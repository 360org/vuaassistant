/**
 * CRUD operations for task_run_logs table in outbound.db.
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
  const stmt = db.prepare(`
    INSERT INTO task_run_logs (id, taskId, status, runAt, duration, output)
    VALUES (?, ?, ?, ?, ?, ?)
  `);
  stmt.run(log.id, log.taskId, log.status, log.runAt, log.duration, log.output);
  stmt.finalize();
}

/**
 * Get all run logs for a specific task.
 */
export function getTaskRunLogs(taskId: string): TaskRunLogRow[] {
  const db = getOutboundDb();
  const stmt = db.prepare(`
    SELECT id, taskId, status, runAt, duration, output
    FROM task_run_logs
    WHERE taskId = ?
    ORDER BY runAt DESC
  `);
  const rows: TaskRunLogRow[] = [];
  while (stmt.step()) {
    rows.push({
      id: stmt.columnText(0),
      taskId: stmt.columnText(1),
      status: stmt.columnText(2),
      runAt: stmt.columnInt(3),
      duration: stmt.columnInt(4),
      output: stmt.columnText(5),
    });
  }
  stmt.finalize();
  return rows;
}

/**
 * Clear all run logs for a specific task.
 */
export function clearTaskRunLogs(taskId: string): void {
  const db = getOutboundDb();
  const stmt = db.prepare(`
    DELETE FROM task_run_logs
    WHERE taskId = ?
  `);
  stmt.run(taskId);
  stmt.finalize();
}
