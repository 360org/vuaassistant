/**
 * Native tool definitions and executor.
 *
 * Tools run directly on the host OS (no Docker container).
 * Each tool implements: name, description, input_schema, execute().
 */
import { execFileSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { loadConfig } from '../config.js';
import { readMemory } from '../memory/self-improve.js';
import type { ToolDefinition, ToolResult } from '../providers/types.js';

function log(msg: string): void {
  console.error(`[native-tools] ${msg}`);
}

/**
 * Resolve a root through symlinks so containment checks compare real paths.
 * On macOS `/tmp` is itself a symlink to `/private/tmp`, so a lexical-only
 * comparison would reject the agent's own workspace.
 */
function realRoot(configured: string): string {
  const resolved = path.resolve(configured);
  try {
    return fs.realpathSync(resolved);
  } catch {
    return resolved; // not created yet
  }
}

const DATA_DIR = process.env.VUA_DATA_DIR || '/tmp/vuaassistant';

const WORKSPACE_ROOT = realRoot(
  process.env.VUA_AGENT_WORKSPACE || path.join(DATA_DIR, 'workspace'),
);

/**
 * The agent's own directory — instructions, soul and the persistent memory tree
 * the system prompt tells it to read and update. It sits beside the workspace
 * rather than inside it, so it needs its own grant; without one the agent is
 * told about a memory it is not allowed to open.
 */
const AGENT_ROOT = realRoot(path.join(DATA_DIR, 'agents', loadConfig().agentName));

const ALLOWED_ROOTS = [WORKSPACE_ROOT, AGENT_ROOT];
const APPROVED_READ_PATHS_FILE = process.env.VUA_AGENT_APPROVED_READ_PATHS_FILE;
const AI_ROUTER_URL = process.env.VUA_AI_ROUTER_URL || 'http://127.0.0.1:36360';

const ACCESS_DENIED = 'Access denied: agent tools are restricted to the assigned workspace';

function approvedReadRoots(): string[] {
  if (!APPROVED_READ_PATHS_FILE) return [];
  try {
    const paths = JSON.parse(fs.readFileSync(APPROVED_READ_PATHS_FILE, 'utf8'));
    return Array.isArray(paths) ? paths.filter((item): item is string => typeof item === 'string').map(realRoot) : [];
  } catch {
    return [];
  }
}

function isInside(root: string, target: string): boolean {
  const rel = path.relative(root, target);
  // "" is the root itself (allowed, e.g. glob over the whole workspace).
  // ".." or "../…" escapes upward; an absolute rel means a different volume.
  return rel !== '..' && !rel.startsWith(`..${path.sep}`) && !path.isAbsolute(rel);
}

/** Reject anything that resolves outside every granted root. */
function assertInsideWorkspace(target: string): void {
  if (!ALLOWED_ROOTS.some((root) => isInside(root, target))) {
    throw new Error(ACCESS_DENIED);
  }
}

function assertReadable(target: string): void {
  if (!ALLOWED_ROOTS.concat(approvedReadRoots()).some((root) => isInside(root, target))) {
    throw new Error(ACCESS_DENIED);
  }
}

function readPath(input: string): string {
  const requested = needsReadApproval(input);
  if (requested) throw new Error(`${ACCESS_DENIED}. PERMISSION_REQUEST: ${requested}`);
  return realpathBestEffort(path.resolve(WORKSPACE_ROOT, input));
}

/** Return the exact folder the user must approve, if this path is outside grants. */
export function needsReadApproval(input: string): string | null {
  const resolved = realpathBestEffort(path.resolve(WORKSPACE_ROOT, input));
  try {
    assertReadable(resolved);
    return null;
  } catch {
    return path.resolve(input);
  }
}

/**
 * Resolve symlinks as far as the path actually exists, keeping the not-yet-
 * created tail. `file_write` targets a file that is missing by definition, so
 * plain `realpathSync` cannot be used; both sides of the containment check
 * still have to be real paths, because `/tmp` and `/var/folders` are symlinks
 * on macOS and a lexical comparison would reject the agent's own workspace.
 */
function realpathBestEffort(target: string): string {
  const pending: string[] = [];
  let current = path.resolve(target);
  for (;;) {
    try {
      const real = fs.realpathSync(current);
      return pending.length ? path.join(real, ...pending.reverse()) : real;
    } catch {
      const parent = path.dirname(current);
      if (parent === current) return path.resolve(target); // nothing on this path exists
      pending.push(path.basename(current));
      current = parent;
    }
  }
}

/**
 * Map a tool-supplied path into the agent workspace, refusing anything that
 * points outside it.
 *
 * This previously returned absolute inputs untouched and never checked where a
 * relative path landed, so `../vault.key` — or any absolute path at all —
 * reached the real filesystem. idea.md is explicit that file tools only operate
 * inside the granted workspace, so both holes are closed here, symlinks
 * included.
 */
function workspacePath(input: string): string {
  const resolved = realpathBestEffort(path.resolve(WORKSPACE_ROOT, input));
  assertInsideWorkspace(resolved);
  return resolved;
}

/** A native tool with its definition and executor */
export interface NativeTool {
  definition: ToolDefinition;
  execute(args: Record<string, unknown>): Promise<string>;
}

// --- FileRead Tool ---
const fileReadTool: NativeTool = {
  definition: {
    name: 'file_read',
    description: 'Read the contents of a file from the filesystem.',
    input_schema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Absolute or relative file path to read' },
        start_line: { type: 'number', description: 'Start line (1-indexed, inclusive)' },
        end_line: { type: 'number', description: 'End line (1-indexed, inclusive)' },
      },
      required: ['path'],
    },
  },
  async execute(args): Promise<string> {
    const filePath = readPath(args.path as string);
    try {
      const ext = path.extname(filePath).toLowerCase();

      // 1. Handle Excel files (.xlsx, .xls)
      if (ext === '.xlsx' || ext === '.xls') {
        const pyScript = `
import sys, zipfile, xml.etree.ElementTree as ET

def read_xlsx(p):
    try:
        with zipfile.ZipFile(p, 'r') as z:
            strings = []
            if 'xl/sharedStrings.xml' in z.namelist():
                tree = ET.fromstring(z.read('xl/sharedStrings.xml'))
                for el in tree.iter():
                    if el.tag.endswith('t') and el.text:
                        strings.append(el.text)
            
            output = []
            sheet_files = [f for f in z.namelist() if f.startswith('xl/worksheets/sheet')]
            for sf in sheet_files:
                tree = ET.fromstring(z.read(sf))
                rows = []
                for row_el in tree.iter('{http://schemas.openxmlformats.org/spreadsheetml/2006/main}row'):
                    row = []
                    for c_el in row_el.iter('{http://schemas.openxmlformats.org/spreadsheetml/2006/main}c'):
                        val = ''
                        t = c_el.attrib.get('t')
                        v_el = c_el.find('{http://schemas.openxmlformats.org/spreadsheetml/2006/main}v')
                        if v_el is not None and v_el.text:
                            v = v_el.text
                            if t == 's' and int(v) < len(strings):
                                val = strings[int(v)]
                            else:
                                val = v
                        row.append(val)
                    if any(row):
                        rows.append(" | ".join(row))
                if rows:
                    output.append(f"=== Sheet: {sf.split('/')[-1]} ===\\n" + "\\n".join(rows))
            return "\\n\\n".join(output) if output else "Tệp Excel trống."
    except Exception as e:
        return f"Lỗi đọc file Excel: {e}"

print(read_xlsx(sys.argv[1]))
`.trim();
        const res = execFileSync('python3', ['-c', pyScript, filePath], { encoding: 'utf8' });
        return res || 'Tệp Excel không có dữ liệu.';
      }

      // 2. Handle Image files (.jpg, .jpeg, .png, .webp, .gif)
      if (['.jpg', '.jpeg', '.png', '.webp', '.gif'].includes(ext)) {
        const mimeMap: Record<string, string> = {
          '.jpg': 'image/jpeg',
          '.jpeg': 'image/jpeg',
          '.png': 'image/png',
          '.webp': 'image/webp',
          '.gif': 'image/gif',
        };
        const mime = mimeMap[ext] || 'image/png';
        const buffer = fs.readFileSync(filePath);
        const b64 = buffer.toString('base64');
        return `![${path.basename(filePath)}](data:${mime};base64,${b64})`;
      }

      // 3. Handle standard text/code files
      const content = fs.readFileSync(filePath, 'utf8');
      const startLine = args.start_line as number | undefined;
      const endLine = args.end_line as number | undefined;

      if (startLine || endLine) {
        const lines = content.split('\n');
        const start = (startLine || 1) - 1;
        const end = endLine || lines.length;
        return lines.slice(start, end).join('\n');
      }

      return content;
    } catch (err) {
      return `Error reading file: ${err instanceof Error ? err.message : String(err)}`;
    }
  },
};

