/**
 * Main Poll Loop — the heart of the Universal Agent Runner.
 *
 * 1. Poll messages_in for pending rows
 * 2. Format into prompt, call provider.query()
 * 3. Handle tool calls: execute tools, send results back to LLM
 * 4. On final result: write to messages_out
 * 5. Mark messages completed
 * 6. Loop
 *
 * @ref NanoClaw/container/agent-runner/src/poll-loop.ts
 */
import {
  getPendingMessages,
  markProcessing,
  markCompleted,
  writeMessageOut,
  touchHeartbeat,
  clearStaleProcessingAcks,
  getContinuation,
  setContinuation,
  clearContinuation,
  getTranscript,
  setTranscript,
  clearTranscript,
  sessionIdFor,
} from './db/index.js';
import {
  formatMessages,
  extractRouting,
  isClearCommand,
  type RoutingContext,
} from './formatter.js';
import { getToolDefinitions, executeTool, needsReadApproval } from './native-tools/index.js';
import { learnFromExchange } from './memory/self-improve.js';
import { retrieveKnowledge, formatExcerpts } from './knowledge/index.js';
import { mcpManager } from './mcp-client/index.js';
import {
  CAPABILITY_TOOL_DEFINITIONS,
  capabilityFromTool,
  searchCapabilities,
  sideEffectDenied,
  type Capability,
} from './capability-rail.js';
import { clearBuiltinToolContext, executeBuiltinTool, getBuiltinToolDefinitions, hasBuiltinTool, setBuiltinToolContext } from './mcp-tools/index.js';
import { DEFAULT_LIMITS, checkLoop, type Attempt, type GuardLimits } from './loop-guard.js';
import { estimateTokens, pruneHistory } from './context-prune.js';
import type { AgentProvider, ProviderEvent, ChatMessage, ToolCall, ToolResult } from './providers/types.js';

const POLL_INTERVAL_MS = 1000;
const ACTIVE_POLL_INTERVAL_MS = 500;
const MAX_TOOL_ITERATIONS = 25;

/** Ngưỡng phanh vòng lặp; xem `loop-guard.ts` cho lý do từng con số. */
const LOOP_LIMITS: GuardLimits = { ...DEFAULT_LIMITS, maxIterations: MAX_TOOL_ITERATIONS };

function log(msg: string): void {
  console.error(`[poll-loop] ${msg}`);
}

