/**
 * Lightweight, zero-dependency MCP Client (Stdio Transport).
 *
 * Spawns MCP server processes, communicates via JSON-RPC 2.0 over stdin/stdout,
 * and exposes their tools to the Agent Runner.
 */
import { spawn, type ChildProcess } from 'child_process';
import readline from 'readline';
import type { ToolDefinition, ToolResult } from '../providers/types.js';

function log(msg: string): void {
  console.error(`[mcp-client] ${msg}`);
}

interface JsonRpcRequest {
  jsonrpc: '2.0';
  method: string;
  params: Record<string, unknown>;
  id?: number | string;
}

interface PendingRequest {
  resolve: (val: unknown) => void;
  reject: (err: Error) => void;
  timer: NodeJS.Timeout;
}

const MCP_PROTOCOL_VERSION = '2025-06-18';
const DEFAULT_REQUEST_TIMEOUT_MS = 30_000;

interface JsonRpcResponse {
  jsonrpc: '2.0';
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
  id?: number | string | null;
}

export class McpClientConnection {
  private proc: ChildProcess | null = null;
  private nextId = 1;
  private pendingRequests = new Map<number | string, PendingRequest>();
  private initialized = false;

  constructor(
    public readonly name: string,
    private readonly command: string,
    private readonly args: string[],
    private readonly env: Record<string, string> = {},
  ) {}

