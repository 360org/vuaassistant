/**
 * Self-improving memory, running in the Host Process.
 *
 * After an exchange, the role reflects on what just happened and extracts a few
 * durable facts about the user worth remembering next time. The notes go into
 * that role's OWN memory tree (`agents/<name>/memory/memories/learned.md`), so
 * a role gets smarter about the user over time without anyone editing memory by
 * hand, and one role never learns from another's conversations.
 *
 * This used to run in the webview, which meant a Telegram conversation taught
 * the assistant nothing unless the app happened to be open. idea.md §1.3 puts
 * the brain in the host daemon; reflection belongs with it.
 *
 * Reflection is a cheap, tool-free model call and is best-effort: any failure
 * simply means nothing new is learned this turn.
 */
import fs from 'fs';
import path from 'path';
import type { PollLoopConfig } from '../poll-loop.js';
import { getDataDir } from '../util/data-dir.js';

const MAX_NOTES_PER_TURN = 3;
const MEMORY_FILE = path.join('memory', 'memories', 'learned.md');

const REFLECT_SYSTEM =
  'You maintain a long-term memory about the user and execution experiences for one assistant role. ' +
  'From the latest exchange, extract 0-3 SHORT, durable facts, preferences, or tool execution learnings ' +
  'worth remembering in future chats (e.g., "Prefers answers in Vietnamese", ' +
  '"If tool X fails with path Y, use glob to find the absolute path", ' +
  '"Runs a coffee shop called Highland"). Focus especially on tool calls that failed but were successfully corrected ' +
  '— record the error context and the working fix so you avoid repeating the same mistake. ' +
  'Only stable, reusable facts or execution learnings — never one-off task details, and never anything ' +
  'already in the existing memory. Return ONLY a JSON array of strings; return [] if nothing is worth saving.';

const SUMMARIZE_SYSTEM =
  'You consolidate one assistant role long-term memory. Combine overlapping points, prefer newer facts when points conflict, ' +
  'and keep only durable preferences, facts, and execution learnings. Return ONLY markdown bullet lines starting with "- ".';

function log(msg: string): void {
  console.error(`[self-improve] ${msg}`);
}

/**
 * Whether the user has the setting on. Read fresh from runner.json rather than
 * the memoized config so flipping the switch takes effect on the next turn.
 * Missing field means on, matching the app's default.
 */
export function selfImproveEnabled(): boolean {
  const configPath =
    process.env.CONFIG_PATH ||
    path.join(getDataDir(), 'runner.json');
  try {
    const raw = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    return raw.selfImprove !== false;
  } catch {
    return true;
  }
}

/** Pull the first JSON array out of a model reply. */
export function parseNotes(text: string): string[] {
  const match = text.match(/\[[\s\S]*\]/);
  if (!match) return [];
  try {
    const parsed = JSON.parse(match[0]);
    return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

function memoryPath(agentDir: string): string {
  return path.join(agentDir, MEMORY_FILE);
}

/** Notes already learned, used to keep the model from repeating itself. */
export function readMemory(agentDir: string): string[] {
  try {
    return fs
      .readFileSync(memoryPath(agentDir), 'utf8')
      .split('\n')
      .filter((line) => line.startsWith('- '))
      .map((line) => line.slice(2).trim())
      .filter(Boolean);
  } catch {
    return [];
  }
}

/** Append new notes to the role's own memory. */
export function appendMemory(agentDir: string, notes: string[]): void {
  if (notes.length === 0) return;
  const target = memoryPath(agentDir);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const header = fs.existsSync(target)
    ? ''
    : '# Learned about the user\n\nWritten automatically after conversations.\n\n';
  fs.appendFileSync(target, `${header}${notes.map((note) => `- ${note}`).join('\n')}\n`, 'utf8');
}

/**
 * Reflect on one exchange and return the NEW notes, deduped against what is
 * already remembered and capped. Empty when there is nothing worth learning.
 */
export async function reflectAndLearn(
  config: PollLoopConfig,
  exchange: { user: string; assistant: string },
  existing: string[],
): Promise<string[]> {
  if (exchange.user.trim().length < 3 || !exchange.assistant.trim()) return [];

  const prompt =
    `User said:\n${exchange.user}\n\n` +
    `Assistant replied:\n${exchange.assistant}\n\n` +
    `Existing memory:\n${existing.length ? existing.map((m) => `- ${m}`).join('\n') : '(none)'}\n\n` +
    'Return the JSON array of NEW memory notes to add.';

  let out = '';
  // No tools and no continuation: reflection is a pure extraction call and must
  // not join the conversation it is reflecting on.
  const query = config.provider.query({
    prompt,
    messages: [],
    systemContext: { instructions: REFLECT_SYSTEM },
  });
  for await (const event of query.events) {
    if (event.type === 'text_delta') out += event.text;
    else if (event.type === 'result' && event.text) out = event.text;
    else if (event.type === 'error') throw new Error(event.message);
  }

  const seen = new Set(existing.map((m) => m.trim().toLowerCase()));
  const fresh: string[] = [];
  for (const note of parseNotes(out)) {
    const trimmed = note.trim();
    const key = trimmed.toLowerCase();
    if (trimmed && !seen.has(key)) {
      seen.add(key);
      fresh.push(trimmed);
    }
  }
  return fresh.slice(0, MAX_NOTES_PER_TURN);
}

/** Consolidate long memory files in the background; failure must not affect chat. */
export async function summarizeMemoryIfNeeded(config: PollLoopConfig, agentDir: string): Promise<void> {
  const target = memoryPath(agentDir);
  const existing = readMemory(agentDir);
  if (existing.length <= 30) return;

  try {
    let out = '';
    const query = config.provider.query({
      prompt: `Current memory:\n${existing.map((m) => `- ${m}`).join('\n')}\n\nConsolidate it under 20 bullet points.`,
      messages: [],
      systemContext: { instructions: SUMMARIZE_SYSTEM },
    });
    for await (const event of query.events) {
      if (event.type === 'text_delta') out += event.text;
      else if (event.type === 'result' && event.text) out = event.text;
      else if (event.type === 'error') throw new Error(event.message);
    }
    const notes = out.split('\n').filter((line) => line.startsWith('- '));
    if (notes.length > 0) {
      fs.writeFileSync(target, `# Learned about the user\n\nWritten automatically after conversations.\n\n${notes.join('\n')}\n`, 'utf8');
      log(`Memory consolidated from ${existing.length} to ${notes.length} note(s)`);
    }
  } catch (error) {
    log(`Memory consolidation skipped: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * Reflect and persist, swallowing every failure. Callers fire this after a turn
 * has already been delivered — learning must never break answering.
 */
export async function learnFromExchange(
  config: PollLoopConfig,
  agentDir: string,
  exchange: { user: string; assistant: string },
): Promise<string[]> {
  if (!selfImproveEnabled()) return [];
  try {
    const notes = await reflectAndLearn(config, exchange, readMemory(agentDir));
    appendMemory(agentDir, notes);
    if (notes.length > 0) log(`Learned ${notes.length} new note(s)`);
    return notes;
  } catch (error) {
    log(`Reflection skipped: ${error instanceof Error ? error.message : String(error)}`);
    return [];
  }
}
