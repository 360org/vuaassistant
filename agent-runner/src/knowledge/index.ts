/**
 * Knowledge retrieval, running in the Host Process.
 *
 * The role's documents used to be indexed into the webview's IndexedDB and
 * retrieved there, which meant the runner — the thing that actually answers
 * chat, Telegram and scheduled tasks — could never see them. Chunks now live in
 * `knowledge.db`, written by the app and opened read-only here, so every answer
 * the runner produces can be grounded in the user's files.
 *
 * Scoring is tf-idf over the chunks of one role's bucket only: roles never see
 * each other's documents.
 */
import fs from 'fs';
import path from 'path';
import { openDatabase, type DatabaseHandle } from '../db/sqlite.js';
import { getDataDir } from '../util/data-dir.js';

const DEFAULT_TOP_K = 4;
const DEFAULT_MAX_CHARS = 6000;
/** The app's bucket name for "no role selected". */
const GENERAL_BUCKET = 'general';

export interface KnowledgeExcerpt {
  name: string;
  text: string;
}

interface ChunkRow {
  name: string;
  text: string;
}

let db: DatabaseHandle | null = null;
let opened = false;

function dbPath(): string {
  const ipcDir =
    process.env.VUA_IPC_DIR || path.join(getDataDir(), 'ipc');
  return path.join(ipcDir, 'knowledge.db');
}

/**
 * The read-only handle, or null when the app has not created the store yet
 * (nothing has ever been uploaded). Opened once and kept.
 */
function getDb(): DatabaseHandle | null {
  if (opened) return db;
  opened = true;
  try {
    if (!fs.existsSync(dbPath())) return null;
    db = openDatabase(dbPath(), { readonly: true });
  } catch {
    db = null;
  }
  return db;
}

/** Which bucket a role's documents live in. Mirrors the app's mapping. */
export function bucketFor(agentId: string | null | undefined): string {
  return !agentId || agentId === 'default' ? GENERAL_BUCKET : agentId;
}

const tokenize = (value: string): string[] =>
  (value.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []).filter((t) => t.length > 1);

/**
 * The chunks of this role's documents that best match `query`, tf-idf scored
 * and capped so excerpts never flood the prompt. Empty when the role has no
 * documents or the question carries no usable terms.
 */
export function retrieveKnowledge(
  agentId: string | null | undefined,
  query: string,
  topK = DEFAULT_TOP_K,
  maxChars = DEFAULT_MAX_CHARS,
): KnowledgeExcerpt[] {
  const handle = getDb();
  if (!handle) return [];

  const queryTerms = [...new Set(tokenize(query))];
  if (queryTerms.length === 0) return [];

  let rows: ChunkRow[];
  try {
    rows = handle
      .prepare(
        `SELECT f.name AS name, c.text AS text
           FROM knowledge_chunks c
           JOIN knowledge_files f ON f.file_id = c.file_id
          WHERE c.bucket = ?`,
      )
      .all(bucketFor(agentId)) as ChunkRow[];
  } catch {
    return [];
  }
  if (rows.length === 0) return [];

  const chunks = rows.map((row) => ({ ...row, terms: tokenize(row.text) }));
  const documentFrequency = new Map<string, number>();
  for (const term of queryTerms) {
    documentFrequency.set(term, chunks.filter((c) => c.terms.includes(term)).length);
  }

  const scored = chunks
    .map((chunk) => ({
      ...chunk,
      score: queryTerms.reduce((sum, term) => {
        const termFrequency = chunk.terms.filter((t) => t === term).length;
        if (!termFrequency) return sum;
        const df = documentFrequency.get(term) || 1;
        return sum + (1 + Math.log(termFrequency)) * Math.log(1 + chunks.length / df);
      }, 0),
    }))
    .filter((chunk) => chunk.score > 0)
    .sort((a, b) => b.score - a.score);

  const excerpts: KnowledgeExcerpt[] = [];
  let used = 0;
  for (const chunk of scored.slice(0, topK)) {
    if (used + chunk.text.length > maxChars) break;
    excerpts.push({ name: chunk.name, text: chunk.text });
    used += chunk.text.length;
  }
  return excerpts;
}

/** Render excerpts as the grounding section appended to the system prompt. */
export function formatExcerpts(excerpts: KnowledgeExcerpt[]): string {
  if (excerpts.length === 0) return '';
  const body = excerpts
    .map((excerpt) => `--- ${excerpt.name} ---\n${excerpt.text}`)
    .join('\n\n');
  return (
    '\n\n=== Knowledge from the user\'s documents ===\n' +
    'Use these excerpts when they answer the question, and cite the document name.\n\n' +
    body
  );
}

/** Drop the cached handle so the next retrieval reopens the store. */
export function closeKnowledge(): void {
  try {
    db?.close();
  } catch {
    // Already closed.
  }
  db = null;
  opened = false;
}
