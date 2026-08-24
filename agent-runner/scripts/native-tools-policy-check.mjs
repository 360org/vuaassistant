/**
 * Kiểm phần khai tính chất của 13 tool native, và đối chiếu với lối đoán cũ.
 *
 * Điểm chính không phải "13 tool đã khai đủ" — TypeScript đã ép việc đó. Điểm
 * chính là **lối đoán cũ sai ở đâu**, và bản khai mới có sửa đúng chỗ đó không.
 * Nên bài này dựng lại nguyên văn logic cũ — cả hai danh sách cứng lẫn hai
 * regex — rồi so từng tool một, kèm một mục đối chứng cho chỗ mã cũ làm đúng.
 */
import { mkdirSync, mkdtempSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';

const root = mkdtempSync(path.join(tmpdir(), 'ar-policy-'));
mkdirSync(path.join(root, 'workspace'));
process.env.VUA_DATA_DIR = root;
process.env.VUA_AGENT_NAME = 'default';
process.env.VUA_AGENT_WORKSPACE = path.join(root, 'workspace');

const { createKernel } = await import('../src/kernel/runtime.ts');
const { toolsPlugin } = await import('../src/kernel/tools.ts');
const { nativeToolsPlugin } = await import('../src/native-tools/index.ts');

let pass = true;
const check = (name, cond) => {
  console.log(`${cond ? '✓' : '✗'} ${name}`);
  if (!cond) pass = false;
};

const kernel = createKernel();
await kernel.use(toolsPlugin);
await kernel.use(nativeToolsPlugin);
const tools = kernel.root.tools;

// --- 1. Cắm đủ, không sót ---------------------------------------------------
const names = tools.list().map((t) => t.name);
check(`cắm đủ 17 tool native vào ctx.tools (thấy ${names.length})`, names.length === 17);
check('mọi tool đều mang nguồn "native"', tools.list().every((t) => t.origin === 'native'));

// --- 2. Đối chiếu với lối đoán cũ -------------------------------------------
// Dựng lại NGUYÊN VĂN logic cũ trong capability-rail.ts: hai danh sách cứng
// HOẶC hai regex. Chỉ so với regex là vu oan cho mã cũ — danh sách cứng có bắt
// đúng vài tool, và một bài kiểm chứng thổi phồng lỗi thì cũng vô dụng như một
// bài bỏ sót lỗi.
const OLD_SIDE_RE = /(^|__)send|write|edit|delete|create|update|post|publish|message/i;
const OLD_APPROVAL_RE = /(^|__)send|delete|post|publish|message/i;
const OLD_SIDE_NAMES = new Set(['file_write', 'file_edit', 'connector_request', 'schedule_task',
  'send_message', 'send_file', 'edit_message', 'add_reaction']);
const OLD_APPROVAL_NAMES = new Set(['connector_request', 'send_message', 'send_file',
  'edit_message', 'add_reaction']);

const oldSide = (n) => OLD_SIDE_NAMES.has(n) || OLD_SIDE_RE.test(n);
const oldApproval = (n) => OLD_APPROVAL_NAMES.has(n) || OLD_APPROVAL_RE.test(n);

const lech = tools.list()
  .map((t) => ({
    name: t.name,
    cuSide: oldSide(t.name),
    cuApproval: oldApproval(t.name),
    moiSide: t.sideEffect,
    moiApproval: t.requiresApproval,
  }))
  .filter((r) => r.cuSide !== r.moiSide || r.cuApproval !== r.moiApproval);

console.log('\n  Chỗ lối cũ đoán sai:');
for (const r of lech) {
  const doi = [];
  if (r.cuSide !== r.moiSide) doi.push(`sideEffect ${r.cuSide}→${r.moiSide}`);
  if (r.cuApproval !== r.moiApproval) doi.push(`requiresApproval ${r.cuApproval}→${r.moiApproval}`);
  console.log(`    ${r.name.padEnd(20)} ${doi.join(', ')}`);
}
console.log();

check('lối cũ có đoán sai thật (nếu 0 thì bài này vô nghĩa)', lech.length > 0);

// --- 3. Hai chỗ sai nguy hiểm nhất phải được sửa ----------------------------
const computerUse = tools.get('computer_use');
check('computer_use (điều khiển chuột/bàn phím thật) nay phải hỏi trước',
  computerUse.sideEffect === true && computerUse.requiresApproval === true);
check('ĐẢO NGƯỢC: lối cũ (cả danh sách cứng lẫn regex) xếp computer_use là vô hại',
  oldSide('computer_use') === false && oldApproval('computer_use') === false);

const http = tools.get('http_request');
check('http_request (gửi được POST/PUT/DELETE) nay tính là có tác dụng phụ', http.sideEffect === true);
check('ĐẢO NGƯỢC: lối cũ xếp http_request là không có tác dụng phụ',
  oldSide('http_request') === false);

// Đối chứng: mã cũ KHÔNG sai mọi chỗ. Danh sách cứng bắt đúng connector_request
// và schedule_task. Nêu ra để con số "sai bao nhiêu" không bị thổi lên.
check('đối chứng: danh sách cứng cũ đã bắt đúng connector_request',
  oldSide('connector_request') === true && oldApproval('connector_request') === true);

// --- 4. Không bắt duyệt oan tool chỉ đọc ------------------------------------
const chiDoc = ['file_read', 'grep', 'glob', 'web_search', 'search_memory', 'vault_list'];
const oan = chiDoc.filter((n) => tools.get(n).sideEffect || tools.get(n).requiresApproval);
check(`không tool chỉ đọc nào bị bắt duyệt (${chiDoc.length} tool)`, oan.length === 0);

// --- 5. Tool dùng credential phải hỏi ---------------------------------------
const connector = tools.get('connector_request');
check('connector_request (dùng credential, gửi ra ngoài) phải hỏi trước',
  connector.requiresApproval === true);

// --- 6. Gỡ plugin là rút sạch ----------------------------------------------
await kernel.dispose();
const conLai = (() => {
  try {
    return kernel.root.tools?.list().length ?? 0;
  } catch {
    return 0;
  }
})();
check('gỡ kernel xong không còn tool nào treo lại', conLai === 0);

console.log(
  pass
    ? `\n✓ ${names.length} tool native tự khai tính chất; hai chỗ lối đoán cũ sai nguy hiểm nhất đã được sửa`
    : '\n✗ FAILED',
);
process.exit(pass ? 0 : 1);
