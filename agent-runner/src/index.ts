import fs from 'fs';
import path from 'path';
import { loadConfig } from './config.js';
import { ensureIpcDir, setMaxMessagesPerPrompt } from './db/index.js';
import { createProvider, type ProviderName } from './providers/factory.js';
import { runPollLoop } from './poll-loop.js';
// import { startScheduler } from './scheduler/index.js';
// import { startTelegramChannel } from './channels/telegram.js';
// import { mcpManager } from './mcp-client/index.js';
import { ensureMemoryScaffold } from './memory/memory-scaffold.js';

function log(msg: string): void {
  console.error(`[agent-runner] ${msg}`);
}

import { startBuiltinMcpServer } from './mcp-tools/index.js';
import { composeRunner } from './kernel/compose.js';

async function main(): Promise<void> {
  const config = loadConfig();

  // If called with --mcp, start the built-in JSON-RPC stdio MCP server
  // (Task 4: Built-in MCP Server)
  if (process.argv.includes('--mcp')) {
    log('Starting VuaAssistant Built-in stdio MCP Server');
    startBuiltinMcpServer();
    return;
  }

  const providerName = config.provider.toLowerCase() as ProviderName;

  log(`Starting VuaAssistant Agent Runner v0.1.0`);
  log(`  Provider: ${providerName}`);
  log(`  Model: ${config.model || '(default)'}`);
  log(`  Agent: ${config.agentName}`);
  log(`  Data dir: ${config.dataDir}`);
  log(`  IPC dir: ${config.ipcDir}`);

  // Ensure IPC directory exists
  ensureIpcDir();

  // Set max messages per prompt from config
  setMaxMessagesPerPrompt(config.maxMessagesPerPrompt);

  // Create provider
  const provider = createProvider(providerName, {
    baseUrl: config.baseUrl,
    model: config.model,
    assistantName: config.assistantName,
    mcpServers: config.mcpServers,
  });

  // Providers opt in because some stateless/local backends may not want the
  // persistent per-agent memory tree injected into their context.
  const agentDir = path.join(config.dataDir, 'agents', config.agentName);
  if (provider.usesMemoryScaffold) {
    ensureMemoryScaffold(agentDir);
  }

  log(`Provider created: ${provider.name}`);

  // Cây plugin dựng ở một chỗ duy nhất (kernel/compose.ts) để bài test kiểm
  // đúng thứ người dùng chạy, không phải một hình thù chỉ có trong test.
  const kernel = await composeRunner({ provider, providerName, log });
  log(`Plugin đã nạp: ${kernel.loaded.join(', ')}`);
  log(`Tool đã đăng ký: ${kernel.root.tools.list().length}`);

  // Initialize external MCP servers qua plugin
  await kernel.root.mcp.init(config.mcpServers || {});

  // Dựng prompt SAU khi cây plugin nạp xong: phần liệt kê tool đọc từ sổ đăng
  // ký, nên dựng sớm là ra danh sách rỗng.
  const instructions = buildSystemPrompt(
    config.assistantName,
    config.agentName,
    agentDir,
    kernel.root.prompt.build(),
  );

  const loopConfig = {
    provider,
    providerName,
    agentId: config.agentName,
    agentDir,
    systemContext: { instructions },
    tools: kernel.root.tools,
    ctx: kernel.root,
  };

  // Scheduled tasks live here, not in the webview: closing the app window must
  // not stop a schedule (idea.md §1.3 — the brain runs in the Host Process).
  kernel.root.scheduler.start(loopConfig);

  // Same reason for Telegram: the bot must answer with the window closed. The
  // AI Router holds the bot token; this only drives its token-free endpoints.
  kernel.root.telegram.start(loopConfig);

  log('Entering poll loop...');

  // Tiến hành dọn dẹp khi nhận tín hiệu kết thúc qua kernel.dispose
  const cleanup = async () => {
    log('Shutting down and disposing kernel...');
    await kernel.dispose();
  };
  process.on('SIGTERM', () => cleanup().then(() => process.exit(0)));
  process.on('SIGINT', () => cleanup().then(() => process.exit(0)));

  // Enter main poll loop (runs forever)
  await runPollLoop(loopConfig);
}

