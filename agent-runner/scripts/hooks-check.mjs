/**
 * Test kiểm chứng Hooks Plugin (s04_hooks + Everything is a plugin).
 *
 * Kiểm tra:
 *   1. Đăng ký hook vòng đời (UserPromptSubmit, PreToolUse, PostToolUse, TurnComplete)
 *   2. Gỡ hook sạch qua Disposer (effect discipline)
 *   3. PreToolUse có thể chặn thực thi tool nếu trả về chuỗi thông báo lỗi
 *   4. PostToolUse ghi nhận đúng thời lượng durationMs và kết quả tool
 */
import { createKernel } from '../src/kernel/runtime.ts';
import { toolsPlugin } from '../src/kernel/tools.ts';
import { createHooksPlugin } from '../src/plugins/hooks.ts';

let pass = true;
const check = (name, cond) => {
  console.log(`${cond ? '✓' : '✗'} ${name}`);
  if (!cond) pass = false;
};

// --- 1. Đăng ký & Trigger UserPromptSubmit ---
{
  const kernel = createKernel();
  await kernel.use(toolsPlugin);
  await kernel.use(createHooksPlugin());

  let submittedPrompt = '';
  const dispose = kernel.root.hooks.register('UserPromptSubmit', (payload) => {
    submittedPrompt = payload.prompt;
  });

  await kernel.root.hooks.trigger('UserPromptSubmit', { prompt: 'Xin chào AI' });
  check('UserPromptSubmit trigger thành công', submittedPrompt === 'Xin chào AI');

  dispose();
  await kernel.root.hooks.trigger('UserPromptSubmit', { prompt: 'Tin nhắn thứ 2' });
  check('Disposer gỡ UserPromptSubmit sạch sẽ', submittedPrompt === 'Xin chào AI');

  await kernel.dispose();
}

// --- 2. PreToolUse & PostToolUse Interception ---
{
  const kernel = createKernel();
  await kernel.use(toolsPlugin);
  await kernel.use(createHooksPlugin());

  kernel.root.tools.register(
    {
      name: 'safe_tool',
      description: 'Công cụ an toàn',
      input_schema: { type: 'object' },
      sideEffect: false,
      requiresApproval: false,
      execute: async () => ({ tool_call_id: '', content: 'safe_result' }),
    },
    'native',
  );

  kernel.root.tools.register(
    {
      name: 'blocked_tool',
      description: 'Công cụ bị chặn',
      input_schema: { type: 'object' },
      sideEffect: true,
      requiresApproval: false,
      execute: async () => ({ tool_call_id: '', content: 'should_not_run' }),
    },
    'native',
  );

  let postRun = null;

  // Hook chặn blocked_tool
  kernel.root.hooks.register('PreToolUse', (payload) => {
    if (payload.toolName === 'blocked_tool') {
      return 'Lệnh bị từ chối bởi chính sách bảo mật';
    }
  });

  // Hook ghi nhận PostToolUse
  kernel.root.hooks.register('PostToolUse', (payload) => {
    postRun = payload;
  });

  // Chạy tool an toàn
  const res1 = await kernel.root.tools.execute('safe_tool', {});
  check('safe_tool chạy bình thường', res1.content === 'safe_result' && !res1.is_error);
  check('PostToolUse ghi nhận toolName và duration', postRun?.toolName === 'safe_tool' && typeof postRun?.durationMs === 'number');

  // Chạy tool bị chặn
  const res2 = await kernel.root.tools.execute('blocked_tool', {});
  check('blocked_tool bị PreToolUse chặn đứng', res2.is_error === true && res2.content.includes('Lệnh bị từ chối'));

  await kernel.dispose();
}

console.log(`\nKết quả hooks-check: ${pass ? 'TẤT CẢ ĐẠT' : 'CÓ LỖI'}`);
if (!pass) process.exit(1);
