/**
 * Real AI provider clients — streaming chat over each vendor's public API.
 *
 * All three protocols are browser-callable (CORS-enabled by the vendors):
 *  - OpenAI-compatible (OpenRouter, Local AI via Ollama/LM Studio, OpenAI)
 *  - Anthropic Messages API (with the direct-browser-access header)
 *  - Google Gemini streamGenerateContent
 *
 * Keys are held in app state only — never sent anywhere except the vendor.
 */

import type { ProviderId } from "@/lib/catalog";
import type { ChatMessage } from "./engine";
import type { AgentTool } from "./tools";
import { devUrl } from "./proxy";
import { vaultGet, vaultSet } from "./vault";

/** Safety bound on the tool-calling loop (tool → result → model → …). */
const MAX_TOOL_ROUNDS = 6;
const MAX_RATE_LIMIT_RETRIES = 2;
const DEFAULT_RETRY_DELAY_MS = 500;
const MAX_ANTIGRAVITY_MESSAGES = 48;
// OpenRouter's Auto router otherwise assumes the selected model's maximum
// completion budget (currently up to 65,535 tokens), which can exceed a
// connected account's remaining credits before a short chat even starts.
const MAX_OPENAI_COMPAT_OUTPUT_TOKENS = 4096;
const antigravitySessions = new Map<string, string>();

export interface ProviderConfig {
  apiKey?: string;
  /** OpenAI-compatible base URL — used by Local AI (Ollama, LM Studio). */
  baseUrl?: string;
  /** Model override; each provider has a sensible default. */
  model?: string;
  /**
   * The apiKey is a vendor subscription OAuth token (not a raw API key), so
   * inference must use `Authorization: Bearer` + the vendor's OAuth beta
   * header instead of the normal key header. Set by subscription sign-in.
   */
  oauth?: boolean;
  authMode?: "antigravity";
  projectId?: string;
  /** Gemini OAuth refresh token. Kept in the Vault, never persisted in app state. */
  refreshToken?: string;
  /** Access-token expiry timestamp (ms since epoch). */
  expiresAt?: number;
  /** Only successfully connected providers are offered in the chat picker. */
  connectionStatus?: "connected" | "expired";
  /** Route through AI Router. This intentionally has no vendor credential. */
  router?: boolean;
}

export type ProviderConfigs = Partial<Record<ProviderId, ProviderConfig>>;

/** Direct vendors are attempted in this order; OpenRouter is always last. */
export const RATE_LIMIT_FALLBACK_ORDER: readonly ProviderId[] = [
  "claude",
  "chatgpt",
  "gemini",
  "openrouter",
];

export class ProviderHttpError extends Error {
  constructor(
    readonly status: number,
    detail: string,
  ) {
    super(`Provider error (${status}): ${detail}`);
    this.name = "ProviderHttpError";
  }
}

export function isRateLimitError(error: unknown): boolean {
  if (error instanceof ProviderHttpError) {
    // Antigravity reports an exhausted model pool as 503. It is safe to
    // choose another configured vendor before any text has streamed.
    return [429, 500, 502, 503, 504, 529].includes(error.status);
  }
  const message = error instanceof Error ? error.message : String(error);
  return /(?:^|\D)(?:429|500|502|503|504|529)(?:\D|$)|no capacity/i.test(message);
}

export const DEFAULT_MODELS: Record<ProviderId, string> = {
  chatgpt: "gpt-4o-mini",
  claude: "claude-sonnet-5",
  gemini: "gemini-3.6-flash-high",
  "grok-cli": "grok-beta",
  openrouter: "openrouter/auto",
  local: "llama3.2",
};

/** The router all direct sign-ins go through (OpenRouter-style). */
export const ROUTER_BASE_URL = "https://openrouter.ai/api/v1";

/**
 * Model each "Login with …" maps to when signing in through the router —
 * so "Continue with ChatGPT" reaches GPT, "Continue with Claude" reaches
 * Claude, etc., all from one login and with no API key.
 */
