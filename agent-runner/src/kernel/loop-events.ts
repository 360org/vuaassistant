/**
 * Mốc vòng lặp, công bố dưới dạng sự kiện có kiểu.
 *
 * Trước đây muốn quan sát hay chen vào một lượt thì phải sửa thẳng
 * `poll-loop.ts` — nên mọi mối quan tâm mới đều đổ dồn vào một tệp, và tệp đó
 * phình lên 563 dòng trộn bảy việc. Nay các mốc là sự kiện: cắm thêm được mà
 * không đụng vào vòng lặp.
 *
 * Một **bước** là một lần gọi model cộng các tool nó gọi. Một **lượt** gồm một
 * hoặc nhiều bước, mở khi nhận việc và đóng khi không còn gì nợ lại.
 */
import type { ToolCall, ToolResult } from '../providers/types.js';

/** Vì sao một lượt kết thúc. */
export type TurnOutcome =
  | 'completed'
  /** Phanh chống lặp cắt ngang: cùng một lỗi lặp lại, hoặc không tiến triển. */
  | 'loop-guard'
  /** Chạm trần số bước. */
  | 'max-steps'
  | 'error';

export interface TurnStart {
  readonly agentId: string;
  /** Việc người dùng nhờ, nguyên văn. */
  readonly goal: string;
}

export interface TurnEnd {
  readonly agentId: string;
  readonly outcome: TurnOutcome;
  readonly steps: number;
  /** Ước lượng token đã tiêu trong cả lượt. */
  readonly tokensEstimate: number;
}

export interface StepStart {
  /** Đếm từ 0, trong phạm vi một lượt. */
  readonly index: number;
}

export interface StepEnd {
  readonly index: number;
  /** Số tool model gọi ở bước này. */
  readonly toolCalls: number;
}

export interface ToolOutcome {
  readonly call: ToolCall;
  readonly result: ToolResult;
}

declare module './types.js' {
  interface NotifyEvents {
    /** Mở một lượt, trước lần gọi model đầu tiên. */
    'turn/start': (payload: TurnStart) => void;
    /** Đóng một lượt. Luôn phát, kể cả khi lượt bị phanh cắt ngang. */
    'turn/end': (payload: TurnEnd) => void;
    /** Mở một bước. */
    'step/start': (payload: StepStart) => void;
    /** Đóng một bước, sau khi tool của bước đó đã chạy xong. */
    'step/end': (payload: StepEnd) => void;
    /** Một tool đã chạy xong, dù thành công hay lỗi. */
    'tool/result': (payload: ToolOutcome) => void;
  }
}