// --- FileWrite Tool ---
const fileWriteTool: NativeTool = {
  definition: {
    name: 'file_write',
    description: 'Write content to a file. Creates parent directories if needed.',
    input_schema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'File path to write to' },
        content: { type: 'string', description: 'Content to write' },
        append: { type: 'boolean', description: 'If true, append instead of overwrite' },
      },
      required: ['path', 'content'],
    },
  },
  async execute(args): Promise<string> {
    const filePath = workspacePath(args.path as string);
    const content = args.content as string;
    const append = args.append as boolean | undefined;
    try {
      const dir = path.dirname(filePath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      if (append) {
        fs.appendFileSync(filePath, content, 'utf8');
      } else {
        fs.writeFileSync(filePath, content, 'utf8');
      }
      return `Successfully wrote ${content.length} chars to ${filePath}`;
    } catch (err) {
      return `Error writing file: ${err instanceof Error ? err.message : String(err)}`;
    }
  },
};

// --- FileEdit Tool ---
const fileEditTool: NativeTool = {
  definition: {
    name: 'file_edit',
    description: 'Search and replace text in a file. Finds exact matches of old_text and replaces with new_text.',
    input_schema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'File path to edit' },
        old_text: { type: 'string', description: 'Exact text to find and replace' },
        new_text: { type: 'string', description: 'Replacement text' },
      },
      required: ['path', 'old_text', 'new_text'],
    },
  },
  async execute(args): Promise<string> {
    const filePath = workspacePath(args.path as string);
    const oldText = args.old_text as string;
    const newText = args.new_text as string;
    try {
      const content = fs.readFileSync(filePath, 'utf8');
      if (!content.includes(oldText)) {
        return `Error: old_text not found in ${filePath}`;
      }
      const updated = content.replace(oldText, newText);
      fs.writeFileSync(filePath, updated, 'utf8');
      return `Successfully edited ${filePath}`;
    } catch (err) {
      return `Error editing file: ${err instanceof Error ? err.message : String(err)}`;
    }
  },
};

