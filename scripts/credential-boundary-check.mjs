import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

const runnerConfig = read("agent-runner/src/config.ts");
const tauriRuntime = read("src-tauri/src/runtime.rs");
const vault = read("src-tauri/src/vault.rs");
const router = read("ai-router/src/sidecar.mjs");
const nativeTools = read("agent-runner/src/native-tools/index.ts");
const mcpClient = read("agent-runner/src/mcp-client/index.ts");
const webviewTools = read("src/runtime/tools.ts");
const vaultPage = read("src/pages/Vault.tsx");

assert(!runnerConfig.includes("VUA_API_KEY"), "Agent Runner must not read a raw API key from the environment");
assert(!runnerConfig.includes("apiKey?:"), "Agent Runner config must not expose a raw API-key field");
assert(!tauriRuntime.includes('"apiKey"'), "runner.json must not contain an API-key field");
assert(!tauriRuntime.includes("VUA_VAULT_MANIFEST"), "Runner must query Vault metadata instead of reading a cache file");
assert(vault.includes("Aes256"), "App Vault must encrypt its SQLite values with AES-256");
assert(vault.includes("HmacSha256"), "App Vault ciphertext must be authenticated");
assert(!vault.includes("keyring::Entry"), "Connection data must stay in the VuaAssistant Vault, not an OS keychain");
assert(!vault.includes("vault-manifest.json"), "App Vault must remain the single source of connection metadata");
assert(router.includes("AI_ROUTER_VAULT_BROKER_URL"), "AI Router must support the desktop Vault broker");
assert(router.includes("AI_ROUTER_VAULT_BROKER_TOKEN"), "AI Router broker access must require a capability token");
assert(!router.includes("AI_ROUTER_STATE_PATH"), "AI Router connection metadata must not use a separate state file");
assert(router.includes("ai-router:connections"), "AI Router connection metadata must live in the App Vault");
assert(router.includes("/v1/connectors/request"), "Credentialed calls must cross the trusted connector gateway");
assert(router.includes("/v1/vault/manifest"), "Agents must query a sanitized manifest from the App Vault");
assert(vaultPage.includes("getAiRouterConnections"), "Vault UI must include AI Router credential metadata");
assert(vaultPage.includes("connection.credentialRef"), "Vault UI must show only the opaque AI Router credential reference");
assert(!vaultPage.includes("connection.accessToken"), "Vault UI must never render provider access tokens");
assert(vaultPage.includes("AiProviderCredentialEditor"), "AI provider credentials must be editable inside Vault");
assert(vaultPage.includes("vaultGet(connection.credentialRef)"), "Vault editor must load the selected credential directly");
assert(vaultPage.includes("connection.label || connection.name"), "AI credentials must use the shared editable Vault label");
assert(vaultPage.includes('connection.testStatus || "Connected"'), "AI credentials must expose a status tag");
assert(router.includes("redactSecrets"), "Connector responses must be redacted before returning to an agent");
assert(router.includes("target.origin !== allowedOrigin"), "Vault references must be bound to their saved origin");
assert(nativeTools.includes("name: 'connector_request'"), "Agent Runner must expose opaque connector references");
assert(!nativeTools.includes("bashTool"), "Agent Runner must not expose a host shell to the model");
assert(!nativeTools.includes("getVaultSecret"), "Agent tools must never resolve Vault values directly");
assert(!nativeTools.includes("VUA_VAULT_MANIFEST"), "Agent Runner must not read a Vault metadata cache from disk");
assert(mcpClient.includes("delete childEnv.VUA_CONNECTOR_GATEWAY_TOKEN"), "External MCP processes must not inherit the Vault gateway capability");
assert(!webviewTools.includes("resolveVaultPlaceholders"), "Legacy Webview tools must not resolve Vault values directly");
assert(!webviewTools.includes("readField(entry"), "Legacy Webview tools must not read credential values");
assert(
  !existsSync(new URL("../agent-runner/src/vault/vault-resolver.ts", import.meta.url)),
  "The agent-side Vault decryptor must not exist",
);

console.log("Credential boundary OK: agent sees opaque refs; AI Router resolves and redacts Vault values");
