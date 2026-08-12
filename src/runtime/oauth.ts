/**
 * Direct sign-in (OAuth) with AI providers — popup-based flow.
 *
 * Pattern follows 9router (ai-router.vuahethong.com):
 *  1. Call /api/oauth/[provider]/authorize (server builds auth URL + PKCE)
 *     — or for simple providers, build URL client-side
 *  2. Open a popup pointing at the auth URL; redirect_uri = localhost:1420/callback
 *  3. The /callback page relays code+state back via postMessage / BroadcastChannel
 *  4. Exchange the code server-side (or via proxy) for an access token
 *  5. Resolve with { provider, apiKey }
 *
 * Fallback (popup blocked / remote host):
 *  - Show the auth URL for the user to open manually
 *  - Accept a pasted callback URL → parse code from it → exchange
 *
 * Desktop Tauri shell still uses the native loopback listener (unchanged).
 */

import type { ProviderId } from "@/lib/catalog";
import { devUrl, inDesktopShell } from "./proxy";

const PENDING_KEY = "vuaassistant-oauth-pending";
const CALLBACK_KEY = "vuaassistant_oauth_callback";

/**
 * Demo build: the artifact/preview can't complete a real OAuth round-trip.
 * In demo mode the sign-in simulates the vendor round-trip locally.
 */
export const DEMO_MODE = import.meta.env.VITE_DEMO === "1";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Storage that never throws (sandboxed webviews block localStorage). */
const safeStore = {
  get(key: string): string | null {
    try { return localStorage.getItem(key); } catch { return null; }
  },
  set(key: string, value: string): void {
    try { localStorage.setItem(key, value); } catch { /* no persistence */ }
  },
  remove(key: string): void {
    try { localStorage.removeItem(key); } catch { /* no-op */ }
  },
};

export interface LoginResult {
  provider: ProviderId;
  apiKey: string;
  projectId?: string;
  refreshToken?: string;
  expiresAt?: number;
}

export interface OAuthReturn {
  provider: ProviderId;
  apiKey: string;
  projectId?: string;
  refreshToken?: string;
  expiresAt?: number;
  context: "onboarding" | "settings";
}

/** OAuth attempt whose callback is completed explicitly in the desktop UI. */
export interface ManualSignInAttempt {
  provider: ProviderId;
  authUrl: string;
  redirect: string;
  verifier: string;
  state: string;
  /** Provider name understood by the native AI Router Core. */
  routerProvider?: string;
}

const AI_ROUTER_OAUTH_URL = "http://127.0.0.1:36360/v1/oauth";

const ROUTER_OAUTH_PROVIDER: Partial<Record<string, string>> = {
  gemini: "antigravity",
  "gemini-cli": "gemini-cli",
  antigravity: "antigravity",
  claude: "claude",
  codex: "codex",
  chatgpt: "codex",
  openai: "codex",
  "grok-cli": "grok-cli",
  grok: "grok-cli",
  xai: "grok-cli",
};

interface RouterAuthorization {
  authUrl?: string;
  state?: string;
  codeVerifier?: string;
  redirectUri?: string;
  error?: string;
}

interface RouterTokens {
  accessToken?: string;
  apiKey?: string;
  refreshToken?: string;
  projectId?: string;
  expiresIn?: number;
}

// ─── PKCE helpers ────────────────────────────────────────────────────────────