// --- Grep Tool ---
const grepTool: NativeTool = {
  definition: {
    name: 'grep',
    description: 'Search file contents using ripgrep-style pattern matching. Returns matching lines with file paths and line numbers.',
    input_schema: {
      type: 'object',
      properties: {
        pattern: { type: 'string', description: 'Search pattern (regex)' },
        path: { type: 'string', description: 'Directory or file to search in' },
        include: { type: 'string', description: 'Glob pattern to filter files (e.g. "*.ts")' },
        case_insensitive: { type: 'boolean', description: 'Case insensitive search' },
      },
      required: ['pattern', 'path'],
    },
  },
  async execute(args): Promise<string> {
    const pattern = args.pattern as string;
    const searchPath = readPath(args.path as string);
    const include = args.include as string | undefined;
    const caseInsensitive = args.case_insensitive as boolean | undefined;

    const grepArgs = ['-rnI', '--color=never'];
    if (caseInsensitive) grepArgs.push('-i');
    if (include) grepArgs.push(`--include=${include}`);
    grepArgs.push(pattern, searchPath);

    try {
      const output = execFileSync('grep', grepArgs, {
        encoding: 'utf8',
        maxBuffer: 512 * 1024,
        timeout: 10000,
      });
      const lines = output.trim().split('\n');
      if (lines.length > 50) {
        return lines.slice(0, 50).join('\n') + `\n... (${lines.length - 50} more matches)`;
      }
      return output || '(no matches)';
    } catch {
      return '(no matches)';
    }
  },
};

