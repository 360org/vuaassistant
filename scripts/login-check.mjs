// Checks the direct sign-in ("Continue with ChatGPT/Claude/Gemini/…") logic
// that can be verified without a real browser:
//
//   1. completeOAuthReturn: a returned ?code + stored PKCE verifier are
//      exchanged for a user key, sending code_verifier + S256 (real
//      exchangeCode path).
//   2. per-vendor routing: after login, each vendor's routed config reaches
//      that vendor's models (chatgpt→openai/*, claude→anthropic/*,
//      gemini→google/*, openrouter→auto) — one login, right vendor.
//   3. fetchVendorAccount: the local user is created from the account.
//
// The real OAuth redirect + openrouter.ai round-trip still needs a manual
// desktop run; that part can't run in CI (no browser).

import { build } from "esbuild";
import { pathToFileURL } from "node:url";
import { writeFileSync, rmSync } from "node:fs";

// --- Shims: browser globals the web sign-in path touches --------------------
globalThis.mockStorageStore = new Map();
const mockLocalStorage = {
  getItem: (k) => globalThis.mockStorageStore.get(k) || null,
  setItem: (k, v) => globalThis.mockStorageStore.set(k, String(v)),
  removeItem: (k) => globalThis.mockStorageStore.delete(k),
};

try {
  globalThis.localStorage = mockLocalStorage;
} catch {
  Object.defineProperty(globalThis, "localStorage", {
    value: mockLocalStorage,
    configurable: true,
    writable: true,
  });
}

const mockWindow = {
  location: { search: "?code=AUTH_CODE_123", pathname: "/", origin: "https://app" },
  history: { replaceState: () => {} },
};

if (typeof globalThis.window === "undefined") {
  globalThis.window = mockWindow;
} else {
  try {
    Object.defineProperty(globalThis.window, "location", {
      value: mockWindow.location,
      configurable: true,
      writable: true,
    });
    Object.defineProperty(globalThis.window, "history", {
      value: mockWindow.history,
      configurable: true,
      writable: true,
    });
  } catch {
    // Fallback if window is read-only but location property is writable
    try {
      globalThis.window.location = mockWindow.location;
      globalThis.window.history = mockWindow.history;
    } catch {
      /* ignore if completely frozen */
    }
  }
}

