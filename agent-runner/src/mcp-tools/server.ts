/**
 * Zero-dependency MCP stdio server for VuaAssistant built-in tools.
 * It intentionally mirrors the subset of MCP used by the existing external
 * MCP client so the runner can expose the same tool contract without an SDK.
 */
import readline from 'readline';
import { CORE_TOOLS } from './core.js';

interface JsonRpcRequest { jsonrpc?: string; id?: number | string; method?: string; params?: Record<string, unknown>; }

function reply(id: number | string | undefined, result?: unknown, error?: { code: number; message: string }): void {
  if (id === undefined) return;
  process.stdout.write(`${JSON.stringify(error ? { jsonrpc: '2.0', id, error } : { jsonrpc: '2.0', id, result })}\n`);
}

export function startBuiltinMcpServer(): void {
  const input = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
  input.on('line', async (line) => {
    let request: JsonRpcRequest;
    try { request = JSON.parse(line) as JsonRpcRequest; } catch { return; }
    try {
      if (request.method === 'initialize') {
        reply(request.id, { protocolVersion: '2024-11-05', capabilities: { tools: {} }, serverInfo: { name: 'vuaassistant', version: '0.1.0' } });
      } else if (request.method === 'tools/list') {
        reply(request.id, { tools: CORE_TOOLS.map((tool) => tool.definition) });
      } else if (request.method === 'tools/call') {
        const name = String(request.params?.name || '');
        const args = (request.params?.arguments || {}) as Record<string, unknown>;
        const tool = CORE_TOOLS.find((candidate) => candidate.definition.name === name);
        if (!tool) {
          reply(request.id, { content: [{ type: 'text', text: `Unknown built-in MCP tool: ${name}` }], isError: true });
        } else {
          const result = await tool.execute(args);
          reply(request.id, { content: [{ type: 'text', text: result }] });
        }
      } else if (request.id !== undefined) {
        reply(request.id, undefined, { code: -32601, message: `Method not found: ${request.method || ''}` });
      }
    } catch (error) {
      reply(request.id, undefined, { code: -32000, message: error instanceof Error ? error.message : String(error) });
    }
  });
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1])) startBuiltinMcpServer();