function base64url(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

async function s256(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
  return base64url(new Uint8Array(digest));
}

/**
 * PKCE verifier / CSRF state, sized exactly like 9router's `generatePKCE`
 * (32 random bytes → 43 base64url chars each). The vendor OAuth clients are
 * picky: a shorter state made claude.ai reject the request with "Invalid
 * request format", so keep these byte counts in sync with 9router.
 */
const PKCE_BYTES = 32;

function randomBase64url(bytes = PKCE_BYTES): string {
  return base64url(crypto.getRandomValues(new Uint8Array(bytes)));
}

// ─── OAuth configs (static) ───────────────────────────────────────────────────

// Subscription sign-in with the vendor's OAuth client (Claude Code and
// Antigravity). Gemini uses Antigravity's Code Assist endpoint, not the
// Gemini Developer API used by raw API keys.
// ponytail: client không phải do vendor cấp cho VuaAssistant — vendor có thể
// thu hồi/chặn bất kỳ lúc nào; hướng nâng cấp là chuyển OAuth về 9router
// server-side (CHECKLIST §4.2).
export const OAUTH_CONFIGS = {
  openrouter: {
    authorizeUrl: "https://openrouter.ai/auth",
    tokenUrl: "https://openrouter.ai/api/v1/auth/keys",
    usePkce: true,
    usePopup: true,   // openrouter uses callback_url param, not redirect_uri
  },
  claude: {
    clientId: "9d1c250a-e61b-44d9-88ed-5944d1962f5e",
    authorizeUrl: "https://claude.ai/oauth/authorize",
    tokenUrl: "https://api.anthropic.com/v1/oauth/token",
    scopes: ["org:create_api_key", "user:profile", "user:inference"],
    usePkce: true,
    usePopup: true,
    // Claude token exchange uses JSON body (not form-urlencoded) — per 9router
    exchangeContentType: "application/json" as const,
  },
  gemini: {
    clientId: "1071006060591-tmhssin2h21lcre235vtolojh4g403ep.apps.googleusercontent.com",
    clientSecret: "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",
    authorizeUrl: "https://accounts.google.com/o/oauth2/v2/auth",
    tokenUrl: "https://oauth2.googleapis.com/token",
    scopes: [
      "https://www.googleapis.com/auth/cloud-platform",
      "https://www.googleapis.com/auth/userinfo.email",
      "https://www.googleapis.com/auth/userinfo.profile",
      "https://www.googleapis.com/auth/cclog",
      "https://www.googleapis.com/auth/experimentsandconfigs",
    ],
    usePkce: false,
    usePopup: true,
  },
} as const;

/** Resolve the project required by an Antigravity subscription chat request. */
export async function loadAntigravityProject(accessToken: string): Promise<string> {
  const metadata = { ideType: 9, platform: 2, pluginType: 2 };
  const load = await fetch(devUrl("https://cloudcode-pa.googleapis.com/v1internal:loadCodeAssist"), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`,
      "X-Goog-Api-Client": "google-cloud-sdk vscode_cloudshelleditor/0.1",
      "Client-Metadata": JSON.stringify(metadata),
    },
    body: JSON.stringify({ metadata, mode: 1 }),
  });
  if (!load.ok) throw new Error(`Gemini subscription setup failed (HTTP ${load.status}): ${await load.text()}`);
  const setup = await load.json();
  const project = setup.cloudaicompanionProject;
  const projectId = typeof project === "string" ? project : project?.id;
  if (!projectId) throw new Error("Gemini subscription setup returned no Antigravity project.");
  return projectId;
}

// ─── Callback URL helper ──────────────────────────────────────────────────────

/**
 * The redirect_uri per provider. It is NOT free-form: each vendor OAuth client
 * only accepts redirect URIs registered against it.
 *
 *  - OpenRouter: public PKCE, no client registration → the app's own /callback
 *    route (main.tsx) works, and the popup relays the code back automatically.
 *    This is the only true 1-click flow.
 *
 *  - Claude: the Claude Code client whitelists only a fixed set of loopback
 *    URIs (`http://localhost:443/callback` is the one 9router uses and the one
 *    proven to work here). Any other port — including the app's own 1420 — is
 *    rejected by claude.ai with "Authorization failed / Invalid request
 *    format". Nothing listens on 443, so after the user approves, the browser
 *    lands on an unreachable page whose address bar carries `?code=…`; the user
 *    pastes that URL back into the app (see ProviderConnect's manual fallback).
 *
 * ponytail: 443 is a magic number inherited from the vendor's whitelist, not a
 * choice. Hard-coding it is the only thing that works today; the durable fix is
 * to move vendor OAuth server-side into 9router (CHECKLIST §4.2).
 */
const CLAUDE_REDIRECT_URI = "http://localhost:443/callback";

function callbackUrl(provider: ProviderId): string {
  if (provider === "claude") return CLAUDE_REDIRECT_URI;
  // OpenRouter authorizes the application's origin, not a /callback route.
  if (provider === "openrouter") return window.location.origin;
  return `${window.location.origin}/callback`;
}

/**
 * Start the first-login desktop flow without depending on a browser-to-webview
 * event race. The user pastes the final callback URL/code into the app.
 */
export async function beginManualSignIn(provider: ProviderId): Promise<ManualSignInAttempt> {
  const routerProvider = ROUTER_OAUTH_PROVIDER[provider];
  if (routerProvider) {
    const redirectUri = routerProvider === "codex"
      ? "http://localhost:1455/auth/callback"
      : routerProvider === "claude"
      ? "http://localhost:443/callback"
      : "http://localhost:1420/callback";

    const response = await fetch(`${AI_ROUTER_OAUTH_URL}/authorize`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ provider: routerProvider, redirectUri }),
    });
    const authorization = await response.json() as RouterAuthorization;
    if (!response.ok || !authorization.authUrl || !authorization.state || !authorization.codeVerifier || !authorization.redirectUri) {
      throw new Error(authorization.error || `AI Router could not start ${provider} sign-in.`);
    }
    await openExternal(authorization.authUrl);
    return {
      provider,
      authUrl: authorization.authUrl,
      redirect: authorization.redirectUri,
      verifier: authorization.codeVerifier,
      state: authorization.state,
      routerProvider,
    };
  }
  if (!(provider in OAUTH_CONFIGS)) {
    throw new Error(`Direct sign-in for ${provider} is not available. Use another provider or paste an API key.`);
  }
  const verifier = randomBase64url();
  const state = randomBase64url();
  const redirect = provider === "claude"
    ? CLAUDE_REDIRECT_URI
    : provider === "gemini"
      ? "http://localhost:1420/callback"
      : provider === "openrouter"
        ? "http://127.0.0.1:1420"
        : callbackUrl(provider);
  const authUrl = await buildAuthUrl(provider, redirect, verifier, state);
  await openExternal(authUrl);
  return { provider, authUrl, redirect, verifier, state };
}

