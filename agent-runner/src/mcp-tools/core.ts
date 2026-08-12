/** Core delivery tools backed by the runner-owned outbound IPC database. */
import fs from 'fs';
import path from 'path';
import { getMessageIdBySeq, getRoutingBySeq, writeMessageOut } from '../db/index.js';
import { findByName, getAllDestinations } from '../destinations.js';
import type { ToolDefinition } from '../providers/types.js';
import { getBuiltinToolContext } from './context.js';

const WORKSPACE_ROOT = path.resolve(
  process.env.VUA_AGENT_WORKSPACE || path.join(process.env.VUA_DATA_DIR || '/tmp/vuaassistant', 'workspace'),
);
const OUTBOX_ROOT = process.env.VUA_AGENT_WORKSPACE
  ? path.resolve(process.env.VUA_AGENT_WORKSPACE, '..', 'outbox')
  : path.resolve(process.env.VUA_DATA_DIR || '/tmp/vuaassistant', 'outbox');

export interface BuiltinTool {
  definition: ToolDefinition;
  execute(args: Record<string, unknown>): Promise<string>;
}

function newId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function workspaceFile(input: string): string {
  const resolved = path.resolve(WORKSPACE_ROOT, input);
  if (resolved !== WORKSPACE_ROOT && !resolved.startsWith(`${WORKSPACE_ROOT}${path.sep}`)) {
    throw new Error('Access denied: files must remain inside the assigned workspace.');
  }
  return resolved;
}

function routingFor(args: Record<string, unknown>) {
  const current = getBuiltinToolContext();
  const destinationName = typeof args.to === 'string' ? args.to : undefined;
  if (destinationName) {
    const destination = findByName(destinationName);
    if (!destination) throw new Error(`Unknown destination "${destinationName}".`);
    if (destination.type === 'agent') {
      return {
        platform_id: destination.agentGroupId || destination.platformId || null,
        channel_type: 'agent',
        thread_id: null,
        in_reply_to: current.inReplyTo,
      };
    }
    return {
      platform_id: destination.platformId || null,
      channel_type: destination.channelType || null,
      thread_id: destination.platformId === current.routing.platformId && destination.channelType === current.routing.channelType
        ? current.routing.threadId
        : null,
      in_reply_to: current.inReplyTo,
    };
  }
  const available = getAllDestinations();
  if (!current.routing.platformId && available.length > 1) {
    throw new Error(`Multiple destinations are available. Choose one with "to": ${available.map((entry) => entry.name).join(', ')}.`);
  }
  return {
    platform_id: typeof args.platform_id === 'string' ? args.platform_id : current.routing.platformId,
    channel_type: typeof args.channel_type === 'string' ? args.channel_type : current.routing.channelType,
    thread_id: typeof args.thread_id === 'string' ? args.thread_id : current.routing.threadId,
    in_reply_to: current.inReplyTo,
  };
}

const sendMessage: BuiltinTool = {
  definition: {
    name: 'send_message',
    description: 'Send a chat message to the current conversation, or to an explicitly provided routing destination.',
    input_schema: {
      type: 'object',
      properties: {
        text: { type: 'string', description: 'Message text' },
        to: { type: 'string', description: 'Named host-approved destination. Optional for the current conversation.' },
        platform_id: { type: 'string' },
        channel_type: { type: 'string' },
        thread_id: { type: 'string' },
      },
      required: ['text'],
    },
  },
  async execute(args): Promise<string> {
    const text = String(args.text || '').trim();
    if (!text) throw new Error('text is required');
    const routing = routingFor(args);
    const seq = writeMessageOut({
      id: newId('out'),
      ...routing,
      kind: 'chat',
      content: JSON.stringify({ text }),
    });
    return `Message queued (seq ${seq}).`;
  },
};