export const ROUTED_MODELS: Record<ProviderId, string> = {
  chatgpt: "openai/gpt-4o-mini",
  claude: "anthropic/claude-sonnet-4-5",
  gemini: "google/gemini-flash-1.5",
  "grok-cli": "x-ai/grok-beta",
  openrouter: "openrouter/auto",
  local: "",
};

/** Build the provider config for a router sign-in (routes to the vendor). */
export function routedConfig(
  provider: ProviderId,
  apiKey: string,
): ProviderConfig {
  return {
    apiKey,
    baseUrl: provider === "openrouter" ? ROUTER_BASE_URL : undefined,
    model: ROUTED_MODELS[provider],
    connectionStatus: "connected",
  };
}

/**
 * Native model each vendor subscription sign-in talks to — a real vendor
 * model id (no "vendor/" prefix), so requests go straight to the vendor's
 * own API with the subscription OAuth token rather than through the router.
 */
export const SUBSCRIPTION_MODELS: Record<ProviderId, string> = {
  chatgpt: "gpt-4o",
  claude: "claude-sonnet-5",
  gemini: "gemini-3.6-flash-medium",
  "grok-cli": "grok-beta",
  openrouter: "openrouter/auto",
  local: "",
};

/**
 * Config for a "Continue with <vendor>" subscription sign-in.
 *  - OpenRouter → the router key (one login → every model).
 *  - Claude / Gemini → the vendor's own subscription OAuth token, used
 *    natively (Bearer + OAuth beta header) against the vendor API.
 *
 * No model is pinned here on purpose: a pinned id is persisted forever and goes
 * stale when the vendor retires it (that is how a saved `claude-sonnet-4-…`
 * kept producing 404s). The model is resolved per request from
 * SUBSCRIPTION_MODELS instead, so updating that map is enough. The user can
 * still override it under Advanced options.
 */
export function loginConfig(
  provider: ProviderId,
  apiKey: string,
  metadata: Pick<ProviderConfig, "projectId" | "refreshToken" | "expiresAt"> = {},
): ProviderConfig {
  if (provider === "openrouter") return routedConfig(provider, apiKey);
  if (provider === "gemini") {
    return {
      apiKey,
      oauth: true,
      authMode: "antigravity",
      model: SUBSCRIPTION_MODELS.gemini,
      connectionStatus: "connected",
      ...metadata,
    };
  }
  return { apiKey, oauth: true, connectionStatus: "connected" };
}

/** The model a config resolves to when the user has not overridden it. */
export function defaultModelFor(
  provider: ProviderId,
  config: ProviderConfig | undefined,
): string {
  if (config?.oauth) return SUBSCRIPTION_MODELS[provider] || DEFAULT_MODELS[provider];
  return DEFAULT_MODELS[provider];
}

/** Models offered in the chat picker, per provider. Local AI has no fixed
 *  catalogue — the user names the model their own server serves. */
export const MODELS: Record<ProviderId, { id: string; name: string }[]> = {
  claude: [
    { id: "claude-sonnet-5", name: "Claude Sonnet 5" },
    { id: "claude-opus-4-8", name: "Claude Opus 4.8" },
    { id: "claude-haiku-4-5-20251001", name: "Claude Haiku 4.5" },
  ],
  chatgpt: [
    { id: "gpt-4o", name: "GPT-4o" },
    { id: "gpt-4o-mini", name: "GPT-4o mini" },
  ],
  gemini: [
    { id: "gemini-3.6-flash-high", name: "Gemini 3.6 Flash (High)" },
    { id: "gemini-3.6-flash-medium", name: "Gemini 3.6 Flash (Medium)" },
    { id: "gemini-3.6-flash-low", name: "Gemini 3.6 Flash (Low)" },
    { id: "gemini-3-flash-agent", name: "Gemini 3.5 Flash (High)" },
    { id: "gemini-3.5-flash-low", name: "Gemini 3.5 Flash (Medium)" },
    { id: "gemini-3.5-flash-extra-low", name: "Gemini 3.5 Flash (Low)" },
    { id: "gemini-3.1-pro-low", name: "Gemini 3.1 Pro (Low)" },
    { id: "gemini-pro-agent", name: "Gemini 3.1 Pro (High)" },
    { id: "claude-sonnet-4-6", name: "Claude Sonnet 4.6 (Thinking)" },
    { id: "claude-opus-4-6-thinking", name: "Claude Opus 4.6 (Thinking)" },
    { id: "gpt-oss-120b-medium", name: "GPT-OSS 120B (Medium)" },
  ],
  "grok-cli": [
    { id: "grok-beta", name: "Grok Beta" },
    { id: "grok-2", name: "Grok 2" },
  ],
  openrouter: [
    { id: "openrouter/auto", name: "Auto (best available)" },
    { id: "anthropic/claude-sonnet-5", name: "Claude Sonnet 5" },
    { id: "openai/gpt-4o", name: "GPT-4o" },
    { id: "google/gemini-2.5-flash", name: "Gemini 2.5 Flash" },
  ],
  local: [],
};

