/**
 * Cắt tỉa ngữ cảnh, tất định.
 *
 * Mỗi vòng lặp tool đẩy **nguyên** nội dung kết quả tool vào lịch sử hội thoại
 * rồi gửi lại toàn bộ cho model ở vòng sau. Đến vòng 20 thì prompt đầy stack
 * trace cũ và kết quả tool dài ngoằng: vừa đắt (trả tiền theo token, mà lịch
 * sử được gửi lại mỗi vòng nên chi phí tăng theo bình phương), vừa kém chính
 * xác vì model bơi trong rác và quên mất mục tiêu ban đầu.
 *
 * Module này cắt bớt phần rác trước khi gửi. **Không gọi model** — chỉ cắt
 * chuỗi và đếm — nên rẻ tới mức chạy được ở mọi vòng.
 *
 * Ràng buộc phải giữ (nếu phá là hỏng nhà cung cấp, không phải chỉ tốn tiền):
 *
 *  1. Mỗi `assistant` có `tool_calls` phải được theo sau bởi **đủ** `tool`
 *     tương ứng. Gemini từ chối một function call mồ côi.
 *  2. Tin đầu tiên phải là `user` — chính là mục tiêu của cả lượt. Bỏ nó đi
 *     thì model quên mất đang làm gì.
 *
 * Vì vậy chỗ nào cũng **rút gọn nội dung** thay vì xoá tin; chỉ khi lịch sử đã
 * quá dài mới bỏ, và bỏ theo **trọn cụm** (assistant + toàn bộ tool của nó).
 */

import type { ChatMessage } from './providers/types.js';
import { errorFingerprint } from './loop-guard.js';

export interface PruneOptions {
  /** Số ký tự tối đa giữ lại cho một kết quả tool. */
  maxToolChars: number;
  /** Số dòng đầu giữ lại của một stack trace. */
  maxTraceLines: number;
  /** Số cụm tool gần nhất được giữ nguyên vẹn; cũ hơn thì bỏ. */
  window: number;
}

export const DEFAULT_PRUNE: PruneOptions = {
  maxToolChars: 2000,
  maxTraceLines: 8,
  window: 8,
};

