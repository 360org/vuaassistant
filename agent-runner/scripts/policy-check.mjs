#!/usr/bin/env node
/**
 * Luật của người dùng phải được MÁY thi hành, không phải nhét vào prompt.
 *
 * Nhét luật vào system prompt rồi mong model nghe lời thì đó là gợi ý, không
 * phải luật — model có thể bỏ qua, và với việc tiêu tiền thật thì "có thể bỏ
 * qua" là không chấp nhận được. Chỗ chặn thật nằm ở capability rail, nơi mọi
 * capability bắt buộc đi qua trước khi chạy. Test này khoá đúng cái rail đó.
 *
 * Ba chỗ dễ làm luật thành đồ trang trí, đều được kiểm riêng:
 *   - so đường dẫn bằng `includes` trên chuỗi thô: vừa lọt vừa chặn oan;
 *   - tệp chính sách hỏng làm gỡ sạch mọi giới hạn;
 *   - hạn mức theo giờ tròn cho phép gửi gấp đôi quanh mốc giao giờ.
 */
import path from 'node:path';
import { build } from 'esbuild';
import { pathToFileURL } from 'node:url';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';

const root = path.resolve(import.meta.dirname, '..');
const outfile = path.join(root, 'scripts/.policy-bundle.mjs');

await build({
  entryPoints: [path.join(root, 'src/policy.ts')],
  outfile,
  bundle: true,
  format: 'esm',
  platform: 'node',
  logLevel: 'silent',
});
const { readPolicy, pathDenied, requiresAsk, OutboundLimiter, DEFAULT_POLICY } =
  await import(pathToFileURL(outfile).href);

let pass = true;
const check = (name, cond) => {
  console.log(`${cond ? '✓' : '✗'} ${name}`);
  if (!cond) pass = false;
};

const dir = mkdtempSync(path.join(os.tmpdir(), 'vua-policy-'));
const file = path.join(dir, 'policy.json');
const write = (data) => writeFileSync(file, typeof data === 'string' ? data : JSON.stringify(data));

// --- 1. Đọc tệp chính sách --------------------------------------------------
write({ deniedPaths: ['.env', 'ke-toan'], alwaysAsk: ['send_email'], maxOutboundPerHour: 5 });
const policy = readPolicy(file);
check('đọc được luật người dùng đặt', policy.maxOutboundPerHour === 5);
check('đọc được danh sách đường dẫn cấm', policy.deniedPaths.includes('ke-toan'));
check('đọc được danh sách luôn phải hỏi', policy.alwaysAsk.includes('send_email'));

// Tệp hỏng KHÔNG được gỡ sạch giới hạn — một dấu phẩy thừa mà mở toang mọi cửa
// thì còn tệ hơn không có chính sách.
write('{ "deniedPaths": [".env",, }');
check('tệp hỏng thì quay về mặc định, không mở toang', readPolicy(file).deniedPaths.length > 0);
check('tệp không tồn tại cũng về mặc định', readPolicy(path.join(dir, 'khong-co.json')).deniedPaths.length > 0);
write({ deniedPaths: 'không phải mảng', maxOutboundPerHour: 'nhiều' });
check('trường sai kiểu thì lấy mặc định cho riêng trường đó', readPolicy(file).deniedPaths.length > 0);
check('số sai kiểu không thành NaN', Number.isFinite(readPolicy(file).maxOutboundPerHour));
write({ deniedPaths: ['.env', 123, null, '  ke-toan  '] });
check('bỏ phần tử rác trong mảng', readPolicy(file).deniedPaths.every((p) => typeof p === 'string'));
check('cắt khoảng trắng thừa', readPolicy(file).deniedPaths.includes('ke-toan'));

// --- 2. So đường dẫn: phải theo ĐOẠN, không phải `includes` -----------------
const paths = { ...DEFAULT_POLICY, deniedPaths: ['.env', '.ssh', 'ke-toan'] };
check('chặn đúng tệp bị cấm', pathDenied('/home/an/duan/.env', paths) === '.env');
check('chặn đúng thư mục bị cấm', pathDenied('/home/an/.ssh/id_rsa', paths) === '.ssh');
check('chặn cả đường dẫn kiểu Windows', pathDenied('C:\\Users\\An\\.ssh\\config', paths) === '.ssh');
check('không phân biệt hoa thường', pathDenied('/home/An/.SSH/config', paths) === '.ssh');