/** Complete a manual desktop sign-in after the user pastes its callback URL. */
export async function completeManualSignIn(
  attempt: ManualSignInAttempt,
  callbackValue: string,
): Promise<LoginResult> {
  const rawValue = callbackValue.trim();
  if (!rawValue) throw new Error("Paste the callback URL or authorization code.");
  let code = rawValue;
  try {
    const callback = new URL(rawValue);
    const error = callback.searchParams.get("error");
    if (error) throw new Error(callback.searchParams.get("error_description") || error);
    code = callback.searchParams.get("code") || callback.searchParams.get("token") || "";
    const returnedState = callback.searchParams.get("state");
    if (returnedState && returnedState !== attempt.state) {
      throw new Error("OAuth state mismatch. Please start sign-in again.");
    }
  } catch (error) {
    if (error instanceof TypeError) {
      // A provider can display an authorization code instead of redirecting.
      code = rawValue;
    } else {
      throw error;
    }
  }
  if (!code) throw new Error("No authorization code found in the pasted value.");

  if (attempt.routerProvider) {
    const response = await fetch(`${AI_ROUTER_OAUTH_URL}/exchange`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        provider: attempt.routerProvider,
        code,
        redirectUri: attempt.redirect,
        codeVerifier: attempt.verifier,
        state: attempt.state,
      }),
    });
    const payload = await response.json() as { tokens?: RouterTokens; error?: string };
    const tokens = payload.tokens;
    const apiKey = tokens?.accessToken || tokens?.apiKey;
    if (!response.ok || !tokens || !apiKey) {
      throw new Error(payload.error || `${attempt.provider} sign-in could not be completed by AI Router.`);
    }
    return {
      provider: attempt.provider,
      apiKey,
      projectId: tokens.projectId,
      refreshToken: tokens.refreshToken,
      expiresAt: typeof tokens.expiresIn === "number" ? Date.now() + tokens.expiresIn * 1000 : undefined,
    };
  }
  return await exchangeCode(attempt.provider, code, attempt.verifier, attempt.redirect, attempt.state);
}

