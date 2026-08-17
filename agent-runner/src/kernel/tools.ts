/**
 * Sổ đăng ký tool — nơi tool **tự khai** tính chất của mình.
 *
 * Vì sao phải đổi: bản cũ (`capability-rail.ts`) ĐOÁN tool nào nguy hiểm bằng
 * regex khớp vào tên tool. Chạy thử trên chính mã nguồn cho thấy nó sai cả hai
 * chiều — `wire_transfer`, `charge_card`, `drop_database`, `deploy_production`
 * đều lọt qua không cần duyệt, còn `read_messages` chỉ đọc lại bị bắt duyệt.
 * Hỏi oan nhiều lần dạy người dùng bấm "Đồng ý" theo phản xạ, làm hỏng luôn
 * giá trị của lần hỏi thật.
 *
 * Cách chữa lấy từ DeepSeek Harness: registry không bao giờ đoán. Tool khai
 * `sideEffect` và `requiresApproval` ngay tại chỗ định nghĩa, và TypeScript bắt
 * buộc khai — quên là không biên dịch được. Tool từ nguồn ngoài (MCP) không tự
 * khai được thì mặc định coi là **nguy hiểm nhất có thể**, chứ không phải an
 * toàn nhất: nghi ngờ thì nghiêng về phía chặt.
 */
import type { Context, Disposer } from './types.js';
import type { ToolDefinition, ToolResult } from '../providers/types.js';

/** Nguồn gốc của tool — quyết định mức tin cậy mặc định. */
export type ToolOrigin = 'native' | 'builtin' | 'mcp';

/** Phần tính chất mà mọi tool bắt buộc khai. */
export interface ToolPolicy {
  /**
   * Tool có thay đổi thứ gì ngoài bộ nhớ tiến trình không: ghi tệp, gọi mạng
   * có tác dụng phụ, gửi tin, tiêu tiền. Chỉ đọc thì `false`.
   */
  readonly sideEffect: boolean;
  /**
   * Có phải hỏi người dùng trước khi chạy không. Đặt `true` cho mọi thứ gửi ra
   * ngoài, tiêu tiền, hoặc dùng credential.
   */
  readonly requiresApproval: boolean;
}

/** Một tool đã đăng ký. */
export interface ToolSpec extends ToolPolicy {
  readonly name: string;
  readonly description: string;
  readonly input_schema: Record<string, unknown>;
  readonly origin: ToolOrigin;
  /** Chạy tool. Registry không bắt lỗi thay — lỗi nổi lên cho lớp gọi xử lý. */
  execute(args: Record<string, unknown>): Promise<ToolResult> | ToolResult;
}

/** Đăng ký một tool: mọi trường trừ `origin` (registry tự gắn). */
export type ToolRegistration = Omit<ToolSpec, 'origin'>;

/**
 * Tính chất mặc định cho tool đến từ nguồn ngoài.
 *
 * Nghiêng hẳn về phía chặt: một server MCP lạ cắm vào có thể mang tool chuyển
 * tiền mà tên không gợi ra điều gì. Mặc định "phải hỏi" chỉ gây phiền; mặc
 * định "khỏi hỏi" gây mất tiền.
 */
export const UNTRUSTED_TOOL_POLICY: ToolPolicy = {
  sideEffect: true,
  requiresApproval: true,
};

/** Payload của thác nước `tools/pre-execute`. */
export interface ToolExecution {
  readonly tool: ToolSpec;
  readonly args: Record<string, unknown>;
  /** Người dùng đã duyệt lượt chạy này chưa. */
  readonly approved: boolean;
  /**
   * Việc người dùng đang nhờ, để lớp can thiệp xét hành động trong đúng bối
   * cảnh. Đi kèm từng lời gọi chứ không nhét sẵn vào plugin: plugin nạp một
   * lần rồi sống mãi, còn mục tiêu thì đổi theo từng lượt.
   */
  readonly goal: string;
}