// --- Stub OpenRouter + the router chat endpoint via a fetch interceptor -----
let exchangeSaw = null;
function sseStream(text) {
  return new ReadableStream({
    start(controller) {
      const enc = new TextEncoder();
      for (const w of text.split(/(?<=\s)/)) {
        controller.enqueue(
          enc.encode(
            `data: ${JSON.stringify({ choices: [{ delta: { content: w } }] })}\n\n`,
          ),
        );
      }
      controller.enqueue(enc.encode("data: [DONE]\n\n"));
      controller.close();
    },
  });
}
function sseAnthropic(text) {
  return new ReadableStream({
    start(controller) {
      const enc = new TextEncoder();
      controller.enqueue(
        enc.encode(`data: ${JSON.stringify({ type: "content_block_delta", delta: { text } })}\n\n`)
      );
      controller.close();
    },
  });
}
function sseGemini(text) {
  return new ReadableStream({
    start(controller) {
      const enc = new TextEncoder();
      controller.enqueue(
        enc.encode(`data: ${JSON.stringify({ candidates: [{ content: { parts: [{ text }] } }] })}\n\n`)
      );
      controller.close();
    },
  });
}
let lastInferenceHeaders = null;
let anthropicMessageCalls = 0;
let anthropicRateLimitResponses = 0;
let anthropicAuthResponses = 0;
let openAIChatCalls = 0;
let openAIRateLimitResponses = 0;
let lastOpenAIRequest = null;
let geminiCalls = 0;
let geminiRateLimitResponses = 0;
globalThis.fetch = async (url, init) => {
  const u = String(url);
  console.log("FETCHING URL:", u);
  if (u.includes("/api/v1/auth/keys")) {
    exchangeSaw = JSON.parse(init.body);
    return new Response(JSON.stringify({ key: "sk-user-key" }), {
      headers: { "Content-Type": "application/json" },
    });
  }
  if (u.includes("/oauth/token") || u.includes("/token")) {
    const params = new URLSearchParams(init.body);
    if (params.get("grant_type") === "refresh_token") {
      return new Response(JSON.stringify({ access_token: "ya29.REFRESHED", expires_in: 3600 }), {
        headers: { "Content-Type": "application/json" },
      });
    }
    exchangeSaw = {
      code: params.get("code"),
      code_verifier: params.get("code_verifier"),
      code_challenge_method: "S256",
    };
    return new Response(JSON.stringify({ access_token: "sk-user-key", id_token: "mock-id-token" }), {
      headers: { "Content-Type": "application/json" },
    });
  }
  if (u.includes("/api/claude_cli/bootstrap")) {
    return new Response(JSON.stringify({ oauth_account: { account_email: "test@claude.ai" } }), {
      headers: { "Content-Type": "application/json" },
    });
  }
  if (u.includes("/userinfo")) {
    return new Response(JSON.stringify({ email: "test@gemini.ai", name: "Gemini Tester" }), {
      headers: { "Content-Type": "application/json" },
    });
  }
  if (u.includes("/api/v1/key")) {
    return new Response(
      JSON.stringify({ data: { label: "My OpenRouter", limit: 10, usage: 2.5 } }),
      { headers: { "Content-Type": "application/json" } },
    );
  }
  if (u.includes("cloudcode-pa.googleapis.com") || u.includes("/proxy/antigravity/")) {
    geminiCalls++;
    if (geminiRateLimitResponses > 0) {
      geminiRateLimitResponses--;
      return new Response(JSON.stringify({ error: { message: "rate limited" } }), {
        status: 429,
        headers: { "Content-Type": "application/json", "Retry-After": "0" },
      });
    }
    lastInferenceHeaders = init.headers || {};
    const model = JSON.parse(init.body).model;
    return new Response(sseGemini(`model=${model}`), {
      headers: { "Content-Type": "text/event-stream" },
    });
  }
  if (u.includes("/v1/messages")) {
    anthropicMessageCalls++;
    if (anthropicAuthResponses > 0) {
      anthropicAuthResponses--;
      return new Response(JSON.stringify({ error: { message: "expired credential" } }), {
        status: 401,
        headers: { "Content-Type": "application/json" },
      });
    }
    if (anthropicRateLimitResponses > 0) {
      anthropicRateLimitResponses--;
      return new Response(JSON.stringify({ error: { message: "rate limited" } }), {
        status: 429,
        headers: { "Content-Type": "application/json", "Retry-After": "0" },
      });
    }
    lastInferenceHeaders = init.headers || {};
    const model = JSON.parse(init.body).model;
    return new Response(sseAnthropic(`model=${model}`), {
      headers: { "Content-Type": "text/event-stream" },
    });
  }
  if (u.includes("streamGenerateContent")) {
    geminiCalls++;
    if (geminiRateLimitResponses > 0) {
      geminiRateLimitResponses--;
      return new Response(JSON.stringify({ error: { message: "rate limited" } }), {
        status: 429,
        headers: { "Content-Type": "application/json", "Retry-After": "0" },
      });
    }
    lastInferenceHeaders = init.headers || {};
    return new Response(sseGemini(`model=${u.split("/models/")[1].split(":")[0]}`), {
      headers: { "Content-Type": "text/event-stream" },
    });
  }
  if (u.includes("/chat/completions")) {
    if (u.includes("/proxy/openai/")) {
      openAIChatCalls++;
      if (openAIRateLimitResponses > 0) {
        openAIRateLimitResponses--;
        return new Response(JSON.stringify({ error: { message: "rate limited" } }), {
          status: 429,
          headers: { "Content-Type": "application/json", "Retry-After": "0" },
        });
      }
    }
    // Echo the requested model so we can assert per-vendor routing.
    lastOpenAIRequest = JSON.parse(init.body);
    const model = lastOpenAIRequest.model;
    return new Response(sseStream(`model=${model}`), {
      headers: { "Content-Type": "text/event-stream" },
    });
  }
  throw new Error(`unexpected fetch: ${u}`);
};

// --- Bundle the real modules ------------------------------------------------
const entry = `
globalThis.mockWindow = {
  location: { search: "?code=AUTH_CODE_123", pathname: "/", origin: "https://app" },
  history: { replaceState: () => {} },
  open: () => ({ closed: false }),
  addEventListener: () => {},
  removeEventListener: () => {},
};
globalThis.mockLocalStorage = {
  getItem: (k) => globalThis.mockStorageStore.get(k) || null,
  setItem: (k, v) => globalThis.mockStorageStore.set(k, String(v)),
  removeItem: (k) => globalThis.mockStorageStore.delete(k),
};
export {
  completeOAuthReturn,
  fetchVendorAccount,
  OAUTH_CONFIGS,
} from "../src/runtime/oauth.ts";
export {
  routedConfig,
  loginConfig,
  streamProvider,
  streamProviderWithFallback,
  MODELS,
  ROUTED_MODELS,
  SUBSCRIPTION_MODELS,
} from "../src/runtime/providers.ts";
`;
writeFileSync("scripts/.login-entry.mjs", entry);
const outfile = "scripts/.login-bundle.mjs";
await build({
  entryPoints: ["scripts/.login-entry.mjs"],
  bundle: true,
  format: "esm",
  platform: "node",
  outfile,
  define: {
    "import.meta.env": "{}",
    "window": "mockWindow",
    "localStorage": "mockLocalStorage",
  },
  logLevel: "silent",
});
const mod = await import(pathToFileURL(outfile).href);

