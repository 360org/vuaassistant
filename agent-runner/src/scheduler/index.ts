/**
 * Scheduled tasks, running in the Host Process.
 *
 * idea.md §1.3 puts the agent brain in the host daemon, and the product promise
 * is that a scheduled task fires on time. Running the scheduler inside the
 * webview broke that promise: closing the window stopped every schedule. This
 * module ticks inside the runner, so schedules keep firing while the UI is shut.
 *
 * Ownership:
 *  - The app owns the task list and writes it to `scheduled-tasks.json`.
 *  - The runner owns execution and remembers `lastRun` in `session_state`,
 *    so neither side writes the other's storage and there is no lost update.
 *
 * A due task runs through the very same agent loop the chat uses, and its reply
 * is written to `messages_out` — the UI shows it exactly like any other answer.
 */
import fs from 'fs';
import path from 'path';
import { getSessionState, setSessionState, writeMessageOut, writeTaskRunLog } from '../db/index.js';
import { checkBudget, recordSpend, type BudgetStore } from '../daily-budget.js';
import { executeAgentLoop, type PollLoopConfig } from '../poll-loop.js';
import { notifyTelegram } from '../channels/telegram.js';
import { isDue } from './schedule.js';
import { getDataDir } from '../util/data-dir.js';

const TICK_MS = 30_000;
/**
 * Tags every row this module writes, so the chat window — which polls the same
 * outbound queue — never mistakes a scheduled result for its own answer.
 */
const CHANNEL = 'scheduled';

export interface ScheduledTask {
  id: string;
  name: string;
  prompt: string;
  /** Human recurrence, e.g. "Every day at 9:00". */
  schedule: string;
  enabled: boolean;
  /** Written by whoever created the task; the runner tracks its own runs. */
  lastRun?: number;
}

function log(msg: string): void {
  console.error(`[scheduler] ${msg}`);
}

/**
 * The same file the `schedule_task` tool and the app's Scheduled page use, so
 * a task created from chat and one created in the UI are the same task.
 */
function tasksFile(): string {
  return path.join(getDataDir(), 'scheduled_tasks.json');
}

/** Read the shared task list. Missing or malformed file → no tasks. */
export function readTasks(): ScheduledTask[] {
  try {
    const parsed = JSON.parse(fs.readFileSync(tasksFile(), 'utf8'));
    const list = Array.isArray(parsed) ? parsed : parsed?.tasks;
    if (!Array.isArray(list)) return [];
    return list.filter(
      (t): t is ScheduledTask =>
        t && typeof t.id === 'string' && typeof t.prompt === 'string' && typeof t.schedule === 'string',
    );
  } catch {
    return [];
  }
}

const lastRunKey = (taskId: string) => `scheduler:lastRun:${taskId}`;

/**
 * Sổ ngân sách dùng chung kho `session_state` với `lastRun`, nên nó sống sót
 * qua mọi lần khởi động lại — đúng thứ cần thiết, vì một vòng lặp chạy hoang
 * suốt đêm có thể vắt qua nhiều lần app bật/tắt.
 */
const budgetStore: BudgetStore = {
  get: (key) => getSessionState(key),
  set: (key, value) => setSessionState(key, value),
};

/** Đẩy một câu thông báo của hệ thống lên giao diện và Telegram. */
function announce(text: string): void {
  writeMessageOut({
    id: generateId(),
    kind: 'chat',
    platform_id: CHANNEL,
    channel_type: CHANNEL,
    thread_id: 'budget',
    content: JSON.stringify({ text, status: 'notice' }),
  });
  void notifyTelegram(text);
}

/**
 * When the runner has never fired a task, fall back to the `lastRun` stamped
 * into the file at creation time. Without that a task created minutes ago with
 * a "daily at 09:00" schedule would fire immediately on the next tick.
 */
export function getLastRun(taskId: string, fallback?: number): number | undefined {
  const raw = getSessionState(lastRunKey(taskId));
  const value = raw === null ? NaN : Number(raw);
  if (Number.isFinite(value)) return value;
  return typeof fallback === 'number' && Number.isFinite(fallback) ? fallback : undefined;
}

