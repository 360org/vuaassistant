/**
 * OpenAI-compatible provider adapter.
 *
 * Works with: ChatGPT, OpenRouter, LocalAI, Ollama, AI Router, and any
 * OpenAI-compatible endpoint.
 *
 * Uses direct HTTP API calls — NO SDK dependency.
 * Supports streaming (SSE) and tool calling.
 */
import { registerProvider } from '../provider-registry.js';
import type {
  AgentProvider,
  AgentQuery,
  ProviderEvent,
  ProviderOptions,
  QueryInput,
  ToolDefinition,
  ChatMessage,
} from '../types.js';

function log(msg: string): void {
  console.error(`[provider/openai] ${msg}`);
}

const MAX_RETRIES = 2;
const DEFAULT_RETRY_DELAY_MS = 500;

function retryAfterMs(response: Response, attempt: number): number {
  const retryAfter = response.headers.get('retry-after');
  if (retryAfter) {
    const seconds = Number(retryAfter);
    if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1000;

    const retryAt = Date.parse(retryAfter);
    if (!Number.isNaN(retryAt)) return Math.max(0, retryAt - Date.now());
  }
  return DEFAULT_RETRY_DELAY_MS * 2 ** attempt;
}

async function fetchWithRetry(url: string, init: RequestInit): Promise<Response> {
  for (let attempt = 0; ; attempt++) {
    try {
      const response = await fetch(url, init);
      const retryable = response.status === 429 || response.status === 529;
      if (!retryable || attempt === MAX_RETRIES) return response;

      await new Promise<void>((resolve) => setTimeout(resolve, retryAfterMs(response, attempt)));
    } catch (e) {
      if (attempt === MAX_RETRIES) throw e;
      const delay = DEFAULT_RETRY_DELAY_MS * 2 ** attempt;
      await new Promise<void>((resolve) => setTimeout(resolve, delay));
    }
  }
}

interface OpenAIStreamChoice {
  delta?: {
    content?: string;
    role?: string;
    tool_calls?: Array<{
      index: number;
      id?: string;
      function?: { name?: string; arguments?: string };
    }>;
  };
  finish_reason?: string;
}

interface OpenAIStreamChunk {
  id: string;
  choices: OpenAIStreamChoice[];
}

interface OpenAINonStreamResponse {
  id: string;
  choices: Array<{
    message: {
      content: string | null;
      role: string;
      tool_calls?: Array<{
        id: string;
        function: { name: string; arguments: string };
      }>;
    };
    finish_reason: string;
  }>;
}

/**
 * The Runner keeps tool calls in its provider-neutral shape. AI Router's
 * OpenAI-compatible endpoint, and upstream OpenAI-compatible APIs, require
 * the wire-format function envelope when that history is sent back.
 */
function toOpenAIMessage(message: ChatMessage): Record<string, unknown> {
  const { tool_calls: toolCalls, name: _name, ...rest } = message;

  if (message.role === 'assistant' && toolCalls?.length) {
    return {
      ...rest,
      tool_calls: toolCalls.map((call) => ({
        id: call.id,
        type: 'function',
        function: {
          name: call.name,
          arguments: JSON.stringify(call.arguments ?? {}),
        },
      })),
    };
  }

  // OpenAI tool-result messages are paired through tool_call_id. The internal
  // tool name is intentionally omitted from the wire payload.
  return rest;
}

