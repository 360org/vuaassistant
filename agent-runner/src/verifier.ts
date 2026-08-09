/**
 * Vai kiểm độc lập (maker / checker).
 *
 * Agent làm việc có hậu quả thật — gửi email cho khách, chạy chiến dịch quảng
 * cáo bằng tiền của Sếp — thì không nên tự chấm bài của chính mình. Module này
 * dựng một vai **kiểm** riêng: nhận mô tả hành động sắp chạy, và mặc định
 * **TỪ CHỐI** cho tới khi thấy đủ căn cứ.
 *
 * Ba điều bắt buộc, nếu phá thì vai kiểm chỉ còn là thủ tục tốn tiền:
 *
 *  1. **Phiên riêng.** Không truyền `continuation` của vai làm sang. Dùng chung
 *     phiên thì vai kiểm đọc lại lý lẽ của chính mình và gật đầu — nó không
 *     kiểm gì cả, chỉ tự khen.
 *  2. **Không có công cụ.** Vai kiểm xem xét rồi phán, không hành động. Đưa
 *     công cụ cho nó là mở thêm một đường chạy side effect không ai canh.
 *  3. **Mặc định TỪ CHỐI.** Model trả lời rỗng, sai định dạng, hay chính lời
 *     gọi bị lỗi mạng đều phải ra "không duyệt". Mọi cách hỏng đều nghiêng về
 *     phía an toàn, không nghiêng về phía cho chạy.
 *
 * Vai kiểm tốn một lượt gọi model nên chỉ bật cho hành động thật sự có hậu quả
 * (`side_effect` + người dùng bật trong chính sách), không chạy cho mọi thứ.
 */

import type { AgentProvider } from './providers/types.js';

export type Verdict = 'DUYET' | 'TU_CHOI' | 'HOI_NGUOI_DUNG';

export interface VerifierDecision {
  verdict: Verdict;
  /** Lý do, đã sẵn sàng đưa cho người dùng đọc. */
  reason: string;
}

export interface ActionUnderReview {
  /** Tên capability sắp chạy. */
  name: string;
  /** Mô tả capability, lấy từ rail. */
  summary: string;
  /** Tham số sắp dùng. */
  args: Record<string, unknown>;
  /** Việc người dùng đã yêu cầu, để đối chiếu ý định. */
  goal: string;
}

export const VERIFIER_INSTRUCTIONS = [
  'Bạn là NGƯỜI KIỂM trong cặp làm/kiểm. Nhiệm vụ của bạn là TÌM LÝ DO TỪ CHỐI.',
  'Bạn không thực hiện hành động; bạn chỉ phán xét hành động sắp chạy.',
  '',
  'Chỉ trả lời DUYET khi TẤT CẢ đều đúng:',
  '  1. Hành động đúng là thứ người dùng yêu cầu, không phải việc khác.',
  '  2. Tham số khớp với yêu cầu đó, không có gì thừa hay lạ.',
  '  3. Hậu quả nằm trong phạm vi người dùng đã đồng ý.',
  '',
  'Trả lời TU_CHOI khi hành động sai, thừa, hoặc vượt phạm vi.',
  'Trả lời HOI_NGUOI_DUNG khi hành động có thể đúng nhưng rủi ro cao hoặc mơ hồ.',
  'Nghi ngờ thì KHÔNG duyệt.',
  '',
  'Trả về ĐÚNG một dòng JSON, không thêm gì khác:',
  '{"verdict":"DUYET|TU_CHOI|HOI_NGUOI_DUNG","reason":"<một câu tiếng Việt>"}',
].join('\n');

/** Mô tả hành động cho vai kiểm đọc. */
export function describeAction(action: ActionUnderReview): string {
  return [
    `Người dùng yêu cầu: ${action.goal}`,
    '',
    `Hành động sắp chạy: ${action.name}`,
    `Công dụng: ${action.summary}`,
    `Tham số: ${JSON.stringify(action.args)}`,
    '',
    'Hành động này có được phép chạy không?',
  ].join('\n');
}

