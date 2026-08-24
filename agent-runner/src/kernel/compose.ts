/**
 * Bản kê plugin chuẩn của runner — một chỗ duy nhất.
 *
 * Cả lúc chạy thật lẫn lúc chạy test đều gọi hàm này, nên bài test kiểm đúng
 * cây plugin mà người dùng thật sự chạy. Trước đây mỗi bài test tự dựng lấy
 * cấu hình vòng lặp, nên chúng có thể xanh trên một hình thù không tồn tại
 * ngoài đời.
 *
 * Nạp **tĩnh**, không dò tìm ngoài đĩa: bản đóng gói không bảo đảm được thứ gì
 * phân giải lúc chạy — đúng lớp lỗi đã làm bản cài chết vì thiếu `undici`.
 */
import { createKernel, type Kernel } from './runtime.js';
import { toolsPlugin } from './tools.js';
import { promptPlugin, toolListSectionPlugin } from './prompt.js';
import { coreInvariantsPlugin, invariantsPlugin } from './invariants.js';
import { modelVisibleInvariantPlugin, modelVisiblePlugin } from './model-visible.js';
import { createProvidersPlugin } from './providers-plugin.js';
// Nạp adapter model. Đây là import CÓ TÁC DỤNG PHỤ: mỗi adapter tự ghi tên vào
// sổ khi module chạy. Để ở đây, cạnh chỗ dựng cây, chứ không nằm lẻ trong
// index.ts — xoá nhầm một dòng import trông vô hại thì mất luôn một nhà cung
// cấp. Invariant `providers` sẽ nổ ngay nếu dòng này biến mất.
import '../providers/index.js';
import { createPolicyPlugin } from './policy-plugin.js';
import { createVerifierPlugin } from './verifier-plugin.js';
import { nativeToolsPlugin } from '../native-tools/index.js';
import { builtinToolsPlugin } from '../mcp-tools/index.js';
import { skillsPlugin } from './skills.js';
import { OutboundLimiter, readPolicy, type Policy } from '../policy.js';
import type { AgentProvider } from '../providers/types.js';
import { createMcpPlugin } from '../plugins/mcp.js';
import { createSchedulerPlugin } from '../plugins/scheduler.js';
import { createTelegramPlugin } from '../plugins/telegram.js';

export interface ComposeOptions {
  /** Provider dùng cho vai kiểm. Bỏ trống thì vai kiểm không nạp. */
  provider?: AgentProvider;
  /** Bỏ trống thì đọc từ tệp luật. */
  policy?: Policy;
  /** Tên nhà cung cấp trong cấu hình, để invariant khẳng định nó có mặt thật. */
  providerName?: string;
  log?: (message: string) => void;
}

/**
 * Dựng cây plugin chuẩn.
 *
 * **Thứ tự nạp quyết định thứ tự bọc:** đăng ký sau bọc ngoài đăng ký trước,
 * nên `verifier` phải nạp TRƯỚC `policy`. Ngược lại thì một hành động mà chính
 * sách sẽ chặn vẫn kịp tốn một lượt gọi model cho vai kiểm — người dùng trả
 * tiền cho câu hỏi không bao giờ cần hỏi.
 */
export async function composeRunner(options: ComposeOptions = {}): Promise<Kernel> {
  const policy = options.policy ?? readPolicy();
  const kernel = createKernel();

  await kernel.use(invariantsPlugin);
  await kernel.use(toolsPlugin);
  await kernel.use(nativeToolsPlugin);
  await kernel.use(builtinToolsPlugin);
  await kernel.use(skillsPlugin);
  await kernel.use(createMcpPlugin());
  await kernel.use(promptPlugin);
  await kernel.use(toolListSectionPlugin);
  await kernel.use(modelVisiblePlugin);
  await kernel.use(coreInvariantsPlugin);
  await kernel.use(modelVisibleInvariantPlugin);
  await kernel.use(createProvidersPlugin({ configured: options.providerName }));

  // Vai kiểm chỉ có nghĩa khi có provider để hỏi.
  if (options.provider) {
    await kernel.use(
      createVerifierPlugin({
        provider: options.provider,
        enabled: policy.verifySideEffects,
        log: options.log,
      }),
    );
  }

  await kernel.use(createPolicyPlugin({ policy, limiter: new OutboundLimiter(policy) }));
  await kernel.use(createSchedulerPlugin());
  await kernel.use(createTelegramPlugin());
  await kernel.start();

  // Kiểm ngay lúc dựng xong, trên chính cây plugin vừa lắp. Vi phạm thì nổ ở
  // đây — chỗ dễ tìm nhất — thay vì lòi ra thành hành vi lạ sau này.
  const ran = await kernel.root.invariants.verify();
  if (ran === 0) {
    throw new Error('sổ invariant rỗng: không có lời khẳng định nào chạy, nên "đạt" ở đây vô nghĩa');
  }

  return kernel;
}
