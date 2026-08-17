/**
 * Vai kiểm độc lập (maker/checker), cắm vào cùng thác nước với chính sách.
 *
 * Bật bằng `verifySideEffects` trong tệp luật. Chỉ soi tool có tác dụng phụ —
 * bắt một agent thứ hai duyệt lại từng lần đọc tệp thì vừa tốn tiền vừa vô ích.
 *
 * **Thứ tự đăng ký là quan trọng.** Lớp đăng ký sau bọc ngoài lớp trước, nên
 * plugin này phải nạp TRƯỚC `policy` để chính sách nằm ngoài và chạy trước.
 * Ngược lại thì một hành động chính sách sẽ chặn vẫn kịp tốn một lượt gọi model
 * cho vai kiểm — người dùng trả tiền cho một câu hỏi không bao giờ cần hỏi.
 */
import type { Context, Plugin } from './types.js';
import type { AgentProvider, ToolResult } from '../providers/types.js';
import { refusalMessage, verifyAction } from '../verifier.js';

export interface VerifierPluginOptions {
  provider: AgentProvider;
  /** Đọc từ `policy.verifySideEffects`. Tắt thì plugin không cắm gì cả. */
  enabled: boolean;
  log?: (message: string) => void;
}

export function createVerifierPlugin(options: VerifierPluginOptions): Plugin {
  return {
    name: 'verifier',
    dependencies: ['tools'],
    setup(ctx: Context) {
      // Tắt thì không cắm listener nào — rẻ hơn cắm rồi kiểm cờ mỗi lần chạy,
      // và làm cho `--dump` thấy đúng thứ đang thật sự nằm trong đường chạy.
      if (!options.enabled) return;

      ctx.effect(
        ctx.intercept('tools/pre-execute', async ({ tool, args, goal }, next) => {
          if (!tool.sideEffect) return next();

          const action = {
            name: tool.name,
            summary: tool.description || tool.name,
            args,
            goal,
          };
          const decision = await verifyAction(options.provider, action);
          if (decision.verdict === 'DUYET') return next();

          options.log?.(`Người kiểm không duyệt ${tool.name}: ${decision.reason}`);
          const refusal: ToolResult = {
            tool_call_id: '',
            is_error: true,
            content: refusalMessage(action, decision),
          };
          return refusal;
        }),
      );
    },
  };
}