// --- Glob Tool ---
const globTool: NativeTool = {
  definition: {
    name: 'glob',
    description: 'List files matching a glob pattern.',
    input_schema: {
      type: 'object',
      properties: {
        pattern: { type: 'string', description: 'Glob pattern (e.g. "src/**/*.ts")' },
        cwd: { type: 'string', description: 'Working directory for the glob' },
      },
      required: ['pattern'],
    },
  },
  async execute(args): Promise<string> {
    const pattern = args.pattern as string;
    const cwd = readPath((args.cwd as string) || '.');

    try {
      const output = execFileSync('find', [cwd, '-type', 'f'], {
        encoding: 'utf8', maxBuffer: 256 * 1024, timeout: 10000,
      });
      const suffix = pattern.startsWith('*.') ? pattern.slice(1) : null;
      const files = output.trim().split('\n').filter(Boolean).filter((file) =>
        suffix ? file.endsWith(suffix) : file.includes(pattern.replaceAll('*', ''))
      );
      return files.slice(0, 100).join('\n') || '(no matches)';
    } catch {
      return '(no matches)';
    }
  },
};

// --- HTTP Request Tool ---
const httpRequestTool: NativeTool = {
  definition: {
    name: 'http_request',
    description: 'Make an unauthenticated HTTP request. Credentialed operations must use an installed connector or gateway capability.',
    input_schema: {
      type: 'object',
      properties: {
        url: { type: 'string', description: 'URL to request' },
        method: { type: 'string', description: 'HTTP method (GET, POST, PUT, DELETE)', default: 'GET' },
        headers: { type: 'object', description: 'Request headers as key-value pairs' },
        body: { type: 'string', description: 'Request body (for POST/PUT)' },
      },
      required: ['url'],
    },
  },
  async execute(args): Promise<string> {
    const url = args.url as string;
    const method = (args.method as string || 'GET').toUpperCase();
    const headers = (args.headers as Record<string, string>) || {};
    const body = args.body as string | undefined;

    const serialized = JSON.stringify({ url, headers, body });
    const hasCredentialHeader = Object.keys(headers).some((key) => /authorization|proxy-authorization|cookie|x-api-key/i.test(key));
    if (hasCredentialHeader || /\{\{vault:|password|bearer\s|access[_-]?token|refresh[_-]?token|api[_-]?key/i.test(serialized)) {
      return 'Credential access denied. Use a connector/gateway reference; agents cannot resolve Vault secrets.';
    }

    try {
      const response = await fetch(url, {
        method,
        headers,
        body: body || undefined,
      });
      const text = await response.text();
      return `HTTP ${response.status} ${response.statusText}\n\n${text.slice(0, 4096)}`;
    } catch (err) {
      return `Error: ${err instanceof Error ? err.message : String(err)}`;
    }
  },
};

function decodeHtml(value: string): string {
  return value
    .replace(/<[^>]*>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ')
    .trim();
}

// --- Web Search Tool ---
const webSearchTool: NativeTool = {
  definition: {
    name: 'web_search',
    description: 'Search the public web. Returns titles, links, and snippets from web results. Use http_request to read a selected public page.',
    input_schema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Search query' },
        max_results: { type: 'number', description: 'Maximum number of results, from 1 to 10', default: 5 },
      },
      required: ['query'],
    },
  },
  async execute(args): Promise<string> {
    const query = String(args.query || '').trim();
    if (!query) return 'A search query is required.';
    const requested = Number(args.max_results ?? 5);
    const maxResults = Number.isFinite(requested) ? Math.min(Math.max(Math.trunc(requested), 1), 10) : 5;

    try {
      const response = await fetch(`https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`, {
        headers: { 'User-Agent': 'VuaAssistant/1.0 (+https://vuaai.net)' },
      });
      if (!response.ok) return `Web search failed (HTTP ${response.status}).`;
      const html = await response.text();
      const resultPattern = /<a[^>]+class="result__a"[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>[\s\S]*?<a[^>]+class="result__snippet"[^>]*>([\s\S]*?)<\/a>/g;
      const results: string[] = [];
      let match: RegExpExecArray | null;
      while ((match = resultPattern.exec(html)) && results.length < maxResults) {
        const url = match[1].startsWith('//') ? `https:${match[1]}` : match[1];
        results.push(`${results.length + 1}. ${decodeHtml(match[2])}\n${url}\n${decodeHtml(match[3])}`);
      }
      return results.length > 0
        ? results.join('\n\n')
        : 'No web results found. Try a more specific query.';
    } catch (error) {
      return `Web search failed: ${error instanceof Error ? error.message : String(error)}`;
    }
  },
};

// --- Credentialed Connector Gateway Tool ---
const connectorRequestTool: NativeTool = {
  definition: {
    name: 'connector_request',
    description: 'Call the origin bound to a Vault reference. Use opaque {{credential:field}} variables; secret values are resolved and redacted by the trusted gateway.',
    input_schema: {
      type: 'object',
      properties: {
        credential_ref: { type: 'string', description: 'Opaque reference returned by vault_list' },
        url: { type: 'string', description: 'URL or path on the Vault entry origin' },
        method: { type: 'string', description: 'GET, POST, PUT, PATCH or DELETE' },
        headers: { type: 'object', description: 'Headers; credentials must use {{credential:field}} variables' },
        body: { type: 'string', description: 'Optional request body with opaque credential variables' },
      },
      required: ['credential_ref', 'url'],
    },
  },
  async execute(args): Promise<string> {
    const capability = process.env.VUA_CONNECTOR_GATEWAY_TOKEN;
    if (!capability) return 'Connector gateway is unavailable.';
    try {
      const response = await fetch(`${AI_ROUTER_URL}/v1/connectors/request`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${capability}` },
        body: JSON.stringify({
          credentialRef: args.credential_ref,
          url: args.url,
          method: args.method,
          headers: args.headers,
          body: args.body,
        }),
      });
      const payload = await response.json() as { status?: number; body?: string; error?: string };
      if (!response.ok) return `Connector error: ${payload.error || response.status}`;
      return `HTTP ${payload.status}\n\n${payload.body || ''}`;
    } catch (error) {
      return `Connector error: ${error instanceof Error ? error.message : String(error)}`;
    }
  },
};

// --- Vault List Tool ---
const vaultListTool: NativeTool = {
  definition: {
    name: 'vault_list',
    description: 'List the names (labels) and services of all credentials stored in your secure Vault. Use this to discover which credentials are available before making API requests or using placeholders.',
    input_schema: {
      type: 'object',
      properties: {},
    },
  },
  async execute(): Promise<string> {
    const capability = process.env.VUA_CONNECTOR_GATEWAY_TOKEN;
    if (!capability) return 'Connector gateway is unavailable.';
    try {
      const response = await fetch(`${AI_ROUTER_URL}/v1/vault/manifest`, {
        headers: { Authorization: `Bearer ${capability}` },
      });
      if (!response.ok) return `Vault manifest is unavailable (${response.status}).`;
      const manifest = await response.json() as {
        entries?: Array<{ ref: string; label: string; service?: string; fields?: string[] }>;
      };
      const entries = manifest.entries ?? [];
      if (entries.length === 0) {
        return 'Your secure Vault is currently empty.';
      }
      return entries.map((entry) =>
        `- ${entry.label}${entry.service ? ` (${entry.service})` : ''} ref=${entry.ref}` +
        `${entry.fields?.length ? ` variables=${entry.fields.map((field) => `{{credential:${field}}}`).join(',')}` : ''}`
      ).join('\n');
    } catch (err) {
      return `Error listing Vault: ${err instanceof Error ? err.message : String(err)}`;
    }
  },
};

// --- Schedule Task Tool ---
//
// Takes a whole plan in one call. A single-task tool meant a seven-day posting
// schedule needed seven separate calls, and the model reliably summarised the
// plan in prose instead — telling the user their posts were scheduled while
// "Lịch & Nhiệm vụ" stayed empty.
interface ScheduleInput {
  name?: unknown;
  prompt?: unknown;
  schedule?: unknown;
  enabled?: unknown;
}

const scheduleTaskTool: NativeTool = {
  definition: {
    name: 'schedule_task',
    description:
      'Register one or more recurring or dated tasks in VuaAssistant "Lịch & Nhiệm vụ" (Scheduled Tasks). ' +
      'Pass the whole plan at once in `tasks`. You MUST call this whenever you plan, agree, or promise any ' +
      'schedule, posting plan, report, or reminder — a plan is not scheduled until this tool has returned. ' +
      'Never tell the user something is scheduled without calling it.',
    input_schema: {
      type: 'object',
      properties: {
        tasks: {
          type: 'array',
          description: 'Every task in the plan. Use one entry per occurrence or per recurrence.',
          items: {
            type: 'object',
            properties: {
              name: { type: 'string', description: 'Title, e.g. "Đăng bài Blog Ngày 2"' },
              prompt: { type: 'string', description: 'What the assistant should do at that time, in full — it will not have this conversation for context.' },
              schedule: {
                type: 'string',
                description:
                  'When to run. Recurring: "Every day at 09:00", "Hàng ngày lúc 09:30", "Every Monday at 08:00", ' +
                  '"Thứ hai lúc 08:00", "Weekdays at 08:30", "Every hour", "Hàng tháng lúc 09:00". ' +
                  'One-off: "27/07 08:30", "27/07/2026 08:30", "2026-07-27 08:30".',
              },
              enabled: { type: 'boolean', description: 'Active immediately (default true)' },
            },
            required: ['name', 'prompt', 'schedule'],
          },
        },
        name: { type: 'string', description: 'Single-task shorthand; prefer `tasks`.' },
        prompt: { type: 'string', description: 'Single-task shorthand; prefer `tasks`.' },
        schedule: { type: 'string', description: 'Single-task shorthand; prefer `tasks`.' },
        enabled: { type: 'boolean', description: 'Single-task shorthand; prefer `tasks`.' },
      },
    },
  },
  async execute(args): Promise<string> {
    const raw = Array.isArray(args.tasks) && args.tasks.length > 0
      ? (args.tasks as ScheduleInput[])
      : [args as ScheduleInput];

    const incoming = raw
      .map((item) => ({
        name: typeof item.name === 'string' && item.name.trim() ? item.name.trim() : '',
        prompt: typeof item.prompt === 'string' ? item.prompt.trim() : '',
        schedule: typeof item.schedule === 'string' && item.schedule.trim() ? item.schedule.trim() : '',
        enabled: item.enabled !== false,
      }))
      .filter((item) => item.name && item.prompt && item.schedule);

    if (incoming.length === 0) {
      return 'Error: each task needs name, prompt and schedule. Nothing was scheduled.';
    }

    const dataDir = process.env.VUA_DATA_DIR || path.join(process.env.HOME || '', 'vuaai-data');
    fs.mkdirSync(dataDir, { recursive: true });
    const tasksFile = path.join(dataDir, 'scheduled_tasks.json');

    let tasks: Record<string, unknown>[] = [];
    try {
      const parsed = JSON.parse(fs.readFileSync(tasksFile, 'utf8'));
      if (Array.isArray(parsed)) tasks = parsed;
    } catch {
      tasks = [];
    }

    const created: string[] = [];
    for (const item of incoming) {
      // Re-running the same plan updates it rather than piling up duplicates.
      tasks = tasks.filter((t) => !(t.name === item.name && t.schedule === item.schedule));
      tasks.unshift({
        id: `task-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
        ...item,
        createdAt: Date.now(),
        // Stops a recurring task whose time already passed today from firing the
        // instant it is created. A dated one-off compares against its own target,
        // so this stamp does not suppress it.
        lastRun: Date.now(),
      });
      created.push(`- "${item.name}" — ${item.schedule}`);
    }

    fs.writeFileSync(tasksFile, JSON.stringify(tasks, null, 2), 'utf8');
    log(`Scheduled ${created.length} task(s)`);

    return `✅ Đã đưa ${created.length} nhiệm vụ vào "Lịch & Nhiệm vụ":\n${created.join('\n')}`;
  },
};

const searchMemoryTool: NativeTool = {
  definition: {
    name: 'search_memory',
    description: 'Search the agent long-term learned memory for durable user preferences, facts, and execution learnings.',
    input_schema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Keywords to search for in memory' },
      },
      required: ['query'],
    },
  },
  async execute(args): Promise<string> {
    const query = String(args.query || '').trim().toLowerCase();
    if (!query) return 'Error: query cannot be empty.';

    const words = query.split(/\s+/).filter((word) => word.length > 1);
    const matches = readMemory(AGENT_ROOT)
      .map((note) => ({
        note,
        score: words.reduce((score, word) => score + (note.toLowerCase().includes(word) ? 1 : 0), 0),
      }))
      .filter((item) => item.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 10);

    return matches.length
      ? matches.map((item) => `- ${item.note}`).join('\n')
      : `No memories matched query: "${args.query}"`;
  },
};