/** True when the vendor redirects somewhere the app cannot listen on, so the
 *  user has to paste the callback URL back in by hand. */
export function needsManualCallback(provider: ProviderId): boolean {
  return provider === "claude";
}

// ─── Auth URL builders ────────────────────────────────────────────────────────

async function buildAuthUrl(
  provider: ProviderId,
  redirect: string,
  verifier: string,
  state: string,
): Promise<string> {
  if (provider === "openrouter") {
    const challenge = await s256(verifier);
    // OpenRouter uses callback_url (not redirect_uri) and its own PKCE variant
    return (
      `https://openrouter.ai/auth?callback_url=${encodeURIComponent(redirect)}` +
      `&code_challenge=${challenge}&code_challenge_method=S256`
    );
  }

  if (provider === "claude") {
    const challenge = await s256(verifier);
    const conf = OAUTH_CONFIGS.claude;
    const params = new URLSearchParams({
      code: "true",
      client_id: conf.clientId,
      response_type: "code",
      redirect_uri: redirect,
      scope: conf.scopes.join(" "),
      code_challenge: challenge,
      code_challenge_method: "S256",
      state,
    });
    return `${conf.authorizeUrl}?${params.toString()}`;
  }

  if (provider === "gemini") {
    const conf = OAUTH_CONFIGS.gemini;
    const params = new URLSearchParams({
      client_id: conf.clientId,
      response_type: "code",
      redirect_uri: redirect,
      scope: conf.scopes.join(" "),
      state,
      access_type: "offline",
      prompt: "consent",
    });
    return `${conf.authorizeUrl}?${params.toString()}`;
  }

  throw new Error(`Provider ${provider} does not support OAuth`);
}

// ─── Token exchange ───────────────────────────────────────────────────────────

