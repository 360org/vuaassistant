/**
 * Seam nhà cung cấp model.
 *
 * Đây là chỗ dsh gọi là *capability seam*: một bên khai giao diện, một bên cắm
 * bản cài, một bên dùng. Thêm một nhà cung cấp model là **đăng ký một adapter**,
 * không phải sửa vòng lặp.
 *
 * Bản cũ (`provider-registry.ts`) là một `Map` toàn cục, và adapter tự ghi tên
 * mình vào đó như **tác dụng phụ lúc import** — `import './providers/index.js'`
 * ở boot chỉ có tác dụng vì nó chạy mã. Kiểu đăng ký ẩn đó có ba chỗ đau: không
 * gỡ ra được, không biết ai đã ghi gì, và xoá nhầm một dòng import trông vô hại
 * thì mất luôn một nhà cung cấp mà không có gì báo.
 *
 * Ở đây đăng ký là tường minh và là *effect*: gỡ plugin là rút adapter theo.
 */
import type { Context, Disposer, Plugin } from './types.js';
import type { AgentProvider, ProviderFactory, ProviderOptions } from '../providers/types.js';
import { listProviders, getProviderFactory } from '../providers/provider-registry.js';

declare module './types.js' {
  interface Context {
    /** Seam nhà cung cấp model. Do plugin `providers` gắn lên. */
    providers: ProviderSeam;
  }
}

export interface ProviderSeam {
  /** Cắm một adapter. Trùng tên là nổ. Trả về hàm gỡ. */
  register(name: string, factory: ProviderFactory): Disposer;
  /** Tên các nhà cung cấp đang có, đã chuẩn hoá chữ thường. */
  names(): string[];
  has(name: string): boolean;
  /**
   * Dựng một phiên bản. Tên lạ thì nổ kèm **danh sách đang có** — sai cấu hình
   * phải nói được ngay là sai ở đâu và có những lựa chọn nào.
   */
  create(name: string, options?: ProviderOptions): AgentProvider;
}

export interface ProvidersPluginOptions {
  /**
   * Tên nhà cung cấp mà runner được cấu hình để dùng. Có giá trị thì invariant
   * sẽ khẳng định nó thật sự có mặt — đây là quan hệ hai phía có thể lệch nhau:
   * cấu hình nói một đằng, bản đóng gói mang một nẻo.
   */
  configured?: string;
}

export function createProvidersPlugin(options: ProvidersPluginOptions = {}): Plugin {
  return {
    name: 'providers',
    // Khai phụ thuộc, và ở dưới gọi `ctx.invariants.register` KHÔNG optional
    // chaining. Hai thứ này đi cùng nhau: `?.` biến một lỗi thứ tự nạp thành
    // im lặng bỏ qua — invariant không đăng ký, `verify()` vẫn trả số dương nên
    // cả chốt "sổ rỗng" cũng không bắt được. Ba plugin còn lại đều khai phụ
    // thuộc; chỗ này từng là ngoại lệ duy nhất.
    dependencies: ['invariants'],
    setup(ctx: Context) {
      const local = new Map<string, ProviderFactory>();

      const seam: ProviderSeam = {
        register(name, factory) {
          const key = name.trim().toLowerCase();
          if (!key) throw new Error('nhà cung cấp phải có tên');
          if (local.has(key)) throw new Error(`nhà cung cấp "${key}" đã đăng ký rồi`);
          local.set(key, factory);
          return ctx.effect(() => {
            if (local.get(key) === factory) local.delete(key);
          });
        },

        names() {
          // Gộp cả adapter cắm qua seam lẫn adapter còn tự ghi vào sổ toàn cục
          // cũ, để chuyển dần mà không làm gãy nhà cung cấp nào đang chạy.
          return [...new Set([...local.keys(), ...listProviders()])].sort();
        },

        has(name) {
          return this.names().includes(name.trim().toLowerCase());
        },

        create(name, providerOptions = {}) {
          const key = name.trim().toLowerCase();
          const factory = local.get(key);
          if (factory) return factory(providerOptions);
          if (!this.has(key)) {
            throw new Error(
              `không có nhà cung cấp "${name}". Đang có: ${this.names().join(', ') || '(chưa có cái nào)'}`,
            );
          }
          return getProviderFactory(key)(providerOptions);
        },
      };

      ctx.provide('providers', seam);

      // Invariant: cấu hình gọi tên nhà cung cấp nào thì nhà cung cấp đó phải
      // thật sự có mặt. Hai phía này lệch nhau được — và khi lệch thì người
      // dùng thấy "không chat được" chứ không thấy nguyên nhân.
      ctx.invariants.register('providers', (_context, fail) => {
        if (seam.names().length === 0) {
          fail('không có nhà cung cấp model nào được đăng ký');
        }
        if (options.configured && !seam.has(options.configured)) {
          fail(
            `cấu hình dùng "${options.configured}" nhưng không có adapter nào mang tên đó. ` +
              `Đang có: ${seam.names().join(', ')}`,
          );
        }
      });
    },
  };
}