const sendFile: BuiltinTool = {
  definition: {
    name: 'send_file',
    description: 'Send a workspace file to the current conversation. Files outside the assigned workspace are never accessible.',
    input_schema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Path relative to the assigned workspace' },
        to: { type: 'string', description: 'Named host-approved destination. Optional for the current conversation.' },
        caption: { type: 'string', description: 'Optional file caption' },
      },
      required: ['path'],
    },
  },
  async execute(args): Promise<string> {
    const source = workspaceFile(String(args.path || ''));
    if (!fs.existsSync(source) || !fs.statSync(source).isFile()) throw new Error('Workspace file was not found.');
    fs.mkdirSync(OUTBOX_ROOT, { recursive: true });
    const destination = path.join(OUTBOX_ROOT, `${newId('file')}-${path.basename(source)}`);
    fs.copyFileSync(source, destination);
    const routing = routingFor(args);
    const seq = writeMessageOut({
      id: newId('out'),
      ...routing,
      kind: 'file',
      content: JSON.stringify({ filePath: destination, fileName: path.basename(source), caption: String(args.caption || '') }),
    });
    return `File queued (seq ${seq}).`;
  },
};

function messageRouting(seq: number) {
  const routing = getRoutingBySeq(seq);
  if (!routing) throw new Error(`No outbound message exists for seq ${seq}.`);
  const messageId = getMessageIdBySeq(seq);
  if (!messageId) throw new Error(`No message exists for seq ${seq}.`);
  return { routing, messageId };
}

const editMessage: BuiltinTool = {
  definition: {
    name: 'edit_message',
    description: 'Request an edit to an outbound message previously sent by this runner.',
    input_schema: {
      type: 'object',
      properties: { message_seq: { type: 'number' }, text: { type: 'string' } },
      required: ['message_seq', 'text'],
    },
  },
  async execute(args): Promise<string> {
    const seqToEdit = Number(args.message_seq);
    const { routing, messageId } = messageRouting(seqToEdit);
    const seq = writeMessageOut({
      id: newId('out'), kind: 'edit', ...routing,
      content: JSON.stringify({ messageId, text: String(args.text || '') }),
    });
    return `Edit queued (seq ${seq}).`;
  },
};

const addReaction: BuiltinTool = {
  definition: {
    name: 'add_reaction',
    description: 'Add an emoji reaction to a previously sent or received message by sequence number.',
    input_schema: {
      type: 'object',
      properties: { message_seq: { type: 'number' }, emoji: { type: 'string' } },
      required: ['message_seq', 'emoji'],
    },
  },
  async execute(args): Promise<string> {
    const targetSeq = Number(args.message_seq);
    const { routing, messageId } = messageRouting(targetSeq);
    const seq = writeMessageOut({
      id: newId('out'), kind: 'reaction', ...routing,
      content: JSON.stringify({ messageId, emoji: String(args.emoji || '') }),
    });
    return `Reaction queued (seq ${seq}).`;
  },
};

const askUserQuestion: BuiltinTool = {
  definition: {
    name: 'ask_user_question',
    description: 'Ask the user a clarifying question during task execution and pause the runner until a response is received.',
    input_schema: {
      type: 'object',
      properties: {
        question: { type: 'string', description: 'The question to ask the user' },
        options: {
          type: 'array',
          items: { type: 'string' },
          description: 'Optional pre-defined answers (buttons) the user can choose from',
        },
      },
      required: ['question'],
    },
  },
  async execute(args): Promise<string> {
    const question = String(args.question || '').trim();
    if (!question) throw new Error('question is required');
    const options = Array.isArray(args.options) ? args.options.map(String) : undefined;
    const routing = routingFor(args);
    const questionId = newId('q');

    const seq = writeMessageOut({
      id: newId('out'),
      ...routing,
      kind: 'chat',
      content: JSON.stringify({
        type: 'user_question',
        question,
        options,
        questionId,
      }),
    });

    return `INTERACTIVE_QUESTION_PENDING: ${JSON.stringify({ questionId, question, options, seq })}`;
  },
};

