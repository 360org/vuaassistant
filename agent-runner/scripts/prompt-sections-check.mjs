/**
 * Kiểm phần system prompt dựng từ sổ đăng ký.
 *
 * Lỗi được vá ở đây: `buildSystemPrompt` cũ liệt kê tool bằng văn xuôi viết
 * tay, nên nói với model là có 9 tool trong khi runner đăng ký 13. Bốn tool
 * `vault_list`, `search_memory`, `computer_use`, `delegate_task` model không hề
 * biết là có — chúng nằm đó không bao giờ được dùng.
 *
 * Kiểu lệch này không ai phát hiện được vì nhìn riêng thì cả hai phía đều đúng.
 * Nên bài test đo đúng quan hệ giữa hai phía: **mọi tool trong sổ phải xuất
 * hiện trong prompt**, và thêm tool mới thì prompt phải tự biết.
 */
import { mkdirSync, mkdtempSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';

const root = mkdtempSync(path.join(tmpdir(), 'ar-prompt-'));
mkdirSync(path.join(root, 'workspace'));
process.env.VUA_DATA_DIR = root;
process.env.VUA_AGENT_NAME = 'default';
process.env.VUA_AGENT_WORKSPACE = path.join(root, 'workspace');

const { composeRunner } = await import('../src/kernel/compose.ts');

let pass = true;
const check = (name, cond) => {
  console.log(`${cond ? '✓' : '✗'} ${name}`);
  if (!cond) pass = false;
};

const kernel = await composeRunner();
const { tools, prompt } = kernel.root;

// --- 1. Không tool nào bị bỏ quên ------------------------------------------
const built = prompt.build();
const registered = tools.list().map((t) => t.name);
const missing = registered.filter((name) => !built.includes(name));
console.log(`  đăng ký ${registered.length} tool · prompt nêu ${registered.length - missing.length}`);
check('mọi tool trong sổ đều được nêu trong prompt', missing.length === 0);
check('đối chứng: bốn tool từng bị bỏ quên nay đều có mặt',
  ['vault_list', 'search_memory', 'computer_use', 'delegate_task'].every((n) => built.includes(n)));

// --- 2. Thêm tool thì prompt tự biết ---------------------------------------
// Đây mới là điều quan trọng: không phải "hiện tại khớp", mà "không thể lệch".
const before = prompt.build();
const remove = tools.register(
  {
    name: 'tool_hoan_toan_moi',
    description: 'tool vừa cắm vào lúc chạy',
    input_schema: { type: 'object', properties: {} },
    sideEffect: false,
    requiresApproval: false,
    execute: async () => ({ tool_call_id: '', content: '' }),
  },
  'native',
);
const after = prompt.build();
check('cắm thêm tool ⇒ prompt tự có ngay, không phải sửa tay',
  !before.includes('tool_hoan_toan_moi') && after.includes('tool_hoan_toan_moi'));
remove();
check('gỡ tool ⇒ prompt thôi nhắc tới', !prompt.build().includes('tool_hoan_toan_moi'));

// --- 3. Tool phải xin duyệt được đánh dấu ----------------------------------
// Để model biết đường xin duyệt trước, thay vì gọi rồi nhận về lỗi.
const dongComputerUse = built.split('\n').find((line) => line.includes('computer_use'));
check('tool phải-duyệt được đánh dấu ngay trong prompt',
  Boolean(dongComputerUse?.includes('phải xin duyệt')));
const dongGlob = built.split('\n').find((line) => line.startsWith('- glob:'));
check('đối chứng: tool chỉ đọc KHÔNG bị đánh dấu',
  Boolean(dongGlob) && !dongGlob.includes('phải xin duyệt'));

// --- 4. Trùng id thì nổ, không im lặng đè ----------------------------------
let threw = null;
try {
  prompt.register({ id: 'tool-list', order: 1, render: () => 'x' });
} catch (error) {
  threw = error.message;
}
check('đăng ký trùng id phần prompt thì nổ', threw !== null && threw.includes('tool-list'));

await kernel.dispose();
console.log(
  pass
    ? '\n✓ prompt dựng từ sổ đăng ký — không còn hai nguồn sự thật để lệch nhau'
    : '\n✗ FAILED',
);
process.exit(pass ? 0 : 1);
