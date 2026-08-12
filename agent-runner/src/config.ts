/**
 * Runner config — reads runner.json at startup.
 *
 * Config file location: VUA_DATA_DIR/runner.json
 * Falls back to sensible defaults for any missing field.
 *
 * @ref NanoClaw/container/agent-runner/src/config.ts
 */
import fs from 'fs';
import path from 'path';

// Thư mục dữ liệu mặc định phải khớp với vỏ desktop (~/vuaai-data). Lệch tên
// khiến runner đọc/ghi ở nơi không ai nhìn tới khi VUA_DATA_DIR chưa được set.
const DATA_DIR = process.env.VUA_DATA_DIR || path.join(process.env.HOME || '/tmp', 'vuaai-data');
const CONFIG_PATH = process.env.CONFIG_PATH || path.join(DATA_DIR, 'runner.json');

export interface RunnerConfig {
  /** Provider id. `ai-router` is the normal production route for all vendors. */
  provider: string;
  /** Display name for the assistant */
  assistantName: string;
  /** Current agent/role name */
  agentName: string;
  /** Max messages per prompt batch */
  maxMessagesPerPrompt: number;
  /** External MCP servers config */
  mcpServers: Record<string, { command: string; args: string[]; env: Record<string, string> }>;
  /** Model ID or alias */
  model?: string;
  /** Base URL override for the provider */
  baseUrl?: string;
  /** Data directory */
  dataDir: string;
  /** IPC directory */
  ipcDir: string;
}

const DEFAULT_MAX_MESSAGES = 10;

let _config: RunnerConfig | null = null;

/**
 * Load config from runner.json. Called once at startup.
 * Falls back to sensible defaults for any missing field.
 */
export function loadConfig(): RunnerConfig {
  if (_config) return _config;

  let raw: Record<string, unknown> = {};
  try {
    if (fs.existsSync(CONFIG_PATH)) {
      raw = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
    }
  } catch {
    console.error(`[config] Failed to read ${CONFIG_PATH}, using defaults`);
  }

  _config = {
    provider: (raw.provider as string) || process.env.VUA_PROVIDER || 'ai-router',
    assistantName: (raw.assistantName as string) || process.env.VUA_ASSISTANT_NAME || 'VuaAssistant',
    agentName: (raw.agentName as string) || process.env.VUA_AGENT_NAME || 'default',
    maxMessagesPerPrompt: (raw.maxMessagesPerPrompt as number) || DEFAULT_MAX_MESSAGES,
    mcpServers: (raw.mcpServers as RunnerConfig['mcpServers']) || {},
    model: (raw.model as string) || process.env.VUA_MODEL || 'auto',
    baseUrl: (raw.baseUrl as string) || process.env.VUA_BASE_URL || 'http://127.0.0.1:36360/v1',
    dataDir: DATA_DIR,
    ipcDir: process.env.VUA_IPC_DIR || path.join(DATA_DIR, 'ipc'),
  };

  return _config;
}

/** Get the loaded config. Throws if loadConfig() hasn't been called. */
export function getConfig(): RunnerConfig {
  if (!_config) throw new Error('Config not loaded — call loadConfig() first');
  return _config;
}

/** Reset config (for testing). */
export function resetConfig(): void {
  _config = null;
}
