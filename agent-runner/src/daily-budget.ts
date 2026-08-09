/**
 * Ngân sách token theo ngày.
 *
 * Tác vụ lịch chạy khi không ai ngồi trước máy. Một tác vụ hỏng lúc 2 giờ sáng
 * có thể chạy lại mỗi giờ cho tới sáng, và người dùng chỉ biết khi nhìn hoá
 * đơn. Phanh vòng lặp (`loop-guard.ts`) chặn được một *lượt* chạy hoang, nhưng
 * không chặn được **nhiều lượt** cộng dồn qua cả đêm — đó là việc của module
 * này.
 *
 * Ba mức, theo tỉ lệ đã tiêu trong ngày:
 *
 *   < 80%   `normal` — chạy bình thường, không làm phiền.
 *   >= 80%  `warn`   — vẫn chạy, nhưng báo người dùng **một lần** trong ngày.
 *   >= 100% `stop`   — không chạy nữa, báo người dùng **một lần** trong ngày.
 *
 * Số token là **ước lượng** (xấp xỉ 4 ký tự một token) vì các nhà cung cấp
 * không trả về usage trong luồng sự kiện. Nó đủ để chặn một vòng lặp chạy
 * hoang, nhưng **không phải số tiền thật** — mọi câu chữ hiện ra cho người dùng
 * phải nói rõ điều đó, đừng để họ tưởng là hoá đơn.
 *
 * Lưu trạng thái qua một `BudgetStore` nhỏ để test được mà không cần SQLite.
 */

/** Kho khoá–giá trị tối thiểu; runner nối vào `session_state`. */
export interface BudgetStore {
  get(key: string): string | null;
  set(key: string, value: string): void;
}

export type BudgetMode = 'normal' | 'warn' | 'stop';

export interface BudgetStatus {
  mode: BudgetMode;
  /** Token ước lượng đã tiêu trong ngày. */
  spent: number;
  /** Trần của ngày; 0 nghĩa là không giới hạn. */
  cap: number;
  /** Câu báo cho người dùng, hoặc null khi không cần làm phiền. */
  notice: string | null;
}

/**
 * Trần mặc định: đủ cao để dùng bình thường cả ngày không bao giờ chạm, nhưng
 * vẫn chặn được một vòng lặp chạy hoang suốt đêm. Đặt `VUA_DAILY_TOKEN_BUDGET`
 * để đổi; đặt `0` để tắt hẳn giới hạn.
 */
export const DEFAULT_DAILY_CAP = 1_000_000;

export function configuredCap(env: NodeJS.ProcessEnv = process.env): number {
  const raw = env.VUA_DAILY_TOKEN_BUDGET;
  if (raw === undefined || raw.trim() === '') return DEFAULT_DAILY_CAP;
  const value = Number(raw);
  return Number.isFinite(value) && value >= 0 ? value : DEFAULT_DAILY_CAP;
}

/**
 * Ngày theo giờ máy người dùng, không phải UTC.
 *
 * Ngân sách "mỗi ngày" phải reset lúc nửa đêm **của người dùng**. Dùng UTC thì
 * ở Việt Nam (UTC+7) ngân sách nhảy về 0 lúc 7 giờ sáng — vừa khó hiểu vừa cho
 * một vòng lặp chạy hoang thêm một suất giữa buổi.
 */
export function dayKey(now: Date = new Date()): string {
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

const spendKey = (day: string) => `budget:spend:${day}`;
const noticeKey = (day: string, mode: BudgetMode) => `budget:notice:${day}:${mode}`;

/** Token đã tiêu trong ngày `now`. */
export function spentToday(store: BudgetStore, now: Date = new Date()): number {
  const raw = store.get(spendKey(dayKey(now)));
  const value = raw === null ? 0 : Number(raw);
  return Number.isFinite(value) && value > 0 ? value : 0;
}

/** Cộng thêm phần vừa tiêu vào sổ của ngày. */
export function recordSpend(
  store: BudgetStore,
  tokens: number,
  now: Date = new Date(),
): number {
  if (!Number.isFinite(tokens) || tokens <= 0) return spentToday(store, now);
  const total = spentToday(store, now) + Math.round(tokens);
  store.set(spendKey(dayKey(now)), String(total));
  return total;
}

function percent(spent: number, cap: number): number {
  return cap > 0 ? Math.round((spent / cap) * 100) : 0;
}

/**
 * Trạng thái ngân sách lúc này, kèm câu báo nếu cần.
 *
 * Câu báo chỉ trả về **lần đầu** chạm mỗi mức trong ngày — người dùng không cần
 * nghe lại cùng một cảnh báo mỗi 30 giây cho tới nửa đêm.
 */
export function checkBudget(
  store: BudgetStore,
  options: { cap?: number; now?: Date } = {},
): BudgetStatus {
  const now = options.now ?? new Date();
  const cap = options.cap ?? configuredCap();
  const spent = spentToday(store, now);

  if (cap <= 0) return { mode: 'normal', spent, cap, notice: null };

  const mode: BudgetMode =
    spent >= cap ? 'stop' : spent >= cap * 0.8 ? 'warn' : 'normal';
  if (mode === 'normal') return { mode, spent, cap, notice: null };

  const day = dayKey(now);
  const key = noticeKey(day, mode);
  if (store.get(key) !== null) return { mode, spent, cap, notice: null };
  store.set(key, '1');

  const notice =
    mode === 'stop'
      ? `⏸️ Các tác vụ theo lịch tạm dừng tới hết hôm nay: đã dùng khoảng ` +
        `${spent.toLocaleString('vi-VN')} token, chạm mức trần ${cap.toLocaleString('vi-VN')} ` +
        `mà Sếp đặt. Đây là con số **ước lượng** để chặn chạy hoang, không phải hoá đơn thật.\n\n` +
        `Sếp muốn chạy tiếp hôm nay thì nâng trần trong cài đặt, hoặc chờ sang ngày mai là tự mở lại.`
      : `⚠️ Các tác vụ theo lịch đã dùng khoảng ${percent(spent, cap)}% mức trần hôm nay ` +
        `(~${spent.toLocaleString('vi-VN')}/${cap.toLocaleString('vi-VN')} token, là con số ` +
        `**ước lượng** chứ không phải hoá đơn thật).\n\n` +
        `Em vẫn chạy bình thường, nhưng chạm trần là sẽ tạm dừng tới hết ngày — Sếp để ý giúp em.`;

  return { mode, spent, cap, notice };
}