// `includes` trên chuỗi thô sẽ chặn oan chỗ này — người dùng mất quyền đọc
// chính thư mục làm việc của họ vì tên nó tình cờ chứa chuỗi bị cấm.
check(
  'KHÔNG chặn oan tệp chỉ tình cờ chứa chuỗi bị cấm',
  pathDenied('/home/an/duan-env/ghi-chu.txt', paths) === null,
);
check(
  'KHÔNG chặn oan tên tệp dài hơn luật',
  pathDenied('/home/an/.environment-setup.md', paths) === null,
);
check('đường dẫn sạch thì cho qua', pathDenied('/home/an/tai-lieu/bao-cao.docx', paths) === null);
check('luật nhiều đoạn khớp đúng dãy đoạn', pathDenied('/srv/app/config/secrets/key', { ...paths, deniedPaths: ['config/secrets'] }) === 'config/secrets');

// --- 3. Luôn phải hỏi -------------------------------------------------------
const ask = { ...DEFAULT_POLICY, alwaysAsk: ['send_email'] };
check('capability trong danh sách thì phải hỏi', requiresAsk('send_email', ask));
check('không phân biệt hoa thường', requiresAsk('SEND_EMAIL', ask));
check('capability khác thì không bị đòi hỏi', !requiresAsk('read_file', ask));

// --- 4. Hạn mức gửi ra ngoài: cửa sổ TRƯỢT ---------------------------------
const limited = new OutboundLimiter({ ...DEFAULT_POLICY, maxOutboundPerHour: 3 });
const t0 = new Date('2026-08-09T08:00:00').getTime();
check('lần 1 được phép', limited.take(t0) === null);
check('lần 2 được phép', limited.take(t0 + 1000) === null);
check('lần 3 được phép', limited.take(t0 + 2000) === null);
const refused = limited.take(t0 + 3000);
check('lần 4 bị chặn', typeof refused === 'string');
check('nói rõ luật của người dùng, không phải lỗi kỹ thuật', /Sếp/.test(refused ?? ''));
check('nói khi nào gửi lại được', /phút nữa/.test(refused ?? ''));
check('chỉ đường sửa nếu thật sự cần', /Cài đặt/.test(refused ?? ''));

// Cửa sổ trượt, không phải "mỗi giờ tròn reset": với mốc giờ tròn thì agent gửi
// hết hạn mức lúc 8:59 rồi gửi tiếp cả hạn mức mới lúc 9:01 — người dùng nhận
// gấp đôi số tin trong hai phút, đúng thứ giới hạn này sinh ra để tránh.
const sliding = new OutboundLimiter({ ...DEFAULT_POLICY, maxOutboundPerHour: 2 });
const t859 = new Date('2026-08-09T08:59:00').getTime();
sliding.take(t859);
sliding.take(t859 + 1000);
check(
  'qua mốc giờ tròn vẫn bị chặn (cửa sổ trượt, không reset theo giờ)',
  sliding.take(new Date('2026-08-09T09:01:00').getTime()) !== null,
);
check(
  'quá một giờ thì mở lại',
  sliding.take(t859 + 3_600_001) === null,
);

// Không đặt hạn mức thì đừng chặn gì cả.
const unlimited = new OutboundLimiter({ ...DEFAULT_POLICY, maxOutboundPerHour: 0 });
check(
  'không đặt hạn mức thì không bao giờ chặn',
  Array.from({ length: 50 }, () => unlimited.take(t0)).every((r) => r === null),
);

rmSync(dir, { recursive: true, force: true });
rmSync(outfile, { force: true });

console.log(
  pass
    ? '\n✓ luật của người dùng được rail thi hành, không phải chỉ nằm trong prompt'
    : '\n✗ FAILED',
);
process.exit(pass ? 0 : 1);