/** True when the config is complete enough to make real calls. */
export function isConfigured(
  provider: ProviderId,
  config: ProviderConfig | undefined,
  hasSubscription: boolean = false,
): boolean {
  if (config?.connectionStatus === "expired") return false;
  if (config?.router) return Boolean(config.baseUrl);
  if (provider === "local") return Boolean(config?.baseUrl);
  if (hasSubscription) return true;
  return Boolean(config?.apiKey);
}

export async function* streamProvider(
  provider: ProviderId,
  config: ProviderConfig,
  system: string,
  messages: ChatMessage[],
  tools: AgentTool[] = [],
): AsyncGenerator<string> {
  const activeConfig = { ...config };

  // Fallback to global subscription if no specific API key is set for this provider
  if (provider !== "local" && !activeConfig.apiKey && !activeConfig.router) {
    const subKey = await vaultGet("provider:openrouter");
    if (subKey) {
      activeConfig.apiKey = subKey;
      activeConfig.baseUrl = ROUTER_BASE_URL;
      activeConfig.model = config.model || ROUTED_MODELS[provider];
    }
  }

  const model = activeConfig.model || defaultModelFor(provider, activeConfig);
  // A base URL means OpenAI-compatible transport: the router (direct
  // sign-in for any vendor) or a Local AI server. Native vendor APIs are
  // only used when a raw key is supplied without a base URL.
  if (activeConfig.baseUrl) {
    yield* streamOpenAICompat(
      devUrl(activeConfig.baseUrl.replace(/\/$/, "")),
      activeConfig.apiKey,
      model,
      system,
      messages,
      tools,
    );
    return;
  }
  switch (provider) {
    case "claude": {
      const refreshed = await refreshClaudeToken(activeConfig);
      yield* streamAnthropic(refreshed.apiKey!, model, system, messages, refreshed.oauth);
      return;
    }
    case "gemini":
      if (activeConfig.authMode === "antigravity") {
        yield* streamAntigravity(activeConfig, model, system, messages);
        return;
      }
      yield* streamGemini(activeConfig.apiKey!, model, system, messages, activeConfig.oauth);
      return;
    case "openrouter":
      yield* streamOpenAICompat(
        devUrl("https://openrouter.ai/api/v1"),
        activeConfig.apiKey,
        model,
        system,
        messages,
        tools,
      );
      return;
    case "chatgpt":
      yield* streamOpenAICompat(
        devUrl("https://api.openai.com/v1"),
        activeConfig.apiKey,
        model,
        system,
        messages,
        tools,
      );
      return;
    case "local":
      yield* streamOpenAICompat(
        activeConfig.baseUrl!.replace(/\/$/, ""),
        activeConfig.apiKey,
        model,
        system,
        messages,
        tools,
      );
      return;
  }
}

/**
 * Sends one turn through the selected provider, then switches only when that
 * provider is rate limited before it has produced any visible response.
 * Once fallback begins, an unavailable fallback account must not stop the
 * chain before the remaining configured vendors have been tried.
 */
