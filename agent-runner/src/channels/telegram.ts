/**
 * Telegram channel, running in the Host Process.
 *
 * idea.md §1.3 puts the brain in the host daemon: closing the app window must
 * not stop the bot. This module long-polls Telegram, answers with the very same
 * agent loop the chat UI uses, and sends the reply back — all without the app
 * being open.
 *
 * The bot token never reaches this process. Telegram carries it in the URL path
 * (`/bot<token>/getUpdates`), which the connector gateway refuses on purpose, so
 * the AI Router — the only component allowed to resolve Vault secrets — performs
 * the Telegram calls and exposes three token-free endpoints instead. We drive
 * those with the runner's connector capability.
 *
 * Every turn is also written to `messages_out` (channel_type `telegram`, thread
 * = chat id) so the app can show the conversation when it is open.
 */
import { getContinuation, setContinuation, getTranscript, setTranscript, sessionIdFor, writeMessageOut, writeMessageIn, getOutboundDb, markOutboundDelivered, isOutboundDelivered } from '../db/index.js';
import { executeAgentLoop, type PollLoopConfig } from '../poll-loop.js';
import { learnFromExchange } from '../memory/self-improve.js';
import type { RoutingContext } from '../formatter.js';

const ROUTER_URL = process.env.VUA_AI_ROUTER_URL || 'http://127.0.0.1:36360';
const LONG_POLL_SECONDS = 30;
/** Wait before retrying when the router is down or no token is stored yet. */
const RETRY_MS = 5_000;
/** Yield after an empty poll, in case the far side returned without blocking. */
const IDLE_MS = 1_000;
const GREETING = 'Xin chào! Tôi là VuaAssistant. Nhắn gì cũng được, tôi giúp ngay.';

interface TelegramUpdate {
  updateId: number;
  text: string | null;
  chatId: number | null;
}

function log(msg: string): void {
  console.error(`[telegram] ${msg}`);
}

/** Sleep that gives up as soon as the channel is asked to stop. */
function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) return Promise.resolve();
  return new Promise((resolve) => {
    const timer = setTimeout(done, ms);
    function done(): void {
      clearTimeout(timer);
      signal?.removeEventListener('abort', done);
      resolve();
    }
    signal?.addEventListener('abort', done, { once: true });
  });
}

