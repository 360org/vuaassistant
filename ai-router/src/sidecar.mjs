/**
 * VuaAssistant AI Router. This is a first-party local service.
 *
 * The inherited Provider Core is source code under `core/open-sse`; no
 * upstream 9router process, dashboard, cookie, database, or HTTP endpoint is
 * started or contacted by this service.
 */
import { createServer } from "node:http";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Readable } from "node:stream";
import REGISTRY from "../core/open-sse/providers/registry/index.js";
import { PROVIDERS, PROVIDER_MODELS } from "../core/open-sse/providers/index.js";
import { handleChatCore } from "../core/open-sse/handlers/chatCore.js";
import { handleComboChat } from "../core/open-sse/services/combo.js";
import {
  exchangeTokens,
  generateAuthData,
  getProvider,
  getProviderNames,
  pollForToken,
  requestDeviceCode,
} from "../core/src/lib/oauth/providers.js";

// AI Compatible registry entry, loaded directly into core registry at runtime.
// ponytail: dynamic provider registry via API is not needed, static push covers it.
const AI_COMPATIBLE_PROVIDER = {
  id: "ai-compatible",
  priority: 99,
  alias: "ai-compatible",
  display: {
    name: "AI Compatible",
    icon: "network_ping",
    color: "#10B981",
    notice: {
      text: "Kết nối đến các API tương thích OpenAI / 9router / OmiRouter khác.",
    },
  },
  category: "custom",
  authType: "apikey",
  authModes: ["apikey"],
  transport: {
    baseUrl: "https://api.openai.com/v1",
    format: "openai",
  },
  models: [
    { id: "auto", name: "Auto-detect / Load Models" }
  ],
  passthroughModels: true,
};
REGISTRY.push(AI_COMPATIBLE_PROVIDER);
PROVIDERS["ai-compatible"] = AI_COMPATIBLE_PROVIDER.transport;
PROVIDER_MODELS["ai-compatible"] = AI_COMPATIBLE_PROVIDER.models;

// Enable passthrough dynamic models for Google / Cloud Code providers to load from live Quotas API
const geminiCliReg = REGISTRY.find(e => e.id === "gemini-cli");
if (geminiCliReg) geminiCliReg.passthroughModels = true;
const antigravityReg = REGISTRY.find(e => e.id === "antigravity");
if (antigravityReg) antigravityReg.passthroughModels = true;

const host = process.env.AI_ROUTER_HOST || "127.0.0.1";
const port = Number(process.env.AI_ROUTER_PORT || 36360);
const uiOrigin = process.env.AI_ROUTER_UI_ORIGIN || "http://localhost:1420";
const callbackHost = process.env.AI_ROUTER_CALLBACK_HOST || "127.0.0.1";
const vaultPath = process.env.AI_ROUTER_VAULT_PATH || join(process.cwd(), ".vua_vault_dev.json");
const vaultBrokerUrl = process.env.AI_ROUTER_VAULT_BROKER_URL || "";
const vaultBrokerToken = process.env.AI_ROUTER_VAULT_BROKER_TOKEN || "";
const connectorToken = process.env.AI_ROUTER_CONNECTOR_TOKEN || "";
const connectionsRef = "ai-router:connections";
const packsPath = process.env.AI_ROUTER_PACKS_PATH || join(process.cwd(), ".vua_ai_router_packs.json");
const legacyConnectionPath = join(process.cwd(), ".vua_ai_router_connections.json");

function allowedUiOrigin(request) {
  const origin = request?.headers?.origin;
  if (!origin) return uiOrigin;
  try {
    const candidate = new URL(origin);
    if (
      ["127.0.0.1", "localhost"].includes(candidate.hostname) ||
      origin.includes("tauri") ||
      origin.includes("vassistant") ||
      origin.startsWith("app://")
    ) {
      return origin;
    }
  } catch {}
  return origin || uiOrigin;
}

function corsHeaders(request) {
  return {
    "access-control-allow-origin": allowedUiOrigin(request),
    "access-control-allow-methods": "GET, POST, DELETE, OPTIONS",
    "access-control-allow-headers": "authorization, content-type",
  };
}

let codexCallbackServer = null;
let codexCallbackTimer = null;
let codexCallbackReturnUri = null;
const loopbackCallbackRelays = new Map();

function stopCodexCallbackRelay() {
  if (codexCallbackTimer) clearTimeout(codexCallbackTimer);
  codexCallbackTimer = null;
  if (codexCallbackServer) codexCallbackServer.close();
  codexCallbackServer = null;
  codexCallbackReturnUri = null;
}

function validateLocalCallbackUri(value) {
  const callback = new URL(value);
  if (callback.protocol !== "http:" || !["127.0.0.1", "localhost"].includes(callback.hostname)) {
    throw new Error("OAuth callback must use a local HTTP origin.");
  }
  if (callback.pathname !== "/callback") {
    throw new Error("OAuth callback must use the VuaAssistant /callback route.");
  }
  return callback.toString();
}

/**
 * VuaAssistant compatibility relay for the callback URI registered by the
 * inherited Codex OAuth client. The provider Core still owns PKCE, authorize
 * parameters, and token exchange; this adapter only returns the browser to
 * VuaAssistant's existing /callback page.
 */
function startCodexCallbackRelay(returnUri) {
  codexCallbackReturnUri = validateLocalCallbackUri(returnUri);
  if (codexCallbackServer) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const relay = createServer((request, response) => {
      const callback = new URL(request.url || "/", "http://localhost:1455");
      if (callback.pathname !== "/auth/callback") {
        response.writeHead(404);
        response.end("Not found");
        return;
      }
      // A browser can arrive after the five-minute relay window expired.
      // Return a useful response instead of crashing the native sidecar.
      if (!codexCallbackReturnUri) {
        response.writeHead(410, { "Content-Type": "text/plain; charset=utf-8" });
        response.end("This VuaAssistant sign-in session has expired. Start sign-in again in the app.");
        return;
      }
      const destination = new URL(codexCallbackReturnUri);
      destination.search = callback.search;
      response.writeHead(302, { Location: destination.toString() });
      response.end();
      response.once("finish", stopCodexCallbackRelay);
    });
    relay.once("error", (error) => {
      if (codexCallbackServer === relay) codexCallbackServer = null;
      reject(error);
    });
    relay.listen(1455, callbackHost, () => {
      codexCallbackServer = relay;
      codexCallbackTimer = setTimeout(stopCodexCallbackRelay, 300_000);
      resolve();
    });
  });
}

function stopLoopbackCallbackRelay(key) {
  const relay = loopbackCallbackRelays.get(key);
  if (!relay) return;
  if (relay.timer) clearTimeout(relay.timer);
  relay.server.close();
  loopbackCallbackRelays.delete(key);
}

function startLoopbackCallbackRelay({ returnUri, listenHost, listenPort, callbackPath }) {
  const destinationUri = validateLocalCallbackUri(returnUri);
  const path = callbackPath || "/callback";
  const key = `${listenHost}:${listenPort}${path}`;
  if (loopbackCallbackRelays.has(key)) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const relay = createServer((request, response) => {
      const callback = new URL(request.url || "/", `http://${listenHost}:${listenPort}`);
      if (callback.pathname !== path) {
        response.writeHead(404);
        response.end("Not found");
        return;
      }
      const destination = new URL(destinationUri);
      destination.search = callback.search;
      response.writeHead(302, { Location: destination.toString() });
      response.end();
      response.once("finish", () => stopLoopbackCallbackRelay(key));
    });
    relay.once("error", (error) => {
      if (loopbackCallbackRelays.get(key)?.server === relay) loopbackCallbackRelays.delete(key);
      reject(error);
    });
    relay.listen(listenPort, listenHost, () => {
      const timer = setTimeout(() => stopLoopbackCallbackRelay(key), 300_000);
      loopbackCallbackRelays.set(key, { server: relay, timer });
      resolve();
    });
  });
}