export async function* streamProviderWithFallback(
  provider: ProviderId,
  configs: ProviderConfigs,
  system: string,
  messages: ChatMessage[],
  tools: AgentTool[] = [],
  options: { skipPrimary?: boolean } = {},
): AsyncGenerator<string> {
  const candidates = options.skipPrimary
    ? RATE_LIMIT_FALLBACK_ORDER.filter((candidate) => candidate !== provider)
    : [provider, ...RATE_LIMIT_FALLBACK_ORDER.filter((candidate) => candidate !== provider)];
  let firstRateLimitError: unknown;
  let lastFallbackError: unknown;
  let fallbackActive = options.skipPrimary;

  for (const candidate of candidates) {
    if (candidate === "local") continue;
    const savedKey = configs[candidate]?.apiKey
      ? undefined
      : await vaultGet(`provider:${candidate}`);
    const config = savedKey
      ? { ...configs[candidate], apiKey: savedKey }
      : configs[candidate];
    const hasGlobalOpenRouterKey =
      candidate === "openrouter" && Boolean(await vaultGet("provider:openrouter"));
    if (!config?.apiKey && !hasGlobalOpenRouterKey) continue;

    let emitted = false;
    try {
      for await (const chunk of streamProvider(candidate, config ?? {}, system, messages, tools)) {
        emitted = true;
        yield chunk;
      }
      return;
    } catch (error) {
      // Do not splice replies from two vendors, or retry after a tool might
      // already have run. A 429/capacity error before output is safe to reroute.
      if (emitted) throw error;
      if (isRateLimitError(error)) {
        firstRateLimitError ??= error;
        fallbackActive = true;
        continue;
      }
      // A fallback credential may be expired, or an individual router policy
      // may reject it. The original selected vendor was already unavailable,
      // so continue rather than leaving later configured vendors untried.
      if (fallbackActive) {
        lastFallbackError = error;
        continue;
      }
      throw error;
    }
  }

  throw lastFallbackError ?? firstRateLimitError ?? new Error("No configured provider is available for this request.");
}

/** Reads an SSE response body and yields each `data:` payload. */
async function* sseData(response: Response): AsyncGenerator<string> {
  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      const data = line.startsWith("data:") ? line.slice(5).trim() : null;
      if (data && data !== "[DONE]") yield data;
    }
  }
}

async function raiseForStatus(response: Response): Promise<void> {
  if (response.ok) return;
  let detail = "";
  try {
    const body = await response.json();
    detail = body?.error?.message ?? JSON.stringify(body);
  } catch {
    detail = response.statusText;
  }
  if (
    response.status === 404 &&
    /no endpoints available matching your guardrail restrictions and data policy/i.test(detail)
  ) {
    detail =
      "OpenRouter is connected, but its Privacy policy currently blocks every eligible model. " +
      "Allow at least one endpoint at https://openrouter.ai/settings/privacy, then retry.";
  }
  throw new ProviderHttpError(response.status, detail);
}

function retryAfterMs(response: Response, attempt: number): number {
  const retryAfter = response.headers.get("retry-after");
  if (retryAfter) {
    const seconds = Number(retryAfter);
    if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1000;

    const retryAt = Date.parse(retryAfter);
    if (!Number.isNaN(retryAt)) return Math.max(0, retryAt - Date.now());
  }
  return DEFAULT_RETRY_DELAY_MS * 2 ** attempt;
}

async function fetchWithRateLimitRetry(
  url: string,
  init: RequestInit,
): Promise<Response> {
  for (let attempt = 0; ; attempt++) {
    try {
      const response = await fetch(url, init);
      const retryable = [429, 500, 502, 503, 504, 529].includes(response.status);
      if (!retryable || attempt === MAX_RATE_LIMIT_RETRIES) return response;

      await new Promise<void>((resolve) => setTimeout(resolve, retryAfterMs(response, attempt)));
    } catch (e) {
      if (attempt === MAX_RATE_LIMIT_RETRIES) throw e;
      const delay = DEFAULT_RETRY_DELAY_MS * 2 ** attempt;
      await new Promise<void>((resolve) => setTimeout(resolve, delay));
    }
  }
}