/**
 * Đọc phán quyết từ câu trả lời của model.
 *
 * Mọi thứ không đọc được đều ra `TU_CHOI` — đây là chỗ dễ sai nhất: viết
 * `verdict ?? 'DUYET'` hay bắt lỗi rồi cho qua là biến vai kiểm thành con dấu
 * đóng sẵn.
 */
export function parseVerdict(text: string): VerifierDecision {
  const reject = (reason: string): VerifierDecision => ({ verdict: 'TU_CHOI', reason });

  // Chỉ chấp nhận MỘT object. Nếu câu trả lời là một mảng phán quyết thì từ
  // chối luôn: moi object đầu tiên trong mảng ra là mở đúng một đường lách —
  // `[{"verdict":"DUYET"}, …]` sẽ được duyệt dù ta không biết phần còn lại nói
  // gì. Vai kiểm chỉ được phán một lần, về một hành động.
  if (text.trim().startsWith('[')) {
    return reject('Người kiểm trả về nhiều phán quyết cùng lúc nên em không chạy hành động này.');
  }

  const match = text.match(/\{[\s\S]*\}/);
  if (!match) return reject('Người kiểm không trả lời được rõ ràng nên em không chạy hành động này.');

  let data: unknown;
  try {
    data = JSON.parse(match[0]);
  } catch {
    return reject('Người kiểm trả lời sai định dạng nên em không chạy hành động này.');
  }
  if (!data || typeof data !== 'object') {
    return reject('Người kiểm trả lời sai định dạng nên em không chạy hành động này.');
  }

  const record = data as Record<string, unknown>;
  const verdict = String(record.verdict ?? '').toUpperCase().replace(/[\s-]/g, '_');
  const reason = typeof record.reason === 'string' && record.reason.trim()
    ? record.reason.trim()
    : 'Người kiểm không nêu lý do.';

  if (verdict === 'DUYET') return { verdict: 'DUYET', reason };
  if (verdict === 'HOI_NGUOI_DUNG') return { verdict: 'HOI_NGUOI_DUNG', reason };
  if (verdict === 'TU_CHOI') return { verdict: 'TU_CHOI', reason };
  return reject(`Người kiểm trả về phán quyết lạ ("${record.verdict}") nên em không chạy.`);
}

/**
 * Gọi vai kiểm cho một hành động.
 *
 * Luôn mở **phiên mới** (không truyền `continuation`) và **không đưa công cụ**.
 * Mọi lỗi đều trả `TU_CHOI`.
 */
export async function verifyAction(
  provider: AgentProvider,
  action: ActionUnderReview,
): Promise<VerifierDecision> {
  let text = '';
  try {
    const query = provider.query({
      prompt: describeAction(action),
      // Cố ý bỏ trống: vai kiểm không được thấy transcript của vai làm, và
      // không được cầm công cụ nào.
      messages: [],
      systemContext: { instructions: VERIFIER_INSTRUCTIONS },
    });
    for await (const event of query.events) {
      if (event.type === 'text_delta') text += event.text;
      else if (event.type === 'result' && event.text) text = event.text;
      else if (event.type === 'error') throw new Error(event.message);
    }
  } catch (error) {
    return {
      verdict: 'TU_CHOI',
      reason:
        `Không hỏi được người kiểm (${error instanceof Error ? error.message : String(error)}) ` +
        `nên em dừng lại thay vì chạy liều.`,
    };
  }
  return parseVerdict(text);
}

/** Câu báo cho người dùng khi vai kiểm không duyệt. */
export function refusalMessage(action: ActionUnderReview, decision: VerifierDecision): string {
  const head =
    decision.verdict === 'HOI_NGUOI_DUNG'
      ? `Em định chạy \`${action.name}\` nhưng muốn hỏi Sếp trước cho chắc.`
      : `Em đã dừng \`${action.name}\` lại, chưa chạy.`;
  return `${head}\n\nLý do: ${decision.reason}\n\nSếp duyệt thì bảo em một tiếng, em chạy ngay.`;
}