declare module './types.js' {
  interface WaterfallEvents {
    /**
     * Chạy trước mỗi tool. Listener gọi `next()` để cho chạy, hoặc trả thẳng
     * một `ToolResult` lỗi để chặn. Đây là chỗ chính sách của người dùng có
     * hiệu lực thật — không phải nhét luật vào prompt rồi mong model nghe.
     */
    'tools/pre-execute': (
      payload: ToolExecution,
      next: () => Promise<ToolResult>,
    ) => Promise<ToolResult>;
  }

  interface Context {
    /** Sổ đăng ký tool. Do plugin `tools` gắn lên. */
    tools: ToolRegistry;
  }
}

export interface ToolRegistry {
  /** Đăng ký một tool. Trùng tên là nổ. Trả về hàm gỡ. */
  register(registration: ToolRegistration, origin: ToolOrigin): Disposer;
  /**
   * Đăng ký tool từ nguồn ngoài không tự khai được tính chất. Áp
   * `UNTRUSTED_TOOL_POLICY`, và ghi rõ ở đây để không ai vô tình nới lỏng.
   */
  registerUntrusted(
    registration: Omit<ToolRegistration, keyof ToolPolicy>,
    origin: ToolOrigin,
  ): Disposer;
  get(name: string): ToolSpec | undefined;
  list(): readonly ToolSpec[];
  /**
   * Phần gửi cho model. Dựng bằng **danh sách trường cho phép**, không phải
   * xoá bớt trường: thêm trường mới vào `ToolSpec` sau này sẽ mặc định KHÔNG
   * lọt ra ngoài, thay vì mặc định lọt cho tới khi ai đó nhớ ra.
   */
  definitions(): ToolDefinition[];
  /** Chạy một tool qua thác nước `tools/pre-execute`. */
  execute(
    name: string,
    args: Record<string, unknown>,
    options?: { approved?: boolean; goal?: string },
  ): Promise<ToolResult>;
}

/** Plugin gắn `ctx.tools`. */
export const toolsPlugin = {
  name: 'tools',
  setup(ctx: Context): void {
    const registry = new Map<string, ToolSpec>();

    function add(spec: ToolSpec): Disposer {
      if (!spec.name || spec.name.trim() !== spec.name) {
        throw new Error(`tên tool không hợp lệ: ${JSON.stringify(spec.name)}`);
      }
      const existing = registry.get(spec.name);
      if (existing) {
        throw new Error(
          `tool "${spec.name}" đã được đăng ký bởi nguồn "${existing.origin}"; ` +
            `không cho phép đăng ký đè từ "${spec.origin}"`,
        );
      }
      registry.set(spec.name, spec);
      return ctx.effect(() => {
        // Chỉ xoá đúng bản mình đã cắm, phòng trường hợp tên được đăng ký lại.
        if (registry.get(spec.name) === spec) registry.delete(spec.name);
      });
    }

    const tools: ToolRegistry = {
      register(registration, origin) {
        return add({ ...registration, origin });
      },

      registerUntrusted(registration, origin) {
        return add({ ...registration, ...UNTRUSTED_TOOL_POLICY, origin });
      },

      get(name) {
        return registry.get(name);
      },

      list() {
        return [...registry.values()].sort((a, b) => a.name.localeCompare(b.name));
      },

      definitions() {
        return this.list().map((spec) => ({
          name: spec.name,
          description: spec.description,
          input_schema: spec.input_schema,
        }));
      },

      async execute(name, args, options) {
        const tool = registry.get(name);
        if (!tool) {
          return {
            tool_call_id: '',
            content: `Không có tool tên "${name}".`,
            is_error: true,
          };
        }
        const payload: ToolExecution = {
          tool,
          args,
          approved: options?.approved === true,
          goal: options?.goal ?? '',
        };
        return ctx.run<ToolExecution, ToolResult>('tools/pre-execute', payload, async () =>
          tool.execute(args),
        );
      },
    };

    ctx.provide('tools', tools);
    ctx.effect(() => {
      registry.clear();
    });
  },
};