export function setLastRun(taskId: string, at: number): void {
  setSessionState(lastRunKey(taskId), String(at));
}

/** Tasks that should fire at `now`, honouring `enabled` and the last run. */
export function dueTasks(tasks: ScheduledTask[], now: Date): ScheduledTask[] {
  return tasks.filter(
    (task) => task.enabled !== false && isDue(task.schedule, now, getLastRun(task.id, task.lastRun)),
  );
}

function generateId(): string {
  return `sched-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Run every task due at `now`. Returns the ids that fired.
 *
 * `lastRun` is recorded *before* the agent runs so a slow task cannot fire
 * twice when the next tick arrives while it is still working.
 */
export async function runDueTasks(config: PollLoopConfig, now = new Date()): Promise<string[]> {
  const due = dueTasks(readTasks(), now);
  const fired: string[] = [];

  // Kiểm ngân sách TRƯỚC khi chạy bất cứ việc gì. Phanh vòng lặp chặn được một
  // lượt chạy hoang; cái này chặn nhiều lượt cộng dồn qua cả đêm.
  const budget = checkBudget(budgetStore, { now });
  if (budget.notice) announce(budget.notice);
  if (budget.mode === 'stop') {
    if (due.length > 0) {
      log(`Bỏ qua ${due.length} tác vụ: đã chạm trần ngân sách hôm nay (~${budget.spent} token)`);
      // Vẫn ghi lastRun để sang ngày mai không dồn lại chạy một loạt.
      for (const task of due) setLastRun(task.id, now.getTime());
    }
    return fired;
  }

  for (const task of due) {
    setLastRun(task.id, now.getTime());
    fired.push(task.id);
    log(`Running "${task.name || task.id}"`);
    const startedAt = Date.now();

    try {
      const result = await executeAgentLoop(
        config,
        task.prompt,
        undefined,
        { platformId: null, channelType: null, threadId: null },
        config.systemContext,
      );
      recordSpend(budgetStore, result.tokensEstimate ?? 0, now);

      const duration = Date.now() - startedAt;
      writeTaskRunLog({
        id: `log-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        taskId: task.id,
        status: 'success',
        runAt: now.getTime(),
        duration,
        output: result.text || '',
      });

      if (result.text) {
        writeMessageOut({
          id: generateId(),
          kind: 'chat',
          platform_id: CHANNEL,
          channel_type: CHANNEL,
          thread_id: task.id,
          content: JSON.stringify({
            text: result.text,
            scheduledTaskId: task.id,
            scheduledTaskName: task.name,
            status: 'success',
            durationMs: duration,
          }),
        });
        // The point of a schedule is that it reaches the user with the app
        // closed, so push it to Telegram too when a bot is connected.
        void notifyTelegram(`⏰ ${task.name || task.id}\n\n${result.text}`);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      log(`Task "${task.name || task.id}" failed: ${message}`);
      const duration = Date.now() - startedAt;

      writeTaskRunLog({
        id: `log-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        taskId: task.id,
        status: 'error',
        runAt: now.getTime(),
        duration,
        output: message,
      });

      writeMessageOut({
        id: generateId(),
        kind: 'chat',
        platform_id: CHANNEL,
        channel_type: CHANNEL,
        thread_id: task.id,
        content: JSON.stringify({
          text: `⚠️ Scheduled task "${task.name || task.id}" failed: ${message}`,
          scheduledTaskId: task.id,
          scheduledTaskName: task.name,
          status: 'error',
          durationMs: duration,
        }),
      });
    }
  }

  return fired;
}

/** Start the scheduler tick. Runs until the process exits. */
export function startScheduler(config: PollLoopConfig): void {
  log(`Started — checking every ${TICK_MS / 1000}s`);
  const tick = async () => {
    try {
      await runDueTasks(config);
    } catch (error) {
      log(`Tick failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  };
  // Fire soon after boot so a task whose time passed while the app was closed
  // is not held back for a full interval.
  setTimeout(() => void tick(), 5_000);
  setInterval(() => void tick(), TICK_MS).unref?.();
}
