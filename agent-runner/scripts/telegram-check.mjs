// Checks the Host Process Telegram channel: it authenticates to the AI Router,
// never touches the bot token, skips the backlog on start, answers with the
// shared agent loop, and mirrors the turn into outbound.db.
// A stub router stands in for the real one, so this is deterministic and offline.
// Run: npx tsx scripts/telegram-check.mjs

import { createServer } from 'http';
import { mkdtempSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';

const dir = mkdtempSync(path.join(tmpdir(), 'ar-tg-'));
process.env.VUA_DATA_DIR = dir;
process.env.VUA_IPC_DIR = path.join(dir, 'ipc');
process.env.VUA_CONNECTOR_GATEWAY_TOKEN = 'test-capability';

let pass = true;
const check = (name, cond) => {
  console.log(`${cond ? '✓' : '✗'} ${name}`);
  if (!cond) pass = false;
};

// --- stub AI Router ----------------------------------------------------------
// Mirrors the real endpoints in ai-router/src/sidecar.mjs: bearer-guarded, and
// it hands out messages only — a bot token never crosses this boundary.
const sent = [];
let authFailures = 0;
let pending = [];       // updates the next getUpdates call returns
let configured = true;
let abortAfterSend = null;

const server = createServer((req, res) => {
  const reply = (code, body) => {
    res.writeHead(code, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(body));
  };
  if (req.headers.authorization !== 'Bearer test-capability') {
    authFailures++;
    return reply(401, { error: 'Connector capability is invalid.' });
  }
  let raw = '';
  req.on('data', (chunk) => (raw += chunk));
  req.on('end', () => {
    const input = raw ? JSON.parse(raw) : {};
    if (req.url === '/v1/channels/telegram/status') return reply(200, { configured, hasChatId: true });
    if (req.url === '/v1/channels/telegram/updates') {
      const updates = pending;
      pending = [];
      return reply(200, { updates, echoedOffset: input.offset ?? 0 });
    }
    if (req.url === '/v1/channels/telegram/send') {
      sent.push(input);
      abortAfterSend?.();
      return reply(200, { ok: true });
    }
    reply(404, { error: 'not found' });
  });
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
process.env.VUA_AI_ROUTER_URL = `http://127.0.0.1:${server.address().port}`;

// --- runner wiring -----------------------------------------------------------
const { createInboundSchema, closeAll, getOutboundDb, openInboundDbWritable } = await import('../src/db/connection.ts');
createInboundSchema();

const { handleMessage, runTelegramLoop, telegramConfigured, runTelegramDeliveryLoop } = await import('../src/channels/telegram.ts');
const { executeAgentLoop } = await import('../src/poll-loop.ts');

let prompts = [];
const stubProvider = {
  name: 'stub',
  query: ({ prompt, messages }) => {
    const userText = messages?.at(-1)?.content ?? prompt;
    prompts.push({ prompt: userText, history: (messages ?? []).slice(0, -1) });
    return {
      events: (async function* () {
        yield { type: 'result', text: `echo: ${userText}` };
      })(),
    };
  },
  isSessionInvalid: () => false,
};
const config = {
  provider: stubProvider,
  providerName: 'stub',
  agentId: 'default',
  dataDir: dir,
  systemContext: { instructions: '' },
  tools: (await (await import('../src/kernel/compose.ts')).composeRunner()).root.tools,
};

// Helper to manually run one runner turn (read inbound -> LLM -> write outbound)
async function driveRunnerTurn() {
  const { getPendingMessages, markProcessing, markCompleted, sessionIdFor, getTranscript, setTranscript } = await import('../src/db/index.js');
  const messages = getPendingMessages().filter((m) => m.kind !== 'system');
  if (messages.length === 0) return;
  markProcessing(messages.map((m) => m.id));
  const prompt = messages.map((m) => JSON.parse(m.content).text).join('\n');
  const routing = { platformId: messages[0].platform_id, channelType: messages[0].channel_type, threadId: messages[0].thread_id };
  const sessionId = sessionIdFor(config.agentId || 'default', routing);
  const priorTranscript = getTranscript(sessionId);
  const result = await executeAgentLoop(config, prompt, undefined, routing, config.systemContext, priorTranscript);
  if (result.text) {
    const { writeMessageOut } = await import('../src/db/index.js');
    writeMessageOut({
      id: `out-${Date.now()}`,
      kind: 'chat',
      platform_id: routing.platformId,
      channel_type: routing.channelType,
      thread_id: routing.threadId,
      content: JSON.stringify({ text: result.text }),
    });
    setTranscript(sessionId, [
      ...priorTranscript,
      { role: 'user', content: prompt },
      { role: 'assistant', content: result.text },
    ]);
  }
  markCompleted(messages.map((m) => m.id));
}

// --- the capability is required ---------------------------------------------
check('the channel reports the stored token without revealing it', await telegramConfigured());

const saved = process.env.VUA_CONNECTOR_GATEWAY_TOKEN;
process.env.VUA_CONNECTOR_GATEWAY_TOKEN = 'wrong';
let rejected = false;
try {
  await telegramConfigured();
} catch {
  rejected = true;
}
check('a wrong capability is rejected by the router', rejected && authFailures === 1);
process.env.VUA_CONNECTOR_GATEWAY_TOKEN = saved;

// --- one answered message ----------------------------------------------------
await handleMessage(config, 42, 'chào em');
await driveRunnerTurn();

// Start delivery loop with short signal to process and stop
const deliveryController = new AbortController();
const deliveryPromise = runTelegramDeliveryLoop(config, deliveryController.signal);
await new Promise((r) => setTimeout(r, 100));
deliveryController.abort();
await deliveryPromise;

check('the reply goes back to the same chat', sent.length === 1 && sent[0].chatId === 42);
check('the reply is the agent answer', sent[0].text === 'echo: chào em');

const rows = getOutboundDb().prepare('SELECT channel_type, thread_id FROM messages_out').all();
check('outbound message is written to outbound.db', rows.length === 1);
check('the mirror is tagged as the telegram channel', rows[0].channel_type === 'telegram');
check('the mirror threads by chat id', rows[0].thread_id === '42');

// --- the conversation remembers itself ---------------------------------------
await handleMessage(config, 42, 'còn nhớ không?');
await driveRunnerTurn();
check('the next turn carries the prior transcript', prompts[1].history.length === 2);

await handleMessage(config, 99, 'hello');
await driveRunnerTurn();
check('a second chat does not inherit the first', prompts[2].history.length === 0);

// --- /start is answered without spending a model call ------------------------
const before = prompts.length;
await handleMessage(config, 42, '/start');
check('/start replies without calling the model', prompts.length === before);

const deliveryControllerStart = new AbortController();
const deliveryPromiseStart = runTelegramDeliveryLoop(config, deliveryControllerStart.signal);
await new Promise((r) => setTimeout(r, 100));
deliveryControllerStart.abort();
await deliveryPromiseStart;
check('/start greets the user', /VuaAssistant/.test(sent[sent.length - 1].text));

// --- the backlog is skipped on start -----------------------------------------
sent.length = 0;
prompts = [];
pending = [
  { updateId: 7, text: 'tin cũ 1', chatId: 5 },
  { updateId: 8, text: 'tin cũ 2', chatId: 5 },
];

const loopController = new AbortController();
const loop = runTelegramLoop(config, loopController.signal);
// Let the drain pass consume the backlog
await new Promise((r) => setTimeout(r, 100));

pending = [{ updateId: 9, text: 'tin mới', chatId: 5 }];
// Wait for loop to pick it up and write to messages_in (must be > IDLE_MS 1000ms)
await new Promise((r) => setTimeout(r, 1200));
loopController.abort();
await loop;

// Manually process the live message that entered inbound.db
await driveRunnerTurn();

const deliveryControllerLive = new AbortController();
const deliveryPromiseLive = runTelegramDeliveryLoop(config, deliveryControllerLive.signal);
await new Promise((r) => setTimeout(r, 100));
deliveryControllerLive.abort();
await deliveryPromiseLive;

check('the backlog is not answered', !sent.some((m) => /tin cũ/.test(m.text)));
check('a message that arrives while listening is answered', sent.some((m) => m.text === 'echo: tin mới'));

// --- an unconfigured token pauses instead of crashing ------------------------
configured = false;
const idle = new AbortController();
const idleLoop = runTelegramLoop(config, idle.signal);
await new Promise((r) => setTimeout(r, 50));
idle.abort();
await idleLoop;
check('no token means no Telegram traffic, not a crash', true);

server.close();
closeAll();
console.log(pass ? '\n✓ Host Process Telegram channel works' : '\n✗ FAILED');
process.exit(pass ? 0 : 1);
