import type { ToolDefinition, ToolResult } from './providers/types.js';
import type { ToolSpec } from './kernel/tools.js';

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

/**
 * Dựng mô tả capability từ bản khai của chính tool.
 *
 * Bản cũ ĐOÁN `side_effect` và `requires_approval` bằng hai regex khớp vào tên
 * tool cộng hai danh sách cứng. Cách đó sai cả hai chiều và đã được đo: 3/13
 * tool native bị xếp sai, nặng nhất là `computer_use` — điều khiển chuột và bàn
 * phím thật của người dùng — bị coi là hoàn toàn vô hại.
 *
 * Nay hai giá trị đó đọc thẳng từ `ToolSpec`, tức là từ chỗ người viết tool khai
 * ra. Không còn chỗ nào đoán nữa.
 */
export function capabilityFromSpec(spec: ToolSpec): Capability {
  return {
    name: spec.name,
    kind: spec.origin,
    summary: spec.description || spec.name,
    input_schema: spec.input_schema,
    side_effect: spec.sideEffect,
    requires_approval: spec.requiresApproval,
  };
}

export function approvedCapabilityFromPrompt(prompt: string): string | null {
  const marker = prompt.match(/CALL_APPROVED_CAPABILITY:\s*([a-zA-Z0-9_-]+)/i);
  if (marker) return marker[1];

  const natural = prompt.match(/Đã phê duyệt thực thi hành động\s+([a-zA-Z0-9_-]+)/i);
  return natural?.[1] ?? null;
}

export function approvalCoversTool(approvedCapability: string | null, toolName: string): boolean {
  return approvedCapability === toolName;
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

/*
 * `policyDenied()` và `sideEffectDenied()` đã bị xoá khỏi đây.
 *
 * Luật không còn là hai hàm mà mỗi chỗ gọi tool phải tự nhớ gọi theo đúng thứ
 * tự — quên một chỗ là thủng một lỗ và không có gì bắt được cái quên đó. Nay
 * luật là một lớp bọc ở thác nước `tools/pre-execute`
 * (`kernel/policy-plugin.ts`), nên MỌI tool đi qua `ctx.tools.execute()` đều
 * phải chui qua, kể cả tool do plugin viết sau này đăng ký.
 */
