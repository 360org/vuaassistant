// End-to-end check of the Universal Agent Runner poll loop + SQLite IPC.
//
// Proves the core contract with NO network / API key: a message written to
// inbound.db is picked up by the poll loop, run through a mock provider, and
// the reply lands in outbound.db. Run: npx tsx scripts/e2e-check.mjs
//
// This is the automated version of scripts/demo-send.ts (which needs a live
// daemon + real key).

import { DatabaseSync as Database } from 'node:sqlite';
import { mkdtempSync, existsSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { setTimeout as sleep } from 'timers/promises';

// Point the runner's DB layer at a throwaway IPC dir BEFORE importing it.
const dir = mkdtempSync(path.join(tmpdir(), 'ar-e2e-'));
process.env.VUA_IPC_DIR = dir;

const { runPollLoop } = await import('../src/poll-loop.ts');
const { createInboundSchema, closeAll } = await import('../src/db/connection.ts');

let pass = true;
const check = (name, cond) => {
  console.log(`${cond ? '✓' : '✗'} ${name}`);
  if (!cond) pass = false;
};

// The Tauri host owns inbound.db; create its schema and write a user message.
createInboundSchema();
const inboundPath = path.join(dir, 'inbound.db');
const outboundPath = path.join(dir, 'outbound.db');
const inbound = new Database(inboundPath);
inbound
  .prepare(
    `INSERT INTO messages_in (id, seq, kind, status, trigger, content)
     VALUES (?, 2, 'chat', 'pending', 1, ?)`,
  )
  .run('e2e-1', JSON.stringify({ text: 'hello runner' }));
inbound.close();

// A mock provider: no SDK, no network — echoes a fixed reply. Proves the loop
// and IPC without hitting a real LLM.
let sawUserMessage = null;
const provider = {
  name: 'mock',
  query(input) {
    sawUserMessage = input.messages?.at(-1)?.content ?? input.prompt;
    async function* events() {
      yield { type: 'init', continuation: 'sess-1' };
      yield { type: 'result', text: 'PONG from runner' };
    }
    return { push() {}, end() {}, abort() {}, events: events() };
  },
  isSessionInvalid() {
    return false;
  },
};

// Run the loop; abort once we have a reply (or after a timeout).
const controller = new AbortController();
const loop = runPollLoop({
  provider,
  providerName: 'mock',
  systemContext: { instructions: 'You are a test.' },
  tools: (await (await import('../src/kernel/compose.ts')).composeRunner()).root.tools,
  signal: controller.signal,
});

let reply = null;
for (let i = 0; i < 50 && reply === null; i++) {
  await sleep(200);
  if (!existsSync(outboundPath)) continue;
  try {
    const db = new Database(outboundPath, { readOnly: true });
    const row = db
      .prepare('SELECT content FROM messages_out ORDER BY seq DESC LIMIT 1')
      .get();
    db.close();
    if (row) {
      try {
        reply = JSON.parse(row.content).text ?? row.content;
      } catch {
        reply = row.content;
      }
    }
  } catch {
    // outbound may be momentarily locked by the writer; retry
  }
}

controller.abort();
await loop.catch(() => {});
closeAll();

check('inbound message reached the provider', sawUserMessage !== null && sawUserMessage.includes('hello runner'));
check('reply written to outbound.db', reply === 'PONG from runner');

console.log(pass ? '\n✓ Agent Runner poll loop + SQLite IPC work end-to-end' : '\n✗ FAILED');
process.exit(pass ? 0 : 1);