export async function exchangeCode(
  provider: ProviderId,
  code: string,
  verifier: string,
  redirect: string,
  state: string,
): Promise<LoginResult> {
  if (provider === "openrouter") {
    const response = await fetch(devUrl("https://openrouter.ai/api/v1/auth/keys"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        code,
        code_verifier: verifier,
        code_challenge_method: "S256",
      }),
    });
    if (!response.ok) {
      const text = await response.text();
      throw new Error(`OpenRouter sign-in failed (HTTP ${response.status}): ${text}`);
    }
    const { key } = (await response.json()) as { key: string };
    return { provider, apiKey: key };
  }

  if (provider === "claude") {
    // The returned code may carry state after '#' (per 9router claude.js).
    let authCode = code;
    let codeState = "";
    if (authCode.includes("#")) {
      [authCode, codeState = ""] = authCode.split("#");
    }
    const response = await fetch(devUrl("https://api.anthropic.com/v1/oauth/token"), {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({
        code: authCode,
        state: codeState || state,
        grant_type: "authorization_code",
        client_id: OAUTH_CONFIGS.claude.clientId,
        redirect_uri: redirect,
        code_verifier: verifier,
      }),
    });
    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Claude sign-in failed (HTTP ${response.status}): ${text}`);
    }
    const data = await response.json() as {
      access_token?: string;
      refresh_token?: string;
      expires_in?: number;
    };
    if (!data.access_token && !data.refresh_token) {
      throw new Error("No access_token in Claude OAuth response.");
    }
    return {
      provider,
      apiKey: data.access_token || "",
      refreshToken: data.refresh_token,
      expiresAt: data.expires_in ? Date.now() + data.expires_in * 1000 : undefined,
    };
  }

  if (provider === "gemini") {
    const conf = OAUTH_CONFIGS.gemini;
    const response = await fetch(devUrl(conf.tokenUrl), {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        client_id: conf.clientId,
        client_secret: conf.clientSecret,
        code,
        redirect_uri: redirect,
      }),
    });
    if (!response.ok) throw new Error(`Gemini sign-in failed (HTTP ${response.status}): ${await response.text()}`);
    const data = await response.json();
    if (!data.access_token) throw new Error("No access_token in Gemini OAuth response.");
    const projectId = await loadAntigravityProject(data.access_token);
    return {
      provider,
      apiKey: data.access_token,
      projectId,
      refreshToken: data.refresh_token,
      expiresAt: typeof data.expires_in === "number"
        ? Date.now() + data.expires_in * 1000
        : undefined,
    };
  }

  throw new Error(`Exchange not implemented for provider: ${provider}`);
}

// ─── Popup + listener ─────────────────────────────────────────────────────────

export interface CallbackPayload {
  code?: string | null;
  token?: string | null;
  state?: string | null;
  error?: string | null;
  errorDescription?: string | null;
  fullUrl?: string;
}

/**
 * Open OAuth popup and wait for callback via postMessage / BroadcastChannel / localStorage.
 * Resolves with the OAuth code (or rejects on error / timeout).
 *
 * `manualCallback` providers (Claude) redirect to a port nothing listens on, so
 * the popup necessarily ends on a failed page the user closes after copying the
 * URL. Closing it there is the normal path, not an error — so we must not reject
 * on popup close, or the pasted URL arrives after nobody is listening.
 */
export function waitForPopupCallback(
  authUrl: string,
  expectedState: string,
  manualCallback = false,
): Promise<CallbackPayload> {
  return new Promise((resolve, reject) => {
    const TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes
    let settled = false;

    const popup = window.open(authUrl, "vuaassistant_oauth_popup", "width=600,height=700");

    function settle(value: CallbackPayload | Error) {
      if (settled) return;
      settled = true;
      cleanup();
      if (value instanceof Error) reject(value);
      else resolve(value);
    }

    function handleData(data: CallbackPayload) {
      if (data.error) {
        settle(new Error(data.errorDescription || data.error));
        return;
      }
      if (data.code || data.token) {
        // Verify state for CSRF protection
        if (expectedState && data.state && data.state !== expectedState) {
          settle(new Error("OAuth state mismatch — possible CSRF. Please try again."));
          return;
        }
        settle(data);
      }
    }

    // Method 1: postMessage from popup
    const msgHandler = (event: MessageEvent) => {
      const isLocal = event.origin.includes("localhost") || event.origin.includes("127.0.0.1");
      const isSameOrigin = event.origin === window.location.origin;
      if (!isLocal && !isSameOrigin) return;
      if (event.data?.type === "oauth_callback") handleData(event.data.data as CallbackPayload);
    };
    window.addEventListener("message", msgHandler);

    // Method 2: BroadcastChannel
    let channel: BroadcastChannel | undefined;
    try {
      channel = new BroadcastChannel("vuaassistant_oauth");
      channel.onmessage = (e) => handleData(e.data as CallbackPayload);
    } catch { /* not supported */ }

    // Method 3: localStorage storage event
    const storageHandler = (event: StorageEvent) => {
      if (event.key === CALLBACK_KEY && event.newValue) {
        try {
          const data = JSON.parse(event.newValue) as CallbackPayload;
          handleData(data);
          safeStore.remove(CALLBACK_KEY);
        } catch { /* ignore */ }
      }
    };
    window.addEventListener("storage", storageHandler);

    // Check if callback already in localStorage (race condition)
    const existing = safeStore.get(CALLBACK_KEY);
    if (existing) {
      try {
        const data = JSON.parse(existing) as CallbackPayload & { timestamp?: number };
        if (data.timestamp && Date.now() - data.timestamp < 30_000) {
          safeStore.remove(CALLBACK_KEY);
          handleData(data);
        }
      } catch { /* ignore */ }
    }

    // Detect popup closed without completing. Skipped for manual-callback
    // providers, where closing the popup is part of the normal flow and the
    // code still arrives later via the pasted URL.
    const pollInterval = manualCallback
      ? undefined
      : setInterval(() => {
          if (popup && popup.closed && !settled) {
            settle(new Error("Sign-in window was closed before completing. Please try again."));
          }
        }, 1000);

    // Timeout
    const timeout = setTimeout(() => {
      settle(new Error("Sign-in timed out after 5 minutes. Please try again."));
    }, TIMEOUT_MS);

    function cleanup() {
      if (pollInterval !== undefined) clearInterval(pollInterval);
      clearTimeout(timeout);
      window.removeEventListener("message", msgHandler);
      window.removeEventListener("storage", storageHandler);
      channel?.close();
    }
  });
}

// ─── Desktop loopback OAuth (Tauri) ──────────────────────────────────────────

async function desktopLogin(provider: ProviderId): Promise<LoginResult> {
  const { invoke } = await import("@tauri-apps/api/core");
  const { listen } = await import("@tauri-apps/api/event");

  const verifier = randomBase64url();
  const state = randomBase64url();
  let resolveCode!: (code: string) => void;
  let rejectCode!: (error: Error) => void;
  const codePromise = new Promise<string>((resolve, reject) => {
    resolveCode = resolve;
    rejectCode = reject;
  });

  // Register Tauri listeners before opening the loopback listener. Otherwise a
  // fast browser redirect can emit oauth-code before the webview is listening.
  const unlistenCode = await listen<string>("oauth-code", (event) => resolveCode(event.payload));
  const unlistenError = await listen<string>("oauth-error", (event) => rejectCode(new Error(event.payload)));

  // Must match the loopback redirect the vendor OAuth clients whitelist:
  // `http://localhost:<port>/callback` (host `localhost`, path `/callback`).
  // Using 127.0.0.1 or omitting /callback makes claude.ai reject the request
  // as "Invalid request format" (matches 9router's proven flow).
  const timeout = setTimeout(
    () => rejectCode(new Error("Sign-in timed out. Please try again.")),
    300_000,
  );

  try {
    const port = await invoke<number>("oauth_listen");
    const redirect = `http://localhost:${port}/callback`;
    if (!(provider in OAUTH_CONFIGS)) {
      throw new Error(`Direct sign-in for ${provider} is not available. Use another provider or paste an API key.`);
    }

    const url = await buildAuthUrl(provider, redirect, verifier, state);
    await invoke("open_external", { url });

    const code = await codePromise;
    return await exchangeCode(provider, code, verifier, redirect, state);
  } finally {
    clearTimeout(timeout);
    unlistenCode();
    unlistenError();
  }
}

