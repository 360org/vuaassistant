/**
 * Two-DB connection layer for VuaAssistant Agent Runner.
 *
 * Uses two SQLite files to eliminate write contention:
 *   inbound.db  — Tauri/UI writes new messages; Runner opens READ-ONLY
 *   outbound.db — Runner writes responses + acks; Tauri/UI opens read-only
 *
 * Each file has exactly one writer, so no cross-process lock contention.
 *
 * @ref NanoClaw/container/agent-runner/src/db/connection.ts
 */
import fs from 'fs';
import path from 'path';
import { openDatabase, type DatabaseHandle } from './sqlite.js';

// Cùng gốc dữ liệu với vỏ desktop (~/vuaassistant) để hai bên gặp nhau ở cùng
// một hàng đợi IPC khi VUA_DATA_DIR chưa được set.
const DEFAULT_IPC_DIR = process.env.VUA_IPC_DIR || path.join(
  process.env.VUA_DATA_DIR || path.join(process.env.HOME || '/tmp', 'vuaassistant'),
  'ipc'
);

const DEFAULT_INBOUND_PATH = process.env.INBOUND_DB_PATH || path.join(DEFAULT_IPC_DIR, 'inbound.db');
const DEFAULT_OUTBOUND_PATH = process.env.OUTBOUND_DB_PATH || path.join(DEFAULT_IPC_DIR, 'outbound.db');
const DEFAULT_HEARTBEAT_PATH = process.env.HEARTBEAT_PATH || path.join(DEFAULT_IPC_DIR, '.heartbeat');

let _outbound: DatabaseHandle | null = null;
let _heartbeatPath: string = DEFAULT_HEARTBEAT_PATH;

function log(msg: string): void {
  console.error(`[db/connection] ${msg}`);
}

/**
 * Ensure IPC directory exists.
 */
export function ensureIpcDir(): void {
  const dir = path.dirname(DEFAULT_INBOUND_PATH);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
    log(`Created IPC directory: ${dir}`);
  }
}

/**
 * Open inbound.db read-only (fresh connection each time).
 *
 * Unlike a cached singleton, this ensures we always see the latest rows
 * written by the Tauri host. Caller must .close() the returned connection.
 *
 * @ref NanoClaw connection.ts — openInboundDb() pattern
 */
export function openInboundDb(): DatabaseHandle {
  if (!fs.existsSync(DEFAULT_INBOUND_PATH)) {
    createInboundSchema(DEFAULT_INBOUND_PATH);
  }
  const db = openDatabase(DEFAULT_INBOUND_PATH, { readonly: true });
  db.exec('PRAGMA busy_timeout = 5000');
  db.exec('PRAGMA mmap_size = 0');
  return db;
}

/**
 * Get a long-lived inbound DB singleton (for tables that don't change often:
 * destinations, session_routing).
 *
 * For messages_in polling use openInboundDb() instead.
 */
let _inbound: DatabaseHandle | null = null;
export function getInboundDb(): DatabaseHandle {
  if (!fs.existsSync(DEFAULT_INBOUND_PATH)) {
    createInboundSchema(DEFAULT_INBOUND_PATH);
  }
  if (!_inbound) {
    _inbound = openDatabase(DEFAULT_INBOUND_PATH, { readonly: true });
    _inbound.exec('PRAGMA busy_timeout = 5000');
    _inbound.exec('PRAGMA mmap_size = 0');
  }
  return _inbound;
}

/**
 * Outbound DB — Runner owns this file (sole writer).
 * Creates schema on first open.
 */