function parseImageDataUrl(dataUrl?: string): { mimeType: string; base64: string } | null {
  if (!dataUrl || !dataUrl.startsWith("data:")) return null;
  const match = /^data:(image\/[a-zA-Z0-9+.-]+);base64,(.+)$/.exec(dataUrl);
  if (!match) return null;
  return { mimeType: match[1], base64: match[2] };
}

/**
 * Provider APIs reject blank turns and some require strictly alternating roles.
 * Keep the newest context bounded, remove interrupted empty replies, and merge
 * repeated roles before any vendor-specific serialization.
 */
function compactHistory(messages: ChatMessage[], limit = 60) {
  const compact: {
    role: "user" | "assistant";
    content: string;
    attachments?: ChatMessage["attachments"];
  }[] = [];
  for (const message of messages.slice(-limit)) {
    const content = typeof message.content === "string" ? message.content.trim() : "";
    const hasAttachments = message.attachments && message.attachments.some((att) => !!parseImageDataUrl(att.dataUrl));
    if (!content && !hasAttachments) continue;
    const previous = compact[compact.length - 1];
    if (previous?.role === message.role) {
      previous.content += content ? `\n\n${content}` : "";
      if (message.attachments) {
        previous.attachments = [...(previous.attachments ?? []), ...message.attachments];
      }
    } else {
      compact.push({
        role: message.role,
        content: content || " ",
        ...(message.attachments ? { attachments: message.attachments } : {}),
      });
    }
  }
  return compact;
}

/** One accumulated tool call as it streams in fragments. */
interface PendingToolCall {
  id: string;
  name: string;
  args: string;
}

/**
 * OpenAI-compatible chat with an in-app tool-calling loop.
 *
 * Text deltas stream to the user as they arrive. When the model asks to call
 * a tool, the fragments are accumulated, the tool runs locally (Vault, HTTP
 * action), its result is fed back, and the model continues — until it
 * produces a final answer with no more tool calls. With no tools this is a
 * plain streaming chat, identical to before.
 */
async function* streamOpenAICompat(
  baseUrl: string,
  apiKey: string | undefined,
  model: string,
  system: string,
  messages: ChatMessage[],
  tools: AgentTool[] = [],
  extraHeaders?: Record<string, string>,
): AsyncGenerator<string> {
  const convo: Record<string, unknown>[] = [
    { role: "system", content: system },
    ...compactHistory(messages).map((m) => {
      const images = (m.attachments ?? [])
        .map((att) => att.dataUrl)
        .filter((url): url is string => !!url && url.startsWith("data:image/"));
      if (images.length === 0) {
        return { role: m.role, content: m.content };
      }
      return {
        role: m.role,
        content: [
          ...(m.content ? [{ type: "text", text: m.content }] : []),
          ...images.map((url) => ({ type: "image_url", image_url: { url } })),
        ],
      };
    }),
  ];

  for (let round = 0; round <= MAX_TOOL_ROUNDS; round++) {
    const response = await fetchWithRateLimitRetry(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
        ...extraHeaders,
      },
      body: JSON.stringify({
        model,
        max_tokens: MAX_OPENAI_COMPAT_OUTPUT_TOKENS,
        stream: true,
        messages: convo,
        ...(tools.length ? { tools: tools.map((t) => t.schema) } : {}),
      }),
    });
    await raiseForStatus(response);

    let text = "";
    const pending = new Map<number, PendingToolCall>();
    for await (const data of sseData(response)) {
      let delta: {
        content?: string;
        tool_calls?: {
          index?: number;
          id?: string;
          function?: { name?: string; arguments?: string };
        }[];
      };
      try {
        delta = JSON.parse(data).choices?.[0]?.delta ?? {};
      } catch {
        continue; // keep-alive frame
      }
      if (delta.content) {
        text += delta.content;
        yield delta.content;
      }
      for (const tc of delta.tool_calls ?? []) {
        const idx = tc.index ?? 0;
        const slot = pending.get(idx) ?? { id: "", name: "", args: "" };
        if (tc.id) slot.id = tc.id;
        if (tc.function?.name) slot.name += tc.function.name;
        if (tc.function?.arguments) slot.args += tc.function.arguments;
        pending.set(idx, slot);
      }
    }

    // No tool calls → the streamed text is the final answer.
    if (pending.size === 0) return;

    // On the last allowed round, stop looping to avoid runaway tool use.
    if (round === MAX_TOOL_ROUNDS) return;

    const calls = [...pending.values()];
    convo.push({
      role: "assistant",
      content: text || null,
      tool_calls: calls.map((c, i) => ({
        id: c.id || `call_${round}_${i}`,
        type: "function",
        function: { name: c.name, arguments: c.args || "{}" },
      })),
    });
    for (const [i, call] of calls.entries()) {
      const tool = tools.find((t) => t.schema.function.name === call.name);
      let result: string;
      if (!tool) {
        result = `Error: unknown tool "${call.name}".`;
      } else {
        try {
          result = await tool.run(JSON.parse(call.args || "{}"));
        } catch (e) {
          result = `Error: ${e instanceof Error ? e.message : e}`;
        }
      }
      convo.push({
        role: "tool",
        tool_call_id: call.id || `call_${round}_${i}`,
        content: result,
      });
    }
  }
}