/** Dòng có dạng khung ngăn xếp ("at foo (bar.js:1:2)"). */
function isTraceLine(line: string): boolean {
  return /^\s+at\s/.test(line) || /^\s*(File "|\tat )/.test(line);
}

/**
 * Nội dung này có phải một lỗi không.
 *
 * Chỉ **lỗi** mới được gộp khi lặp lại. Dấu vân tay bỏ hết chữ số, nên nếu gộp
 * mọi kết quả tool thì "Kết quả bước 1" và "Kết quả bước 2" thành trùng nhau và
 * ta xoá mất kết quả thật sự khác nhau — model mất dữ liệu chứ không phải chỉ
 * mất rác. Với lỗi thì gộp là đúng: dán lại nguyên văn cùng một lỗi bốn lần
 * không thêm thông tin nào.
 */
function looksLikeError(content: string): boolean {
  const head = content.trim().slice(0, 200).toLowerCase();
  return (
    /^(error|err|exception|traceback|fatal|failed)\b/.test(head) ||
    /^[^\n]{0,80}(error|exception):/.test(head)
  );
}

/**
 * Rút gọn một khối nội dung: cắt bớt stack trace rồi cắt bớt độ dài.
 *
 * Giữ cả đầu lẫn đuôi khi cắt: phần đầu nói lỗi gì, phần đuôi thường mang mã
 * lỗi hoặc gợi ý xử lý. Cắt cụt một phía là mất một nửa thông tin.
 */
export function shrink(content: string, options: PruneOptions): string {
  const lines = content.split('\n');
  const kept: string[] = [];
  let traceRun = 0;
  let dropped = 0;
  for (const line of lines) {
    if (isTraceLine(line)) {
      traceRun++;
      if (traceRun > options.maxTraceLines) { dropped++; continue; }
    } else {
      if (dropped > 0) kept.push(`    … (bỏ bớt ${dropped} dòng ngăn xếp)`);
      traceRun = 0;
      dropped = 0;
    }
    kept.push(line);
  }
  if (dropped > 0) kept.push(`    … (bỏ bớt ${dropped} dòng ngăn xếp)`);

  const text = kept.join('\n');
  if (text.length <= options.maxToolChars) return text;

  const half = Math.floor(options.maxToolChars / 2);
  const omitted = text.length - options.maxToolChars;
  return `${text.slice(0, half)}\n… (bỏ bớt ${omitted} ký tự) …\n${text.slice(-half)}`;
}

/** Vị trí bắt đầu mỗi cụm `assistant`+`tool` trong lịch sử. */
function groupStarts(messages: ChatMessage[]): number[] {
  const starts: number[] = [];
  messages.forEach((message, index) => {
    if (message.role === 'assistant' && message.tool_calls?.length) starts.push(index);
  });
  return starts;
}

/**
 * Cắt tỉa lịch sử hội thoại trước khi gửi cho model.
 *
 * Ba việc, theo thứ tự:
 *   1. Bỏ những cụm tool quá cũ (giữ tin `user` đầu tiên và các tin trước cụm
 *      đầu tiên), thay bằng một dòng ghi chú.
 *   2. Gộp lỗi lặp: các lần gặp **cùng một lỗi** trước lần cuối bị thay bằng
 *      một dòng đếm, vì dán lại nguyên văn 4 lần không thêm thông tin nào.
 *   3. Rút gọn nội dung tool còn lại.
 *
 * Trả về mảng mới; đầu vào không bị sửa.
 */
export function pruneHistory(
  messages: ChatMessage[],
  options: PruneOptions = DEFAULT_PRUNE,
): ChatMessage[] {
  const starts = groupStarts(messages);

  // --- 1. Cửa sổ gần nhất ---------------------------------------------------
  let working = messages;
  if (starts.length > options.window) {
    const cut = starts[starts.length - options.window];
    const head = messages.slice(0, starts[0]); // mục tiêu + bối cảnh ban đầu
    const dropped = starts.length - options.window;
    working = [
      ...head,
      {
        role: 'user',
        content:
          `(Đã bỏ bớt ${dropped} bước công cụ cũ để giữ ngữ cảnh gọn. ` +
          `Các bước gần nhất còn nguyên bên dưới.)`,
      },
      ...messages.slice(cut),
    ];
  }

  // --- 2. Gộp lỗi lặp -------------------------------------------------------
  // Đếm trước, để biết lần xuất hiện CUỐI của mỗi lỗi — lần đó được giữ nguyên
  // văn, những lần trước chỉ còn một dòng đếm.
  const lastIndexOf = new Map<string, number>();
  const seenCount = new Map<string, number>();
  working.forEach((message, index) => {
    if (message.role !== 'tool' || !looksLikeError(message.content)) return;
    const key = errorFingerprint(message.content);
    lastIndexOf.set(key, index);
    seenCount.set(key, (seenCount.get(key) ?? 0) + 1);
  });

  // --- 3. Rút gọn -----------------------------------------------------------
  return working.map((message, index) => {
    if (message.role !== 'tool') return message;
    const key = errorFingerprint(message.content);
    const total = seenCount.get(key) ?? 1;
    if (total > 1 && lastIndexOf.get(key) !== index) {
      return {
        ...message,
        content: `(Lỗi này đã gặp ${total} lần; xem lần gần nhất bên dưới.)`,
      };
    }
    return { ...message, content: shrink(message.content, options) };
  });
}

/**
 * Ước lượng số token của một lịch sử hội thoại.
 *
 * Xấp xỉ 4 ký tự một token — đủ để **so sánh trước/sau khi cắt tỉa**, không
 * dùng để tính tiền. Nhà cung cấp không trả về usage trong luồng sự kiện nên
 * đây là con số duy nhất lấy được mà không phải gọi thêm API.
 */
export function estimateTokens(messages: ChatMessage[]): number {
  const chars = messages.reduce((sum, message) => {
    const calls = message.tool_calls
      ? JSON.stringify(message.tool_calls).length
      : 0;
    return sum + message.content.length + calls;
  }, 0);
  return Math.ceil(chars / 4);
}
