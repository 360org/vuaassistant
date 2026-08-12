import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const core = path.join(root, "ai-router", "core");
const registry = path.join(core, "open-sse", "providers", "registry");
const runnerAdapter = path.join(root, "agent-runner", "src", "providers", "adapters", "openai.ts");
const sidecar = path.join(root, "ai-router", "src", "sidecar.mjs");
// Provider sign-in moved out of the Settings page during the module split;
// the account-connection rules now live in the Model settings component.
const settingsPage = path.join(root, "src", "components", "settings", "ModelSettings.tsx");
const chatPage = path.join(root, "src", "pages", "Chat.tsx");
const authRust = path.join(root, "src-tauri", "src", "auth.rs");
const tauriLib = path.join(root, "src-tauri", "src", "lib.rs");

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

assert(fs.existsSync(path.join(core, "THIRD_PARTY_9ROUTER_LICENSE")), "AI Router core license is missing");
assert(fs.existsSync(path.join(registry, "index.js")), "AI Router provider registry is missing");

const providers = fs.readdirSync(registry).filter((file) => file.endsWith(".js") && file !== "index.js");
assert(providers.length >= 90, `Expected the full 9router registry, found only ${providers.length} providers`);

const adapter = fs.readFileSync(runnerAdapter, "utf8");
assert(adapter.includes("registerProvider('ai-router'"), "Agent Runner does not register AI Router");
assert(adapter.includes("http://127.0.0.1:36360/v1"), "AI Router local proxy contract changed unexpectedly");
assert(fs.existsSync(sidecar), "AI Router sidecar is missing");
const sidecarSource = fs.readFileSync(sidecar, "utf8");
assert(sidecarSource.includes('url.pathname === "/health"') && sidecarSource.includes('url.pathname === "/v1/chat/completions"'), "AI Router public API boundary is missing");
assert(sidecarSource.includes('url.pathname === "/v1/providers"'), "AI Router connection catalog is not exposed");
assert(sidecarSource.includes("mode: \"native-core\""), "AI Router is still delegating to an upstream service");
assert(sidecarSource.includes('url.pathname === "/v1/models"'), "AI Router model filtering is missing");
assert(sidecarSource.includes("startCodexCallbackRelay"), "VuaAssistant Codex callback compatibility relay is missing");
assert(sidecarSource.includes('redirectUri = "http://localhost:1455/auth/callback"'), "Codex callback URI changed unexpectedly");
assert(sidecarSource.includes("startCodexCallbackRelay(redirectUri)"), "Codex callback relay does not preserve the requesting UI origin");
assert(sidecarSource.includes('redirectUri = "http://localhost:443/callback"'), "Claude fixed callback URI is missing");
assert(sidecarSource.includes("startLoopbackCallbackRelay"), "xAI loopback callback relay is missing");
assert(sidecarSource.includes('redirectUri = `http://127.0.0.1:${listenPort}${callbackPath}`'), "xAI must authorize with its registered loopback callback");
assert(sidecarSource.includes('["127.0.0.1", "localhost"].includes(candidate.hostname)'), "AI Router CORS does not support both loopback UI origins");
assert(!sidecarSource.includes('"access-control-allow-origin": "*"'), "AI Router must not expose Vault-backed requests to every browser origin");
assert(!sidecarSource.includes("startCodexProxy"), "VuaAssistant must not modify or embed the Core callback server");
const settingsSource = fs.readFileSync(settingsPage, "utf8");
const onboardingSource = fs.readFileSync(path.join(root, "src", "pages", "Onboarding.tsx"), "utf8");
const chatSource = fs.readFileSync(chatPage, "utf8");
const aiRouterClient = fs.readFileSync(path.join(root, "src", "runtime", "aiRouter.ts"), "utf8");
const authRustSource = fs.readFileSync(authRust, "utf8");
const tauriLibSource = fs.readFileSync(tauriLib, "utf8");
// Each sign-in must land on its own connection. Identity now comes from the
// account itself: an existing connection is reused when the email or
// credential matches, otherwise a fresh per-provider id is minted. That keeps
// two accounts of the same vendor apart without minting duplicates for the
// same account on every login.
//
// The derivation lives in the shared aiRouter client, not in the Settings
// component: onboarding signs in too, and both paths must mint ids the same
// way. Assert against the client so moving the UI cannot silently drop it.
assert(
  aiRouterClient.includes("existingConn ? existingConn.id : `${providerId}_${Date.now()}`"),
  "Provider login does not derive a stable per-account connection ID",
);
assert(
  aiRouterClient.includes("export async function saveConnectionAndCleanupDuplicates"),
  "The shared connection writer is missing",
);
// Every sign-in surface must go through that shared writer.
for (const [name, source] of [["Settings", settingsSource], ["Onboarding", onboardingSource]]) {
  assert(
    source.includes("saveConnectionAndCleanupDuplicates"),
    `${name} sign-in does not de-duplicate connections for the same account`,
  );
}
assert(!settingsSource.includes('`${selectedProvider.id}:default`'), "Provider login still overwrites the default account");
assert(sidecarSource.includes("const models = new Map()"), "Multiple accounts can duplicate models in the catalog");
assert(sidecarSource.includes('from "../core/open-sse/services/combo.js"'), "AI Router must reuse the inherited Combo service");
assert(sidecarSource.includes("AI_ROUTER_PACKS_PATH"), "Pack configuration needs its own non-secret store");
assert(!sidecarSource.includes('ai-router:combos'), "Pack configuration must not be stored in the Vault");
assert(sidecarSource.includes("const packsPath = process.env.AI_ROUTER_PACKS_PATH"), "Pack config path is not separated from the Vault");
assert(!sidecarSource.includes("const packsPath = vaultPath"), "Pack config must not share the Vault file");
assert(sidecarSource.includes('url.pathname === "/v1/packs"'), "Pack CRUD API is missing");
assert(chatSource.includes("saveAiRouterPack"), "Model picker does not expose Pack creation");
assert(!settingsSource.includes("saveAiRouterPack"), "Pack creation must stay in the model picker, not Settings");
assert(sidecarSource.includes('entry.id === "openrouter"'), "OpenRouter OAuth sign-in is not exposed by the provider catalog");
assert(sidecarSource.includes("dynamicModelsForConnection"), "Passthrough provider models are not loaded dynamically");
assert(chatSource.includes("Maximize2") && chatSource.includes("Minimize2"), "Pack editor expand control is missing");
assert(sidecarSource.includes("accountModelId"), "Model variants are not bound to a vendor account");
assert(sidecarSource.includes("accountLabel: connection.accountLabel"), "Model catalog does not identify its account");
assert(chatSource.includes('model.accountLabel || "Account"'), "Pack editor does not show the model account");
assert(chatSource.includes("packAccountFilters"), "Pack editor account checkbox filters are missing");
assert(chatSource.includes("connectedModelAccounts"), "Pack editor does not derive filters from connected accounts");
assert(sidecarSource.includes("providerAccountIdentity"), "Provider account identity backfill is missing");
assert(sidecarSource.includes("creator_user_id"), "OpenRouter identity must not fall back to Account 1");
assert(sidecarSource.includes('cookie: entry.authType === "cookie"'), "Cookie subscriptions must not be presented as API keys");
assert(sidecarSource.includes('authModes.includes("apikey")'), "Dual-mode providers must preserve their API-key option");
assert(aiRouterClient.includes('authorize.flowType === "device_code"'), "Frontend must support inherited device-code providers");
assert(aiRouterClient.includes("capture_grok_sso_cookie"), "Grok Web needs a native cookie capture bridge");
// Asserted on the wiring, not the button label — the UI copy is Vietnamese.
assert(settingsSource.includes("captureGrokWebSsoCookie()"), "Grok Web UI must offer direct session capture");
assert(settingsSource.includes('"subscription",'), "A captured Grok session must be stored as a subscription, not an API key");
assert(
  authRustSource.includes("capture_grok_sso_cookie")
    && authRustSource.includes("read_grok_sso_from_chrome_cookie_store")
    && authRustSource.includes("decrypt_chrome_cookie_value")
    && authRustSource.includes("WHERE name = 'sso' AND host_key LIKE '%grok.com'"),
  "Tauri must capture the Grok sso cookie from Chrome's cookie store",
);
assert(tauriLibSource.includes("auth::capture_grok_sso_cookie"), "Grok cookie capture command is not registered");
assert(!sidecarSource.includes("patch.accountLabel = email || `Account ${accountNumber}`"), "Router must not invent numbered account identities");
assert(chatSource.includes("Connected accounts"), "Pack account filters are not inside a dropdown menu");
assert(chatSource.includes("packExpanded && <details"), "Pack account filters must only render in expanded mode");

console.log(`AI Router contract OK: ${providers.length} inherited providers, Runner -> 127.0.0.1:36360/v1`);
