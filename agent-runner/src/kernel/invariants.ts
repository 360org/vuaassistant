/**
 * Sổ invariant chạy lúc runtime.
 *
 * Lấy từ DeepSeek Harness: mỗi phần của hệ thống tự khẳng định **quan hệ mà nó
 * sở hữu**, và lời khẳng định đó chạy trên máy thật chứ không nằm trong một bài
 * test riêng có thể lệch khỏi mã.
 *
 * Luật quan trọng nhất — cũng là luật dsh nhấn mạnh: invariant phải kiểm **quan
 * hệ giữa hai thứ có thể lệch nhau**, không kiểm "hàm này có tồn tại không".
 * Kiểm sự tồn tại thì luôn xanh và chẳng nói lên điều gì; nó chỉ tạo cảm giác
 * an toàn. Ví dụ đúng: "mọi tool gửi cho model đều phải có trong sổ đăng ký" —
 * hai phía này có thật, và có thể lệch nhau thật.
 *
 * Vi phạm thì **nổ to kèm tên chủ sở hữu**, không ghi log rồi đi tiếp: một
 * invariant bị vi phạm nghĩa là giả định nền đã sai, chạy tiếp chỉ làm hỏng xa
 * hơn chỗ dễ tìm.
 */
import type { Context, Disposer, Plugin } from './types.js';

/** Báo vi phạm. Luôn ném, nên không bao giờ trả về. */
export type Fail = (message: string) => never;

/** Một lời khẳng định. Trả về khi mọi thứ đúng, gọi `fail` khi sai. */
export type InvariantCheck = (ctx: Context, fail: Fail) => void | Promise<void>;

export class InvariantError extends Error {
  readonly code = 'INVARIANT';
  constructor(readonly owner: string, message: string) {
    super(`invariant bị vi phạm bởi "${owner}": ${message}`);
    this.name = 'InvariantError';
  }
}

declare module './types.js' {
  interface Context {
    /** Sổ invariant. Do plugin `invariants` gắn lên. */
    invariants: InvariantRegistry;
  }
}

export interface InvariantRegistry {
  /**
   * Đăng ký lời khẳng định của một phần. Trùng tên chủ sở hữu là nổ — hai chỗ
   * cùng nhận một cái tên thì không truy được trách nhiệm khi vi phạm.
   */
  register(owner: string, check: InvariantCheck): Disposer;
  /** Tên các chủ sở hữu đã đăng ký. */
  owners(): string[];
  /**
   * Chạy hết. Ném ở lời khẳng định sai đầu tiên.
   * @returns số lời khẳng định đã chạy — để chỗ gọi phát hiện được cảnh "chạy
   * 0 cái mà vẫn báo đạt", tức là sổ rỗng chứ không phải hệ thống lành.
   */
  verify(): Promise<number>;
}

export const invariantsPlugin: Plugin = {
  name: 'invariants',
  setup(ctx: Context) {
    const checks = new Map<string, InvariantCheck>();

    ctx.provide('invariants', {
      register(owner, check) {
        if (!owner.trim()) throw new Error('invariant phải có tên chủ sở hữu');
        if (checks.has(owner)) {
          throw new Error(`invariant của "${owner}" đã được đăng ký rồi`);
        }
        checks.set(owner, check);
        return ctx.effect(() => {
          if (checks.get(owner) === check) checks.delete(owner);
        });
      },

      owners() {
        return [...checks.keys()].sort();
      },

      async verify() {
        let ran = 0;
        for (const [owner, check] of checks) {
          const fail: Fail = (message) => {
            throw new InvariantError(owner, message);
          };
          await check(ctx, fail);
          ran += 1;
        }
        return ran;
      },
    });
  },
};

/**
 * Invariant của lõi runner.
 *
 * Cả hai đều kiểm quan hệ giữa hai phía có thể lệch nhau thật — và cả hai đều
 * đã từng lệch trong chính dự án này.
 */
export const coreInvariantsPlugin: Plugin = {
  name: 'core-invariants',
  dependencies: ['invariants', 'tools', 'prompt'],
  setup(ctx: Context) {
    // 1. Thứ gửi cho model phải khớp sổ đăng ký.
    //    Lệch chiều này nghĩa là model được mời gọi một tool không tồn tại,
    //    hoặc trường nội bộ của host lọt ra ngoài.
    ctx.invariants.register('tools', (context, fail) => {
      const registered = new Set(context.tools.list().map((tool) => tool.name));
      for (const definition of context.tools.definitions()) {
        if (!registered.has(definition.name)) {
          fail(`gửi cho model tool "${definition.name}" không có trong sổ đăng ký`);
        }
        const extra = Object.keys(definition).filter(
          (key) => !['name', 'description', 'input_schema'].includes(key),
        );
        if (extra.length) {
          fail(`trường nội bộ lọt ra model ở tool "${definition.name}": ${extra.join(', ')}`);
        }
      }
    });

    // 2. Prompt phải nhắc tới mọi tool đang đăng ký.
    //    Đây đúng là chỗ đã lệch thật: prompt viết tay nêu 9 tool trong khi sổ
    //    có 21, nên 12 tool nằm đó mà model không biết là có.
    ctx.invariants.register('prompt', (context, fail) => {
      const built = context.prompt.build();
      const missing = context.tools
        .list()
        .map((tool) => tool.name)
        .filter((name) => !built.includes(name));
      if (missing.length) {
        fail(`prompt không nhắc tới ${missing.length} tool đang đăng ký: ${missing.join(', ')}`);
      }
    });
  },
};