export function createOpenAIProvider(options: ProviderOptions): AgentProvider {
  const apiKey = options.apiKey || '';
  const baseUrl = (options.baseUrl || 'https://api.openai.com/v1').replace(/\/+$/, '');
  const model = options.model || 'gpt-4o';

  return {
    name: 'openai',
    usesMemoryScaffold: true,

    query(input: QueryInput): AgentQuery {
      let aborted = false;
      const abortController = new AbortController();

      const messages: Array<Record<string, unknown>> = [];

      // System message
      if (input.systemContext?.instructions) {
        messages.push({ role: 'system', content: input.systemContext.instructions });
      }

      // Conversation history
      if (input.messages) {
        for (const msg of input.messages) {
          messages.push(toOpenAIMessage(msg));
        }
      }

      // Current user prompt
      if (input.prompt) {
        messages.push({ role: 'user', content: input.prompt });
      }

      // Build request body
      const body: Record<string, unknown> = {
        model,
        messages,
        stream: true,
      };

      // Add tools if provided
      if (input.tools && input.tools.length > 0) {
        body.tools = input.tools.map((t: ToolDefinition) => ({
          type: 'function',
          function: {
            name: t.name,
            description: t.description,
            parameters: t.input_schema,
          },
        }));
      }

      async function* streamEvents(): AsyncIterable<ProviderEvent> {
        yield { type: 'init', continuation: '' };

        try {
          const response = await fetchWithRetry(`${baseUrl}/chat/completions`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${apiKey}`,
            },
            body: JSON.stringify(body),
            signal: abortController.signal,
          });

          if (!response.ok) {
            const errText = await response.text();
            const retryable = response.status === 429 || response.status >= 500;
            yield { type: 'error', message: `OpenAI API error ${response.status}: ${errText}`, retryable };
            return;
          }

          if (!response.body) {
            yield { type: 'error', message: 'No response body', retryable: false };
            return;
          }

          const reader = response.body.getReader();
          const decoder = new TextDecoder();
          let buffer = '';
          let fullText = '';
          const pendingToolCalls = new Map<number, { id: string; name: string; args: string }>();

          while (!aborted) {
            const { done, value } = await reader.read();
            if (done) break;

            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split('\n');
            buffer = lines.pop() || '';

            for (const line of lines) {
              const trimmed = line.trim();
              if (!trimmed || !trimmed.startsWith('data: ')) continue;
              const data = trimmed.slice(6);
              if (data === '[DONE]') continue;

              try {
                const chunk = JSON.parse(data) as OpenAIStreamChunk;
                const choice = chunk.choices?.[0];
                if (!choice) continue;

                yield { type: 'activity' };

                // Text content
                if (choice.delta?.content) {
                  fullText += choice.delta.content;
                  yield { type: 'text_delta', text: choice.delta.content };
                }

                // Tool calls (streamed incrementally)
                if (choice.delta?.tool_calls) {
                  for (const tc of choice.delta.tool_calls) {
                    if (!pendingToolCalls.has(tc.index)) {
                      pendingToolCalls.set(tc.index, { id: tc.id || '', name: '', args: '' });
                    }
                    const pending = pendingToolCalls.get(tc.index)!;
                    if (tc.id) pending.id = tc.id;
                    if (tc.function?.name) pending.name += tc.function.name;
                    if (tc.function?.arguments) pending.args += tc.function.arguments;
                  }
                }

                // Emit completed tool calls at finish
                if (choice.finish_reason === 'tool_calls' || choice.finish_reason === 'stop') {
                  for (const [, tc] of pendingToolCalls) {
                    try {
                      const args = tc.args ? JSON.parse(tc.args) : {};
                      yield {
                        type: 'tool_call',
                        toolCall: { id: tc.id, name: tc.name, arguments: args },
                      };
                    } catch {
                      log(`Failed to parse tool call args: ${tc.args}`);
                    }
                  }
                  pendingToolCalls.clear();
                }
              } catch {
                // Skip malformed JSON lines
              }
            }
          }

          yield { type: 'result', text: fullText || null };
        } catch (err) {
          if (aborted) return;
          const message = err instanceof Error ? err.message : String(err);
          yield { type: 'error', message, retryable: true };
        }
      }

      return {
        push(_message: string) {
          // For multi-turn, push would append to messages; simplified here
        },
        end() {
          // No-op for streaming
        },
        events: streamEvents(),
        abort() {
          aborted = true;
          abortController.abort();
        },
      };
    },

    isSessionInvalid(_err: unknown): boolean {
      return false; // OpenAI API is stateless
    },
  };
}

// Self-register for all OpenAI-compatible providers
registerProvider('openai', (options) => {
  const provider = createOpenAIProvider({
    ...options,
    model: options.model || 'gpt-4o',
  });
  return { ...provider, name: 'openai' };
});
registerProvider('chatgpt', (options) => {
  const provider = createOpenAIProvider({
    ...options,
    model: options.model || 'gpt-4o-mini',
  });
  return { ...provider, name: 'chatgpt' };
});
registerProvider('openrouter', (options) => {
  const provider = createOpenAIProvider({
    ...options,
    baseUrl: options.baseUrl || 'https://openrouter.ai/api/v1',
    model: options.model || 'openrouter/auto',
  });
  return { ...provider, name: 'openrouter' };
});
registerProvider('local', (options) => {
  const provider = createOpenAIProvider({
    ...options,
    baseUrl: options.baseUrl || 'http://localhost:11434/v1',
    apiKey: options.apiKey || 'ollama',
    model: options.model || 'llama3.2',
  });
  return { ...provider, name: 'local' };
});
/**
 * AI Router is VuaAssistant's local, OpenAI-compatible gateway. It owns
 * provider routing; the Runner never needs a vendor-specific adapter.
 */
registerProvider('ai-router', (options) => {
  const provider = createOpenAIProvider({
    ...options,
    baseUrl: options.baseUrl || 'http://127.0.0.1:36360/v1',
    model: options.model || 'auto',
  });
  return { ...provider, name: 'ai-router' };
});

// Kept only so existing runner.json files made before the rename still boot.
registerProvider('9router', (options) => {
  const provider = createOpenAIProvider({
    ...options,
    baseUrl: options.baseUrl || 'http://127.0.0.1:36360/v1',
    model: options.model || 'auto',
  });
  return { ...provider, name: 'ai-router' };
});
