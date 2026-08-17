/**
 * Kernel: nạp plugin, giữ sự kiện, và gỡ sạch khi tắt.
 *
 * Toàn bộ lớp plugin nằm trong tệp này. Không framework, không DI container,
 * không dò tìm ngoài đĩa — chỉ một sổ đăng ký và một cây effect.
 */
import type {
  Context,
  Disposer,
  NotifyEvents,
  Plugin,
  WaterfallEvents,
  WaterfallListener,
} from './types.js';

/** Gọi hàm gỡ đúng một lần, dù người gọi bấm mấy lần. */
function once(dispose: Disposer): Disposer {
  let done = false;
  return () => {
    if (done) return;
    done = true;
    dispose();
  };
}

interface WaterfallEntry {
  /** Số thứ tự đăng ký — lớn hơn nghĩa là bọc ngoài. */
  order: number;
  listener: WaterfallListener<unknown, unknown>;
}

export interface Kernel {
  /**
   * Nạp một plugin. Nổ ngay nếu trùng tên hoặc thiếu phụ thuộc — sai cấu hình
   * phải lộ ra ở chỗ khai báo, không phải ở chỗ dùng.
   */
  use(plugin: Plugin): Promise<void>;
  /** Phát `kernel/ready` sau khi đã nạp xong mọi plugin. */
  start(): Promise<void>;
  /** Gỡ mọi plugin theo thứ tự ngược, rồi phát `kernel/dispose`. */
  dispose(): Promise<void>;
  /** Ngữ cảnh gốc — dùng cho mã chưa chuyển sang plugin. */
  readonly root: Context;
  /** Tên các plugin đã nạp, theo thứ tự nạp. */
  readonly loaded: readonly string[];
}