function generateId(): string {
  return `msg-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export interface PollLoopConfig {
  provider: AgentProvider;
  providerName: string;
  /** Stable agent identity used to isolate conversations. */
  agentId?: string;
  /** This role's own directory, holding its instructions, soul and memory. */
  agentDir?: string;
  systemContext: {
    instructions: string;
  };
  /** Optional stop signal for testing */
  signal?: AbortSignal;
}

/**
 * Main poll loop. Runs indefinitely until the process is killed or signal aborted.
 */
export async function runPollLoop(config: PollLoopConfig): Promise<void> {
  // Clear leftover 'processing' acks from a previous crashed run
  clearStaleProcessingAcks();

  let pollCount = 0;
  let isFirstPoll = true;

  while (true) {
    if (config.signal?.aborted) return;

    const messages = getPendingMessages(isFirstPoll).filter((m) => m.kind !== 'system');
    isFirstPoll = false;
    pollCount++;

    // Periodic heartbeat
    if (pollCount % 30 === 0) {
      touchHeartbeat();
      log(`Poll heartbeat (${pollCount} iterations, ${messages.length} pending)`);
    }

    if (messages.length === 0) {
      await sleep(POLL_INTERVAL_MS);
      continue;
    }

    // Accumulate gate: if all messages are trigger=0 (context-only), skip
    if (!messages.some((m) => m.trigger === 1)) {
      await sleep(POLL_INTERVAL_MS);
      continue;
    }

    const ids = messages.map((m) => m.id);
    markProcessing(ids);

    const routing = extractRouting(messages);
    const sessionId = sessionIdFor(config.agentId || 'default', routing);
    let continuation = getContinuation(sessionId, config.providerName);
    if (continuation) log(`Resuming session ${sessionId}`);

    // --- Handle /clear command ---
    const normalMessages = [];
    const commandIds: string[] = [];

    for (const msg of messages) {
      if (isClearCommand(msg)) {
        log('Clearing session (resetting continuation)');
        continuation = undefined;
        clearContinuation(sessionId, config.providerName);
        clearTranscript(sessionId);
        writeMessageOut({
          id: generateId(),
          kind: 'chat',
          platform_id: routing.platformId,
          channel_type: routing.channelType,
          thread_id: routing.threadId,
          content: JSON.stringify({ text: '✅ Session cleared.' }),
        });
        commandIds.push(msg.id);
        continue;
      }
      normalMessages.push(msg);
    }

    if (commandIds.length > 0) {
      markCompleted(commandIds);
    }

    if (normalMessages.length === 0) {
      const remainingIds = ids.filter((id) => !commandIds.includes(id));
      if (remainingIds.length > 0) markCompleted(remainingIds);
      log(`All ${messages.length} message(s) were commands, skipping query`);
      await sleep(ACTIVE_POLL_INTERVAL_MS);
      continue;
    }

    // --- Format prompt and query the provider ---
    const prompt = formatMessages(normalMessages);
    log(`Processing ${normalMessages.length} message(s), prompt: ${prompt.slice(0, 100)}...`);

    const requestedPath = prompt.match(/📁\s*([^\n]+)/)?.[1]?.trim();
    if (requestedPath) {
      const approvalPath = needsReadApproval(requestedPath);
      if (approvalPath) {
        writeMessageOut({
          id: generateId(),
          kind: 'chat',
          platform_id: routing.platformId,
          channel_type: routing.channelType,
          thread_id: routing.threadId,
          content: JSON.stringify({
            type: 'permission_request',
            permission: { tool: 'file_read', path: approvalPath, access: 'read' },
          }),
        });
        markCompleted(ids.filter((id) => !commandIds.includes(id)));
        await sleep(ACTIVE_POLL_INTERVAL_MS);
        continue;
      }
    }

    // Parse routing.platformId for skill instructions
    let activeSystemContext = config.systemContext;
    if (routing.platformId) {
      try {
        const meta = JSON.parse(routing.platformId);
        if (meta.skillName && meta.skillInstructions) {
          const customInstructions = `${config.systemContext.instructions || ''}\n\n=== Active Skill: ${meta.skillName} ===\n${meta.skillInstructions}`;
          activeSystemContext = { ...config.systemContext, instructions: customInstructions };
        }
      } catch {
        // Ignore parse errors
      }
    }

    try {
      const priorTranscript = getTranscript(sessionId);
      setBuiltinToolContext({ routing, inReplyTo: normalMessages[normalMessages.length - 1]?.id });
      let result: AgentLoopResult;
      try {
        result = await executeAgentLoop(config, prompt, continuation, routing, activeSystemContext, priorTranscript);
      } finally {
        clearBuiltinToolContext();
      }

      if (result.continuation) {
        continuation = result.continuation;
        setContinuation(sessionId, config.providerName, result.continuation);
      }

      if (result.text) {
        setTranscript(sessionId, [
          ...priorTranscript,
          { role: 'user', content: prompt },
          { role: 'assistant', content: result.text },
        ]);
      }

      // Write final response to outbound
      if (result.text) {
        writeMessageOut({
          id: generateId(),
          kind: 'chat',
          platform_id: routing.platformId,
          channel_type: routing.channelType,
          thread_id: routing.threadId,
          content: JSON.stringify({ text: result.text }),
        });
      }

      markCompleted(ids.filter((id) => !commandIds.includes(id)));

      // Reflect only after the answer has been delivered, so learning can never
      // delay or break a reply.
      if (config.agentDir && result.text) {
        void learnFromExchange(config, config.agentDir, { user: prompt, assistant: result.text });
      }

      // Notify exchange complete
      config.provider.onExchangeComplete?.({
        prompt,
        result: result.text,
        continuation: result.continuation,
        status: 'completed',
      });
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      log(`Query error: ${errMsg}`);

      // Check if continuation is invalid
      if (config.provider.isSessionInvalid(err)) {
        log('Session invalid, clearing continuation');
        continuation = undefined;
        clearContinuation(sessionId, config.providerName);
      }

      // Write error response
      writeMessageOut({
        id: generateId(),
        kind: 'chat',
        platform_id: routing.platformId,
        channel_type: routing.channelType,
        thread_id: routing.threadId,
        content: JSON.stringify({ text: `❌ Error: ${errMsg}` }),
      });

      markCompleted(ids.filter((id) => !commandIds.includes(id)));

      config.provider.onExchangeComplete?.({
        prompt,
        result: null,
        continuation,
        status: 'error',
      });
    }

    await sleep(ACTIVE_POLL_INTERVAL_MS);
  }
}

export interface AgentLoopResult {
  text: string | null;
  continuation?: string;
  /**
   * Token ƯỚC LƯỢNG đã gửi đi trong cả lượt.
   *
   * Cộng dồn theo từng vòng vì lịch sử được gửi lại mỗi vòng — đó chính là
   * chỗ chi phí phình ra. Nhà cung cấp không trả về usage trong luồng sự kiện
   * nên đây là con số duy nhất lấy được mà không gọi thêm API; dùng để chặn
   * chạy hoang, không phải để tính tiền.
   */
  tokensEstimate?: number;
}

/**
 * Execute the full agentic loop for a single query:
 * prompt → LLM → tool calls → LLM → tool calls → ... → final answer
 */
/**
 * Run one full agent turn: prompt → model → tools → … → answer.
 *
 * Exported so the scheduler can reuse the exact same agent machinery instead
 * of duplicating provider and tool plumbing. The scheduler cannot enqueue into
 * inbound.db (host-owned, opened read-only here), so it drives a turn directly
 * and writes the result to messages_out.
 */
export async function executeAgentLoop(
  config: PollLoopConfig,
  prompt: string,
  continuation: string | undefined,
  _routing: RoutingContext,
  systemContext: { instructions: string },
  priorTranscript: ChatMessage[] = [],
): Promise<AgentLoopResult> {
  // Keep the inbound turn in history before the first provider request. It used
  // to exist only as `currentPrompt`, so the second tool-loop request began
  // with an assistant function call followed by its tool result. Gemini rejects
  // that orphaned function-call turn: it must immediately follow a user turn or
  // another function response.
  const conversationHistory: ChatMessage[] = [...priorTranscript, { role: 'user', content: prompt }];
  let currentPrompt = '';
  let finalText: string | null = null;
  let sessionContinuation = continuation;

  // RAG: ground the answer in this role's own documents. Done here rather than
  // in the webview so chat, Telegram and scheduled tasks all get it — the
  // webview could only ever ground the turns it handled itself.
  let groundedContext = systemContext;
  try {
    const excerpts = retrieveKnowledge(config.agentId, prompt);
    if (excerpts.length > 0) {
      log(`Grounding on ${excerpts.length} excerpt(s) from the role's documents`);
      groundedContext = {
        ...systemContext,
        instructions: systemContext.instructions + formatExcerpts(excerpts),
      };
    }
  } catch (error) {
    log(`Knowledge lookup skipped: ${error instanceof Error ? error.message : String(error)}`);
  }

  // Sổ lần thử, nuôi phanh vòng lặp bên dưới. Giữ trong bộ nhớ theo từng lượt.
  const attempts: Attempt[] = [];
  let tokensEstimate = 0;

  for (let iteration = 0; iteration < MAX_TOOL_ITERATIONS; iteration++) {
    // Phanh chạy TRƯỚC mỗi vòng: trần số vòng không đủ để chặn cảnh agent gọi
    // một tool hỏng rồi lặp lại y hệt cho tới hết 25 vòng — người dùng trả tiền
    // 25 lượt gọi model để nhận về đúng một thông báo lỗi.
    const verdict = checkLoop(attempts, iteration, LOOP_LIMITS);
    if (verdict.action === 'stop') {
      log(`Dừng vòng lặp sớm (${verdict.reason}) sau ${attempts.length} lần gọi công cụ`);
      return { text: verdict.message, continuation: sessionContinuation, tokensEstimate };
    }

    const nativeTools = getToolDefinitions();
    const builtinTools = getBuiltinToolDefinitions();
    const mcpTools = await mcpManager.listAllTools();
    const capabilities: Capability[] = [
      ...nativeTools.map((tool) => capabilityFromTool(tool, 'native')),
      ...builtinTools.map((tool) => capabilityFromTool(tool, 'builtin')),
      ...mcpTools.map((tool) => capabilityFromTool(tool, 'mcp')),
    ];
    const allTools = [...CAPABILITY_TOOL_DEFINITIONS, ...nativeTools, ...builtinTools, ...mcpTools];

    // Lịch sử được gửi lại NGUYÊN VẸN ở mỗi vòng, nên chi phí tăng theo bình
    // phương số vòng nếu không cắt bớt. Cắt tỉa ngay trước khi gửi: bản đầy đủ
    // vẫn giữ trong `conversationHistory` cho transcript và cho các vòng sau.
    const outgoing = pruneHistory(conversationHistory);
    const before = estimateTokens(conversationHistory);
    const after = estimateTokens(outgoing);
    if (after < before) log(`Cắt tỉa ngữ cảnh: ~${before} → ~${after} token`);
    // Đếm đúng thứ THẬT SỰ gửi đi, sau khi đã cắt tỉa.
    tokensEstimate += after;

    const query = config.provider.query({
      prompt: currentPrompt,
      messages: outgoing,
      continuation: sessionContinuation,
      systemContext: groundedContext,
      tools: allTools.length > 0 ? allTools : undefined,
    });

    let resultText = '';
    const toolCalls: ToolCall[] = [];

    for await (const event of query.events) {
      switch (event.type) {
        case 'init':
          sessionContinuation = event.continuation;
          break;

        case 'text_delta':
          resultText += event.text;
          break;

        case 'tool_call':
          toolCalls.push(event.toolCall);
          break;

        case 'result':
          if (event.text) resultText = event.text;
          break;

        case 'error':
          throw new Error(event.message);

        case 'activity':
        case 'progress':
          // Liveness signals — touch heartbeat
          touchHeartbeat();
          break;
      }
    }

    // If no tool calls, this is the final answer
    if (toolCalls.length === 0) {
      finalText = resultText;
      break;
    }

    // Add assistant message with tool calls to history
    conversationHistory.push({
      role: 'assistant',
      content: resultText || '',
      tool_calls: toolCalls,
    });

    // Execute each tool and add results to history
    for (const tc of toolCalls) {
      log(`Tool call: ${tc.name}(${JSON.stringify(tc.arguments).slice(0, 200)})`);
      let result: ToolResult;
      
      const directCapability = capabilities.find((item) => item.name === tc.name);
      const directDenied = directCapability ? sideEffectDenied(directCapability, tc.arguments.approved) : null;
      if (tc.name === 'search_capabilities') {
        result = {
          tool_call_id: tc.id,
          content: searchCapabilities(
            capabilities,
            typeof tc.arguments.query === 'string' ? tc.arguments.query : '',
            Number(tc.arguments.limit ?? 8),
          ),
        };
      } else if (tc.name !== 'execute_capability' && directDenied) {
        result = directDenied;
      } else if (tc.name === 'execute_capability') {
        const capabilityName = typeof tc.arguments.name === 'string' ? tc.arguments.name : '';
        const capability = capabilities.find((item) => item.name === capabilityName);
        const capabilityArgs = tc.arguments.arguments && typeof tc.arguments.arguments === 'object'
          ? tc.arguments.arguments as Record<string, unknown>
          : {};
        const denied = capability ? sideEffectDenied(capability, tc.arguments.approved) : null;
        if (!capability) {
          result = { tool_call_id: tc.id, content: `Unknown capability: ${capabilityName}`, is_error: true };
        } else if (denied) {
          result = denied;
        } else if (capability.kind === 'builtin') {
          result = await executeBuiltinTool(capability.name, capabilityArgs);
        } else if (capability.kind === 'mcp') {
          result = await mcpManager.executeTool(capability.name, capabilityArgs) ?? {
            tool_call_id: tc.id,
            content: `Error: MCP tool "${capability.name}" failed to execute or server not found`,
            is_error: true,
          };
        } else {
          result = await executeTool(capability.name, capabilityArgs);
        }
      } else if (hasBuiltinTool(tc.name)) {
        result = await executeBuiltinTool(tc.name, tc.arguments);
      } else if (tc.name.includes('__')) {
        const mcpResult = await mcpManager.executeTool(tc.name, tc.arguments);
        if (mcpResult) {
          result = mcpResult;
        } else {
          result = {
            tool_call_id: tc.id,
            content: `Error: MCP tool "${tc.name}" failed to execute or server not found`,
            is_error: true,
          };
        }
      } else {
        result = await executeTool(tc.name, tc.arguments);
      }
      
      result.tool_call_id = tc.id;

      conversationHistory.push({
        role: 'tool',
        content: result.content,
        tool_call_id: tc.id,
        name: tc.name,
      });

      log(`Tool result (${tc.name}): ${result.content.slice(0, 200)}...`);

      // Ghi vào sổ để phanh vòng lặp có căn cứ ở vòng sau. `is_error` là tín
      // hiệu chính; một số tool báo hỏng ngay trong nội dung nên bắt thêm.
      const failed = result.is_error === true || /^error[: ]/i.test(result.content.trim());
      attempts.push({
        tool: tc.name,
        ok: !failed,
        error: failed ? result.content : undefined,
      });

      if (
        result.content.includes('PERMISSION_REQUEST:') ||
        result.content.includes('APPROVAL_REQUIRED:') ||
        result.content.startsWith('INTERACTIVE_QUESTION_PENDING:')
      ) {
        return { text: result.content, continuation: sessionContinuation, tokensEstimate };
      }
    }

    // Continue loop — LLM will see tool results and decide next action
    currentPrompt = ''; // No new user prompt, just tool results
  }

  return {
    text: finalText,
    continuation: sessionContinuation,
    tokensEstimate,
  };
}
