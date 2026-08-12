import type { ToolDefinition, ToolResult } from './providers/types.js';
import { OutboundLimiter, pathDenied, readPolicy, requiresAsk, type Policy } from './policy.js';

export type CapabilityKind = 'native' | 'builtin' | 'mcp';

export interface Capability {
  name: string;
  kind: CapabilityKind;
  summary: string;
  input_schema: Record<string, unknown>;
  side_effect: boolean;
  requires_approval: boolean;
}

export const CAPABILITY_TOOL_DEFINITIONS: ToolDefinition[] = [
  {
    name: 'search_capabilities',
    description: 'Tìm capability đang có trong VuaAssistant runtime. Dùng trước khi chọn tool hoặc integration.',
    input_schema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Việc cần làm, ví dụ "đọc file", "gửi Telegram", "tìm web".' },
        limit: { type: 'number', description: 'Số kết quả tối đa, mặc định 8.' },
      },
      required: ['query'],
    },
  },
  {
    name: 'execute_capability',
    description: 'Chạy một capability trả về từ search_capabilities. Với capability gửi dữ liệu ra ngoài hoặc dùng credential, chỉ truyền approved=true sau khi người dùng duyệt rõ ràng.',
    input_schema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Tên capability trả về từ search_capabilities.' },
        arguments: { type: 'object', description: 'Tham số cho capability đã chọn.' },
        approved: { type: 'boolean', description: 'Bắt buộc với capability gửi tin, gửi file, sửa message hoặc gọi connector có credential.' },
      },
      required: ['name'],
    },
  },
];

const SIDE_EFFECT_NAMES = new Set([
  'file_write',
  'file_edit',
  'connector_request',
  'schedule_task',
  'send_message',
  'send_file',
  'edit_message',
  'add_reaction',
]);

const APPROVAL_REQUIRED_NAMES = new Set([
  'connector_request',
  'send_message',
  'send_file',
  'edit_message',
  'add_reaction',
]);

export function capabilityFromTool(tool: ToolDefinition, kind: CapabilityKind): Capability {
  const sideEffect = SIDE_EFFECT_NAMES.has(tool.name) || /(^|__)send|write|edit|delete|create|update|post|publish|message/i.test(tool.name);
  return {
    name: tool.name,
    kind,
    summary: tool.description || tool.name,
    input_schema: tool.input_schema,
    side_effect: sideEffect,
    requires_approval: APPROVAL_REQUIRED_NAMES.has(tool.name) || /(^|__)send|delete|post|publish|message/i.test(tool.name),
  };
}

export function searchCapabilities(capabilities: Capability[], query: string, limit = 8): string {
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  const scored = capabilities
    .map((capability) => {
      const haystack = `${capability.name} ${capability.kind} ${capability.summary}`.toLowerCase();
      const score = terms.reduce((sum, term) => sum + (haystack.includes(term) ? 1 : 0), 0);
      return { capability, score };
    })
    .filter(({ score }) => score > 0 || terms.length === 0)
    .sort((a, b) => b.score - a.score || a.capability.name.localeCompare(b.capability.name))
    .slice(0, Math.max(1, Math.min(20, Math.trunc(limit) || 8)))
    .map(({ capability }) => ({
      name: capability.name,
      kind: capability.kind,
      summary: capability.summary,
      side_effect: capability.side_effect,
      requires_approval: capability.requires_approval,
      input_schema: capability.input_schema,
    }));

  return scored.length ? JSON.stringify({ capabilities: scored }, null, 2) : 'Không tìm thấy capability phù hợp.';
}

/**
 * Chặn theo chính sách của người dùng, TRƯỚC khi capability được chạy.
 *
 * Đây là chỗ luật thật sự có hiệu lực. Nhét luật vào system prompt chỉ là gợi
 * ý — model có thể bỏ qua, và với việc tiêu tiền thật thì "có thể bỏ qua" là
 * không chấp nhận được. Mọi capability đều đi qua đây nên chặn ở đây là chặn
 * được thật.
 *
 * Ba luật: đường dẫn bị cấm, capability luôn phải hỏi, và hạn mức gửi ra ngoài
 * mỗi giờ. Ba luật đều đọc từ tệp chính sách; tệp hỏng thì quay về mặc định
 * chặt hơn chứ không lỏng hơn.
 */
export function policyDenied(
  capability: Capability,
  args: Record<string, unknown>,
  approved: unknown,
  policy: Policy = readPolicy(),
  limiter?: OutboundLimiter,
): ToolResult | null {
  const deny = (content: string): ToolResult => ({ tool_call_id: '', is_error: true, content });

  // 1. Đường dẫn bị cấm — kiểm mọi tham số trông như đường dẫn.
  for (const [key, value] of Object.entries(args)) {
    if (typeof value !== 'string') continue;
    if (!/(path|file|dir|folder|duong_dan)/i.test(key)) continue;
    const rule = pathDenied(value, policy);
    if (rule) {
      return deny(
        `POLICY_DENIED: Sếp đã đặt luật không cho đụng tới "${rule}", nên em không mở ` +
          `"${value}". Nếu Sếp thật sự cần, hãy bỏ luật đó trong phần Cài đặt trước.`,
      );
    }
  }

  // 2. Capability người dùng bắt luôn phải hỏi.
  if (requiresAsk(capability.name, policy) && approved !== true) {
    return deny(
      `APPROVAL_REQUIRED: Sếp đã đặt luật luôn hỏi trước khi dùng ${capability.name}. ` +
        `Hãy xin người dùng duyệt đúng hành động này, rồi gọi lại với approved=true.`,
    );
  }

  // 3. Hạn mức gửi ra ngoài. Chỉ tính khi hành động THẬT SỰ sắp chạy, tức là
  //    sau khi đã qua mọi cửa duyệt — nếu tính sớm thì một lần bị từ chối vẫn
  //    ăn mất hạn mức của người dùng.
  if (limiter && capability.side_effect) {
    const refused = limiter.take();
    if (refused) return deny(`POLICY_DENIED: ${refused}`);
  }

  return null;
}

export function sideEffectDenied(capability: Capability, approved: unknown): ToolResult | null {
  if (!capability.requires_approval || approved === true) return null;
  return {
    tool_call_id: '',
    is_error: true,
    content: `APPROVAL_REQUIRED: ${capability.name} gửi dữ liệu ra ngoài hoặc dùng credential. Hãy xin người dùng duyệt đúng hành động này, rồi gọi lại execute_capability với approved=true.`,
  };
}