export function createKernel(): Kernel {
  const notifyListeners = new Map<string, Array<{ order: number; listener: unknown }>>();
  const waterfalls = new Map<string, WaterfallEntry[]>();
  const loaded: string[] = [];
  const pluginDisposers = new Map<string, Disposer[]>();
  let counter = 0;
  let disposed = false;

  /**
   * Ngữ cảnh dùng chung. Dịch vụ mà plugin gắn lên (ctx.tools, ctx.prompt, …)
   * sống ở đây, nên plugin nạp trước vẫn nhìn thấy dịch vụ đăng ký sau — tra
   * cứu đi qua chuỗi prototype lúc truy cập, không phải lúc tạo.
   */
  const shared = {
    on(event: string, listener: unknown): Disposer {
      const list = notifyListeners.get(event) || [];
      const entry = { order: counter++, listener };
      list.push(entry);
      notifyListeners.set(event, list);
      return once(() => {
        const current = notifyListeners.get(event);
        if (!current) return;
        const at = current.indexOf(entry);
        if (at >= 0) current.splice(at, 1);
      });
    },

    async emit(event: string, ...args: unknown[]): Promise<void> {
      // Chụp một bản sao: listener có quyền tự gỡ mình ngay trong lúc chạy.
      const list = [...(notifyListeners.get(event) || [])];
      for (const { listener } of list) {
        await (listener as (...a: unknown[]) => unknown)(...args);
      }
    },

    intercept(event: string, listener: unknown): Disposer {
      const list = waterfalls.get(event) || [];
      const entry: WaterfallEntry = {
        order: counter++,
        listener: listener as WaterfallListener<unknown, unknown>,
      };
      list.push(entry);
      waterfalls.set(event, list);
      return once(() => {
        const current = waterfalls.get(event);
        if (!current) return;
        const at = current.indexOf(entry);
        if (at >= 0) current.splice(at, 1);
      });
    },

    async run(event: string, payload: unknown, base: () => Promise<unknown>): Promise<unknown> {
      const list = waterfalls.get(event);
      if (!list || list.length === 0) return base();
      // Đăng ký sau bọc ngoài đăng ký trước: gấp từ trong ra, nên phần tử cuối
      // danh sách thành lớp ngoài cùng và được chạy đầu tiên.
      let next = base;
      for (const { listener } of [...list].sort((a, b) => a.order - b.order)) {
        const inner = next;
        next = () => listener(payload, inner);
      }
      return next();
    },

    effect(dispose: Disposer): Disposer {
      // Ngữ cảnh gốc không thuộc plugin nào; effect của nó gỡ lúc kernel tắt.
      return registerEffect('<root>', dispose);
    },

    provide(key: string, value: unknown): Disposer {
      return provideFrom('<root>', key, value);
    },

    pluginName: '<root>',
  };

  /** Cùng một đối tượng `shared`, nhìn dưới dạng túi dịch vụ để ghi theo khoá. */
  const services = shared as unknown as Record<string, unknown>;

  /**
   * Gắn dịch vụ lên đối tượng dùng chung, không phải lên khung nhìn của plugin
   * — đó mới là chỗ mọi plugin khác tra tới qua chuỗi prototype.
   */
  function provideFrom(pluginName: string, key: string, value: unknown): Disposer {
    if (Object.prototype.hasOwnProperty.call(services, key)) {
      throw new Error(
        `dịch vụ "${key}" đã có rồi; plugin "${pluginName}" không được gắn đè. ` +
          `Muốn thay thì gỡ plugin sở hữu trước.`,
      );
    }
    services[key] = value;
    return registerEffect(pluginName, () => {
      if (services[key] === value) delete services[key];
    });
  }

  function registerEffect(pluginName: string, dispose: Disposer): Disposer {
    const wrapped = once(dispose);
    const list = pluginDisposers.get(pluginName) || [];
    list.push(wrapped);
    pluginDisposers.set(pluginName, list);
    return wrapped;
  }

  /**
   * Một khung nhìn riêng cho mỗi plugin: `effect` và `pluginName` là của nó,
   * còn mọi dịch vụ tra qua prototype nên luôn thấy trạng thái mới nhất.
   */
  function contextFor(pluginName: string): Context {
    const view = Object.create(shared) as Context & { pluginName: string };
    Object.defineProperty(view, 'pluginName', { value: pluginName, enumerable: true });
    Object.defineProperty(view, 'effect', {
      value: (dispose: Disposer) => registerEffect(pluginName, dispose),
      enumerable: true,
    });
    Object.defineProperty(view, 'provide', {
      value: (key: string, value: unknown) => provideFrom(pluginName, key, value),
      enumerable: true,
    });
    return view;
  }

  return {
    root: shared as unknown as Context,

    get loaded() {
      return loaded;
    },

    async use(plugin: Plugin): Promise<void> {
      if (disposed) throw new Error('kernel đã tắt, không nạp thêm plugin được');
      if (!plugin.name || plugin.name.trim() !== plugin.name) {
        throw new Error(`tên plugin không hợp lệ: ${JSON.stringify(plugin.name)}`);
      }
      if (loaded.includes(plugin.name)) {
        throw new Error(`plugin "${plugin.name}" đã được nạp rồi`);
      }
      for (const dependency of plugin.dependencies || []) {
        if (!loaded.includes(dependency)) {
          throw new Error(
            `plugin "${plugin.name}" cần "${dependency}" nạp trước, nhưng chưa có. ` +
              `Đã nạp: ${loaded.join(', ') || '(chưa có gì)'}`,
          );
        }
      }

      const ctx = contextFor(plugin.name);
      // Ghi tên vào sổ TRƯỚC khi chạy setup, để plugin tự tra được phụ thuộc
      // của mình và để thông điệp lỗi nêu đúng thủ phạm.
      loaded.push(plugin.name);
      try {
        const extra = await plugin.setup(ctx);
        if (typeof extra === 'function') registerEffect(plugin.name, extra);
      } catch (error) {
        // Nạp hỏng thì rút sạch phần nó đã kịp cắm vào, đừng để lại nửa vời.
        await disposePlugin(plugin.name);
        const at = loaded.indexOf(plugin.name);
        if (at >= 0) loaded.splice(at, 1);
        throw new Error(
          `plugin "${plugin.name}" nạp hỏng: ${error instanceof Error ? error.message : String(error)}`,
          { cause: error },
        );
      }
    },

    async start(): Promise<void> {
      await shared.emit('kernel/ready');
    },

    async dispose(): Promise<void> {
      if (disposed) return;
      disposed = true;
      await shared.emit('kernel/dispose');
      for (const name of [...loaded].reverse()) await disposePlugin(name);
      await disposePlugin('<root>');
      loaded.length = 0;
    },
  };

  async function disposePlugin(name: string): Promise<void> {
    const list = pluginDisposers.get(name);
    pluginDisposers.delete(name);
    if (!list) return;
    // Gỡ ngược thứ tự cắm, để thứ dựng sau rút trước.
    for (const dispose of [...list].reverse()) {
      try {
        dispose();
      } catch (error) {
        console.error(
          `[kernel] plugin "${name}" gỡ effect lỗi: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
  }
}

/** Kiểu tiện dụng cho plugin khai báo sự kiện riêng. */
export type { Context, Disposer, NotifyEvents, Plugin, WaterfallEvents, WaterfallListener };
