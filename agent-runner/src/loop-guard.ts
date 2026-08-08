/**
 * Phanh cho vòng lặp agentic.
 *
 * Trước đây vòng lặp tool-calling chỉ có đúng một cái phanh là trần số vòng
 * (`MAX_TOOL_ITERATIONS`). Đó là phanh cùn: agent gọi một tool hỏng, nhận về
 * cùng một lỗi, rồi gọi lại y hệt — cho tới hết 25 vòng. Người dùng trả tiền
 * cho 25 lượt gọi model để nhận về đúng một thông báo lỗi.
 *
 * Module này thêm ba điều kiện dừng nữa và **hoàn toàn tất định** — không gọi
 * model để quyết định, nên rẻ tới mức chạy được ở mọi vòng lặp:
 *
 *   1. Giậm chân       — cùng một lỗi lặp lại N lần liên tiếp.
 *   2. Không tiến triển — N tool call hỏng liên tiếp (dù lỗi khác nhau).
 *   3. Trần token      — chỉ bật khi có cấu hình ngân sách.
 *
 * Hàm ở đây thuần tuý (không đọc DB, không I/O) nên test được trực tiếp:
 * xem `agent-runner/scripts/loop-guard-check.mjs`.
 */

/** Một lần gọi tool trong vòng lặp. */
export interface Attempt {
  /** Tên tool đã gọi. */
  tool: string;
  /** Tool chạy xong không lỗi hay không. */
  ok: boolean;
  /** Thông điệp lỗi, khi `ok` là false. */
  error?: string;
  /** Token ước lượng đã tiêu cho vòng này (tuỳ chọn). */
  tokens?: number;
}

export type StopReason =
  | 'iteration-cap'
  | 'stagnation'
  | 'no-progress'
  | 'token-budget';

export type LoopVerdict =
  | { action: 'continue' }
  | { action: 'stop'; reason: StopReason; message: string };

export interface GuardLimits {
  /** Trần cứng số vòng lặp tool. */
  maxIterations: number;
  /** Dừng khi cùng một lỗi lặp lại đủ số lần liên tiếp này. */
  stagnation: number;
  /** Dừng sau đủ số tool call hỏng liên tiếp này. */
  noProgress: number;
  /** Trần token cho cả lượt; bỏ trống là không giới hạn. */
  tokenBudget?: number;
}

export const DEFAULT_LIMITS: GuardLimits = {
  maxIterations: 25,
  stagnation: 3,
  noProgress: 5,
};

/**
 * Rút gọn một thông điệp lỗi thành "dấu vân tay" để so sánh.
 *
 * Hai lần thử cùng một việc hỏng hiếm khi cho ra chuỗi lỗi giống hệt nhau:
 * số cổng, id request, timestamp, đường dẫn tạm… đổi mỗi lần. So sánh nguyên
 * văn sẽ không bao giờ thấy "cùng một lỗi", và phanh giậm chân thành vô dụng.
 * Nên ở đây bỏ hết phần biến thiên rồi mới so.
 */
export function errorFingerprint(error: string): string {
  return error
    .toLowerCase()
    // thời điểm ISO
    .replace(/\d{4}-\d{2}-\d{2}t[\d:.]+z?/g, '<time>')
    // uuid
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g, '<id>')
    // chuỗi hex dài (id request, hash)
    .replace(/\b[0-9a-f]{16,}\b/g, '<id>')
    // mọi con số còn lại: cổng, dòng, mã, số lần thử
    .replace(/\d+/g, '<n>')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 200);
}

/** Số lần thử hỏng liên tiếp tính từ cuối. */
function trailingFailures(attempts: Attempt[]): number {
  let count = 0;
  for (let i = attempts.length - 1; i >= 0 && !attempts[i].ok; i--) count++;
  return count;
}

/** Số lần lỗi giống nhau lặp liên tiếp tính từ cuối. */
function trailingSameError(attempts: Attempt[]): number {
  const last = attempts[attempts.length - 1];
  if (!last || last.ok || !last.error) return 0;
  const target = errorFingerprint(last.error);
  let count = 0;
  for (let i = attempts.length - 1; i >= 0; i--) {
    const attempt = attempts[i];
    if (attempt.ok || !attempt.error) break;
    if (errorFingerprint(attempt.error) !== target) break;
    count++;
  }
  return count;
}

