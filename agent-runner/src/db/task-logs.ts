/**
 * CRUD operations for task_run_logs table in outbound.db.
 *
 * Dùng đúng API của `node:sqlite` mà các tệp db khác đang dùng: `run()` để ghi,
 * `all()` để đọc. Bản đầu viết theo lối con trỏ thấp (`step()`, `columnText()`,
 * `finalize()`) — đó là API của `better-sqlite3`/`node-sqlite3-wasm`, không có
 * trên `PreparedStatement` của `node:sqlite`, nên cả agent-runner không biên
 * dịch được.
 */
import { getOutboundDb } from './connection.js';

export interface TaskRunLogRow {
  id: string;
  taskId: string;
  status: string;
  runAt: number;
  duration: number;
  output: string;
}

/**
 * Write a new task run log row.
 */
export function writeTaskRunLog(log: TaskRunLogRow): void {
  const db = getOutboundDb();
  db.prepare(`
    INSERT INTO task_run_logs (id, taskId, status, runAt, duration, output)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(log.id, log.taskId, log.status, log.runAt, log.duration, log.output);
}

/**
 * Get all run logs for a specific task, newest first.
 */
export function getTaskRunLogs(taskId: string): TaskRunLogRow[] {
  const db = getOutboundDb();
  const rows = db.prepare(`
    SELECT id, taskId, status, runAt, duration, output
    FROM task_run_logs
    WHERE taskId = ?
    ORDER BY runAt DESC
  `).all(taskId) as Array<Record<string, unknown>>;

  // `output` cho phép NULL trong schema, nên trả về chuỗi rỗng thay vì null —
  // phía gọi luôn mong một chuỗi.
  return rows.map((row) => ({
    id: String(row.id),
    taskId: String(row.taskId),
    status: String(row.status),
    runAt: Number(row.runAt),
    duration: Number(row.duration),
    output: row.output == null ? '' : String(row.output),
  }));
}

/**
 * Clear all run logs for a specific task.
 */
export function clearTaskRunLogs(taskId: string): void {
  const db = getOutboundDb();
  db.prepare(`
    DELETE FROM task_run_logs
    WHERE taskId = ?
  `).run(taskId);
}