function providerCatalog() {
  const oauthProviderNames = new Set(getProviderNames());
  return REGISTRY
    .map((entry) => {
      const authModes = Array.isArray(entry.authModes) ? entry.authModes : [];
      // `xai` targets api.x.ai. Its PKCE token is useful to the API transport,
      // but it is not the SuperGrok/Grok Build subscription connection.
      // Keep subscription sign-in exclusively on `grok-cli`, whose transport
      // is cli-chat-proxy.grok.com and which uses the official device flow.
      const subscriptionOAuth = oauthProviderNames.has(entry.id) && entry.id !== "xai";
      const oauth = entry.id !== "xai" && (
        Boolean(entry.oauth)
        || Boolean(entry.hasOAuth)
        || authModes.includes("oauth")
        || subscriptionOAuth
        || entry.id === "openrouter"
      );
      return {
        id: entry.id,
        name: entry.display?.name || entry.id,
        oauth,
        oauthProvider: subscriptionOAuth || entry.id === "openrouter" ? entry.id : undefined,
        cookie: entry.authType === "cookie" || entry.category === "webCookie",
        authHint: entry.authHint,
        apiKey: authModes.includes("apikey")
          || entry.authType === "apikey"
          || entry.category === "apiKey"
          || entry.category === "apikey"
          || entry.category === "freeTier"
          || entry.category === "free",
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

function oauthProviderCatalog() {
  return getProviderNames().map((id) => ({
    id,
    flowType: getProvider(id).flowType,
  })).sort((a, b) => a.id.localeCompare(b.id));
}

async function readVaultValue(ref) {
  if (vaultBrokerUrl && vaultBrokerToken) {
    const response = await fetch(`${vaultBrokerUrl}?ref=${encodeURIComponent(ref)}`, {
      headers: { Authorization: `Bearer ${vaultBrokerToken}` },
    });
    if (response.status === 404) return null;
    if (!response.ok) throw new Error(`AI Router Vault broker read failed (${response.status}).`);
    return (await response.json())?.value ?? null;
  }
  try {
    return JSON.parse(readFileSync(vaultPath, "utf8"))?.[ref] ?? null;
  } catch {
    return null;
  }
}

async function writeVaultValue(ref, value) {
  if (vaultBrokerUrl && vaultBrokerToken) {
    const response = await fetch(`${vaultBrokerUrl}?ref=${encodeURIComponent(ref)}`, {
      method: "PUT",
      headers: { Authorization: `Bearer ${vaultBrokerToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({ value }),
    });
    if (!response.ok) throw new Error(`AI Router Vault broker write failed (${response.status}).`);
    return;
  }
  let vault = {};
  try { vault = JSON.parse(readFileSync(vaultPath, "utf8")); } catch { /* first write */ }
  vault[ref] = value;
  writeFileSync(vaultPath, JSON.stringify(vault, null, 2), { mode: 0o600 });
}

async function deleteVaultValue(ref) {
  if (vaultBrokerUrl && vaultBrokerToken) {
    const response = await fetch(`${vaultBrokerUrl}?ref=${encodeURIComponent(ref)}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${vaultBrokerToken}` },
    });
    if (!response.ok && response.status !== 404) {
      throw new Error(`AI Router Vault broker delete failed (${response.status}).`);
    }
    return;
  }
  let vault = {};
  try { vault = JSON.parse(readFileSync(vaultPath, "utf8")); } catch { return; }
  delete vault[ref];
  writeFileSync(vaultPath, JSON.stringify(vault, null, 2), { mode: 0o600 });
}

/**
 * Whether a saved connection may serve chat requests.
 *
 * A fresh sign-in starts at "Pending test": the credential is saved but the
 * background smoke test has not answered yet. Requiring "Verified" here left
 * the user with a connected account and an empty model list — the promised
 * "login → chat" flow dead-ended, and a single flaky test call (rate limit,
 * transient 5xx, a retired probe model) made the app unusable.
 *
 * So the gate is negative: only a connection the smoke test actually rejected
 * ("Failed") is withheld. Pending and Verified both serve models.
 */
function isUsableConnection(connection) {
  return connection?.isActive !== false && connection?.testStatus !== "Failed";
}

async function readConnections() {
  try {
    let raw = await readVaultValue(connectionsRef);
    if (!raw && existsSync(legacyConnectionPath)) {
      raw = readFileSync(legacyConnectionPath, "utf8");
      const legacy = JSON.parse(raw);
      await writeVaultValue(connectionsRef, JSON.stringify({ connections: legacy.connections ?? [] }));
    }
    const data = typeof raw === "string" ? JSON.parse(raw) : {};
    const connections = Array.isArray(data.connections) ? data.connections : [];
    let migrated = false;
    const normalized = connections.map((connection) => {
      if (typeof connection?.id === "string" && !connection.credentialRef) {
        migrated = true;
        return { ...connection, credentialRef: `ai-router:credential:${connection.id}` };
      }
      return connection;
    });
    const providerCounts = new Map();
    for (let index = 0; index < normalized.length; index += 1) {
      const connection = normalized[index];
      const accountNumber = (providerCounts.get(connection.provider) || 0) + 1;
      providerCounts.set(connection.provider, accountNumber);
      const patch = {};
      if (typeof connection.priority !== "number") patch.priority = accountNumber;
      if (!connection.accountLabel) {
        const credentialRaw = connection.credentialRef ? await readVaultValue(connection.credentialRef) : null;
        let credential;
        try { credential = typeof credentialRaw === "string" ? JSON.parse(credentialRaw) : null; } catch { credential = null; }
        const email = typeof credential?.email === "string" ? credential.email : undefined;
        if (!connection.email && email) patch.email = email;
        if (email) patch.accountLabel = email;
      }
      if (!connection.label) {
        patch.label = connection.name || connection.provider;
      }
      if (Object.keys(patch).length) {
        normalized[index] = { ...connection, ...patch };
        migrated = true;
      }
    }
    if (migrated) await writeConnections(normalized);
    return normalized;
  } catch (error) {
    console.error(`[ai-router] could not read Vault connection metadata: ${error.message}`);
    return [];
  }
}

async function writeConnections(connections) {
  await writeVaultValue(connectionsRef, JSON.stringify({ connections }));
}

function readPacks() {
  try {
    const data = JSON.parse(readFileSync(packsPath, "utf8"));
    return Array.isArray(data.packs) ? data.packs : [];
  } catch {
    return [];
  }
}

function writePacks(packs) {
  writeFileSync(packsPath, JSON.stringify({ packs }, null, 2), { mode: 0o600 });
}

function accountModelId(provider, model, connectionId) {
  return `${provider}/${model}?account=${encodeURIComponent(connectionId)}`;
}

function modelAccount(modelId) {
  const marker = modelId.lastIndexOf("?account=");
  if (marker < 0) return { modelId, connectionId: null };
  try {
    return { modelId: modelId.slice(0, marker), connectionId: decodeURIComponent(modelId.slice(marker + 9)) };
  } catch {
    return { modelId: modelId.slice(0, marker), connectionId: null };
  }
}

/**
 * Bind each model in a pack to a live account.
 *
 * A pinned `?account=` used to be returned untouched, so signing in again —
 * which mints a new connection id and removes the old one — orphaned every
 * saved pack: the editor showed nothing selected, and the ids it had loaded
 * matched no checkbox, so the user could not clear them and saving always
 * failed with "model without a Verified connection". A pin to an account that
 * no longer exists is stale, not a preference, so it is re-bound here.
 */
function packModelsForConnections(models, connections) {
  const live = connections.filter(isUsableConnection);
  return models.map((modelId) => {
    if (modelId === "auto") return "auto";
    const pinIndex = modelId.indexOf("?account=");
    const bare = pinIndex < 0 ? modelId : modelId.slice(0, pinIndex);
    if (pinIndex >= 0) {
      const pinned = decodeURIComponent(modelId.slice(pinIndex + "?account=".length));
      if (live.some((item) => item.id === pinned)) return modelId;
    }
    const separator = bare.indexOf("/");
    const provider = separator > 0 ? bare.slice(0, separator) : "";
    const connection = live.find((item) => item.provider === provider);
    return connection ? `${bare}?account=${encodeURIComponent(connection.id)}` : bare;
  });
}

function modelsForConnections(connections, packs = []) {
  const models = new Map();
  for (const pack of packs) {
    if (!pack?.id || !pack?.name || !Array.isArray(pack.models) || !pack.models.length) continue;
    models.set(`pack:${pack.id}`, {
      id: `pack:${pack.id}`,
      name: pack.name,
      provider: "pack",
      kind: "pack",
      models: packModelsForConnections(pack.models, connections),
      strategy: pack.strategy || "fallback",
    });
  }
  for (const connection of connections) {
    // Pending connections are listed too, so a fresh sign-in can chat right
    // away; only a connection the smoke test rejected is withheld.
    if (!isUsableConnection(connection)) continue;
    const provider = REGISTRY.find((entry) => entry.id === connection.provider);
    if (!provider || !Array.isArray(provider.models) || provider.passthroughModels) continue;
    for (const model of provider.models
      .filter((model) => !model.kind || model.kind === "llm")
      .map((model) => ({
        id: accountModelId(provider.id, model.id, connection.id),
        name: model.name || model.id,
        provider: provider.id,
        connectionId: connection.id,
        accountLabel: connection.accountLabel || connection.email || connection.id,
      }))) models.set(model.id, model);
  }
  return [...models.values()];
}

async function dynamicModelsForConnection(connection) {
  const provider = REGISTRY.find((entry) => entry.id === connection.provider);
  const isCompatible = connection.provider === "ai-compatible";
  const isGoogleCloudCode = connection.provider === "gemini-cli" || connection.provider === "antigravity";
  if (!isCompatible && !isGoogleCloudCode && (!provider?.modelsFetcher?.url || !provider.passthroughModels)) return [];
  try {
    const credentials = await credentialsFromVault(connection);
    if (isGoogleCloudCode) {
      // Fetch dynamic quota from Google Cloud Code Assist API and return as model items
      const usage = await getUsageForProvider(connection).catch(() => null);
      if (usage && usage.quotas) {
        return Object.keys(usage.quotas).map((modelId) => ({
          id: accountModelId(connection.provider, modelId, connection.id),
          name: usage.quotas[modelId].displayName || modelId,
          provider: connection.provider,
          connectionId: connection.id,
          accountLabel: connection.accountLabel || connection.email || connection.id,
        }));
      }
      return [];
    }
    const baseUrl = credentials?.providerSpecificData?.baseUrl || credentials?.baseUrl;
    const fetchUrl = isCompatible && baseUrl
      ? `${baseUrl.replace(/\/$/, "")}/models`
      : provider.modelsFetcher.url;
    const headers = {};
    const token = credentials.apiKey || credentials.accessToken;
    if (token) headers.Authorization = `Bearer ${token}`;
    const response = await fetch(fetchUrl, { headers });
    if (!response.ok) return [];
    const payload = await response.json();
    const items = Array.isArray(payload) ? payload : Array.isArray(payload?.data) ? payload.data : [];
    const provId = provider?.id || connection.provider;
    return items
      .filter((item) => typeof item?.id === "string")
      .map((item) => ({
        id: accountModelId(provId, item.id, connection.id),
        name: typeof item.name === "string" ? item.name : item.id,
        provider: provId,
        connectionId: connection.id,
        accountLabel: connection.accountLabel || connection.email || connection.id,
      }));
  } catch {
    return [];
  }
}

async function allModelsForConnections(connections, packs = []) {
  const models = new Map(modelsForConnections(connections, packs).map((model) => [model.id, model]));
  for (const connection of connections) {
    if (!isUsableConnection(connection)) continue;
    // A vendor catalogue fetch can fail independently (expired token, offline);
    // that must not wipe out the static models already collected above.
    try {
      for (const model of await dynamicModelsForConnection(connection)) models.set(model.id, model);
    } catch {
      /* keep the static catalogue for this connection */
    }
  }
  return [...models.values()];
}

async function findConnection(id) {
  return (await readConnections()).find((connection) => connection.id === id);
}

async function updateConnection(id, patch) {
  const connections = await readConnections();
  const index = connections.findIndex((connection) => connection.id === id);
  if (index < 0) return null;
  const updated = { ...connections[index], ...patch };
  connections[index] = updated;
  await writeConnections(connections);
  return updated;
}

async function deleteConnection(id) {
  const connections = await readConnections();
  const connection = connections.find((item) => item.id === id);
  const next = connections.filter((connection) => connection.id !== id);
  if (next.length === connections.length) return false;
  await writeConnections(next);
  if (connection?.credentialRef) await deleteVaultValue(connection.credentialRef);
  return true;
}

function readJson(request) {
  return new Promise((resolve, reject) => {
    let body = "";
    request.on("data", (chunk) => {
      body += chunk;
      if (body.length > 64_000) request.destroy(new Error("Request body is too large"));
    });
    request.on("error", reject);
    request.on("end", () => {
      try { resolve(JSON.parse(body || "{}")); } catch { reject(new Error("Invalid JSON request body")); }
    });
  });
}

async function credentialsFromVault(connection) {
  const credentialRef = typeof connection.credentialRef === "string" ? connection.credentialRef : "";
  if (!credentialRef.startsWith("ai-router:credential:")) {
    throw new Error("AI Router connection has no valid Vault credential reference.");
  }
  const raw = await readVaultValue(credentialRef);
  let stored;
  try { stored = typeof raw === "string" ? JSON.parse(raw) : null; } catch { stored = null; }
  if (!stored || typeof stored !== "object") throw new Error("AI Router Vault credential is invalid.");
  return {
    connectionId: connection.id,
    connectionName: connection.accountLabel || connection.email || connection.name || connection.id,
    accessToken: typeof stored.accessToken === "string" ? stored.accessToken : undefined,
    apiKey: typeof stored.apiKey === "string" ? stored.apiKey : undefined,
    refreshToken: typeof stored.refreshToken === "string" ? stored.refreshToken : undefined,
    projectId: typeof stored.projectId === "string" ? stored.projectId : undefined,
    expiresAt: typeof stored.expiresAt === "number" || typeof stored.expiresAt === "string"
      ? stored.expiresAt
      : undefined,
    idToken: typeof stored.idToken === "string" ? stored.idToken : undefined,
    email: typeof stored.email === "string" ? stored.email : undefined,
    lastRefreshAt: typeof stored.lastRefreshAt === "string" ? stored.lastRefreshAt : undefined,
    scope: typeof stored.scope === "string" ? stored.scope : undefined,
    providerSpecificData: stored.providerSpecificData && typeof stored.providerSpecificData === "object"
      ? stored.providerSpecificData
      : undefined,
  };
}

async function persistRefreshedCredentials(connection, refreshed) {
  const credentialRef = typeof connection?.credentialRef === "string" ? connection.credentialRef : "";
  if (!credentialRef.startsWith("ai-router:credential:")) {
    throw new Error("AI Router connection has no valid Vault credential reference.");
  }

  const raw = await readVaultValue(credentialRef);
  let stored;
  try { stored = typeof raw === "string" ? JSON.parse(raw) : null; } catch { stored = null; }
  if (!stored || typeof stored !== "object") {
    throw new Error("AI Router Vault credential is invalid.");
  }

  // Persist only the refreshed credential shape. The secret itself remains sealed in Vault.
  const next = { ...stored };
  for (const key of ["accessToken", "apiKey", "refreshToken", "idToken", "expiresAt", "expiresIn", "lastRefreshAt", "projectId"]) {
    if (refreshed?.[key] !== undefined) next[key] = refreshed[key];
  }
  if (refreshed?.providerSpecificData && typeof refreshed.providerSpecificData === "object") {
    next.providerSpecificData = { ...(stored.providerSpecificData || {}), ...refreshed.providerSpecificData };
  }
  await writeVaultValue(credentialRef, JSON.stringify(next));
}

function connectionErrorSummary(connection, status, detail = "") {
  const label = connection?.label || connection?.name || connection?.provider || "This provider";
  // Một 403 vì "gói dịch vụ không có model này" KHÔNG phải đăng nhập hỏng.
  // Gộp chung hai thứ là đẩy người dùng đi tạo khoá mới trong khi khoá của họ
  // vẫn tốt — họ làm mãi cũng không hết lỗi vì đang sửa nhầm chỗ.
  if (isAccountAuthError(status, detail)) {
    return `${label} sign-in expired or was revoked. Reset and sign in again.`;
  }
  return detail || `${label} returned HTTP ${status}.`;
}

async function providerAccountIdentity(connection, credentials) {
  try {
    const token = credentials.apiKey || credentials.accessToken;
    if (!token) return null;
    if (connection.provider === "claude") {
      const response = await fetch("https://api.anthropic.com/api/claude_cli/bootstrap", {
        headers: {
          Authorization: `Bearer ${token}`,
          "anthropic-beta": "oauth-2025-04-20",
        },
      });
      if (!response.ok) return null;
      const data = await response.json();
      const account = data?.oauth_account || data?.account || {};
      const email = account.account_email || account.email;
      const displayName = account.display_name || account.full_name || account.name || account.username;
      return email || displayName || null;
    }
    if (connection.provider === "openrouter") {
      const response = await fetch("https://openrouter.ai/api/v1/key", {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!response.ok) return null;
      const data = (await response.json())?.data || {};
      return data.email
        || data.full_name
        || data.username
        || data.name
        || data.creator_user_id
        || data.label
        || null;
    }
  } catch {
    return null;
  }
  return null;
}

async function resolveModel(modelId) {
  const connections = await readConnections();
  if (modelId && modelId !== "auto") {
    const accountVariant = modelAccount(modelId);
    const separator = accountVariant.modelId.indexOf("/");
    if (separator > 0) {
      const provider = accountVariant.modelId.slice(0, separator);
      const model = accountVariant.modelId.slice(separator + 1);
      const candidates = connections.filter((item) =>
        item.provider === provider
        && isUsableConnection(item)
        && (!accountVariant.connectionId || item.id === accountVariant.connectionId)
      );
      if (candidates.length) return { provider, model, connection: candidates[0], candidates };
    }
  }

  for (const connection of connections) {
    if (!isUsableConnection(connection)) continue;
    const provider = REGISTRY.find((entry) => entry.id === connection.provider);
    const defaultModel = connection.defaultModel
      ? provider?.models?.find((item) => item.id === connection.defaultModel)
      : undefined;
    const model = defaultModel || provider?.models?.find((item) => !item.kind || item.kind === "llm");
    if (provider && model) {
      const candidates = connections.filter((item) =>
        item.provider === provider.id && isUsableConnection(item)
      );
      return { provider: provider.id, model: model.id, connection, candidates };
    }
    if (provider?.passthroughModels || connection.provider === "ai-compatible") {
      const dynamic = await dynamicModelsForConnection(connection).catch(() => []);
      const firstDynamic = dynamic[0];
      if (firstDynamic) {
        const parsed = modelAccount(firstDynamic.id);
        const slash = parsed.modelId.indexOf("/");
        const dynamicModelId = slash > 0 ? parsed.modelId.slice(slash + 1) : parsed.modelId;
        const candidates = connections.filter((item) =>
          item.provider === provider.id && isUsableConnection(item)
        );
        return { provider: provider.id, model: dynamicModelId, connection, candidates };
      }
    }
  }
  return null;
}

function routerLog() {
  return {
    debug() {}, info() {}, warn() {}, error() {}, line() {}, errorLine() {},
    tagForSession() { return "local"; }, nextTag() { return "local"; },
  };
}

function credentialFields(entry) {
  const fields = new Map();
  for (const key of ["username", "password"]) {
    if (typeof entry?.[key] === "string") fields.set(key, entry[key]);
  }
  for (const field of Array.isArray(entry?.fields) ? entry.fields : []) {
    if (typeof field?.label === "string" && typeof field?.value === "string") {
      fields.set(field.label.toLowerCase().trim(), field.value);
    }
  }
  return fields;
}

function resolveCredentialVariables(template, fields) {
  return template.replace(/\{\{credential:([^{}]+)\}\}/gi, (_match, name) => {
    const value = fields.get(String(name).toLowerCase().trim());
    if (typeof value !== "string") throw new Error(`Credential variable is unavailable: ${name}`);
    return value;
  });
}

function redactSecrets(text, fields) {
  let redacted = text;
  for (const [name, value] of fields) {
    if (name === "url" || value.length < 3) continue;
    redacted = redacted.split(value).join(`[REDACTED:${name}]`);
  }
  return redacted;
}

// ─── Telegram channel ────────────────────────────────────────────────────────
//
// Telegram carries the bot token in the URL path (`/bot<token>/getUpdates`),
// which the connector gateway deliberately refuses — a credential must never
// appear in a connector URL. So the channel lives here instead: the router is
// the only component allowed to resolve Vault secrets, and it performs the
// Telegram calls itself. Callers (the Agent Runner) drive the channel through
// these endpoints and never see the token.

const TELEGRAM_API = "https://api.telegram.org";
const TELEGRAM_MAX = 4096;

/** The Vault entry holding the bot token, plus its resolved fields. */
async function telegramCredentials() {
  const indexRaw = await readVaultValue("vault-index");
  let index = [];
  try {
    index = typeof indexRaw === "string" ? JSON.parse(indexRaw) : [];
  } catch {
    index = [];
  }
  const meta = (Array.isArray(index) ? index : []).find(
    (item) =>
      typeof item?.id === "string" &&
      /telegram/i.test(`${item.label ?? ""} ${item.service ?? ""}`),
  );
  if (!meta) return null;

  const raw = await readVaultValue(`vault-entry:${meta.id}`);
  let entry = null;
  try {
    entry = typeof raw === "string" ? JSON.parse(raw) : null;
  } catch {
    entry = null;
  }
  if (!entry) return null;

  const fields = credentialFields(entry);
  const pick = (...names) => {
    for (const name of names) {
      const value = fields.get(name);
      if (typeof value === "string" && value.trim()) return value.trim();
    }
    return null;
  };
  const token = pick("bot token", "bottoken", "token") ||
    [...fields.entries()].find(([name]) => /token/i.test(name))?.[1] || null;
  const chatId = pick("chat id", "chatid") ||
    [...fields.entries()].find(([name]) => /chat/i.test(name))?.[1] || null;

  return token ? { token, chatId, fields } : null;
}

function requireConnectorToken(request, response) {
  if (!connectorToken || request.headers.authorization !== `Bearer ${connectorToken}`) {
    sendJson(response, 401, { error: "Connector capability is invalid." });
    return false;
  }
  return true;
}

/** Long-poll Telegram for updates. Returns messages only — never the token. */
async function handleTelegramUpdates(request, response, input) {
  if (!requireConnectorToken(request, response)) return;
  const credentials = await telegramCredentials();
  if (!credentials) {
    sendJson(response, 404, { error: "No Telegram bot token is stored in the Vault." });
    return;
  }
  const offset = Number.isFinite(Number(input?.offset)) ? Number(input.offset) : 0;
  const timeout = Math.min(50, Math.max(0, Number(input?.timeout) || 0));
  try {
    const url =
      `${TELEGRAM_API}/bot${credentials.token}/getUpdates?timeout=${timeout}` +
      (offset ? `&offset=${offset}` : "");
    const upstream = await fetch(url);
    const data = await upstream.json();
    if (!data.ok) throw new Error(data.description || "getUpdates failed");
    const updates = (Array.isArray(data.result) ? data.result : []).map((update) => ({
      updateId: update.update_id,
      text: update.message?.text ?? null,
      chatId: update.message?.chat?.id ?? null,
    }));
    sendJson(response, 200, { updates });
  } catch (error) {
    sendJson(response, 502, {
      error: redactSecrets(error instanceof Error ? error.message : String(error), credentials.fields),
    });
  }
}

/** Send a message as the bot. The caller supplies text and chat id only. */
async function handleTelegramSend(request, response, input) {
  if (!requireConnectorToken(request, response)) return;
  const credentials = await telegramCredentials();
  if (!credentials) {
    sendJson(response, 404, { error: "No Telegram bot token is stored in the Vault." });
    return;
  }
  const chatId = input?.chatId ?? credentials.chatId;
  const text = typeof input?.text === "string" ? input.text : "";
  if (chatId == null || !text.trim()) {
    sendJson(response, 400, { error: "chatId and text are required." });
    return;
  }
  try {
    const upstream = await fetch(`${TELEGRAM_API}/bot${credentials.token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text: text.slice(0, TELEGRAM_MAX) }),
    });
    const data = await upstream.json();
    if (!data.ok) throw new Error(data.description || "sendMessage failed");
    sendJson(response, 200, { ok: true });
  } catch (error) {
    sendJson(response, 502, {
      error: redactSecrets(error instanceof Error ? error.message : String(error), credentials.fields),
    });
  }
}

/** Whether a bot token is configured, without revealing it. */
async function handleTelegramStatus(request, response) {
  if (!requireConnectorToken(request, response)) return;
  const credentials = await telegramCredentials();
  sendJson(response, 200, {
    configured: Boolean(credentials),
    hasChatId: Boolean(credentials?.chatId),
  });
}

async function handleVaultManifest(request, response) {
  if (!connectorToken || request.headers.authorization !== `Bearer ${connectorToken}`) {
    sendJson(response, 401, { error: "Connector capability is invalid." });
    return;
  }
  try {
    const indexRaw = await readVaultValue("vault-index");
    const index = typeof indexRaw === "string" ? JSON.parse(indexRaw) : [];
    const entries = [];
    for (const meta of Array.isArray(index) ? index : []) {
      if (typeof meta?.id !== "string") continue;
      const raw = await readVaultValue(`vault-entry:${meta.id}`);
      let entry;
      try { entry = typeof raw === "string" ? JSON.parse(raw) : null; } catch { entry = null; }
      if (!entry || typeof entry !== "object") continue;
      const fields = [];
      for (const name of ["username", "password"]) {
        if (typeof entry[name] === "string" && entry[name]) fields.push(name);
      }
      for (const field of Array.isArray(entry.fields) ? entry.fields : []) {
        if (typeof field?.label === "string" && field.label.trim()) fields.push(field.label.trim());
      }
      entries.push({
        ref: `vault-entry:${meta.id}`,
        label: typeof meta.label === "string" ? meta.label : meta.id,
        service: typeof meta.service === "string" ? meta.service : undefined,
        fields,
      });
    }
    sendJson(response, 200, { entries });
  } catch (error) {
    sendJson(response, 500, { error: error instanceof Error ? error.message : String(error) });
  }
}

async function handleConnectorRequest(request, response, input) {
  if (!connectorToken || request.headers.authorization !== `Bearer ${connectorToken}`) {
    sendJson(response, 401, { error: "Connector capability is invalid." });
    return;
  }
  const credentialRef = typeof input.credentialRef === "string" ? input.credentialRef : "";
  if (!credentialRef.startsWith("vault-entry:")) {
    sendJson(response, 400, { error: "A Vault entry reference is required." });
    return;
  }
  try {
    const raw = await readVaultValue(credentialRef);
    const entry = typeof raw === "string" ? JSON.parse(raw) : null;
    if (!entry || typeof entry.url !== "string") throw new Error("Vault entry has no connector origin URL.");
    const allowedOrigin = new URL(entry.url).origin;
    const target = new URL(typeof input.url === "string" && input.url ? input.url : entry.url, entry.url);
    if (target.origin !== allowedOrigin) throw new Error("Connector request origin does not match its Vault entry.");
    if (/\{\{credential:/i.test(target.href)) throw new Error("Credential variables are not allowed in connector URLs.");
    const method = typeof input.method === "string" ? input.method.toUpperCase() : "GET";
    if (!new Set(["GET", "POST", "PUT", "PATCH", "DELETE"]).has(method)) {
      throw new Error("Connector method is not allowed.");
    }
    const fields = credentialFields(entry);
    const headers = {};
    for (const [key, value] of Object.entries(input.headers && typeof input.headers === "object" ? input.headers : {})) {
      if (typeof value !== "string") continue;
      if (/^(host|content-length|cookie)$/i.test(key)) throw new Error(`Connector header is not allowed: ${key}`);
      if (/^(authorization|proxy-authorization|x-api-key)$/i.test(key) && !/\{\{credential:/i.test(value)) {
        throw new Error(`Credential header must use an opaque Vault variable: ${key}`);
      }
      headers[key] = resolveCredentialVariables(value, fields);
    }
    const body = typeof input.body === "string" ? resolveCredentialVariables(input.body, fields) : undefined;
    const upstream = await fetch(target, { method, headers, body, redirect: "manual" });
    const text = redactSecrets((await upstream.text()).slice(0, 65_536), fields);
    sendJson(response, 200, { status: upstream.status, ok: upstream.ok, body: text });
  } catch (error) {
    sendJson(response, 422, { error: error instanceof Error ? error.message : String(error) });
  }
}

async function handleChat(request, response, input) {
  const modelId = typeof input.model === "string" ? input.model : "";
  const packs = readPacks();
  const pack = modelId.startsWith("pack:")
    ? packs.find((item) => item.id === modelId.slice(5))
    : null;
  const routeModel = async (body, selectedModel) => {
    let resolved = await resolveModel(selectedModel);
    if (!resolved && pack) {
      // Auto-fallback in pack: if a specific pinned model has no active connection,
      // try resolving dynamically without connection pin or fallback to any active model
      resolved = await resolveModel("auto");
    }
    if (!resolved) {
      return new Response(JSON.stringify({ error: { message: "The selected model has no active AI Router connection." } }), {
        status: 503,
        headers: { "content-type": "application/json" },
      });
    }
    const { provider, model } = resolved;
    const candidates = resolved.candidates?.length ? resolved.candidates : [resolved.connection];
    let lastError = "AI Router received no provider response.";
    for (let index = 0; index < candidates.length; index += 1) {
      const connection = candidates[index];
      const hasNextAccount = index < candidates.length - 1;
      try {
        const credentials = await credentialsFromVault(connection);
        const result = await handleChatCore({
          body: { ...body, model: `${provider}/${model}` },
          modelInfo: { provider, model },
          credentials,
          connectionId: connection.id,
          apiKey: credentials.apiKey || credentials.accessToken,
          log: routerLog(),
          clientRawRequest: { endpoint: request.url || "/v1/chat/completions", body, headers: request.headers },
          onCredentialsRefreshed: (refreshed) => persistRefreshedCredentials(connection, refreshed),
        });
        const upstream = result?.response;
        if (!upstream) {
          lastError = result?.error || lastError;
          if (hasNextAccount) continue;
          return new Response(JSON.stringify({ error: { message: lastError } }), { status: 502, headers: { "content-type": "application/json" } });
        }
        const retryable = [401, 403, 408, 409, 429, 500, 502, 503, 504, 529].includes(upstream.status);
        if (!upstream.ok && (upstream.status === 401 || upstream.status === 403)) {
          lastError = connectionErrorSummary(connection, upstream.status);
          await updateConnection(connection.id, {
            testStatus: "Failed",
            lastError,
            lastErrorAt: new Date().toISOString(),
          });
        }
        if (hasNextAccount && retryable) {
          if (upstream.status !== 401 && upstream.status !== 403) {
            lastError = `Account ${connection.accountLabel || connection.id} returned HTTP ${upstream.status}.`;
          }
          await upstream.body?.cancel().catch(() => {});
          await updateConnection(connection.id, { lastError, lastErrorAt: new Date().toISOString() });
          continue;
        }
        return upstream;
      } catch (error) {
        lastError = error instanceof Error ? error.message : String(error);
        if (!hasNextAccount) break;
      }
    }
    return new Response(JSON.stringify({ error: { message: lastError } }), { status: 500, headers: { "content-type": "application/json" } });
  };

  const upstream = pack
    ? await handleComboChat({
        body: input,
        models: pack.models,
        handleSingleModel: routeModel,
        log: routerLog(),
        comboName: pack.name,
        comboStrategy: pack.strategy || "fallback",
        comboStickyLimit: pack.stickyLimit || 1,
        autoSwitch: pack.autoSwitch !== false,
      })
    : await routeModel(input, modelId);
  const headers = { ...corsHeaders(request) };
  upstream.headers.forEach((value, key) => { headers[key] = value; });
  response.writeHead(upstream.status, headers);
  if (upstream.body) Readable.fromWeb(upstream.body).pipe(response);
  else response.end(await upstream.text());
}

/**
 * Một lỗi thuộc về TÀI KHOẢN (khoá sai, hết hạn, bị thu hồi) hay chỉ thuộc về
 * MODEL đang dò (gói dịch vụ không có model đó, model đã bị gỡ)?
 *
 * Phân biệt được hai thứ này là điều kiện để không chẩn đoán sai. Trước đây
 * mọi lỗi đều bị gộp thành "đăng nhập hết hạn", nên người dùng có tài khoản
 * hoàn toàn tốt vẫn bị bảo đi tạo khoá mới — làm mãi cũng không hết lỗi vì họ
 * đang sửa nhầm chỗ.
 */
function isModelAccessError(status, detail = "") {
  if (status === 404) return true;
  const text = String(detail);
  // Không ép thứ tự chữ: nhà cung cấp viết đủ kiểu — "model X not supported",
  // "your plan does not include model X", "no access to this model". Bắt theo
  // thứ tự cố định là bỏ sót đúng những câu hay gặp nhất.
  const mentionsModel = /\bmodels?\b/i.test(text);
  const accessPhrase =
    /(not found|not supported|unsupported|does not exist|does not include|not included|unavailable|no access|not allowed|not enabled|not entitled|invalid model|no quota|quota exceeded)/i
      .test(text);
  if (mentionsModel && accessPhrase) return true;
  // Câu nói về GÓI DỊCH VỤ cũng thuộc về quyền dùng model, không phải khoá hỏng.
  return /(plan|tier|subscription)[^\n]{0,60}(does not include|not included|upgrade|not entitled)/i
    .test(text);
}

function isAccountAuthError(status, detail = "") {
  if (status === 401) return true;
  if (isModelAccessError(status, detail)) return false;
  return status === 403 ||
    /authentication_error|invalid_api_key|invalid credentials|access token has been revoked|permissiondenied/i.test(detail);
}

/**
 * Danh sách model để dò, xếp theo thứ tự đáng thử nhất.
 *
 * Với nhà cung cấp có `passthroughModels` (Gemini CLI, Antigravity, endpoint
 * tuỳ chỉnh), danh sách ĐỘNG mới là thứ tài khoản thật sự có quyền dùng — lấy
 * từ chính API quota của nhà cung cấp. Trước đây danh sách động chỉ được dùng
 * khi registry tĩnh RỖNG, mà registry luôn có sẵn model, nên thực tế không bao
 * giờ chạy tới: bài kiểm tra luôn dò đúng một model tĩnh cứng
 * (`gemini-2.5-flash`, `gemini-3.6-flash-high`). Gói dịch vụ nào không có đúng
 * model đó là bị báo hỏng cả kết nối, dù 13 model còn lại vẫn chạy tốt.
 */
async function testableModels(connection, provider) {
  const candidates = [];
  const seen = new Set();
  const add = (id, name) => {
    if (!id || seen.has(id)) return;
    seen.add(id);
    candidates.push({ id, name: name || id });
  };

  if (provider?.passthroughModels || connection.provider === "ai-compatible") {
    const dynamic = await dynamicModelsForConnection(connection).catch(() => []);
    // Model rẻ nhất trước: bài kiểm tra không nên tốn tiền của người dùng.
    const ordered = [
      ...dynamic.filter((item) => /free|flash|mini|lite|small/i.test(item.id)),
      ...dynamic,
    ];
    for (const item of ordered) {
      add(modelAccount(item.id).modelId.slice(connection.provider.length + 1), item.name);
    }
  }

  for (const item of provider?.models || []) {
    if (item.kind && item.kind !== "llm") continue;
    add(item.id, item.name);
  }
  return candidates;
}

async function testConnection(id) {
  const connection = await findConnection(id);
  if (!connection) throw new Error("AI Router connection was not found.");
  const provider = REGISTRY.find((entry) => entry.id === connection.provider);
  const provId = provider?.id || connection.provider;
  const candidates = await testableModels(connection, provider);
  if (!provId || candidates.length === 0) {
    throw new Error("This provider returned no testable language model.");
  }

  const credentials = await credentialsFromVault(connection);
  // Dò tối đa vài model. Một tài khoản không có quyền dùng model A nhưng dùng
  // tốt model B thì KHÔNG phải là kết nối hỏng — báo hỏng là chẩn đoán sai và
  // đẩy người dùng đi đăng nhập lại vô ích.
  const attempts = candidates.slice(0, 4);
  let lastStatus = 0;
  let lastDetail = "";
  let lastModel = "";

  for (const model of attempts) {
    lastModel = model.id;
    try {
      const body = {
        model: `${provId}/${model.id}`,
        messages: [{ role: "user", content: "Reply with OK." }],
        max_tokens: 16,
        stream: false,
      };
      const result = await handleChatCore({
        body,
        modelInfo: { provider: provId, model: model.id },
        credentials,
        connectionId: connection.id,
        apiKey: credentials.apiKey || credentials.accessToken,
        log: routerLog(),
        clientRawRequest: { endpoint: "/v1/providers/test", body, headers: {} },
        onCredentialsRefreshed: (refreshed) => persistRefreshedCredentials(connection, refreshed),
      });
      const upstream = result?.response;
      if (!upstream) {
        lastStatus = 0;
        lastDetail = result?.error || "AI Router received no provider response.";
      } else {
        const responseText = await upstream.text();
        if (upstream.ok) {
          const identity = await providerAccountIdentity(connection, credentials);
          const updated = await updateConnection(connection.id, {
            testStatus: "Verified",
            lastError: undefined,
            lastTestedAt: new Date().toISOString(),
            ...(identity ? {
              email: identity.includes("@") ? identity : connection.email,
              accountLabel: connection.email || identity,
            } : {}),
          });
          return { valid: true, connection: updated, model: `${provId}/${model.id}` };
        }
        lastStatus = upstream.status;
        lastDetail = responseText.slice(0, 500) || `Provider returned HTTP ${upstream.status}.`;
      }
    } catch (error) {
      lastStatus = 0;
      lastDetail = error instanceof Error ? error.message : String(error);
    }

    // Khoá/tài khoản hỏng thì dò thêm model nữa cũng vô ích — dừng ngay.
    if (isAccountAuthError(lastStatus, lastDetail)) break;
  }

  const message = isModelAccessError(lastStatus, lastDetail)
    ? `Tài khoản này đăng nhập được nhưng không dùng được model đã thử (${lastModel}). ` +
      `Chi tiết: ${lastDetail.slice(0, 300)}`
    : connectionErrorSummary(connection, lastStatus, lastDetail);

  await updateConnection(connection.id, {
    testStatus: "Failed",
    lastError: message,
    lastTestedAt: new Date().toISOString(),
  });
  throw new Error(message);
}

function sendJson(response, status, payload) {
  const body = JSON.stringify(payload);
  response.writeHead(status, {
    ...corsHeaders(response.req),
    "content-type": "application/json",
    "content-length": Buffer.byteLength(body),
  });
  response.end(body);
}

const server = createServer((request, response) => {
  const url = new URL(request.url || "/", `http://${host}:${port}`);
  if (request.method === "OPTIONS") {
    response.writeHead(204, corsHeaders(request));
    response.end();
    return;
  }
  if (url.pathname === "/health") {
    sendJson(response, 200, { ok: true, service: "ai-router", mode: "native-core", providerCore: "mounted", providerCount: providerCatalog().length });
    return;
  }
  if (url.pathname === "/v1/providers/catalog") {
    sendJson(response, 200, { providers: providerCatalog() });
    return;
  }
  if (url.pathname === "/v1/oauth/providers" && request.method === "GET") {
    sendJson(response, 200, { providers: oauthProviderCatalog() });
    return;
  }
  if (url.pathname === "/v1/oauth/authorize" && request.method === "POST") {
    void readJson(request).then(async (input) => {
      const provider = typeof input.provider === "string" ? input.provider : "";
      let redirectUri = typeof input.redirectUri === "string" ? input.redirectUri : "";
      if (!provider || !redirectUri) throw new Error("OAuth provider and redirect URI are required.");
      if (provider === "codex") {
        // The OpenAI Codex OAuth client redirects to the fixed local relay.
        // A Tauri WebView origin is not a valid callback destination, so the
        // relay always returns the browser to the app's local manual callback.
        await startCodexCallbackRelay(redirectUri);
        redirectUri = "http://localhost:1455/auth/callback";
      } else if (provider === "claude") {
        redirectUri = "http://localhost:443/callback";
      } else if (provider === "antigravity") {
        // The inherited Google OAuth client only registers this loopback URI.
        // Never forward a Tauri/WebView origin to Google: it is not an OAuth
        // callback origin and Google rejects it before the user can sign in.
        redirectUri = "http://localhost:1420/callback";
      } else if (provider === "xai") {
        const oauthProvider = getProvider(provider);
        const listenPort = Number(oauthProvider.fixedPort || 56121);
        const callbackPath = oauthProvider.callbackPath || "/callback";
        await startLoopbackCallbackRelay({
          returnUri: redirectUri,
          listenHost: callbackHost,
          listenPort,
          callbackPath,
        });
        redirectUri = `http://127.0.0.1:${listenPort}${callbackPath}`;
      }
      sendJson(response, 200, await generateAuthData(provider, redirectUri, input.meta));
    }).catch((error) => sendJson(response, 400, { error: error instanceof Error ? error.message : String(error) }));
    return;
  }
  if (url.pathname === "/v1/oauth/exchange" && request.method === "POST") {
    void readJson(request).then(async (input) => {
      const provider = typeof input.provider === "string" ? input.provider : "";
      const code = typeof input.code === "string" ? input.code : "";
      const redirectUri = typeof input.redirectUri === "string" ? input.redirectUri : "";
      const verifier = typeof input.codeVerifier === "string" ? input.codeVerifier : "";
      const state = typeof input.state === "string" ? input.state : "";
      if (!provider || !code || !redirectUri) throw new Error("OAuth provider, callback code, and redirect URI are required.");
      sendJson(response, 200, { tokens: await exchangeTokens(provider, code, redirectUri, verifier, state, input.meta) });
    }).catch((error) => sendJson(response, 422, { error: error instanceof Error ? error.message : String(error) }));
    return;
  }
  if (url.pathname === "/v1/oauth/device/start" && request.method === "POST") {
    void readJson(request).then(async (input) => {
      const provider = typeof input.provider === "string" ? input.provider : "";
      const codeChallenge = typeof input.codeChallenge === "string" ? input.codeChallenge : "";
      if (!provider) throw new Error("OAuth provider is required.");
      sendJson(response, 200, { device: await requestDeviceCode(provider, codeChallenge, input.options) });
    }).catch((error) => sendJson(response, 400, { error: error instanceof Error ? error.message : String(error) }));
    return;
  }
  if (url.pathname === "/v1/oauth/device/poll" && request.method === "POST") {
    void readJson(request).then(async (input) => {
      const provider = typeof input.provider === "string" ? input.provider : "";
      const deviceCode = typeof input.deviceCode === "string" ? input.deviceCode : "";
      const verifier = typeof input.codeVerifier === "string" ? input.codeVerifier : "";
      if (!provider || !deviceCode) throw new Error("OAuth provider and device code are required.");
      sendJson(response, 200, await pollForToken(provider, deviceCode, verifier, input.extraData));
    }).catch((error) => sendJson(response, 422, { error: error instanceof Error ? error.message : String(error) }));
    return;
  }
  if (url.pathname === "/v1/providers" && request.method === "GET") {
    void readConnections()
      .then((connections) => {
        const sorted = [...connections].sort((a, b) => {
          const aDisabled = a.isActive === false;
          const bDisabled = b.isActive === false;
          if (aDisabled && !bDisabled) return 1;
          if (!aDisabled && bDisabled) return -1;
          return 0;
        });
        sendJson(response, 200, { connections: sorted });
      })
      .catch((error) => sendJson(response, 500, { error: error instanceof Error ? error.message : String(error) }));
    return;
  }
  if (url.pathname === "/v1/packs" && request.method === "GET") {
    sendJson(response, 200, { packs: readPacks() });
    return;
  }
  if (url.pathname === "/v1/packs" && request.method === "POST") {
    void readJson(request).then(async (input) => {
      const name = typeof input.name === "string" ? input.name.trim() : "";
      const models = Array.isArray(input.models)
        ? [...new Set(input.models.filter((model) => typeof model === "string" && (model.includes("/") || model === "auto")))]
        : [];
      if (!name || models.length < 2) throw new Error("A pack needs a name and at least two models.");
      const available = new Set([
        "auto",
        ...(await allModelsForConnections(await readConnections())).map((model) => model.id),
      ]);
      if (models.some((model) => !available.has(model))) throw new Error("Pack contains a model without a Verified connection.");
      const packs = readPacks();
      const id = typeof input.id === "string" && input.id
        ? input.id
        : globalThis.crypto.randomUUID();
      const pack = {
        id,
        name,
        models,
        strategy: input.strategy === "round-robin" ? "round-robin" : "fallback",
        stickyLimit: Math.max(1, Number(input.stickyLimit) || 1),
        autoSwitch: input.autoSwitch !== false,
        updatedAt: Date.now(),
      };
      writePacks([...packs.filter((item) => item.id !== id), pack]);
      sendJson(response, 200, { pack });
    }).catch((error) => sendJson(response, 422, { error: error instanceof Error ? error.message : String(error) }));
    return;
  }
  const packDeletePath = url.pathname.match(/^\/v1\/packs\/([^/]+)$/);
  if (packDeletePath && request.method === "DELETE") {
    const id = decodeURIComponent(packDeletePath[1]);
    const packs = readPacks();
    const next = packs.filter((item) => item.id !== id);
    if (next.length === packs.length) return sendJson(response, 404, { error: "Pack was not found." });
    writePacks(next);
    response.writeHead(204, corsHeaders(request));
    response.end();
    return;
  }
  if (url.pathname === "/v1/providers" && request.method === "POST") {
    void readJson(request).then(async (input) => {
      const provider = typeof input.provider === "string" ? input.provider : "";
      const id = typeof input.id === "string" ? input.id : "";
      const authType = input.authType === "subscription" || input.authType === "api-key" ? input.authType : "";
      const credentialRef = typeof input.credentialRef === "string" ? input.credentialRef : "";
      const catalogEntry = REGISTRY.find((entry) => entry.id === provider);
      if (!id || !catalogEntry || !authType || !credentialRef.startsWith("ai-router:credential:")) {
        sendJson(response, 400, { error: "A valid provider, connection id, auth type, and Vault credential reference are required" });
        return;
      }
      const currentConnections = await readConnections();
      const existing = currentConnections.find((item) => item.id === id);
      const connection = {
        ...existing,
        id,
        provider,
        name: typeof input.name === "string" ? input.name : catalogEntry.display?.name || provider,
        label: typeof input.label === "string" && input.label.trim()
          ? input.label.trim()
          : existing?.label || (typeof input.name === "string" ? input.name : catalogEntry.display?.name || provider),
        email: typeof input.email === "string" ? input.email : undefined,
        accountLabel: typeof input.accountLabel === "string" ? input.accountLabel : undefined,
        priority: typeof input.priority === "number" ? input.priority : undefined,
        authType,
        credentialRef,
        defaultModel: typeof input.defaultModel === "string" ? input.defaultModel : undefined,
        isActive: typeof input.isActive === "boolean" ? input.isActive : (existing?.isActive !== false),
        testStatus: "Pending test",
        lastError: undefined,
        lastErrorAt: undefined,
        connectedAt: existing?.connectedAt || new Date().toISOString(),
      };
      const connections = currentConnections.filter((item) => item.id !== id);
      connections.push(connection);
      await writeConnections(connections);
      sendJson(response, 201, { connection });
    }).catch((error) => sendJson(response, 400, { error: error.message }));
    return;
  }
  const togglePath = url.pathname.match(/^\/v1\/providers\/([^/]+)\/toggle$/);
  if (togglePath && (request.method === "POST" || request.method === "PATCH")) {
    const id = decodeURIComponent(togglePath[1]);
    void readJson(request)
      .then(async (input) => {
        const existing = await findConnection(id);
        if (!existing) {
          sendJson(response, 404, { error: "AI Router connection not found." });
          return;
        }
        const newActive = typeof input?.isActive === "boolean" ? input.isActive : (existing.isActive === false);
        const updated = await updateConnection(id, { isActive: newActive });
        sendJson(response, 200, { connection: updated });
      })
      .catch((error) => sendJson(response, 500, { error: error instanceof Error ? error.message : String(error) }));
    return;
  }
  const connectionPath = url.pathname.match(/^\/v1\/providers\/([^/]+)$/);
  if (connectionPath && request.method === "DELETE") {
    const id = decodeURIComponent(connectionPath[1]);
    void deleteConnection(id).then((deleted) => {
      if (!deleted) {
        sendJson(response, 404, { error: "AI Router connection was not found." });
        return;
      }
      response.writeHead(204, corsHeaders(request));
      response.end();
    }).catch((error) => sendJson(response, 500, { error: error instanceof Error ? error.message : String(error) }));
    return;
  }
  const testPath = url.pathname.match(/^\/v1\/providers\/([^/]+)\/test$/);
  if (testPath && request.method === "POST") {
    const id = decodeURIComponent(testPath[1]);
    void testConnection(id)
      .then((result) => sendJson(response, 200, result))
      .catch((error) => sendJson(response, 422, { valid: false, error: error instanceof Error ? error.message : String(error) }));
    return;
  }
  if (url.pathname === "/v1/models") {
    void readConnections()
      .then(async (connections) => sendJson(response, 200, { object: "list", data: await allModelsForConnections(connections, readPacks()) }))
      .catch((error) => sendJson(response, 500, { error: error instanceof Error ? error.message : String(error) }));
    return;
  }
  if (url.pathname === "/v1/connectors/request" && request.method === "POST") {
    void readJson(request)
      .then((input) => handleConnectorRequest(request, response, input))
      .catch((error) => sendJson(response, 400, { error: error instanceof Error ? error.message : String(error) }));
    return;
  }
  if (url.pathname === "/v1/vault/manifest" && request.method === "GET") {
    void handleVaultManifest(request, response);
    return;
  }
  if (url.pathname === "/v1/channels/telegram/status" && request.method === "GET") {
    void handleTelegramStatus(request, response);
    return;
  }
  if (url.pathname === "/v1/channels/telegram/updates" && request.method === "POST") {
    void readJson(request)
      .then((input) => handleTelegramUpdates(request, response, input))
      .catch((error) => sendJson(response, 400, { error: error.message }));
    return;
  }
  if (url.pathname === "/v1/channels/telegram/send" && request.method === "POST") {
    void readJson(request)
      .then((input) => handleTelegramSend(request, response, input))
      .catch((error) => sendJson(response, 400, { error: error.message }));
    return;
  }
  if (url.pathname === "/v1/chat/completions" || url.pathname === "/v1/responses") {
    if (request.method !== "POST") {
      sendJson(response, 405, { error: { message: "Use POST for AI Router chat requests." } });
      return;
    }
    void readJson(request)
      .then((input) => handleChat(request, response, input))
      .catch((error) => sendJson(response, 400, { error: { message: error.message } }));
    return;
  }
  sendJson(response, 404, { error: "AI Router only exposes /health and /v1/*" });
});

server.listen(port, host, () => {
  console.error(`[ai-router] native core listening on http://${host}:${port}`);
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.once(signal, () => server.close(() => process.exit(0)));
}