/** Tổng token ước lượng đã tiêu. */
function totalTokens(attempts: Attempt[]): number {
  return attempts.reduce((sum, attempt) => sum + (attempt.tokens ?? 0), 0);
}

/**
 * Câu báo cho người dùng khi vòng lặp bị cắt.
 *
 * Người dùng không đọc mã và không quan tâm "stagnation" là gì. Câu phải nói
 * được ba điều: đã thử gì, hỏng vì sao, và giờ nên làm gì — cùng chuẩn với
 * `providerErrors.ts`: không đổ JSON thô, không im lặng bỏ cuộc.
 */
export function stopMessage(
  reason: StopReason,
  attempts: Attempt[],
  limits: GuardLimits,
): string {
  const last = attempts[attempts.length - 1];
  const detail = last?.error ? ` Lỗi gần nhất: ${last.error.trim().slice(0, 300)}` : '';
  const tool = last?.tool ? ` bằng công cụ \`${last.tool}\`` : '';

  switch (reason) {
    case 'stagnation':
      return (
        `Em đã thử${tool} ${trailingSameError(attempts)} lần và lần nào cũng gặp đúng một lỗi, ` +
        `nên dừng lại để khỏi tốn thêm chi phí.${detail}\n\n` +
        `Sếp muốn em thử hướng khác, hay kiểm tra lại phần kết nối trước?`
      );
    case 'no-progress':
      return (
        `Em đã thử ${trailingFailures(attempts)} bước liên tiếp nhưng bước nào cũng hỏng, ` +
        `nên dừng lại thay vì đi tiếp trong vô định.${detail}\n\n` +
        `Sếp mô tả rõ hơn kết quả mong muốn giúp em, hoặc bảo em thử cách khác nhé.`
      );
    case 'token-budget':
      return (
        `Việc này đã dùng hết phần chi phí cho phép (khoảng ${totalTokens(attempts)} token), ` +
        `nên em dừng ở đây để không phát sinh thêm.\n\n` +
        `Sếp muốn em tiếp tục thì bảo em một tiếng, hoặc chia nhỏ việc ra cho nhẹ hơn.`
      );
    case 'iteration-cap':
      return (
        `Việc này đã qua ${limits.maxIterations} bước mà vẫn chưa xong, nên em dừng lại báo Sếp ` +
        `thay vì chạy tiếp.\n\n` +
        `Có thể việc đang quá lớn cho một lượt — Sếp thử chia nhỏ ra giúp em.`
      );
  }
}

/**
 * Có nên chạy tiếp vòng lặp nữa không.
 *
 * Gọi TRƯỚC mỗi vòng, với toàn bộ lần thử đã có. Trả `continue` để đi tiếp,
 * hoặc `stop` kèm câu đã sẵn sàng gửi thẳng cho người dùng.
 */
export function checkLoop(
  attempts: Attempt[],
  iteration: number,
  limits: GuardLimits = DEFAULT_LIMITS,
): LoopVerdict {
  const stop = (reason: StopReason): LoopVerdict => ({
    action: 'stop',
    reason,
    message: stopMessage(reason, attempts, limits),
  });

  if (iteration >= limits.maxIterations) return stop('iteration-cap');

  // Giậm chân được kiểm trước "không tiến triển": cùng một lỗi lặp lại là dấu
  // hiệu rõ ràng hơn và cho câu báo cụ thể hơn cho người dùng.
  if (limits.stagnation > 0 && trailingSameError(attempts) >= limits.stagnation) {
    return stop('stagnation');
  }

  if (limits.noProgress > 0 && trailingFailures(attempts) >= limits.noProgress) {
    return stop('no-progress');
  }

  if (limits.tokenBudget && totalTokens(attempts) >= limits.tokenBudget) {
    return stop('token-budget');
  }

  return { action: 'continue' };
}
