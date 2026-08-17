/**
 * Kiểm cửa capability sau khi luật dời vào plugin.
 *
 * Bản cũ của bài này nạp riêng `capability-rail.ts` rồi gọi `capabilityFromTool`
 * và `sideEffectDenied` — hai thứ nay đã bị xoá. Nó kiểm **lối đoán theo tên**,
 * tức là kiểm đúng cái sai. Bản này kiểm qua đường thật: dựng cây plugin y như
 * lúc chạy, rồi gọi tool qua `ctx.tools.execute()`.
 *
 * Điểm mấu chốt cần giữ: một tool phải-hỏi mà chưa duyệt thì **không được chạy**
 * — không phải "chạy rồi báo lỗi". Nên mọi mục ở đây đều đo bằng việc thân tool
 * có thật sự chạy hay không, chứ không chỉ nhìn thông điệp trả về.
 */
import { mkdirSync, mkdtempSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';

const root = mkdtempSync(path.join(tmpdir(), 'ar-rail-'));
mkdirSync(path.join(root, 'workspace'));
process.env.VUA_DATA_DIR = root;
process.env.VUA_AGENT_NAME = 'default';
process.env.VUA_AGENT_WORKSPACE = path.join(root, 'workspace');
// Luật của người dùng: cấm .env, và bắt luôn hỏi trước khi dùng file_write.
writeFileSync(
  path.join(root, 'policy.json'),
  JSON.stringify({ deniedPaths: ['.env'], alwaysAsk: ['file_write'], maxOutboundPerHour: 0 }),
);

const { composeRunner } = await import('../src/kernel/compose.ts');
const { searchCapabilities, capabilityFromSpec } = await import('../src/capability-rail.ts');

let pass = true;
const check = (name, cond) => {
  console.log(`${cond ? '✓' : '✗'} ${name}`);
  if (!cond) pass = false;
};

const kernel = await composeRunner();
const tools = kernel.root.tools;

// --- 1. Tìm capability vẫn hoạt động ---------------------------------------
const capabilities = tools.list().map(capabilityFromSpec);
check('search_capabilities tìm được tool ghi tệp',
  searchCapabilities(capabilities, 'write').includes('file_write'));
check('capability mang đúng tính chất tool đã khai',
  capabilities.find((c) => c.name === 'computer_use')?.requires_approval === true);

// --- 2. Tool phải-hỏi thì KHÔNG được chạy khi chưa duyệt --------------------
// Cắm một tool giả để đo thân tool có chạy hay không — đây là điều bài test cũ
// không đo được, vì nó chỉ nhìn giá trị trả về của một hàm thuần.
let ranDangerous = 0;
tools.register(
  {
    name: 'gui_tien_that',
    description: 'chuyển tiền ra ngoài',
    input_schema: { type: 'object', properties: {} },
    sideEffect: true,
    requiresApproval: true,
    execute: async () => { ranDangerous += 1; return { tool_call_id: '', content: 'đã gửi' }; },
  },
  'native',
);

const chuaDuyet = await tools.execute('gui_tien_that', {});
check('chưa duyệt ⇒ trả lỗi APPROVAL_REQUIRED',
  chuaDuyet.is_error === true && chuaDuyet.content.includes('APPROVAL_REQUIRED'));
check('chưa duyệt ⇒ thân tool KHÔNG chạy', ranDangerous === 0);

const daDuyet = await tools.execute('gui_tien_that', {}, { approved: true });
check('đã duyệt ⇒ tool chạy thật', daDuyet.is_error !== true && ranDangerous === 1);

// --- 3. Luật của người dùng có hiệu lực ------------------------------------
let ranWrite = 0;
tools.register(
  {
    name: 'ghi_thu',
    description: 'ghi tệp thử',
    input_schema: { type: 'object', properties: {} },
    sideEffect: true,
    requiresApproval: false,
    execute: async () => { ranWrite += 1; return { tool_call_id: '', content: 'ok' }; },
  },
  'native',
);
const camDuongDan = await tools.execute('ghi_thu', { path: '/nha/toi/.env' });
check('đường dẫn bị cấm ⇒ chặn, nêu đúng luật đã vi phạm',
  camDuongDan.is_error === true && camDuongDan.content.includes('.env'));
check('đường dẫn bị cấm ⇒ thân tool KHÔNG chạy', ranWrite === 0);

// alwaysAsk của người dùng phải chặn được cả tool tự khai là KHÔNG cần hỏi.
const fileWrite = tools.get('file_write');
check('đối chứng: file_write tự khai là không cần duyệt', fileWrite.requiresApproval === false);
const bijAlwaysAsk = await tools.execute('file_write', { path: 'a.txt', content: 'x' });
check('luật alwaysAsk của người dùng thắng bản khai của tool',
  bijAlwaysAsk.is_error === true && bijAlwaysAsk.content.includes('APPROVAL_REQUIRED'));

// --- 4. Tool chỉ đọc đi thẳng, không phiền người dùng ----------------------
const doc = await tools.execute('glob', { pattern: '*' });
check('tool chỉ đọc chạy thẳng, không đòi duyệt',
  !(doc.is_error === true && String(doc.content).includes('APPROVAL_REQUIRED')));

await kernel.dispose();
console.log(
  pass
    ? '\n✓ cửa capability: luật thi hành ở thác nước, tool phải-hỏi không chạy khi chưa duyệt'
    : '\n✗ FAILED',
);
process.exit(pass ? 0 : 1);
