import { DatabaseSync as Database } from 'node:sqlite';
import { mkdtempSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { setTimeout as sleep } from 'timers/promises';

const dir = mkdtempSync(path.join(tmpdir(), 'ar-session-'));
process.env.VUA_IPC_DIR = dir;

const { runPollLoop } = await import('../src/poll-loop.ts');
const { createInboundSchema, closeAll } = await import('../src/db/connection.ts');
// Dựng sổ tool SAU khi VUA_IPC_DIR đã trỏ vào thư mục tạm — module tool đọc
// biến môi trường ngay lúc nạp, nên nạp sớm là mở nhầm thư mục dữ liệu thật.
const sharedTools = (await (await import('../src/kernel/compose.ts')).composeRunner()).root.tools;

createInboundSchema();
const inboundPath = path.join(dir, 'inbound.db');
const outboundPath = path.join(dir, 'outbound.db');
let nextSeq = 2;

function send(id, threadId, text) {
  const db = new Database(inboundPath);
  db.prepare(
    `INSERT INTO messages_in
       (id, seq, kind, status, trigger, platform_id, channel_type, thread_id, content)
     VALUES (?, ?, 'chat', 'pending', 1, 'desktop', 'chat', ?, ?)`,
  ).run(id, nextSeq, threadId, JSON.stringify({ text }));
  nextSeq += 2;
  db.close();
}

async function waitCompleted(id) {
  for (let i = 0; i < 80; i++) {
    await sleep(50);
    const db = new Database(outboundPath, { readOnly: true });
    const row = db.prepare("SELECT status FROM processing_ack WHERE message_id = ?").get(id);
    db.close();
    if (row?.status === 'completed') return;
  }
  throw new Error(`Timed out waiting for ${id}`);
}

const calls = [];
const provider = {
  name: 'mock-stateless',
  query(input) {
    calls.push({ prompt: input.prompt, messages: structuredClone(input.messages ?? []) });
    async function* events() {
      yield { type: 'init', continuation: '' };
      yield { type: 'result', text: `reply:${input.prompt}` };
    }
    return { push() {}, end() {}, abort() {}, events: events() };
  },
  isSessionInvalid() { return false; },
};

async function startRunner() {
  const controller = new AbortController();
  const loop = runPollLoop({
    provider,
    providerName: 'mock-stateless',
    agentId: 'agent-a',
    systemContext: { instructions: 'test' },
    tools: sharedTools,
    signal: controller.signal,
  });
  return async () => {
    controller.abort();
    await loop;
    closeAll();
  };
}

let stop = await startRunner();
send('a1', 'thread-a', 'first-a');
await waitCompleted('a1');
send('b1', 'thread-b', 'first-b');
await waitCompleted('b1');
send('a2', 'thread-a', 'second-a');
await waitCompleted('a2');

if (!calls[2].messages.some((m) => m.role === 'user' && m.content === 'first-a')) {
  throw new Error('thread-a history was not restored');
}
if (calls[2].messages.some((m) => m.role === 'user' && m.content === 'first-b')) {
  throw new Error('thread-b history leaked into thread-a');
}

await stop();
stop = await startRunner();
send('a3', 'thread-a', 'after-restart');
await waitCompleted('a3');
if (!calls[3].messages.some((m) => m.role === 'user' && m.content === 'second-a')) {
  throw new Error('history did not survive runner restart');
}

send('clear-a', 'thread-a', '/clear');
await waitCompleted('clear-a');
send('a4', 'thread-a', 'after-clear');
await waitCompleted('a4');
if (calls[4].messages.some((m) => m.content === 'first-a' || m.content === 'second-a')) {
  throw new Error('/clear did not clear only the active session');
}

send('b2', 'thread-b', 'second-b');
await waitCompleted('b2');
if (!calls[5].messages.some((m) => m.role === 'user' && m.content === 'first-b')) {
  throw new Error('/clear in thread-a incorrectly cleared thread-b');
}

await stop();
console.log('✓ session isolation, restart resume, and scoped clear work end-to-end');