// ─── AI Router (9router) OAuth ──────────────────────────────────────────────────

async function signInViaRouter(
  provider: ProviderId,
  routerProvider: string,
  onAuthUrl?: (url: string) => void,
): Promise<LoginResult> {
  const redirectUri = routerProvider === "codex"
    ? "http://localhost:1455/auth/callback"
    : routerProvider === "claude"
      ? "http://localhost:443/callback"
      : "http://localhost:1420/callback";

  const response = await fetch(`${AI_ROUTER_OAUTH_URL}/authorize`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ provider: routerProvider, redirectUri }),
  });
  const authorization = await response.json() as RouterAuthorization;
  if (!response.ok || !authorization.authUrl || !authorization.state || !authorization.codeVerifier || !authorization.redirectUri) {
    throw new Error(authorization.error || `AI Router could not start ${provider} sign-in.`);
  }

  await openExternal(authorization.authUrl);
  onAuthUrl?.(authorization.authUrl);

  // Wait for callback via popup/broadcast/localStorage (same as direct flow)
  const payload = await waitForPopupCallback(
    authorization.authUrl,
    authorization.state,
    false, // router handles callback properly, no manual paste needed
  );
  const code = payload.code || payload.token || "";
  if (!code) throw new Error("No authorization code received from AI Router callback.");

  // Exchange code via AI Router
  const exchangeResponse = await fetch(`${AI_ROUTER_OAUTH_URL}/exchange`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      provider: routerProvider,
      code,
      redirectUri: authorization.redirectUri,
      codeVerifier: authorization.codeVerifier,
      state: authorization.state,
    }),
  });
  const exchangePayload = await exchangeResponse.json() as { tokens?: RouterTokens; error?: string };
  const tokens = exchangePayload.tokens;
  const apiKey = tokens?.accessToken || tokens?.apiKey;
  if (!exchangeResponse.ok || !tokens || !apiKey) {
    throw new Error(exchangePayload.error || `${provider} sign-in could not be completed by AI Router.`);
  }

  return {
    provider,
    apiKey,
    projectId: tokens.projectId,
    refreshToken: tokens.refreshToken,
    expiresAt: typeof tokens.expiresIn === "number" ? Date.now() + tokens.expiresIn * 1000 : undefined,
  };
}