/**
 * Build the system prompt from agent config.
 */
function buildSystemPrompt(
  assistantName: string,
  agentName: string,
  agentDir: string,
  toolSection: string,
): string {
  const parts: string[] = [];

  parts.push(`You are ${assistantName}, a personal AI assistant.`);
  parts.push(`Current role: ${agentName}`);
  parts.push('');
  // Danh sách tool dựng từ sổ đăng ký, KHÔNG viết tay. Bản viết tay cũ nói với
  // model là có 9 tool trong khi runner đăng ký 13 — bốn tool nằm đó không bao
  // giờ được dùng vì model không biết chúng tồn tại.
  if (toolSection) parts.push(toolSection);
  parts.push('');
  parts.push('=== MANDATORY SCHEDULING RULE ===');
  parts.push('Whenever you plan, agree to, or promise anything that happens at a time — a posting plan, a recurring report, a reminder, a daily summary — you MUST call "schedule_task" before you say it is scheduled.');
  parts.push('Pass the WHOLE plan in one call using the "tasks" array: a seven-day posting plan is one call with seven entries, not seven calls and not a written summary.');
  parts.push('A plan written in a message, a document, or a file is NOT scheduled. Only a task registered through this tool will ever run.');
  parts.push('NEVER tell the user something is scheduled, will be posted automatically, or will run on time unless "schedule_task" returned successfully in this turn. If you did not call it, say plainly that nothing is scheduled yet.');
  parts.push('Each task\'s "prompt" must stand on its own — the scheduled run does not see this conversation.');
  parts.push('Schedule strings may be English or Vietnamese, recurring ("Hàng ngày lúc 09:30", "Every Monday at 08:00", "Weekdays at 08:30") or one-off ("27/07 08:30", "2026-07-27 08:30").');
  parts.push('Schedule inside VuaAssistant, not on external websites, unless the user explicitly asks otherwise.');
  parts.push('');
  parts.push('=== MANDATORY WORKSPACE & FILE STORAGE RULE ===');
  parts.push('- All created or generated files MUST be saved inside your active workspace directory.');
  parts.push('- NEVER write or save files to Desktop (/Users/*/Desktop), Downloads, /tmp or outside the workspace unless the user explicitly specified that exact full absolute path in their current message.');
  parts.push('- To inspect a folder outside the workspace, call glob with that exact absolute path. If access is denied, reply with exactly `PERMISSION_REQUEST: <the exact absolute directory path>` and nothing else; never tell the user to copy the project into the workspace.');
  parts.push('- Always use tools when they would help accomplish the task.');
  parts.push('Be concise and helpful.');

  // Load Instructions
  const instPath = path.join(agentDir, 'instructions.md');
  if (fs.existsSync(instPath)) {
    const content = fs.readFileSync(instPath, 'utf8').trim();
    if (content) {
      parts.push('\n=== Custom Agent Instructions ===');
      parts.push(content);
    }
  }

  // Load Soul
  const soulPath = path.join(agentDir, 'soul.md');
  if (fs.existsSync(soulPath)) {
    const content = fs.readFileSync(soulPath, 'utf8').trim();
    if (content) {
      parts.push('\n=== Custom Agent Soul & Personality ===');
      parts.push(content);
    }
  }

  // Load Memory system guidelines
  const memoryDir = path.join(agentDir, 'memory');
  if (fs.existsSync(memoryDir)) {
    parts.push('\n=== Persistent Memory ===');
    parts.push(`Your persistent memory is stored in: ${memoryDir}`);
    parts.push('You can read and update files in this directory to persist facts, project context, preferences, and learnings across turns.');
    parts.push('Refer to memory/system/definition.md and memory/index.md for memory structure and guidelines.');
  }

  return parts.join('\n');
}

// --- Process lifecycle ---

// Graceful shutdown handled in main loop cleanup
// Start
main().catch((err) => {
  log(`Fatal error: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