const scheduleMessage: BuiltinTool = {
  definition: {
    name: 'schedule_message',
    description: 'Schedule a message or task to run periodically or at a specific time.',
    input_schema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Name of the scheduled task' },
        prompt: { type: 'string', description: 'Prompt to send to the agent when the schedule fires' },
        schedule: { type: 'string', description: 'Cron pattern, e.g. "Every day at 09:00" or raw ISO date "2026-07-27 08:30"' },
        enabled: { type: 'boolean', description: 'State of the task (default: true)' },
      },
      required: ['name', 'prompt', 'schedule'],
    },
  },
  async execute(args): Promise<string> {
    const name = String(args.name || '').trim();
    const prompt = String(args.prompt || '').trim();
    const schedule = String(args.schedule || '').trim();
    const enabled = args.enabled !== false;

    if (!name || !prompt || !schedule) throw new Error('name, prompt and schedule are required');

    const dataDir = process.env.VUA_DATA_DIR || path.join(process.env.HOME || '', 'vuaai-data');
    fs.mkdirSync(dataDir, { recursive: true });
    const tasksFile = path.join(dataDir, 'scheduled_tasks.json');

    let tasks: Record<string, unknown>[] = [];
    try {
      if (fs.existsSync(tasksFile)) {
        tasks = JSON.parse(fs.readFileSync(tasksFile, 'utf8'));
      }
    } catch {
      // Ignore parse errors
    }

    // Dedup and add
    tasks = tasks.filter((t) => !(t.name === name && t.schedule === schedule));
    const taskId = `task-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
    tasks.unshift({
      id: taskId,
      name,
      prompt,
      schedule,
      enabled,
      createdAt: Date.now(),
      lastRun: Date.now(),
    });

    fs.writeFileSync(tasksFile, JSON.stringify(tasks, null, 2), 'utf8');
    return `✅ Task scheduled successfully (id: ${taskId}).`;
  },
};

const listScheduled: BuiltinTool = {
  definition: {
    name: 'list_scheduled',
    description: 'List all active and inactive scheduled tasks.',
    input_schema: {
      type: 'object',
      properties: {},
    },
  },
  async execute(): Promise<string> {
    const dataDir = process.env.VUA_DATA_DIR || path.join(process.env.HOME || '', 'vuaai-data');
    const tasksFile = path.join(dataDir, 'scheduled_tasks.json');
    if (!fs.existsSync(tasksFile)) return 'No scheduled tasks found.';

    try {
      const tasks = JSON.parse(fs.readFileSync(tasksFile, 'utf8')) as Array<Record<string, unknown>>;
      if (tasks.length === 0) return 'No scheduled tasks found.';
      return tasks
        .map(
          (t) =>
            `- [${t.enabled ? 'Enabled' : 'Disabled'}] "${t.name}" (${t.schedule}) prompt="${String(t.prompt).slice(0, 50)}..." id=${t.id}`
        )
        .join('\n');
    } catch (error) {
      return `Error listing tasks: ${error instanceof Error ? error.message : String(error)}`;
    }
  },
};

const cancelScheduled: BuiltinTool = {
  definition: {
    name: 'cancel_scheduled',
    description: 'Cancel (delete) a scheduled task by ID or name.',
    input_schema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'The unique ID of the task to cancel' },
        name: { type: 'string', description: 'Alternative: match by name' },
      },
    },
  },
  async execute(args): Promise<string> {
    const id = typeof args.id === 'string' ? args.id.trim() : undefined;
    const name = typeof args.name === 'string' ? args.name.trim() : undefined;
    if (!id && !name) throw new Error('Either id or name is required to cancel a task');

    const dataDir = process.env.VUA_DATA_DIR || path.join(process.env.HOME || '', 'vuaai-data');
    const tasksFile = path.join(dataDir, 'scheduled_tasks.json');
    if (!fs.existsSync(tasksFile)) return 'No scheduled tasks found.';

    try {
      let tasks = JSON.parse(fs.readFileSync(tasksFile, 'utf8')) as Array<Record<string, unknown>>;
      const before = tasks.length;
      if (id) {
        tasks = tasks.filter((t) => t.id !== id);
      } else if (name) {
        tasks = tasks.filter((t) => t.name !== name);
      }

      if (tasks.length === before) {
        return 'No matching task found to cancel.';
      }

      fs.writeFileSync(tasksFile, JSON.stringify(tasks, null, 2), 'utf8');
      return `✅ Task canceled successfully.`;
    } catch (error) {
      return `Error canceling task: ${error instanceof Error ? error.message : String(error)}`;
    }
  },
};

export const CORE_TOOLS: BuiltinTool[] = [sendMessage, sendFile, editMessage, addReaction, askUserQuestion, scheduleMessage, listScheduled, cancelScheduled];