export function getOutboundDb(): DatabaseHandle {
  if (!_outbound) {
    _outbound = openDatabase(DEFAULT_OUTBOUND_PATH);
    _outbound.exec('PRAGMA journal_mode = DELETE');
    _outbound.exec('PRAGMA busy_timeout = 5000');
    _outbound.exec('PRAGMA foreign_keys = ON');

    // Create tables if not exists
    _outbound.exec(`
      CREATE TABLE IF NOT EXISTS messages_out (
        id          TEXT PRIMARY KEY,
        seq         INTEGER UNIQUE,
        in_reply_to TEXT,
        timestamp   TEXT NOT NULL DEFAULT (datetime('now')),
        deliver_after TEXT,
        recurrence  TEXT,
        kind        TEXT NOT NULL DEFAULT 'chat',
        platform_id TEXT,
        channel_type TEXT,
        thread_id   TEXT,
        content     TEXT NOT NULL
      );
    `);

    _outbound.exec(`
      CREATE TABLE IF NOT EXISTS processing_ack (
        message_id  TEXT PRIMARY KEY,
        status      TEXT NOT NULL DEFAULT 'processing',
        updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
      );
    `);

    _outbound.exec(`
      CREATE TABLE IF NOT EXISTS outbound_delivery_ack (
        message_id  TEXT PRIMARY KEY,
        status      TEXT NOT NULL DEFAULT 'delivered',
        updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
      );
    `);

    _outbound.exec(`
      CREATE TABLE IF NOT EXISTS session_state (
        key         TEXT PRIMARY KEY,
        value       TEXT NOT NULL,
        updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
      );
    `);

    _outbound.exec(`
      CREATE TABLE IF NOT EXISTS task_run_logs (
        id          TEXT PRIMARY KEY,
        taskId      TEXT NOT NULL,
        status      TEXT NOT NULL,
        runAt       INTEGER NOT NULL,
        duration    INTEGER NOT NULL,
        output      TEXT
      );
    `);

    log('Outbound DB initialized');
  }
  return _outbound;
}

/**
 * Touch heartbeat file so the host knows the runner is alive.
 */
export function touchHeartbeat(): void {
  try {
    const now = new Date().toISOString();
    fs.writeFileSync(_heartbeatPath, now, 'utf8');
  } catch {
    // Best-effort
  }
}

/**
 * Clear stale 'processing' acks from a previous crashed run.
 * This lets the new runner re-process those messages.
 *
 * @ref NanoClaw connection.ts — clearStaleProcessingAcks()
 */
export function clearStaleProcessingAcks(): void {
  const outbound = getOutboundDb();
  outbound.exec("DELETE FROM processing_ack WHERE status = 'processing'");
}

/**
 * Open inbound.db read-write (for host/adapters to insert incoming messages).
 */
export function openInboundDbWritable(): DatabaseHandle {
  if (!fs.existsSync(DEFAULT_INBOUND_PATH)) {
    createInboundSchema(DEFAULT_INBOUND_PATH);
  }
  const db = openDatabase(DEFAULT_INBOUND_PATH);
  db.exec('PRAGMA busy_timeout = 5000');
  db.exec('PRAGMA mmap_size = 0');
  return db;
}

export function closeAll(): void {
  if (_inbound) {
    _inbound.close();
    _inbound = null;
  }
  if (_outbound) {
    _outbound.close();
    _outbound = null;
  }
}

/**
 * Create the inbound.db schema (called by the Tauri host, not the runner).
 * The runner opens inbound.db read-only.
 */
export function createInboundSchema(dbPath?: string): void {
  const p = dbPath || DEFAULT_INBOUND_PATH;
  ensureIpcDir();
  const db = openDatabase(p);
  db.exec('PRAGMA journal_mode = DELETE');
  db.exec(`
    CREATE TABLE IF NOT EXISTS messages_in (
      id            TEXT PRIMARY KEY,
      seq           INTEGER UNIQUE,
      kind          TEXT NOT NULL DEFAULT 'chat',
      timestamp     TEXT NOT NULL DEFAULT (datetime('now')),
      status        TEXT NOT NULL DEFAULT 'pending',
      process_after TEXT,
      recurrence    TEXT,
      tries         INTEGER NOT NULL DEFAULT 0,
      trigger       INTEGER NOT NULL DEFAULT 1,
      platform_id   TEXT,
      channel_type  TEXT,
      thread_id     TEXT,
      content       TEXT NOT NULL
    );
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS destinations (
      name          TEXT PRIMARY KEY,
      type          TEXT NOT NULL DEFAULT 'channel',
      channel_type  TEXT,
      platform_id   TEXT,
      metadata      TEXT
    );
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS session_routing (
      key           TEXT PRIMARY KEY DEFAULT 'current',
      channel_type  TEXT,
      platform_id   TEXT,
      thread_id     TEXT
    );
  `);

  db.close();
  log(`Inbound DB schema created: ${p}`);
}