let pass = true;
const check = (name, cond) => {
  console.log(`${cond ? "✓" : "✗"} ${name}`);
  if (!cond) pass = false;
};

// 1. Sign-in return: pending verifier for "Continue with OpenRouter" → key.
globalThis.mockStorageStore.set(
  "vuaassistant-oauth-pending",
  JSON.stringify({ provider: "openrouter", verifier: "VERIFIER_XYZ", context: "onboarding" }),
);
const result = await mod.completeOAuthReturn();
check("code exchanged for a user key", result?.apiKey === "sk-user-key");
check("vendor preserved through login", result?.provider === "openrouter");
check(
  "PKCE fields sent (code_verifier + S256)",
  exchangeSaw?.code === "AUTH_CODE_123" &&
    exchangeSaw?.code_verifier === "VERIFIER_XYZ" &&
    exchangeSaw?.code_challenge_method === "S256",
);

// 2. Per-vendor routing: each "Continue with X" reaches X's models.
async function modelFor(provider) {
  let out = "";
  for await (const chunk of mod.streamProvider(
    provider,
    mod.routedConfig(provider, "sk-user-key"),
    "system",
    [{ id: "1", role: "user", content: "hi", createdAt: 0 }],
  )) {
    out += chunk;
  }
  return out.replace("model=", "");
}
check("ChatGPT login → OpenAI model", (await modelFor("chatgpt")).startsWith("openai/"));
check("Claude login → Anthropic model", (await modelFor("claude")).startsWith("anthropic/"));
check("Gemini login → Google model", (await modelFor("gemini")).startsWith("google/"));
check("OpenRouter login → auto", (await modelFor("openrouter")).includes("auto"));
check("OpenRouter → caps completion tokens for available credits", lastOpenAIRequest?.max_tokens === 4096);

// 3. Local user created from the vendor account.
const account = await mod.fetchVendorAccount("gemini", "sk-user-key");
check(
  "local user created from account",
  account?.label === "test@gemini.ai" && account.detail === "Gemini Tester",
);

// 4. Subscription vendor sign-in (loginConfig): the vendor's own OAuth token
//    is used NATIVELY (Bearer + OAuth beta) against the vendor API — NOT the
//    router. This is the "login with your subscription" path (SPEC §1).
async function drainLogin(provider, token, metadata) {
  lastInferenceHeaders = null;
  let out = "";
  for await (const chunk of mod.streamProvider(
    provider,
    mod.loginConfig(provider, token, metadata),
    "system",
    [{ id: "1", role: "user", content: "hi", createdAt: 0 }],
  )) {
    out += chunk;
  }
  return { model: out.replace("model=", ""), headers: lastInferenceHeaders || {} };
}

const claudeCfg = mod.loginConfig("claude", "sk-ant-oat01-TOKEN");
// The model is deliberately NOT pinned into the saved config — a pinned id goes
// stale when the vendor retires the model. It is resolved per request instead.
check("Claude subscription → oauth flag set, no model pinned",
  claudeCfg.oauth === true && claudeCfg.model === undefined);
check("Claude subscription → resolves to a native model id (no router prefix)",
  !mod.SUBSCRIPTION_MODELS.claude.includes("/"));
const callsBeforeRateLimit = anthropicMessageCalls;
anthropicRateLimitResponses = 1;
const claudeRun = await drainLogin("claude", "sk-ant-oat01-TOKEN");
check("Claude subscription → hits vendor model natively",
  claudeRun.model === mod.SUBSCRIPTION_MODELS.claude);
check("Claude subscription → retries one 429 response",
  anthropicMessageCalls === callsBeforeRateLimit + 2);
check("Claude subscription → Bearer + OAuth beta header (not x-api-key)",
  claudeRun.headers.Authorization === "Bearer sk-ant-oat01-TOKEN" &&
  claudeRun.headers["anthropic-beta"] === "oauth-2025-04-20" &&
  !("x-api-key" in claudeRun.headers));

const gemRun = await drainLogin("gemini", "ya29.ANTIGRAVITY", { projectId: "test-project" });
check("Gemini subscription → uses Antigravity Bearer transport",
  gemRun.headers.Authorization === "Bearer ya29.ANTIGRAVITY");
check("Gemini subscription → uses an Antigravity model",
  gemRun.model === mod.SUBSCRIPTION_MODELS.gemini);