async function* streamAnthropic(
  apiKey: string,
  model: string,
  system: string,
  messages: ChatMessage[],
  oauth = false,
): AsyncGenerator<string> {
  // Subscription OAuth token → Bearer + OAuth beta header; raw key → x-api-key.
  // The config flag is authoritative; the prefix check is a fallback for keys
  // rehydrated without the flag.
  // ponytail: header shape follows Anthropic's OAuth flow, but a Claude
  // subscription token is minted for Claude Code and the API may reject a
  // foreign system prompt — needs a live smoke test with a real token.
  const isOAuth = oauth || apiKey.startsWith("sk-ant-oat");
  const url = devUrl("https://api.anthropic.com/v1/messages");
  // A relative URL means devUrl rewrote it onto the dev proxy, so the request
  // leaves from the server, not the browser. Only announce direct browser
  // access when we really are the browser: the header makes Anthropic enforce
  // the org's CORS setting, and orgs with CORS disabled answer 401
  // ("CORS requests are not allowed for this Organization").
  const throughProxy = !url.startsWith("http");
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "anthropic-version": "2023-06-01",
    ...(throughProxy
      ? {}
      : { "anthropic-dangerous-direct-browser-access": "true" }),
  };
  if (isOAuth) {
    headers["Authorization"] = `Bearer ${apiKey}`;
    headers["anthropic-beta"] = "oauth-2025-04-20";
  } else {
    headers["x-api-key"] = apiKey;
  }

  const response = await fetchWithRateLimitRetry(url, {
    method: "POST",
    headers,
    body: JSON.stringify({
      model,
      max_tokens: 4096,
      stream: true,
      system,
      messages: compactHistory(messages).map((m) => {
        const images = (m.attachments ?? [])
          .map((att) => parseImageDataUrl(att.dataUrl))
          .filter((img): img is { mimeType: string; base64: string } => img !== null);
        if (images.length === 0) {
          return { role: m.role, content: m.content };
        }
        return {
          role: m.role,
          content: [
            ...(m.content ? [{ type: "text", text: m.content }] : []),
            ...images.map((img) => ({
              type: "image",
              source: {
                type: "base64",
                media_type: img.mimeType,
                data: img.base64,
              },
            })),
          ],
        };
      }),
    }),
  });
  await raiseForStatus(response);
  for await (const data of sseData(response)) {
    try {
      const event = JSON.parse(data);
      if (event.type === "content_block_delta" && event.delta?.text) {
        yield event.delta.text;
      }
    } catch {
      /* ignore */
    }
  }
}

