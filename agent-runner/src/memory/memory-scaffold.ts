/**
 * Memory scaffold manager for VuaAssistant.
 *
 * Automatically creates the memory directory structure for the current agent
 * at startup.
 *
 * Path: VUA_DATA_DIR/agents/<agentName>/memory/
 *
 * @ref NanoClaw/container/agent-runner/src/memory-scaffold.ts
 */
import fs from 'fs';
import path from 'path';
import { DEFINITION_TEMPLATE, INDEX_TEMPLATE } from './memory-templates.js';

function log(msg: string): void {
  console.error(`[memory-scaffold] ${msg}`);
}

/**
 * Ensure memory scaffold exists for the current agent.
 *
 * Creates the following layout:
 *   agents/<agentName>/
 *     instructions.md  — Custom agent instructions (if not exists, empty)
 *     soul.md          — Custom agent personality/soul (if not exists, empty)
 *     memory/
 *       index.md
 *       system/
 *         definition.md
 *       memories/
 *       data/
 */
export function ensureMemoryScaffold(agentDir: string): void {
  const memoryDir = path.join(agentDir, 'memory');
  const systemDir = path.join(memoryDir, 'system');
  const memoriesDir = path.join(memoryDir, 'memories');
  const dataDir = path.join(memoryDir, 'data');

  // Create directories
  for (const dir of [agentDir, memoryDir, systemDir, memoriesDir, dataDir]) {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }

  // Create instructions.md with basic defaults if missing
  const instPath = path.join(agentDir, 'instructions.md');
  if (!fs.existsSync(instPath)) {
    fs.writeFileSync(
      instPath,
      '# Agent Instructions\n\nDefine the business logic and custom instructions for this agent here.\n',
      'utf8',
    );
  }

  // Create soul.md with basic defaults if missing
  const soulPath = path.join(agentDir, 'soul.md');
  if (!fs.existsSync(soulPath)) {
    fs.writeFileSync(
      soulPath,
      '# Agent Soul\n\nDefine the personality, tone, and character traits of this agent here.\n',
      'utf8',
    );
  }

  // Create memory/system/definition.md if missing
  const defPath = path.join(systemDir, 'definition.md');
  if (!fs.existsSync(defPath)) {
    fs.writeFileSync(defPath, DEFINITION_TEMPLATE, 'utf8');
  }

  // Create memory/index.md if missing
  const indexPath = path.join(memoryDir, 'index.md');
  if (!fs.existsSync(indexPath)) {
    fs.writeFileSync(indexPath, INDEX_TEMPLATE, 'utf8');
  }

  log(`Memory scaffold checked and verified at: ${memoryDir}`);
}
