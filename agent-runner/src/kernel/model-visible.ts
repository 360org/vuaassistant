/**
 * Sổ ghi những gì model được nhìn thấy.
 *
 * Luật lấy từ dsh: **model thấy gì thì sổ phải có**. Bất cứ thứ gì đi vào lời
 * nhắc gửi model đều phải dựng lại được từ sổ này.
 *
 * Vì sao cần: trước đây tri thức (RAG) được nối thẳng vào chuỗi `instructions`
 * bằng một phép cộng chuỗi, không để lại vết. Khi Sếp hỏi "sao nó trả lời kỳ
 * vậy", không có cách nào biết lượt đó model đã được cho xem thêm những gì —
 * cùng một câu hỏi chạy lại có thể ra kết quả khác mà không ai giải thích được.
 *
 * Cách chữa không phải là "nhớ ghi log": nhớ thì sẽ quên. Ở đây lời nhắc cuối
 * cùng **chỉ có thể dựng bằng `assemble()`**, và `assemble()` dựng nó từ đúng
 * những mục đã ghi. Muốn thêm thứ gì cho model xem thì buộc phải ghi vào sổ —
 * không còn đường nào khác để nhét vào.
 */
import type { Context, Plugin } from './types.js';

export interface VisibleEntry {
  /** Ai đã thêm phần này: 'knowledge', 'memory', 'skill'… */
  readonly source: string;
  /** Nguyên văn phần được thêm vào lời nhắc. */
  readonly text: string;
}

declare module './types.js' {
  interface Context {
    /** Sổ ghi phần model được xem. Do plugin `model-visible` gắn lên. */
    modelVisible: ModelVisibleLedger;
  }
}

export interface ModelVisibleLedger {
  /** Ghi một phần sẽ cho model xem. Trả về chính nó để nối chuỗi lời gọi. */
  record(entry: VisibleEntry): void;
  /** Xoá sổ, gọi khi mở một lượt mới. */
  reset(): void;
  /** Các mục đã ghi trong lượt hiện tại, theo thứ tự ghi. */
  entries(): readonly VisibleEntry[];
  /**
   * Dựng lời nhắc cuối cùng: phần nền cộng đúng những mục đã ghi.
   *
   * Đây là lối duy nhất để dựng lời nhắc, nên không thể có thứ gì lọt vào mắt
   * model mà không nằm trong sổ.
   */
  assemble(base: string): string;
}

export const modelVisiblePlugin: Plugin = {
  name: 'model-visible',
  setup(ctx: Context) {
    let entries: VisibleEntry[] = [];

    ctx.provide('modelVisible', {
      record(entry) {
        if (!entry.source.trim()) throw new Error('phần cho model xem phải khai nguồn');
        entries.push(entry);
      },
      reset() {
        entries = [];
      },
      entries() {
        return entries;
      },
      assemble(base) {
        return [base, ...entries.map((entry) => entry.text)].join('');
      },
    });

    // Mở lượt mới là xoá sổ: sổ của lượt trước không được dính sang lượt sau.
    ctx.effect(ctx.on('turn/start', () => {
      entries = [];
    }));
  },
};

/**
 * Invariant: lời nhắc gửi model phải dựng lại được từ sổ.
 *
 * Kiểm quan hệ giữa hai thứ có thể lệch nhau thật — chuỗi thật sự gửi đi, và
 * tổng các mục đã ghi. Ai đó nối thêm chuỗi thẳng vào lời nhắc mà không ghi sổ
 * thì hai bên lệch, và invariant nổ.
 */
export const modelVisibleInvariantPlugin: Plugin = {
  name: 'model-visible-invariant',
  dependencies: ['invariants', 'model-visible'],
  setup(ctx: Context) {
    ctx.invariants.register('model-visible', (context, fail) => {
      const base = 'NEN';
      const before = context.modelVisible.entries().length;
      const assembled = context.modelVisible.assemble(base);
      if (!assembled.startsWith(base)) {
        fail('assemble() làm mất phần nền của lời nhắc');
      }
      const rebuilt = [base, ...context.modelVisible.entries().map((e) => e.text)].join('');
      if (assembled !== rebuilt) {
        fail('lời nhắc gửi model không dựng lại được từ sổ — có thứ lọt vào ngoài sổ');
      }
      if (context.modelVisible.entries().length !== before) {
        fail('assemble() làm thay đổi sổ; nó phải là phép đọc thuần');
      }
    });
  },
};