async function* streamGemini(
  apiKey: string,
  model: string,
  system: string,
  messages: ChatMessage[],
  oauth = false,
): AsyncGenerator<string> {
  const url = devUrl(
    `https://generativelanguage.googleapis.com/v1beta/models/` +
    `${model}:streamGenerateContent?alt=sse`,
  );
  // Gemini Developer API uses an API key. Subscription OAuth needs an OAuth
  // client registered to VuaAssistant's own Google Cloud project, which this
  // app does not ship yet.
  const isOAuth = oauth || apiKey.startsWith("ya29.");
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (isOAuth) {
    headers["Authorization"] = `Bearer ${apiKey}`;
  } else {
    headers["x-goog-api-key"] = apiKey;
  }

  const response = await fetchWithRateLimitRetry(url, {
    method: "POST",
    headers,
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: system }] },
      contents: compactHistory(messages).map((m) => {
        const images = (m.attachments ?? [])
          .map((att) => parseImageDataUrl(att.dataUrl))
          .filter((img): img is { mimeType: string; base64: string } => img !== null);
        const parts: any[] = [{ text: m.content || " " }];
        for (const img of images) {
          parts.push({ inlineData: { mimeType: img.mimeType, data: img.base64 } });
        }
        return {
          role: m.role === "assistant" ? "model" : "user",
          parts,
        };
      }),
    }),
  });
  try {
    await raiseForStatus(response);
  } catch (error) {
    if (
      error instanceof ProviderHttpError &&
      error.status === 403 &&
      /insufficient authentication scopes/i.test(error.message)
    ) {
      throw new ProviderHttpError(403, "Gemini OAuth is unsupported here. Reconnect Gemini with an API key from Google AI Studio.");
    }
    throw error;
  }
  for await (const data of sseData(response)) {
    try {
      const text =
        JSON.parse(data).candidates?.[0]?.content?.parts?.[0]?.text;
      if (text) yield text;
    } catch {
      /* ignore */
    }
  }
}

