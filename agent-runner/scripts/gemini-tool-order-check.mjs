// Regression check for Gemini's tool-turn rule:
// user → assistant(functionCall) → tool(functionResponse) → model.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'vua-gemini-tool-order-'));
process.env.VUA_DATA_DIR = root;
process.env.VUA_IPC_DIR = path.join(root, 'ipc');
process.env.VUA_AGENT_WORKSPACE = path.join(root, 'workspace');
fs.mkdirSync(process.env.VUA_AGENT_WORKSPACE, { recursive: true });
fs.writeFileSync(path.join(process.env.VUA_AGENT_WORKSPACE, 'note.txt'), 'ready');

const { executeAgentLoop } = await import('../src/poll-loop.ts');
const seen = [];
let queryCount = 0;
const provider = {
  name: 'mock',
  query(input) {
    seen.push(input.messages.map((message) => ({
      role: message.role,
      toolCalls: message.tool_calls?.length ?? 0,
      toolCallId: message.tool_call_id,
    })));
    queryCount += 1;
    async function* events() {
      if (queryCount === 1) {
        yield { type: 'tool_call', toolCall: { id: 'call_glob', name: 'glob', arguments: { pattern: '**/*' } } };
        yield { type: 'result', text: null };
      } else {
        yield { type: 'result', text: 'Đã đọc workspace.' };
      }
    }
    return { push() {}, end() {}, abort() {}, events: events() };
  },
  isSessionInvalid() { return false; },
};

try {
const kernelTools = (await (await import('../src/kernel/compose.ts')).composeRunner()).root.tools;
  const result = await executeAgentLoop(
    { provider, providerName: 'mock', systemContext: { instructions: 'test' }, tools: kernelTools },
    'Hãy kiểm tra workspace',
    undefined,
    { platformId: 'desktop', channelType: 'chat', threadId: 'test' },
  );
  assert.equal(result.text, 'Đã đọc workspace.');
  assert.deepEqual(seen[0], [{ role: 'user', toolCalls: 0, toolCallId: undefined }]);
  assert.deepEqual(seen[1], [
    { role: 'user', toolCalls: 0, toolCallId: undefined },
    { role: 'assistant', toolCalls: 1, toolCallId: undefined },
    { role: 'tool', toolCalls: 0, toolCallId: 'call_glob' },
  ]);
  console.log('gemini tool ordering check passed');
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}