check("Gemini picker → exposes Antigravity model catalog",
  mod.MODELS.gemini.map((m) => m.id).join(",") === [
    "gemini-3.6-flash-high",
    "gemini-3.6-flash-medium",
    "gemini-3.6-flash-low",
    "gemini-3-flash-agent",
    "gemini-3.5-flash-low",
    "gemini-3.5-flash-extra-low",
    "gemini-3.1-pro-low",
    "gemini-pro-agent",
    "claude-sonnet-4-6",
    "claude-opus-4-6-thinking",
    "gpt-oss-120b-medium",
  ].join(","));
check("Gemini OAuth → requests Antigravity scopes",
  mod.OAUTH_CONFIGS.gemini.scopes.includes("https://www.googleapis.com/auth/cclog") &&
  mod.OAUTH_CONFIGS.gemini.scopes.includes("https://www.googleapis.com/auth/experimentsandconfigs"));

const refreshedGemRun = await drainLogin("gemini", "ya29.EXPIRED", {
  projectId: "test-project",
  refreshToken: "refresh-token",
  expiresAt: 0,
});
check("Gemini subscription → refreshes an expired access token",
  refreshedGemRun.headers.Authorization === "Bearer ya29.REFRESHED");
globalThis.mockStorageStore.delete("vuaassistant-vault:provider:gemini");
globalThis.mockStorageStore.delete("vuaassistant-vault:provider:gemini:refresh");

const openAICallsBeforeRateLimit = openAIChatCalls;
openAIRateLimitResponses = 1;
for await (const _chunk of mod.streamProvider(
  "chatgpt",
  { apiKey: "sk-test" },
  "system",
  [{ id: "1", role: "user", content: "hi", createdAt: 0 }],
)) {
  // Draining the stream verifies the retried request reaches a full response.
}
check("ChatGPT → retries one 429 response",
  openAIChatCalls === openAICallsBeforeRateLimit + 2);

const geminiCallsBeforeRateLimit = geminiCalls;
geminiRateLimitResponses = 1;
await drainLogin("gemini", "ya29.TOKEN", { projectId: "test-project" });
check("Gemini → retries one 429 response",
  geminiCalls === geminiCallsBeforeRateLimit + 2);

// 5. After Claude has exhausted its bounded retries, keep the selected
// provider in the UI but route this turn through another configured vendor.
// OpenRouter is intentionally last in the fallback order.
async function drainFallback(configs) {
  let out = "";
  for await (const chunk of mod.streamProviderWithFallback(
    "claude",
    configs,
    "system",
    [{ id: "1", role: "user", content: "hi", createdAt: 0 }],
  )) {
    out += chunk;
  }
  return out.replace("model=", "");
}

const callsBeforeVendorFailover = anthropicMessageCalls;
anthropicRateLimitResponses = 3;
const geminiFallbackModel = await drainFallback({
  claude: mod.loginConfig("claude", "sk-ant-oat01-TOKEN"),
  gemini: mod.loginConfig("gemini", "ya29.TOKEN", { projectId: "test-project" }),
  openrouter: mod.loginConfig("openrouter", "sk-or-user"),
});
check("Claude rate limit → retries before switching vendor",
  anthropicMessageCalls === callsBeforeVendorFailover + 3);
check("Claude rate limit → falls back to configured Gemini",
  geminiFallbackModel === mod.SUBSCRIPTION_MODELS.gemini);

anthropicRateLimitResponses = 3;
const openRouterFallbackModel = await drainFallback({
  claude: mod.loginConfig("claude", "sk-ant-oat01-TOKEN"),
  openrouter: mod.loginConfig("openrouter", "sk-or-user"),
});
check("Claude rate limit → OpenRouter is the final configured fallback",
  openRouterFallbackModel === mod.ROUTED_MODELS.openrouter);

geminiRateLimitResponses = 3;
anthropicAuthResponses = 1;
let continuedFallbackModel = "";
for await (const chunk of mod.streamProviderWithFallback(
  "gemini",
  {
    gemini: mod.loginConfig("gemini", "ya29.TOKEN", { projectId: "test-project" }),
    claude: mod.loginConfig("claude", "sk-ant-oat01-EXPIRED"),
    chatgpt: { apiKey: "sk-chatgpt" },
  },
  "system",
  [{ id: "1", role: "user", content: "hi", createdAt: 0 }],
)) {
  continuedFallbackModel += chunk;
}
check("Gemini quota → skips expired Claude and continues to ChatGPT",
  continuedFallbackModel.replace("model=", "") === "gpt-4o-mini");

// OpenRouter login stays a router key (central subscription), not a native call.
const orCfg = mod.loginConfig("openrouter", "sk-or-user");
check("OpenRouter login → router baseUrl (central subscription)",
  orCfg.baseUrl?.includes("openrouter.ai") && orCfg.oauth !== true);

rmSync("scripts/.login-entry.mjs", { force: true });
rmSync(outfile, { force: true });
console.log(pass ? "\n✓ direct sign-in logic verified" : "\n✗ FAILED");
process.exit(pass ? 0 : 1);