  /**
   * Start the MCP server process.
   */
  public async start(): Promise<void> {
    log(`Spawning MCP server "${this.name}": ${this.command} ${this.args.join(' ')}`);

    const childEnv = { ...process.env, ...this.env };
    // Gateway capabilities belong only to trusted Runner code. An external
    // MCP server must never inherit or override them.
    delete childEnv.VUA_CONNECTOR_GATEWAY_TOKEN;

    this.proc = spawn(this.command, this.args, {
      env: childEnv,
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    this.proc.stderr?.on('data', (data) => {
      // Forward stderr from the MCP server to stderr for debugging
      const lines = data.toString().trim().split('\n');
      for (const line of lines) {
        console.error(`[mcp-server:${this.name}] ${line}`);
      }
    });

    const rl = readline.createInterface({
      input: this.proc.stdout!,
      terminal: false,
    });

    rl.on('line', (line) => {
      this.handleMessage(line);
    });

    this.proc.on('close', (code) => {
      log(`MCP server "${this.name}" exited with code ${code}`);
      this.cleanup(new Error(`MCP server "${this.name}" exited with code ${code}`));
    });

    this.proc.on('error', (err) => {
      log(`MCP server "${this.name}" process error: ${err.message}`);
      this.cleanup(err);
    });

    // MCP requires initialize to be the first client/server interaction.
    // Source: https://modelcontextprotocol.io/specification/2025-06-18/basic/lifecycle#initialization
    const result = await this.sendRequest('initialize', {
      protocolVersion: MCP_PROTOCOL_VERSION,
      capabilities: {},
      clientInfo: { name: 'vuaassistant-agent-runner', version: '0.1.0' },
    }) as { protocolVersion?: string; capabilities?: Record<string, unknown> };

    if (!result.protocolVersion) {
      throw new Error(`MCP server "${this.name}" returned an invalid initialize result`);
    }

    this.sendNotification('notifications/initialized', {});
    this.initialized = true;
    log(`MCP server "${this.name}" initialized (${result.protocolVersion})`);
  }

  /**
   * Stop the MCP server process.
   */
  public stop(): void {
    if (this.proc) {
      log(`Stopping MCP server "${this.name}"`);
      this.proc.kill();
      this.cleanup(new Error('MCP server connection closed by client'));
    }
  }

  /**
   * List tools provided by this server.
   */
  public async listTools(): Promise<ToolDefinition[]> {
    if (!this.initialized) return [];
    try {
      const response = await this.sendRequest('tools/list', {}) as { tools: Array<{ name: string; description?: string; inputSchema?: Record<string, unknown> }> };
      return (response.tools || []).map((t) => ({
        name: `${this.name}__${t.name}`, // Namespace to prevent name collisions
        description: t.description || '',
        input_schema: (t.inputSchema as Record<string, unknown>) || { type: 'object', properties: {} },
      }));
    } catch (err) {
      log(`Failed to list tools from "${this.name}": ${err instanceof Error ? err.message : String(err)}`);
      return [];
    }
  }

  /**
   * Call a tool on this server.
   */
  public async callTool(originalName: string, args: Record<string, unknown>): Promise<ToolResult> {
    try {
      const response = await this.sendRequest('tools/call', {
        name: originalName,
        arguments: args,
      }) as { content: Array<{ type: string; text?: string; image?: string }>; isError?: boolean };

      const content = response.content
        .map((c) => c.text || JSON.stringify(c))
        .join('\n');

      return {
        tool_call_id: '',
        content,
        is_error: response.isError ?? false,
      };
    } catch (err) {
      return {
        tool_call_id: '',
        content: `Error calling MCP tool: ${err instanceof Error ? err.message : String(err)}`,
        is_error: true,
      };
    }
  }

  private sendRequest(
    method: string,
    params: Record<string, unknown>,
    timeoutMs = DEFAULT_REQUEST_TIMEOUT_MS,
  ): Promise<unknown> {
    if (!this.proc || this.proc.killed) {
      return Promise.reject(new Error(`MCP server "${this.name}" is not running`));
    }

    const id = this.nextId++;
    const request: JsonRpcRequest = {
      jsonrpc: '2.0',
      method,
      params,
      id,
    };

    return new Promise((resolve, reject) => {
      // MCP recommends bounded request timeouts to avoid hung connections.
      // Source: https://modelcontextprotocol.io/specification/2025-06-18/basic/lifecycle#timeouts
      const timer = setTimeout(() => {
        this.pendingRequests.delete(id);
        this.sendNotification('notifications/cancelled', {
          requestId: id,
          reason: `Request timed out after ${timeoutMs}ms`,
        });
        reject(new Error(`MCP request "${method}" timed out after ${timeoutMs}ms`));
      }, timeoutMs);
      this.pendingRequests.set(id, { resolve, reject, timer });
      this.proc!.stdin!.write(JSON.stringify(request) + '\n');
    });
  }

  private sendNotification(method: string, params: Record<string, unknown>): void {
    if (!this.proc || this.proc.killed || !this.proc.stdin?.writable) return;
    this.proc.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method, params })}\n`);
  }

  private handleMessage(line: string): void {
    try {
      const msg = JSON.parse(line) as JsonRpcResponse;
      if (msg.id !== undefined && msg.id !== null) {
        const pending = this.pendingRequests.get(msg.id);
        if (pending) {
          this.pendingRequests.delete(msg.id);
          clearTimeout(pending.timer);
          if (msg.error) {
            pending.reject(new Error(msg.error.message));
          } else {
            pending.resolve(msg.result);
          }
        }
      }
    } catch {
      // Log parsing errors
    }
  }

  private cleanup(err: Error): void {
    for (const [, pending] of this.pendingRequests) {
      clearTimeout(pending.timer);
      pending.reject(err);
    }
    this.pendingRequests.clear();
    this.initialized = false;
    this.proc = null;
  }
}

// --- MCP Manager ---

export class McpManager {
  private connections = new Map<string, McpClientConnection>();

  /**
   * Initialize connections to all configured external MCP servers.
   */
  public async init(servers: Record<string, { command: string; args: string[]; env: Record<string, string> }>): Promise<void> {
    const starts: Promise<void>[] = [];
    for (const [name, cfg] of Object.entries(servers)) {
      if (this.connections.has(name)) continue;

      const conn = new McpClientConnection(name, cfg.command, cfg.args, cfg.env);
      this.connections.set(name, conn);
      starts.push(conn.start().catch((err) => {
        this.connections.delete(name);
        conn.stop();
        throw err;
      }));
    }
    await Promise.all(starts);
  }

  /**
   * List tools from all active MCP connections.
   */
  public async listAllTools(): Promise<ToolDefinition[]> {
    const list: ToolDefinition[] = [];
    for (const conn of this.connections.values()) {
      const tools = await conn.listTools();
      list.push(...tools);
    }
    return list;
  }

  /**
   * Execute an MCP tool (format: server__tool).
   */
  public async executeTool(fullName: string, args: Record<string, unknown>): Promise<ToolResult | null> {
    const idx = fullName.indexOf('__');
    if (idx === -1) return null; // Not an MCP tool format

    const serverName = fullName.slice(0, idx);
    const toolName = fullName.slice(idx + 2);

    const conn = this.connections.get(serverName);
    if (!conn) {
      return {
        tool_call_id: '',
        content: `Error: MCP server "${serverName}" is not active or configured.`,
        is_error: true,
      };
    }

    return conn.callTool(toolName, args);
  }

  /**
   * Stop all active MCP connections on shutdown.
   */
  public shutdown(): void {
    for (const conn of this.connections.values()) {
      conn.stop();
    }
    this.connections.clear();
  }
}

/** Singleton instance */
export const mcpManager = new McpManager();
