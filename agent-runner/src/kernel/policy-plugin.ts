/**
 * Chính sách của người dùng, thi hành ở thác nước `tools/pre-execute`.
 *
 * Trước đây luật nằm rải trong `poll-loop.ts`: mỗi chỗ gọi tool phải tự nhớ gọi
 * `policyDenied()` rồi `sideEffectDenied()` theo đúng thứ tự. Quên một chỗ là
 * thủng một lỗ, và không có gì bắt được cái quên đó.
 *
 * Ở đây luật là một lớp bọc: **mọi** tool đi qua `ctx.tools.execute()` đều phải
 * chui qua, kể cả tool đăng ký sau này bởi plugin chưa viết. Không gọi `next()`
 * là chặn — đó là cách lớp này từ chối.
 *
 * Bốn cửa, theo đúng thứ tự cũ để không đổi hành vi ngoài ý muốn:
 *   1. đường dẫn bị cấm
 *   2. tool người dùng bắt luôn phải hỏi (`alwaysAsk`)
 *   3. tool tự khai `requiresApproval`
 *   4. hạn mức gửi ra ngoài mỗi giờ — tính SAU cùng, vì tính sớm thì một lần
 *      bị từ chối vẫn ăn mất hạn mức của người dùng
 */
import type { Context, Plugin } from './types.js';
import type { ToolResult } from '../providers/types.js';
import {
  OutboundLimiter,
  pathDenied,
  readPolicy,
  requiresAsk,
  type Policy,
} from '../policy.js';

const deny = (content: string): ToolResult => ({ tool_call_id: '', is_error: true, content });

/** Tham số trông như đường dẫn thì phải soi theo luật cấm đường dẫn. */
const PATH_LIKE = /(path|file|dir|folder|duong_dan)/i;

export interface PolicyPluginOptions {
  /** Đọc sẵn từ ngoài để dùng chung với phần còn lại của runner. */
  policy?: Policy;
  limiter?: OutboundLimiter;
}

export function createPolicyPlugin(options: PolicyPluginOptions = {}): Plugin {
  return {
    name: 'policy',
    dependencies: ['tools'],
    setup(ctx: Context) {
      const policy = options.policy ?? readPolicy();
      const limiter = options.limiter ?? new OutboundLimiter(policy);

      ctx.effect(
        ctx.intercept('tools/pre-execute', async ({ tool, args, approved }, next) => {
          // 1. Đường dẫn bị cấm.
          for (const [key, value] of Object.entries(args)) {
            if (typeof value !== 'string' || !PATH_LIKE.test(key)) continue;
            const rule = pathDenied(value, policy);
            if (rule) {
              return deny(
                `POLICY_DENIED: Sếp đã đặt luật không cho đụng tới "${rule}", nên em không mở ` +
                  `"${value}". Nếu Sếp thật sự cần, hãy bỏ luật đó trong phần Cài đặt trước.`,
              );
            }
          }

          // 2. Luật "luôn hỏi" do người dùng đặt.
          if (requiresAsk(tool.name, policy) && !approved) {
            return deny(
              `APPROVAL_REQUIRED: Sếp đã đặt luật luôn hỏi trước khi dùng ${tool.name}. ` +
                `Hãy xin người dùng duyệt đúng hành động này, rồi gọi lại với approved=true.`,
            );
          }

          // 3. Tool tự khai là phải hỏi. Đây là chỗ thay cho lối đoán theo tên:
          //    giá trị đọc từ bản khai của chính tool, không suy ra từ chuỗi.
          if (tool.requiresApproval && !approved) {
            return deny(
              `APPROVAL_REQUIRED: ${tool.name} gửi dữ liệu ra ngoài, dùng credential hoặc ` +
                `điều khiển máy của người dùng. Hãy xin người dùng duyệt đúng hành động này, ` +
                `rồi gọi lại với approved=true.`,
            );
          }

          // 4. Hạn mức gửi ra ngoài — chỉ tính khi hành động thật sự sắp chạy.
          if (tool.sideEffect) {
            const refused = limiter.take();
            if (refused) return deny(`POLICY_DENIED: ${refused}`);
          }

          return next();
        }),
      );
    },
  };
}