// ─── Public API ───────────────────────────────────────────────────────────────

/** Open a URL in the user's real browser. */
export async function openExternal(url: string): Promise<void> {
  if (inDesktopShell()) {
    const { invoke } = await import("@tauri-apps/api/core");
    await invoke("open_external", { url });
    return;
  }
  window.open(url, "_blank", "noopener,noreferrer");
}

/**
 * Start direct sign-in with a provider.
 *  - Desktop shell → real loopback OAuth, resolves in place.
 *  - Demo build → simulated round-trip.
 *  - Web → popup + BroadcastChannel/postMessage flow.
 *
 * @param onAuthUrl - Called with the auth URL before the popup opens.
 *   Use this to show a manual "copy URL / paste callback" fallback.
 */
export async function signIn(
  provider: ProviderId,
  _context: OAuthReturn["context"],
  onAuthUrl?: (url: string) => void,
): Promise<LoginResult | null> {
  if (DEMO_MODE) {
    await sleep(900);
    return { provider, apiKey: "demo-key" };
  }

  // Route gemini/antigravity through AI Router (9router) — avoids Google's
  // unverified-app block on internal Cloud Code Assist client ID.
  const routerProvider = ROUTER_OAUTH_PROVIDER[provider];
  if (routerProvider) {
    return await signInViaRouter(provider, routerProvider, onAuthUrl);
  }

  if (!(provider in OAUTH_CONFIGS)) {
    throw new Error(
      `Provider ${provider} does not support subscription sign-in yet. ` +
      `Please paste an API key under Advanced options.`
    );
  }

  if (inDesktopShell()) {
    return await desktopLogin(provider);
  }

  // Web flow: popup + callback relay
  const verifier = randomBase64url();
  const state = randomBase64url();
  const redirect = callbackUrl(provider);
  // Also support providers that return in the current tab instead of the
  // popup: OAuthCallbackPage sends the user back to the app to exchange it.
  safeStore.set(PENDING_KEY, JSON.stringify({ provider, verifier, state, context: _context }));

  const authUrl = await buildAuthUrl(provider, redirect, verifier, state);

  // Emit authUrl so caller can show manual fallback
  onAuthUrl?.(authUrl);

  const payload = await waitForPopupCallback(
    authUrl,
    state,
    needsManualCallback(provider),
  );
  const code = payload.code || payload.token || "";
  if (!code) throw new Error("No authorization code received.");

  return await exchangeCode(provider, code, verifier, redirect, state);
}

// ─── Legacy completeOAuthReturn (no-op in popup flow) ────────────────────────

export type { OAuthReturn as OAuthReturnType };

/**
 * In popup-based flow this is no longer needed (callback page relays via
 * postMessage). Kept for backward compatibility — always returns null.
 */
export async function completeOAuthReturn(): Promise<OAuthReturn | null> {
  // Popup flow: callback page relays data; no redirect on main window.
  // If somehow the main window ended up at /callback (e.g. popup was blocked
  // and user pasted URL into main tab), handle it gracefully.
  const params = new URLSearchParams(window.location.search);
  const code = params.get("code");
  const pendingRaw = safeStore.get(PENDING_KEY);
  if (!code || !pendingRaw) return null;

  safeStore.remove(PENDING_KEY);
  const pending = JSON.parse(pendingRaw) as {
    provider: ProviderId;
    verifier: string;
    state: string;
    context: OAuthReturn["context"];
  };
  window.history.replaceState({}, "", window.location.pathname);

  const result = await exchangeCode(
    pending.provider,
    code,
    pending.verifier,
    callbackUrl(pending.provider),
    pending.state,
  );
  return { ...result, context: pending.context };
}

