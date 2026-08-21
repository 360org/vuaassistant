/**
 * Chính sách do người dùng đặt, được rail thi hành.
 *
 * Trước đây mọi luật đều nằm **trong mã**: `capability-rail.ts` quyết định cái
 * gì cần duyệt, `native-tools` quyết định thư mục nào đọc được. Người dùng muốn
 * đổi luật thì phải chờ bản phát hành mới. Module này đưa luật ra một tệp mà
 * ứng dụng ghi và runner đọc.
 *
 * Điểm cốt lõi — cũng là thứ đáng học nhất từ loop-engineering: **luật phải
 * được máy thi hành**. Nhét luật vào system prompt rồi mong model nghe lời thì
 * đó là gợi ý, không phải luật. Chỗ chặn thật nằm ở rail, nơi mọi capability
 * bắt buộc đi qua trước khi chạy.
 *
 * Tệp hỏng, thiếu, hay có trường lạ đều **không** được làm agent chết: khi đó
 * quay về chính sách mặc định (chặt hơn, không lỏng hơn).
 */

import fs from 'fs';
import path from 'path';
import { getDataDir } from './util/data-dir.js';

export interface Policy {
  /** Đường dẫn agent không được đụng tới, dù đã được cấp workspace. */
  deniedPaths: string[];
  /** Capability luôn phải hỏi người dùng, kể cả khi rail thấy nó vô hại. */
  alwaysAsk: string[];
  /** Số hành động gửi ra ngoài tối đa mỗi giờ; 0 là không giới hạn. */
  maxOutboundPerHour: number;
  /**
   * Bật vai kiểm độc lập trước mỗi hành động có hậu quả thật.
   *
   * Tốn thêm một lượt gọi model cho mỗi hành động, nên mặc định tắt: người
   * dùng bật khi giao cho Agent những việc tiêu tiền hoặc gửi ra ngoài.
   */
  verifySideEffects: boolean;
}

export const DEFAULT_POLICY: Policy = {
  // Mặc định chặn đúng những chỗ mà lộ ra là mất tài khoản: khoá, ví, cấu hình
  // môi trường. Người dùng thêm bớt được, nhưng mặc định phải an toàn.
  deniedPaths: ['.env', '.ssh', '.aws', '.gnupg', 'id_rsa', 'credentials', 'wallet'],
  alwaysAsk: [],
  maxOutboundPerHour: 0,
  verifySideEffects: false,
};

function policyFile(): string {
  return path.join(getDataDir(), 'policy.json');
}

/** Lấy mảng chuỗi sạch từ dữ liệu người dùng ghi ra; bỏ mọi thứ không phải chuỗi. */
function stringList(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null;
  const list = value.filter((item): item is string => typeof item === 'string' && item.trim() !== '');
  return list.map((item) => item.trim());
}

/**
 * Đọc chính sách từ đĩa, hợp nhất với mặc định.
 *
 * Trường nào thiếu hoặc sai kiểu thì lấy mặc định — **không** bỏ qua cả tệp,
 * vì như vậy một dấu phẩy thừa sẽ âm thầm gỡ hết mọi giới hạn người dùng đặt.
 */
export function readPolicy(file: string = policyFile()): Policy {
  let raw: unknown;
  try {
    raw = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return { ...DEFAULT_POLICY };
  }
  if (!raw || typeof raw !== 'object') return { ...DEFAULT_POLICY };
  const data = raw as Record<string, unknown>;

  const limit = Number(data.maxOutboundPerHour);
  return {
    deniedPaths: stringList(data.deniedPaths) ?? DEFAULT_POLICY.deniedPaths,
    alwaysAsk: stringList(data.alwaysAsk) ?? DEFAULT_POLICY.alwaysAsk,
    maxOutboundPerHour:
      Number.isFinite(limit) && limit >= 0 ? Math.floor(limit) : DEFAULT_POLICY.maxOutboundPerHour,
    verifySideEffects:
      typeof data.verifySideEffects === 'boolean'
        ? data.verifySideEffects
        : DEFAULT_POLICY.verifySideEffects,
  };
}

/**
 * Đường dẫn này có bị chính sách cấm không.
 *
 * So trên đường dẫn đã chuẩn hoá và theo **từng đoạn**, không phải `includes`
 * trên chuỗi thô. `includes` vừa lọt (`..%2f`, dấu gạch ngược trên Windows) vừa
 * chặn oan (`/home/an/duan-env/ghi-chu.txt` dính luật `.env`).
 */
export function pathDenied(target: string, policy: Policy): string | null {
  const normalized = target.replace(/\\/g, '/').toLowerCase();
  const segments = normalized.split('/').filter(Boolean);
  for (const rule of policy.deniedPaths) {
    const needle = rule.replace(/\\/g, '/').toLowerCase().replace(/^\/+|\/+$/g, '');
    if (!needle) continue;
    if (needle.includes('/')) {
      // Luật nhiều đoạn: khớp một dãy đoạn liên tiếp.
      if (normalized.includes(`/${needle}/`) || normalized.endsWith(`/${needle}`)) return rule;
      continue;
    }
    if (segments.includes(needle)) return rule;
  }
  return null;
}

/** Capability này có bị chính sách bắt hỏi người dùng không. */
export function requiresAsk(name: string, policy: Policy): boolean {
  return policy.alwaysAsk.some((entry) => entry.toLowerCase() === name.toLowerCase());
}

/**
 * Bộ đếm hành động gửi ra ngoài, theo cửa sổ trượt một giờ.
 *
 * Dùng cửa sổ trượt chứ không phải "mỗi giờ tròn reset": với mốc giờ tròn,
 * agent gửi hết hạn mức lúc 8:59 rồi gửi tiếp cả hạn mức mới lúc 9:01 — người
 * dùng nhận gấp đôi số tin trong hai phút, đúng thứ giới hạn này để tránh.
 */
export class OutboundLimiter {
  private readonly stamps: number[] = [];

  constructor(private readonly policy: Policy) {}

  /**
   * Ghi nhận một hành động gửi ra ngoài. Trả về lý do từ chối, hoặc null nếu
   * được phép (và khi đó hành động đã được tính vào hạn mức).
   */
  take(now: number = Date.now()): string | null {
    const limit = this.policy.maxOutboundPerHour;
    if (limit <= 0) return null;

    const cutoff = now - 3_600_000;
    while (this.stamps.length > 0 && this.stamps[0] <= cutoff) this.stamps.shift();

    if (this.stamps.length >= limit) {
      const oldest = this.stamps[0];
      const minutes = Math.max(1, Math.ceil((oldest + 3_600_000 - now) / 60_000));
      return (
        `Chính sách của Sếp cho tối đa ${limit} lần gửi ra ngoài mỗi giờ, và em đã dùng hết. ` +
        `Khoảng ${minutes} phút nữa là gửi tiếp được. Nếu việc này gấp, Sếp nâng giới hạn ` +
        `trong phần Cài đặt giúp em.`
      );
    }

    this.stamps.push(now);
    return null;
  }
}
