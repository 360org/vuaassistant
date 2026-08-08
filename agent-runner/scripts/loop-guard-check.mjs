#!/usr/bin/env node
/**
 * Phanh vòng lặp agentic phải cắt được cảnh lặp vô ích.
 *
 * Cảnh cần chặn: agent gọi một tool hỏng, nhận về cùng một lỗi, rồi gọi lại y
 * hệt. Trước đây chỉ có trần 25 vòng nên nó chạy đủ 25 lần — người dùng trả
 * tiền cho 25 lượt gọi model để nhận về đúng một thông báo lỗi.
 *
 * Test dựng thẳng cảnh đó rồi đòi vòng lặp phải dừng sớm, và đòi câu báo cho
 * người dùng là tiếng Việt đọc hiểu được chứ không phải mã lỗi nội bộ.
 */
import assert from 'node:assert/strict';
import path from 'node:path';
import { build } from 'esbuild';
import { pathToFileURL } from 'node:url';
import { rmSync } from 'node:fs';

const root = path.resolve(import.meta.dirname, '..');
const outfile = path.join(root, 'scripts/.loop-guard-bundle.mjs');

await build({
  entryPoints: [path.join(root, 'src/loop-guard.ts')],
  outfile,
  bundle: true,
  format: 'esm',
  platform: 'node',
  logLevel: 'silent',
});
const { checkLoop, errorFingerprint, DEFAULT_LIMITS } = await import(pathToFileURL(outfile).href);

let pass = true;
const check = (name, cond) => {
  console.log(`${cond ? '✓' : '✗'} ${name}`);
  if (!cond) pass = false;
};

const fail = (error, tool = 'http_request') => ({ tool, ok: false, error });
const ok = (tool = 'http_request') => ({ tool, ok: true });

// --- 1. Giậm chân: cùng một lỗi lặp lại ------------------------------------
const sameError = 'Error: connect ECONNREFUSED 127.0.0.1:5432';
const stuck = [fail(sameError), fail(sameError), fail(sameError)];
const stuckVerdict = checkLoop(stuck, 3, DEFAULT_LIMITS);

check('cùng một lỗi 3 lần liên tiếp thì dừng', stuckVerdict.action === 'stop');
check('nêu đúng lý do là giậm chân', stuckVerdict.reason === 'stagnation');
check(
  'dừng ở vòng 3, không chạy hết 25 vòng',
  checkLoop(stuck.slice(0, 2), 2, DEFAULT_LIMITS).action === 'continue',
);

// Lỗi thật hiếm khi giống hệt nhau: cổng, id request, thời điểm đổi mỗi lần.
// So nguyên văn sẽ không bao giờ thấy "cùng một lỗi" và phanh thành vô dụng.
const drifting = [
  fail('Error: connect ECONNREFUSED 127.0.0.1:5432 (req 8f2a1c9d4b3e6f70)'),
  fail('Error: connect ECONNREFUSED 127.0.0.1:5432 (req 1b7e4a2c8d9f0356)'),
  fail('Error: connect ECONNREFUSED 127.0.0.1:5432 (req c4d8e1f2a3b56789)'),
];
check(
  'lỗi khác nhau ở id/số vẫn tính là cùng một lỗi',
  checkLoop(drifting, 3, DEFAULT_LIMITS).reason === 'stagnation',
);
check(
  'dấu vân tay bỏ được phần biến thiên',
  errorFingerprint('timeout after 30s') === errorFingerprint('timeout after 90s'),
);
check(
  'nhưng lỗi thật sự khác nhau thì không gộp',
  errorFingerprint('connection refused') !== errorFingerprint('permission denied'),
);

// --- 2. Không tiến triển: hỏng liên tiếp dù lỗi khác nhau -------------------
const flailing = [
  fail('Error: file not found'),
  fail('Error: permission denied'),
  fail('Error: invalid argument'),
  fail('Error: timeout'),
  fail('Error: unknown host'),
];
const flailVerdict = checkLoop(flailing, 5, DEFAULT_LIMITS);
check('5 bước hỏng liên tiếp thì dừng', flailVerdict.action === 'stop');
check('nêu đúng lý do là không tiến triển', flailVerdict.reason === 'no-progress');

// --- 3. Không được chặn nhầm việc đang chạy tốt ----------------------------
check(
  'chưa có lần thử nào thì chạy tiếp',
  checkLoop([], 0, DEFAULT_LIMITS).action === 'continue',
);
check(
  'mọi bước đều tốt thì chạy tiếp',
  checkLoop([ok(), ok(), ok(), ok(), ok(), ok()], 6, DEFAULT_LIMITS).action === 'continue',
);
check(
  'hỏng rồi thành công thì đếm lại từ đầu, không dừng',
  checkLoop(
    [fail(sameError), fail(sameError), ok(), fail(sameError)],
    4,
    DEFAULT_LIMITS,
  ).action === 'continue',
);
check(
  'lỗi xen kẽ thành công không bao giờ chạm ngưỡng',
  checkLoop(
    [fail('a'), ok(), fail('a'), ok(), fail('a'), ok(), fail('a')],
    7,
    DEFAULT_LIMITS,
  ).action === 'continue',
);

// --- 4. Trần cứng vẫn còn ---------------------------------------------------
check(
  'chạm trần số vòng thì vẫn dừng',
  checkLoop([ok()], 25, DEFAULT_LIMITS).reason === 'iteration-cap',
);

// --- 5. Trần token (chỉ bật khi có cấu hình) --------------------------------
const spendy = [{ tool: 'x', ok: true, tokens: 60_000 }, { tool: 'x', ok: true, tokens: 50_000 }];
check(
  'không cấu hình ngân sách thì không chặn vì token',
  checkLoop(spendy, 2, DEFAULT_LIMITS).action === 'continue',
);
check(
  'có ngân sách và tiêu quá thì dừng',
  checkLoop(spendy, 2, { ...DEFAULT_LIMITS, tokenBudget: 100_000 }).reason === 'token-budget',
);

// --- 6. Câu báo phải là tiếng người, không phải mã lỗi ----------------------
for (const [label, verdict] of [
  ['giậm chân', stuckVerdict],
  ['không tiến triển', flailVerdict],
]) {
  const message = verdict.message ?? '';
  check(`câu báo (${label}) không rỗng`, message.length > 40);
  check(
    `câu báo (${label}) không lộ tên lý do nội bộ`,
    !/stagnation|no-progress|iteration-cap|token-budget/.test(message),
  );
  check(
    `câu báo (${label}) nói cho người dùng bước tiếp theo`,
    /Sếp/.test(message) && /\?|nhé/.test(message),
  );
}
check(
  'câu báo có kèm lỗi thật để người dùng biết hỏng ở đâu',
  stuckVerdict.message.includes('ECONNREFUSED'),
);
check(
  'câu báo không đổ nguyên khối JSON thô',
  !/^\s*[{[]/m.test(stuckVerdict.message),
);

rmSync(outfile, { force: true });

console.log(
  pass
    ? '\n✓ phanh vòng lặp cắt được cảnh lặp vô ích, và báo cho người dùng bằng tiếng người'
    : '\n✗ FAILED',
);
process.exit(pass ? 0 : 1);