// ─── Vendor account fetch ─────────────────────────────────────────────────────

function parseJwt(token: string) {
  try {
    const base64Url = token.split(".")[1];
    const base64 = base64Url.replace(/-/g, "+").replace(/_/g, "/");
    return JSON.parse(decodeURIComponent(
      atob(base64).split("").map((c) => "%" + ("00" + c.charCodeAt(0).toString(16)).slice(-2)).join(""),
    ));
  } catch { return null; }
}

export interface VendorAccount {
  label: string;
  detail?: string;
}

export async function fetchVendorAccount(
  provider: ProviderId | string,
  apiKey: string,
): Promise<VendorAccount | null> {
  if (DEMO_MODE) {
    return { label: `Demo user · ${provider}`, detail: "Preview account" };
  }
  const pLower = provider.toLowerCase();
  try {
    if (pLower === "openrouter") {
      const res = await fetch(devUrl("https://openrouter.ai/api/v1/key"), {
        headers: { Authorization: `Bearer ${apiKey}` },
      });
      if (!res.ok) return null;
      const { data } = (await res.json()) as { data?: { label?: string; limit?: number | null; usage?: number } };
      const label = data?.label?.trim() || "OpenRouter account";
      const detail = data?.limit != null
        ? `$${(data.limit - (data.usage ?? 0)).toFixed(2)} credit left`
        : undefined;
      return { label, detail };
    }
    if (pLower === "chatgpt" || pLower === "codex" || pLower === "openai") {
      const payload = parseJwt(apiKey);
      const profile = payload?.["https://api.openai.com/profile"];
      const email = profile?.email || payload?.email;
      if (email) return { label: email, detail: "Connected via OpenAI" };
      return { label: "OpenAI User", detail: "Connected via OpenAI" };
    }
    if (pLower === "claude") {
      const res = await fetch(devUrl("https://api.anthropic.com/api/claude_cli/bootstrap"), {
        headers: { Authorization: `Bearer ${apiKey}`, "anthropic-beta": "oauth-2025-04-20" },
      });
      if (res.ok) {
        const data = await res.json();
        const email = data?.oauth_account?.account_email;
        if (email) return { label: email, detail: "Connected via Claude" };
      }
      const payload = parseJwt(apiKey);
      if (payload?.email) return { label: payload.email, detail: "Connected via Claude" };
      return { label: "Claude User", detail: "Connected via Claude" };
    }
    if (pLower === "gemini" || pLower === "antigravity") {
      try {
        const res = await fetch(`https://www.googleapis.com/oauth2/v1/userinfo?access_token=${encodeURIComponent(apiKey)}`);
        if (res.ok) {
          const data = (await res.json()) as { email?: string; name?: string };
          if (data.email) return { label: data.email, detail: data.name || "Connected via Google" };
        }
      } catch { /* fallback */ }
      try {
        const res = await fetch(devUrl("https://www.googleapis.com/oauth2/v1/userinfo"), {
          headers: { Authorization: `Bearer ${apiKey}` },
        });
        if (res.ok) {
          const data = (await res.json()) as { email?: string; name?: string };
          if (data.email) return { label: data.email, detail: data.name || "Connected via Google" };
        }
      } catch { /* fallback */ }
      const payload = parseJwt(apiKey);
      if (payload?.email) return { label: payload.email, detail: "Connected via Google" };
      return { label: "Google User", detail: "Connected via Google" };
    }
    if (pLower === "grok-cli" || pLower === "grok" || pLower === "xai") {
      const payload = parseJwt(apiKey);
      if (payload?.email) return { label: payload.email, detail: "Connected via Grok" };
    }
  } catch { /* fall through */ }
  return null;
}
