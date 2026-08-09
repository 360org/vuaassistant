#!/usr/bin/env node
/**
 * Ngân sách token theo ngày phải chặn được vòng lặp chạy hoang qua đêm.
 *
 * Phanh vòng lặp (`loop-guard`) chỉ cắt được MỘT lượt chạy hoang. Nhưng tác vụ
 * theo lịch chạy khi không ai ngồi trước máy: một tác vụ hỏng lúc 2 giờ sáng có
 * thể chạy lại mỗi giờ cho tới sáng, mỗi lượt đều nằm dưới ngưỡng của phanh, mà
 * cộng dồn thì thành một hoá đơn thật. Test này khoá phần cộng dồn đó.
 *
 * Và khoá cả cách nói với người dùng: cảnh báo chỉ được kêu MỘT LẦN mỗi ngày,
 * và phải nói rõ đây là con số ước lượng chứ không phải hoá đơn.
 */
import path from 'node:path';
import { build } from 'esbuild';
import { pathToFileURL } from 'node:url';
import { rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

const root = path.resolve(import.meta.dirname, '..');
const outfile = path.join(root, 'scripts/.daily-budget-bundle.mjs');

await build({
  entryPoints: [path.join(root, 'src/daily-budget.ts')],
  outfile,
  bundle: true,
  format: 'esm',
  platform: 'node',
  logLevel: 'silent',
});
const { checkBudget, recordSpend, spentToday, dayKey, configuredCap, DEFAULT_DAILY_CAP } =
  await import(pathToFileURL(outfile).href);

let pass = true;
const check = (name, cond) => {
  console.log(`${cond ? '✓' : '✗'} ${name}`);
  if (!cond) pass = false;
};

/** Kho trong bộ nhớ, thay cho session_state. */
function store() {
  const map = new Map();
  return { get: (k) => (map.has(k) ? map.get(k) : null), set: (k, v) => map.set(k, v) };
}

const CAP = 100_000;
const day = new Date('2026-08-09T10:00:00');

// --- 1. Dưới ngưỡng thì đừng làm phiền -------------------------------------
const quiet = store();
recordSpend(quiet, 50_000, day);
const normal = checkBudget(quiet, { cap: CAP, now: day });
check('dưới 80% thì chạy bình thường', normal.mode === 'normal');
check('dưới 80% thì không làm phiền người dùng', normal.notice === null);

// --- 2. Chạm 80%: cảnh báo nhưng vẫn chạy ----------------------------------
const warned = store();
recordSpend(warned, 80_000, day);
const warn = checkBudget(warned, { cap: CAP, now: day });
check('chạm 80% thì cảnh báo', warn.mode === 'warn');
check('cảnh báo rồi vẫn chạy tiếp', warn.mode !== 'stop');
check('có câu báo cho người dùng', typeof warn.notice === 'string' && warn.notice.length > 40);
check('câu báo nói rõ là ƯỚC LƯỢNG, không phải hoá đơn', /ước lượng/i.test(warn.notice));

// Cảnh báo lặp lại mỗi 30 giây cho tới nửa đêm thì người dùng sẽ tắt app.
const warnAgain = checkBudget(warned, { cap: CAP, now: day });
check('cảnh báo chỉ kêu MỘT LẦN trong ngày', warnAgain.notice === null);
check('nhưng trạng thái vẫn là cảnh báo', warnAgain.mode === 'warn');

// --- 3. Chạm trần: dừng hẳn -------------------------------------------------
const stopped = store();
recordSpend(stopped, 100_000, day);
const stop = checkBudget(stopped, { cap: CAP, now: day });
check('chạm trần thì dừng', stop.mode === 'stop');
check('báo cho người dùng biết đã dừng', /tạm dừng/.test(stop.notice ?? ''));
check('nói rõ cách chạy tiếp', /nâng trần|ngày mai/.test(stop.notice ?? ''));
check('thông báo dừng cũng chỉ kêu một lần', checkBudget(stopped, { cap: CAP, now: day }).notice === null);

// --- 4. Cộng dồn qua nhiều lượt — chính là cảnh cần chặn --------------------
// 10 lượt, mỗi lượt 12k token: không lượt nào tự nó đáng ngờ, nhưng cộng lại
// thì vượt trần. Đây là cảnh "tác vụ hỏng chạy lại mỗi giờ suốt đêm".
const overnight = store();
let stoppedAt = null;
for (let hour = 0; hour < 10; hour++) {
  const status = checkBudget(overnight, { cap: CAP, now: day });
  if (status.mode === 'stop') { stoppedAt = hour; break; }
  recordSpend(overnight, 12_000, day);
}
check(`chạy hoang qua đêm bị chặn (ở lượt thứ ${stoppedAt})`, stoppedAt !== null);
check('chặn trước khi tiêu quá xa mức trần', spentToday(overnight, day) <= CAP * 1.2);

// --- 5. Sang ngày mới thì mở lại --------------------------------------------
const tomorrow = new Date('2026-08-10T00:05:00');
check('sổ của ngày mới bắt đầu từ 0', spentToday(stopped, tomorrow) === 0);
check('ngày mới chạy lại bình thường', checkBudget(stopped, { cap: CAP, now: tomorrow }).mode === 'normal');
check(
  'ngày mới có thể cảnh báo lại (không bị khoá vĩnh viễn)',
  (() => {
    recordSpend(stopped, 85_000, tomorrow);
    return checkBudget(stopped, { cap: CAP, now: tomorrow }).notice !== null;
  })(),
);

// --- 6. Ngày tính theo giờ máy người dùng, không phải UTC -------------------
// Ở Việt Nam (UTC+7), dùng UTC thì ngân sách nhảy về 0 lúc 7 giờ sáng — vừa khó
// hiểu vừa cho vòng lặp chạy hoang thêm một suất giữa buổi.
//
// Máy chạy CI đặt giờ UTC, nên so `getFullYear()` với `getUTCFullYear()` ở đây
// luôn ra bằng nhau và mục test thành rỗng nghĩa. Phải chạy hẳn dưới múi giờ
// Việt Nam trong một tiến trình con mới kiểm được thật.
const tzProbe = spawnSync(
  process.execPath,
  [
    '--input-type=module',
    '-e',
    `import { dayKey } from ${JSON.stringify(pathToFileURL(outfile).href)};
     // 16:30Z = 23:30 giờ VN ngày 09; 17:30Z = 00:30 giờ VN ngày 10.
     const truoc = dayKey(new Date('2026-08-09T16:30:00Z'));
     const sau = dayKey(new Date('2026-08-09T17:30:00Z'));
     console.log(JSON.stringify({ truoc, sau }));`,
  ],
  { env: { ...process.env, TZ: 'Asia/Ho_Chi_Minh' }, encoding: 'utf8' },
);
const tz = tzProbe.stdout ? JSON.parse(tzProbe.stdout) : {};
check(
  `nửa đêm giờ VN sang sổ mới (${tz.truoc} → ${tz.sau}), không đợi tới 7 giờ sáng`,
  tz.truoc === '2026-08-09' && tz.sau === '2026-08-10',
);

// --- 7. Cấu hình -----------------------------------------------------------
check('mặc định có trần', configuredCap({}) === DEFAULT_DAILY_CAP);
check('đặt được trần riêng', configuredCap({ VUA_DAILY_TOKEN_BUDGET: '250000' }) === 250_000);
check('đặt 0 là tắt giới hạn', configuredCap({ VUA_DAILY_TOKEN_BUDGET: '0' }) === 0);
check(
  'tắt giới hạn thì không bao giờ chặn',
  checkBudget(stopped, { cap: 0, now: day }).mode === 'normal',
);
check(
  'giá trị rác thì quay về mặc định, không tắt mất giới hạn',
  configuredCap({ VUA_DAILY_TOKEN_BUDGET: 'nhiều vào' }) === DEFAULT_DAILY_CAP,
);

// --- 8. Ghi sổ ---------------------------------------------------------------
const ledger = store();
recordSpend(ledger, 1000, day);
recordSpend(ledger, 500, day);
check('cộng dồn đúng', spentToday(ledger, day) === 1500);
check('số âm hoặc rác không làm hỏng sổ', (() => {
  recordSpend(ledger, -900, day);
  recordSpend(ledger, NaN, day);
  return spentToday(ledger, day) === 1500;
})());

rmSync(outfile, { force: true });

console.log(
  pass
    ? '\n✓ ngân sách ngày chặn được chạy hoang qua đêm, và chỉ làm phiền người dùng một lần'
    : '\n✗ FAILED',
);
process.exit(pass ? 0 : 1);