// --- Computer Use Tool ---
// Calls the Tauri computer_action commands via HTTP to the Tauri IPC bridge.
// When running inside the desktop app, Tauri exposes a local IPC; the Agent
// Runner (Node.js sidecar) calls back through the AI Router which proxies
// whitelisted Tauri commands. When not in Tauri, this tool is simply absent.
//
// ponytail: single tool covering all actions to avoid polluting the model's
// tool list. Upgrade path: split per-action when capability-rail needs
// per-action gates (e.g. allow screenshot but not keyboard).
const computerUseTool: NativeTool = {
  definition: {
    name: 'computer_use',
    description:
      'Control the host computer: move the mouse, click, type text, press keyboard shortcuts, ' +
      'or take a screenshot of the screen. Only available when the user has granted Computer Use ' +
      'in Settings → Agent Limits. Actions run on the real desktop — use carefully.',
    input_schema: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          description:
            'One of: "mouse_move", "mouse_click", "mouse_down", "mouse_up", ' +
            '"type_text", "key_press", "key_down", "key_up", "screenshot", "list_displays".',
        },
        x: { type: 'number', description: 'X coordinate for mouse_move (absolute screen pixels).' },
        y: { type: 'number', description: 'Y coordinate for mouse_move (absolute screen pixels).' },
        button: { type: 'string', description: '"left" | "right" | "middle" for mouse actions (default "left").' },
        text: { type: 'string', description: 'Text to type (for type_text action).' },
        key: { type: 'string', description: 'Key name for key_press/key_down/key_up (e.g. "return", "ctrl", "f5").' },
        display_index: { type: 'number', description: 'Display index for screenshot (0 = primary, default 0).' },
      },
      required: ['action'],
    },
  },
  async execute(args): Promise<string> {
    const routerUrl = AI_ROUTER_URL;
    const action = String(args.action || '');
    // Map action → Tauri command + params, forwarded via AI Router tauri-bridge.
    const payload: Record<string, unknown> = { command: '' };
    switch (action) {
      case 'mouse_move':
        payload.command = 'computer_mouse_move';
        payload.x = args.x ?? 0;
        payload.y = args.y ?? 0;
        break;
      case 'mouse_click':
        payload.command = 'computer_mouse_click';
        payload.button = args.button ?? 'left';
        break;
      case 'mouse_down':
        payload.command = 'computer_mouse_down';
        payload.button = args.button ?? 'left';
        break;
      case 'mouse_up':
        payload.command = 'computer_mouse_up';
        payload.button = args.button ?? 'left';
        break;
      case 'type_text':
        payload.command = 'computer_type_text';
        payload.text = String(args.text ?? '');
        break;
      case 'key_press':
        payload.command = 'computer_key_press';
        payload.key = String(args.key ?? '');
        break;
      case 'key_down':
        payload.command = 'computer_key_down';
        payload.key = String(args.key ?? '');
        break;
      case 'key_up':
        payload.command = 'computer_key_up';
        payload.key = String(args.key ?? '');
        break;
      case 'screenshot':
        payload.command = 'computer_screenshot';
        payload.display_index = args.display_index ?? 0;
        break;
      case 'list_displays':
        payload.command = 'computer_list_displays';
        break;
      default:
        return `Unknown computer_use action: "${action}". Valid: mouse_move, mouse_click, mouse_down, mouse_up, type_text, key_press, key_down, key_up, screenshot, list_displays.`;
    }
    try {
      const res = await fetch(`${routerUrl}/v1/tauri-bridge`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const err = await res.text();
        return `Computer use error (${res.status}): ${err}`;
      }
      const data = await res.json() as { result?: unknown; error?: string };
      if (data.error) return `Computer use error: ${data.error}`;
      // screenshot returns base64 PNG — tell the model it's an image data URL
      if (action === 'screenshot' && typeof data.result === 'string') {
        return `data:image/png;base64,${data.result}`;
      }
      return typeof data.result === 'string' ? data.result : JSON.stringify(data.result ?? 'OK');
    } catch (err) {
      return `Computer use unavailable: ${err instanceof Error ? err.message : String(err)}`;
    }
  },
};