async function* streamAntigravity(
  config: ProviderConfig,
  model: string,
  system: string,
  messages: ChatMessage[],
): AsyncGenerator<string> {
  if (!config.projectId) throw new Error("Gemini subscription setup is incomplete. Reconnect Gemini to finish Antigravity setup.");
  const url = devUrl("https://cloudcode-pa.googleapis.com/v1internal:streamGenerateContent?alt=sse");
  const contents = antigravityContents(messages);
  const sessionId = antigravitySession(config.projectId);
  const conversationId = crypto.randomUUID();
  const trajectoryId = crypto.randomUUID();
  let activeConfig = await refreshAntigravityToken(config);
  const request = () => fetchWithRateLimitRetry(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${activeConfig.apiKey}`,
      "X-Goog-Api-Client": "google-cloud-sdk vscode_cloudshelleditor/0.1",
      "Client-Metadata": JSON.stringify({ ideType: 9, platform: 2, pluginType: 2 }),
    },
    body: JSON.stringify({
      project: config.projectId,
      model,
      userAgent: "antigravity",
      requestType: "agent",
      requestId: `agent/${conversationId}/${Date.now()}/${trajectoryId}/${Math.max(1, contents.length * 2 - 1)}`,
      request: {
        sessionId,
        systemInstruction: { parts: [{ text: system }] },
        contents,
        generationConfig: { maxOutputTokens: 4096 },
      },
    }),
  });
  let response = await request();
  // A token can be revoked before its advertised expiry. Refresh it once and
  // retry the identical request before asking the user to reconnect.
  if (response.status === 401 && activeConfig.refreshToken) {
    activeConfig = await refreshAntigravityToken(activeConfig, true);
    response = await request();
  }
  if (response.status === 401) {
    throw new ProviderHttpError(401, "Gemini session has expired. Reconnect Gemini to continue.");
  }
  await raiseForStatus(response);
  for await (const data of sseData(response)) {
    try {
      // Antigravity wraps each streamed generate-content response in
      // `{ response: { candidates } }`, unlike Gemini Developer API's root
      // `candidates` shape. Accept both envelopes for compatibility.
      const parsed = JSON.parse(data);
      const text = (parsed.response ?? parsed).candidates?.[0]?.content?.parts
        ?.map((part: { text?: string }) => part.text ?? "")
        .join("");
      if (text) yield text;
    } catch { /* ignore */ }
  }
}

async function refreshClaudeToken(
  config: ProviderConfig,
  force = false,
): Promise<ProviderConfig> {
  const expiresSoon = config.expiresAt != null && config.expiresAt <= Date.now() + 60_000;
  if ((!force && !expiresSoon) || !config.refreshToken) return config;

  const response = await fetch(devUrl("https://vuaai.net/api/auth/claude/token"), {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: config.refreshToken,
      client_id: "9d1c2508-bf82-4a7b-a1e6-b63690d79d1a",
    }),
  });
  if (!response.ok) {
    throw new ProviderHttpError(401, "Claude session could not be refreshed. Reconnect Claude to continue.");
  }
  const data = await response.json() as {
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
  };
  if (!data.access_token) {
    throw new ProviderHttpError(401, "Claude session refresh returned no access token. Reconnect Claude to continue.");
  }
  const refreshToken = data.refresh_token || config.refreshToken;
  const next = {
    ...config,
    apiKey: data.access_token,
    refreshToken,
    expiresAt: typeof data.expires_in === "number" ? Date.now() + data.expires_in * 1000 : undefined,
  };
  await Promise.all([
    vaultSet("provider:claude", data.access_token),
    vaultSet("provider:claude:refresh", refreshToken),
  ]);
  return next;
}

async function refreshAntigravityToken(
  config: ProviderConfig,
  force = false,
): Promise<ProviderConfig> {
  const expiresSoon = config.expiresAt != null && config.expiresAt <= Date.now() + 60_000;
  if ((!force && !expiresSoon) || !config.refreshToken) return config;

  const response = await fetch(devUrl("https://oauth2.googleapis.com/token"), {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: config.refreshToken,
      client_id: "1071006060591-tmhssin2h21lcre235vtolojh4g403ep.apps.googleusercontent.com",
      client_secret: "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",
    }),
  });
  if (!response.ok) {
    throw new ProviderHttpError(401, "Gemini session could not be refreshed. Reconnect Gemini to continue.");
  }
  const data = await response.json() as {
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
  };
  if (!data.access_token) {
    throw new ProviderHttpError(401, "Gemini session refresh returned no access token. Reconnect Gemini to continue.");
  }
  const refreshToken = data.refresh_token || config.refreshToken;
  const next = {
    ...config,
    apiKey: data.access_token,
    refreshToken,
    expiresAt: typeof data.expires_in === "number" ? Date.now() + data.expires_in * 1000 : undefined,
  };
  await Promise.all([
    vaultSet("provider:gemini", data.access_token),
    vaultSet("provider:gemini:refresh", refreshToken),
  ]);
  return next;
}

/** Antigravity requires non-empty, alternating Gemini content turns. */
function antigravityContents(messages: ChatMessage[]) {
  const normalized: { role: "user" | "model"; parts: any[] }[] = [];
  for (const message of compactHistory(messages, MAX_ANTIGRAVITY_MESSAGES)) {
    const text = message.content;
    const role = message.role === "assistant" ? "model" : "user";
    const parts: any[] = [{ text: text || " " }];
    if (message.attachments) {
      for (const att of message.attachments) {
        const img = parseImageDataUrl(att.dataUrl);
        if (img) {
          parts.push({
            inlineData: {
              mimeType: img.mimeType,
              data: img.base64,
            },
          });
        }
      }
    }
    const previous = normalized[normalized.length - 1];
    if (previous?.role === role) {
      previous.parts.push(...parts);
    } else {
      normalized.push({ role, parts });
    }
  }
  return normalized.length ? normalized : [{ role: "user" as const, parts: [{ text: "Hello" }] }];
}

function antigravitySession(projectId: string): string {
  const existing = antigravitySessions.get(projectId);
  if (existing) return existing;
  // Cloud Code uses a negative signed integer. Keep it stable for this app run
  // so consecutive turns retain its conversation context.
  const session = `-${Date.now()}${Math.floor(Math.random() * 1_000_000)}`;
  antigravitySessions.set(projectId, session);
  return session;
}