function generateId(): string {
  return `tg-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

/** Routing that tags a turn as belonging to one Telegram chat. */
export function telegramRouting(chatId: number): RoutingContext {
  return { platformId: 'telegram', channelType: 'telegram', threadId: String(chatId) };
}

async function callRouter<T>(path: string, init: RequestInit = {}): Promise<T> {
  const capability = process.env.VUA_CONNECTOR_GATEWAY_TOKEN;
  if (!capability) throw new Error('Connector capability is not available');
  const response = await fetch(`${ROUTER_URL}${path}`, {
    ...init,
    headers: {
      ...(init.headers as Record<string, string> | undefined),
      'Content-Type': 'application/json',
      Authorization: `Bearer ${capability}`,
    },
  });
  const body = (await response.json().catch(() => ({}))) as Record<string, unknown> & T;
  if (!response.ok) throw new Error(String(body.error ?? `Router returned ${response.status}`));
  return body;
}

/** Whether a bot token is stored. Never returns the token itself. */
export async function telegramConfigured(): Promise<boolean> {
  const status = await callRouter<{ configured?: boolean }>('/v1/channels/telegram/status');
  return Boolean(status.configured);
}

async function getUpdates(offset: number, timeout: number): Promise<TelegramUpdate[]> {
  const body = await callRouter<{ updates?: TelegramUpdate[] }>('/v1/channels/telegram/updates', {
    method: 'POST',
    body: JSON.stringify({ offset, timeout }),
  });
  return Array.isArray(body.updates) ? body.updates : [];
}

async function sendMessage(chatId: number, text: string): Promise<void> {
  await callRouter('/v1/channels/telegram/send', {
    method: 'POST',
    body: JSON.stringify({ chatId, text }),
  });
}

/**
 * Push a message to the chat id stored in the Vault (the router fills it in).
 * Best-effort: used to deliver scheduled results, which must not fail a run.
 */
export async function notifyTelegram(text: string): Promise<boolean> {
  try {
    await callRouter('/v1/channels/telegram/send', {
      method: 'POST',
      body: JSON.stringify({ text }),
    });
    return true;
  } catch {
    return false;
  }
}

/**
 * Route one incoming Telegram message into the inbound SQLite queue.
 * (Task 1: Router — Channel -> inbound.db)
 */
export async function handleMessage(config: PollLoopConfig, chatId: number, text: string): Promise<void> {
  const routing = telegramRouting(chatId);

  // If start command, write direct greeting back to outbox, else route inbound
  if (text.startsWith('/start')) {
    writeMessageOut({
      id: generateId(),
      kind: 'chat',
      platform_id: routing.platformId,
      channel_type: routing.channelType,
      thread_id: routing.threadId,
      content: JSON.stringify({ text: GREETING }),
    });
    return;
  }

  log(`Routing Telegram message from chat ${chatId} into inbound queue`);
  await writeMessageIn({
    id: generateId(),
    kind: 'chat',
    platform_id: routing.platformId,
    channel_type: routing.channelType,
    thread_id: routing.threadId,
    content: JSON.stringify({ text }),
  });
}

/**
 * Long-poll Telegram until `signal` aborts. The first pass drains the backlog
 * without answering, so restarting the app does not replay old messages.
 */
export async function runTelegramLoop(config: PollLoopConfig, signal?: AbortSignal): Promise<void> {
  let offset = 0;
  let drained = false;
  let announced = false;

  while (!signal?.aborted) {
    let updates: TelegramUpdate[];
    try {
      if (!(await telegramConfigured())) {
        await sleep(RETRY_MS, signal);
        continue;
      }
      if (!announced) {
        log('Connected — listening for messages');
        announced = true;
      }
      updates = await getUpdates(offset, drained ? LONG_POLL_SECONDS : 0);
    } catch (error) {
      // The router may still be booting, or the token may have been removed.
      log(`Poll failed: ${error instanceof Error ? error.message : String(error)}`);
      announced = false;
      await sleep(RETRY_MS, signal);
      continue;
    }

    for (const update of updates) offset = Math.max(offset, update.updateId + 1);

    if (!drained) {
      drained = true;
      continue;
    }

    // Long-polling already blocks on the far side; this keeps a server that
    // answers immediately from turning the loop hot.
    if (updates.length === 0) {
      await sleep(IDLE_MS, signal);
      continue;
    }

    for (const update of updates) {
      if (signal?.aborted) return;
      if (!update.text || update.chatId == null) continue;
      await handleMessage(config, update.chatId, update.text);
    }
  }
}

/**
 * Scan outbound queue and deliver pending Telegram replies.
 * (Task 2 & 3: Delivery with Response Registry — outbound.db -> Channel)
 */
export async function runTelegramDeliveryLoop(config: PollLoopConfig, signal?: AbortSignal): Promise<void> {
  while (!signal?.aborted) {
    try {
      if (!(await telegramConfigured())) {
        await sleep(RETRY_MS, signal);
        continue;
      }

      const outbound = getOutboundDb();
      // Fetch recent outbound messages for Telegram
      const pending = outbound
        .prepare(
          `SELECT id, content, thread_id FROM messages_out
           WHERE channel_type = 'telegram'
           ORDER BY seq ASC
           LIMIT 50`
        )
        .all() as Array<{ id: string; content: string; thread_id: string | null }>;

      for (const row of pending) {
        if (signal?.aborted) return;
        if (isOutboundDelivered(row.id)) continue;

        const chatId = row.thread_id ? Number(row.thread_id) : null;
        if (!chatId) {
          markOutboundDelivered([row.id]);
          continue;
        }

        let text = '';
        try {
          const payload = JSON.parse(row.content);
          text = typeof payload.text === 'string' ? payload.text : String(payload);
        } catch {
          text = row.content;
        }

        if (text) {
          log(`Delivering outbound message id ${row.id} to Telegram chat ${chatId}`);
          await sendMessage(chatId, text);
        }

        markOutboundDelivered([row.id]);
      }
    } catch (error) {
      log(`Delivery failed loop: ${error instanceof Error ? error.message : String(error)}`);
    }

    await sleep(IDLE_MS, signal);
  }
}

/** Start the channel in the background. Runs until the process exits. */
export function startTelegramChannel(config: PollLoopConfig): void {
  void runTelegramLoop(config, config.signal).catch((error) => {
    log(`Channel receiver stopped: ${error instanceof Error ? error.message : String(error)}`);
  });
  void runTelegramDeliveryLoop(config, config.signal).catch((error) => {
    log(`Channel deliverer stopped: ${error instanceof Error ? error.message : String(error)}`);
  });
}