// --- Delegate Task Tool (#14 Autonomy Loop) ---
// Allows an Agent to spawn a child task (sub-agent run) by writing to the
// inbound IPC queue. The parent continues; the child result comes back as a
// scheduled outbound message tagged with the delegated task id.
//
// ponytail: writes to messages_in directly using the same DB the host uses.
// Upgrade path: full DAG parentTaskId tracking in a separate task_tree table.
const delegateTaskTool: NativeTool = {
  definition: {
    name: 'delegate_task',
    description:
      'Delegate a sub-task to a child Agent. The child runs independently and ' +
      'its result is delivered back to the current session. Use this to break a ' +
      'large goal into parallel workstreams. Each child runs in the same workspace.',
    input_schema: {
      type: 'object',
      properties: {
        task_name: { type: 'string', description: 'Short name for the delegated task (shown in UI).' },
        prompt: { type: 'string', description: 'Full instructions for the child agent.' },
        agent_name: { type: 'string', description: 'Target agent name/group (default: current agent).' },
      },
      required: ['task_name', 'prompt'],
    },
  },
  async execute(args): Promise<string> {
    const dataDir = DATA_DIR;
    const ipcDir = path.join(dataDir, 'ipc');
    const inboundDb = path.join(ipcDir, 'inbound.db');

    if (!fs.existsSync(inboundDb)) {
      return 'Delegate unavailable: IPC database not found. Ensure the Agent Runner is active.';
    }

    const taskId = `delegate-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
    const taskName = String(args.task_name || 'Delegated task');
    const prompt = String(args.prompt || '');
    const agentName = String(args.agent_name || loadConfig().agentName);

    // Write to inbound.db as a new message for the target agent.
    // Uses even sequence number (host-side) to avoid collision with container (odd).
    try {
      const { execFileSync: exec } = await import('child_process');
      const sql = `
        INSERT INTO messages_in (id, seq, kind, timestamp, status, platform_id, channel_type, thread_id, content, trigger)
        VALUES (
          '${taskId}',
          (SELECT COALESCE(MAX(seq), 0) + 2 FROM messages_in WHERE seq % 2 = 0),
          'chat',
          ${Date.now()},
          'pending',
          '${agentName}',
          'agent',
          '${taskId}',
          ${JSON.stringify(JSON.stringify({ role: 'user', content: `[DELEGATED TASK: ${taskName}]\n\n${prompt}` }))},
          1
        );
      `;
      exec('sqlite3', [inboundDb, sql]);
      log(`Delegated task "${taskName}" → ${agentName} (id=${taskId})`);
      return `✅ Task delegated: "${taskName}" → agent "${agentName}" (id: ${taskId}). The result will appear in your session when complete.`;
    } catch (err) {
      return `Failed to delegate task: ${err instanceof Error ? err.message : String(err)}`;
    }
  },
};

/** All built-in native tools */
export const NATIVE_TOOLS: NativeTool[] = [
  fileReadTool,
  fileWriteTool,
  fileEditTool,
  grepTool,
  globTool,
  httpRequestTool,
  webSearchTool,
  connectorRequestTool,
  vaultListTool,
  scheduleTaskTool,
  searchMemoryTool,
  computerUseTool,
  delegateTaskTool,
];

/** Get tool definitions for all native tools (for sending to LLM) */
export function getToolDefinitions(): ToolDefinition[] {
  return NATIVE_TOOLS.map((t) => t.definition);
}

function logAudit(toolName: string, args: Record<string, unknown>, isError: boolean, errorMsg?: string): void {
  const timestamp = new Date().toISOString();
  const logDir = path.join(WORKSPACE_ROOT, '.audit');
  try {
    if (!fs.existsSync(logDir)) fs.mkdirSync(logDir, { recursive: true });
    const logLine = JSON.stringify({ timestamp, tool: toolName, args, is_error: isError, error: errorMsg }) + '\n';
    fs.appendFileSync(path.join(logDir, 'tool_calls.log'), logLine, 'utf8');
  } catch {
    /* ignore logging failure */
  }
}

/** Execute a tool by name */
export async function executeTool(name: string, args: Record<string, unknown>): Promise<ToolResult> {
  const tool = NATIVE_TOOLS.find((t) => t.definition.name === name);
  if (!tool) {
    const error = `Unknown tool: ${name}`;
    logAudit(name, args, true, error);
    return {
      tool_call_id: '',
      content: error,
      is_error: true,
    };
  }
  try {
    const result = await tool.execute(args);
    logAudit(name, args, false);
    return { tool_call_id: '', content: result };
  } catch (err) {
    const errorMsg = `Tool error: ${err instanceof Error ? err.message : String(err)}`;
    logAudit(name, args, true, errorMsg);
    return {
      tool_call_id: '',
      content: errorMsg,
      is_error: true,
    };
  }
}
