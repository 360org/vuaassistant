/**
 * Kiểm sổ invariant.
 *
 * Bài này phải tự chứng minh nó không vô dụng, vì một sổ invariant hỏng trông
 * y hệt một hệ thống lành: cả hai đều "không báo lỗi". Nên ở đây làm hai việc:
 *   1. dựng ra vi phạm thật rồi đòi nó phải nổ, kèm đúng tên chủ sở hữu;
 *   2. khẳng định sổ RỖNG bị coi là hỏng, không phải là đạt.
 */
import { mkdirSync, mkdtempSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';

const root = mkdtempSync(path.join(tmpdir(), 'ar-inv-'));
mkdirSync(path.join(root, 'workspace'));
process.env.VUA_DATA_DIR = root;
process.env.VUA_AGENT_NAME = 'default';
process.env.VUA_AGENT_WORKSPACE = path.join(root, 'workspace');

const { composeRunner } = await import('../src/kernel/compose.ts');
const { createKernel } = await import('../src/kernel/runtime.ts');
const { invariantsPlugin, InvariantError } = await import('../src/kernel/invariants.ts');
const { toolsPlugin } = await import('../src/kernel/tools.ts');
const { promptPlugin, toolListSectionPlugin } = await import('../src/kernel/prompt.ts');
const { coreInvariantsPlugin } = await import('../src/kernel/invariants.ts');

let pass = true;
const check = (name, cond) => {
  console.log(`${cond ? '✓' : '✗'} ${name}`);
  if (!cond) pass = false;
};
async function caught(fn) {
  try { await fn(); return null; } catch (error) { return error; }
}

// --- 1. Cây plugin thật phải qua được -------------------------------------
const kernel = await composeRunner();
const ran = await kernel.root.invariants.verify();
check(`cây plugin thật qua được mọi invariant (chạy ${ran} lời khẳng định)`, ran >= 2);
check('mỗi lời khẳng định có chủ sở hữu rõ ràng',
  kernel.root.invariants.owners().includes('tools') &&
  kernel.root.invariants.owners().includes('prompt'));
await kernel.dispose();

// --- 2. Vi phạm thật phải nổ, kèm tên chủ sở hữu ---------------------------
// Dựng một cây thiếu phần liệt kê tool: sổ có tool, prompt thì không nhắc —
// đúng kiểu lệch đã xảy ra thật (prompt viết tay nêu 9 trong khi sổ có 21).
{
  const broken = createKernel();
  await broken.use(toolsPlugin);
  await broken.use(promptPlugin);
  await broken.use(invariantsPlugin);
  await broken.use(coreInvariantsPlugin);
  broken.root.tools.register(
    {
      name: 'tool_bi_bo_quen', description: 'x', input_schema: { type: 'object' },
      sideEffect: false, requiresApproval: false,
      execute: async () => ({ tool_call_id: '', content: '' }),
    },
    'native',
  );
  const error = await caught(() => broken.root.invariants.verify());
  check('prompt bỏ quên tool ⇒ invariant nổ', error instanceof InvariantError);
  check('lỗi nêu đúng tên chủ sở hữu', error?.owner === 'prompt');
  check('lỗi nêu đúng tool bị bỏ quên', String(error?.message).includes('tool_bi_bo_quen'));
  check('lỗi mang mã ổn định để chỗ khác bắt', error?.code === 'INVARIANT');
  await broken.dispose();
}

// --- 3. ĐẢO NGƯỢC: có phần liệt kê thì KHÔNG nổ ----------------------------
// Nếu bỏ mục này thì mục trên có thể xanh vì một lý do sai (ví dụ verify luôn ném).
{
  const ok = createKernel();
  await ok.use(toolsPlugin);
  await ok.use(promptPlugin);
  await ok.use(toolListSectionPlugin);
  await ok.use(invariantsPlugin);
  await ok.use(coreInvariantsPlugin);
  ok.root.tools.register(
    {
      name: 'tool_duoc_neu', description: 'x', input_schema: { type: 'object' },
      sideEffect: false, requiresApproval: false,
      execute: async () => ({ tool_call_id: '', content: '' }),
    },
    'native',
  );
  const error = await caught(() => ok.root.invariants.verify());
  check('ĐẢO NGƯỢC: prompt có nhắc tool thì KHÔNG nổ', error === null);
  await ok.dispose();
}

// --- 4. Sổ rỗng là hỏng, không phải đạt ------------------------------------
{
  const empty = createKernel();
  await empty.use(invariantsPlugin);
  const count = await empty.root.invariants.verify();
  check('sổ rỗng chạy 0 lời khẳng định — chỗ gọi phải phát hiện được', count === 0);
  await empty.dispose();
}

// --- 5. Trùng tên chủ sở hữu thì nổ ----------------------------------------
{
  const k = createKernel();
  await k.use(invariantsPlugin);
  k.root.invariants.register('ai-do', () => {});
  const error = await caught(async () => k.root.invariants.register('ai-do', () => {}));
  check('hai chỗ cùng nhận một tên chủ sở hữu thì nổ', error !== null);
  await k.dispose();
}

console.log(
  pass
    ? '\n✓ invariant: vi phạm thật thì nổ kèm tên chủ sở hữu, và sổ rỗng bị coi là hỏng'
    : '\n✗ FAILED',
);
process.exit(pass ? 0 : 1);
