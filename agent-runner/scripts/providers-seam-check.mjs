/**
 * Kiểm seam nhà cung cấp model.
 *
 * Điều cần chứng minh: **cấu hình gọi tên nhà cung cấp nào thì nhà cung cấp đó
 * phải thật sự có mặt trong bản đang chạy.** Hai phía này lệch nhau được, và
 * khi lệch thì người dùng chỉ thấy "không chat được" chứ không thấy nguyên nhân
 * — đúng triệu chứng của #5/#7/#9 trước đây.
 */
import { mkdirSync, mkdtempSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';

const root = mkdtempSync(path.join(tmpdir(), 'ar-prov-'));
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
async function caught(fn) {
  try { await fn(); return null; } catch (error) { return error; }
}

// --- 1. Cây plugin thật mang đủ adapter ------------------------------------
const kernel = await composeRunner();
const names = kernel.root.providers.names();
console.log(`  nhà cung cấp đang có: ${names.join(', ')}`);
check('bản đang chạy có ít nhất một nhà cung cấp', names.length > 0);
check('có đủ ba nhà cung cấp chính',
  ['anthropic', 'openai', 'gemini'].every((n) => kernel.root.providers.has(n)));

// --- 2. Tên lạ thì nổ, kèm danh sách đang có -------------------------------
const unknown = await caught(async () => kernel.root.providers.create('khong-co-that'));
check('tên nhà cung cấp lạ thì nổ', unknown !== null);
check('lỗi nêu ra những lựa chọn đang có, không chỉ nói "sai"',
  names.some((n) => String(unknown?.message).includes(n)));

// --- 3. Đăng ký là effect --------------------------------------------------
const remove = kernel.root.providers.register('thu-nghiem', () => ({
  name: 'thu-nghiem', query: () => ({ push() {}, end() {}, abort() {}, events: (async function* () {})() }),
  isSessionInvalid: () => false,
}));
check('cắm adapter mới ⇒ seam thấy ngay', kernel.root.providers.has('thu-nghiem'));
remove();
check('gỡ ra ⇒ seam thôi thấy', !kernel.root.providers.has('thu-nghiem'));

const dup = await caught(async () => {
  const off = kernel.root.providers.register('trung-ten', () => ({}));
  kernel.root.providers.register('trung-ten', () => ({}));
  off();
});
check('trùng tên nhà cung cấp thì nổ', dup !== null);
await kernel.dispose();

// --- 4. Cấu hình gọi tên không có thì nổ NGAY LÚC DỰNG ---------------------
// Đây là mục quan trọng nhất: sai cấu hình phải lộ ở chỗ dựng, không phải lộ
// thành "không có model, không chat được" sau khi người dùng đã cài xong.
const missing = await caught(() => composeRunner({ providerName: 'nha-cung-cap-khong-ton-tai' }));
check('cấu hình gọi tên không có ⇒ nổ ngay lúc dựng cây plugin', missing !== null);
check('lỗi nói rõ tên bị thiếu',
  String(missing?.message).includes('nha-cung-cap-khong-ton-tai'));
check('lỗi mang mã INVARIANT để chỗ khác bắt được', missing?.code === 'INVARIANT');

// --- 5. ĐẢO NGƯỢC: tên có thật thì KHÔNG nổ --------------------------------
// Thiếu mục này thì mục trên có thể xanh vì composeRunner luôn ném.
const fine = await caught(async () => {
  const k = await composeRunner({ providerName: 'anthropic' });
  await k.dispose();
});
check('ĐẢO NGƯỢC: cấu hình gọi tên có thật thì dựng trót lọt', fine === null);

console.log(
  pass
    ? '\n✓ seam nhà cung cấp: thêm adapter là đăng ký, và cấu hình sai lộ ngay lúc dựng'
    : '\n✗ FAILED',
);
process.exit(pass ? 0 : 1);
