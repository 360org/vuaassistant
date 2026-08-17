// Checks the Host Process scheduler: schedule matching, due selection against
// the shared scheduled_tasks.json, run bookkeeping, and that a fired task's
// answer reaches outbound.db. Deterministic, no network.
// Run: npx tsx scripts/scheduler-check.mjs

import { mkdtempSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';

const dir = mkdtempSync(path.join(tmpdir(), 'ar-sched-'));
process.env.VUA_DATA_DIR = dir;
process.env.VUA_IPC_DIR = path.join(dir, 'ipc');

const { createInboundSchema, closeAll, getOutboundDb } = await import('../src/db/connection.ts');
createInboundSchema();

const { isDue } = await import('../src/scheduler/schedule.ts');
const { readTasks, dueTasks, getLastRun, setLastRun, runDueTasks } = await import('../src/scheduler/index.ts');

let pass = true;
const check = (name, cond) => {
  console.log(`${cond ? '✓' : '✗'} ${name}`);
  if (!cond) pass = false;
};

// --- schedule matching -------------------------------------------------------
const at9 = new Date('2026-03-10T09:05:00');
check('daily fires once the time has passed', isDue('Every day at 09:00', at9, undefined));
check('daily does not re-fire after running today', !isDue('Every day at 09:00', at9, at9.getTime() - 60_000));
check('daily waits until its time', !isDue('Every day at 23:00', at9, undefined));
check('hourly respects the hour gap', !isDue('Every hour', at9, at9.getTime() - 60_000));
check('hourly fires after an hour', isDue('Every hour', at9, at9.getTime() - 3_600_000));
// 2026-03-10 is a Tuesday.
check('named weekday only fires on that day', !isDue('Every Monday at 09:00', at9, undefined));
check('weekdays skip the weekend', !isDue('Weekdays at 08:00', new Date('2026-03-08T09:00:00'), undefined));

// --- the assistant writes these strings, in either language ------------------
// The tool's own description suggests "Hàng ngày lúc 09:30"; that used to miss
// the time entirely and silently become 09:00.
check('Vietnamese daily honours its time', !isDue('Hàng ngày lúc 09:30', at9, undefined));
check('Vietnamese daily fires once its time passes', isDue('Hàng ngày lúc 09:00', at9, undefined));
check('a bare HH:MM is read as the time', !isDue('Đăng bài 23:00', at9, undefined));
check('9h30 style is read as the time', !isDue('Hàng ngày 9h30', at9, undefined));
check('Vietnamese weekday only fires on that day', !isDue('Thứ hai lúc 09:00', at9, undefined));
check('Vietnamese hourly respects the gap', !isDue('Hàng giờ', at9, at9.getTime() - 60_000));

// --- a dated one-off is not a daily job -------------------------------------
// It used to fall through to "daily at 09:00" and run every day forever.
const onDay = new Date('2026-03-10T09:05:00');
check('a dated task fires once its moment arrives', isDue('10/03 08:30', onDay, undefined));
check('a dated task waits for its time of day', !isDue('10/03 23:00', onDay, undefined));
check('a dated task does not fire on another day', !isDue('11/03 08:30', onDay, undefined));
check('a creation stamp does not suppress a future one-off', isDue('10/03 08:30', onDay, onDay.getTime() - 86_400_000));
check('a dated task never fires twice', !isDue('10/03 08:30', onDay, onDay.getTime()));
check('an ISO date works too', isDue('2026-03-10 08:30', onDay, undefined));
check('a full dd/mm/yyyy works too', isDue('10/03/2026 08:30', onDay, undefined));
check('the date is not mistaken for a time', !isDue('10/03 23:30', onDay, undefined));

// --- reads the same file the schedule_task tool writes ------------------------
const tasks = [
  { id: 't1', name: 'Daily report', prompt: 'Summarise today', schedule: 'Every day at 09:00', enabled: true },
  { id: 't2', name: 'Disabled', prompt: 'Nope', schedule: 'Every day at 09:00', enabled: false },
  { id: 't3', name: 'Later', prompt: 'Not yet', schedule: 'Every day at 23:00', enabled: true },
];
writeFileSync(path.join(dir, 'scheduled_tasks.json'), JSON.stringify(tasks, null, 2));

check('reads the shared scheduled_tasks.json', readTasks().length === 3);

const due = dueTasks(readTasks(), at9);
check('only the due, enabled task is selected', due.length === 1 && due[0].id === 't1');

// --- run bookkeeping ---------------------------------------------------------
check('a task with no history has no last run', getLastRun('t1') === undefined);
setLastRun('t1', at9.getTime());
check('last run is remembered across reads', getLastRun('t1') === at9.getTime());
check('a task does not fire twice in the same window', dueTasks(readTasks(), at9).length === 0);

// A task created moments ago must not fire immediately on the next tick.
writeFileSync(
  path.join(dir, 'scheduled_tasks.json'),
  JSON.stringify([{ id: 'fresh', name: 'Fresh', prompt: 'x', schedule: 'Every day at 09:00', enabled: true, lastRun: at9.getTime() }]),
);
check('a freshly created task respects its creation stamp', dueTasks(readTasks(), at9).length === 0);

// --- a fired task delivers its answer ---------------------------------------
writeFileSync(
  path.join(dir, 'scheduled_tasks.json'),
  JSON.stringify([{ id: 'run1', name: 'Runner', prompt: 'say hi', schedule: 'Every day at 09:00', enabled: true }]),
);

const stubProvider = {
  name: 'stub',
  query: () => ({
    events: (async function* () {
      yield { type: 'text_delta', text: 'scheduled answer' };
      yield { type: 'result', text: 'scheduled answer' };
    })(),
  }),
  isSessionInvalid: () => false,
};

const fired = await runDueTasks(
  { provider: stubProvider, providerName: 'stub', agentId: 'default', systemContext: { instructions: '' }, tools: (await (await import('../src/kernel/compose.ts')).composeRunner()).root.tools },
  at9,
);
check('the due task fired', fired.length === 1 && fired[0] === 'run1');

const rows = getOutboundDb().prepare('SELECT channel_type, content FROM messages_out').all();
const delivered = rows.map((r) => String(r.content)).join('\n');
check('the answer reached outbound.db', delivered.includes('scheduled answer'));
check('the delivery names its task', delivered.includes('run1'));
// Chat, Telegram and schedules share one outbound queue; without this tag the
// chat window would show a scheduled result as the answer to its own question.
check('the delivery is tagged as scheduled', rows.every((r) => r.channel_type === 'scheduled'));

// --- the tool the assistant actually calls ----------------------------------
// A seven-day plan has to be one call: when this took a single task, the model
// summarised the plan in prose instead and nothing was ever scheduled.
const { executeTool } = await import('../src/native-tools/index.ts');
writeFileSync(path.join(dir, 'scheduled_tasks.json'), '[]');

const plan = Array.from({ length: 7 }, (_, i) => ({
  name: `Đăng bài Ngày ${i + 1}`,
  prompt: `Đăng bài blog ngày ${i + 1} lên demo.vuahethong.com`,
  schedule: `2${6 + i}/07 08:30`,
}));
let res = await executeTool('schedule_task', { tasks: plan });
check('a whole plan is registered in one call', !res.is_error && readTasks().length === 7);
check('the tool says how many it created', res.content.includes('7 nhiệm vụ'));
check('each task keeps its own schedule', new Set(readTasks().map((t) => t.schedule)).size === 7);

// Re-running the same plan must update, not duplicate.
await executeTool('schedule_task', { tasks: plan });
check('re-running a plan does not duplicate it', readTasks().length === 7);

// The single-task shorthand still works.
await executeTool('schedule_task', { name: 'Báo cáo tuần', prompt: 'Tổng hợp tuần', schedule: 'Hàng ngày lúc 18:00' });
check('the single-task form still works', readTasks().length === 8);

// A half-specified task must be refused, not silently stored.
res = await executeTool('schedule_task', { tasks: [{ name: 'Thiếu prompt', schedule: 'Hàng ngày' }] });
check('an incomplete task is refused', res.content.startsWith('Error') && readTasks().length === 8);

closeAll();
console.log(pass ? '\n✓ Host Process scheduler works' : '\n✗ FAILED');
process.exit(pass ? 0 : 1);
