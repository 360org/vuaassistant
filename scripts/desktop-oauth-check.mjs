#!/usr/bin/env node

// Boots the AI Router sidecar itself instead of assuming one is already
// listening. Without this the check only passed when an app instance happened
// to be running, and failed with a raw ECONNREFUSED stack trace otherwise —
// which is how a sidecar that never started (wrong project dir) and a runner
// that crash-looped both reached a release with CI green.
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PORT = Number(process.env.AI_ROUTER_PORT || 36360);
const baseUrl = process.env.AI_ROUTER_BASE_URL || `http://127.0.0.1:${PORT}/v1`;

async function reachable() {
  try {
    const res = await fetch(`${baseUrl}/models`, { signal: AbortSignal.timeout(5000) });
    return res.ok;
  } catch {
    return false;
  }
}

/** Start the sidecar unless something already answers on the port. */
async function ensureRouter() {
  if (await reachable()) return null;

  const sidecar = path.join(repoRoot, "ai-router/src/sidecar.mjs");
  if (!existsSync(sidecar)) {
    throw new Error(`AI Router sidecar not found at ${sidecar}`);
  }

  const child = spawn(process.execPath, [sidecar], {
    cwd: path.join(repoRoot, "ai-router"),
    env: { ...process.env, AI_ROUTER_PORT: String(PORT) },
    stdio: ["ignore", "ignore", "pipe"],
  });
  let stderr = "";
  child.stderr.on("data", (chunk) => {
    stderr += String(chunk);
  });

  for (let attempt = 0; attempt < 40; attempt++) {
    if (child.exitCode !== null) {
      throw new Error(`AI Router sidecar exited early (code ${child.exitCode}):\n${stderr.trim()}`);
    }
    if (await reachable()) return child;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  child.kill();
  throw new Error(`AI Router sidecar did not become ready on port ${PORT}:\n${stderr.trim()}`);
}

const router = await ensureRouter();
process.on("exit", () => router?.kill());

async function post(path, body) {
  const response = await fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return { response, payload: await response.json() };
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const gemini = await post("/oauth/authorize", {
  provider: "antigravity",
  redirectUri: "http://localhost:1420/callback",
});
assert(gemini.response.ok, `Antigravity authorize failed: ${gemini.payload.error || gemini.response.status}`);
assert(gemini.payload.authUrl?.startsWith("https://accounts.google.com/"), "Antigravity did not return a Google authorization URL.");
assert(gemini.payload.redirectUri === "http://localhost:1420/callback", "Antigravity callback URI changed unexpectedly.");
assert(gemini.payload.state && gemini.payload.codeVerifier, "Antigravity authorization is missing PKCE state.");

const claude = await post("/oauth/authorize", {
  provider: "claude",
  redirectUri: "http://localhost:1420/callback",
});
assert(claude.response.ok, `Claude authorize failed: ${claude.payload.error || claude.response.status}`);
assert(claude.payload.redirectUri === "http://localhost:443/callback", "Claude fixed callback URI changed unexpectedly.");

const codex = await post("/oauth/authorize", {
  provider: "codex",
  redirectUri: "http://localhost:1420/callback",
});
assert(codex.response.ok, `Codex authorize failed: ${codex.payload.error || codex.response.status}`);
assert(codex.payload.authUrl?.includes("auth.openai.com"), "Codex did not return an OpenAI authorization URL.");
assert(codex.payload.redirectUri === "http://localhost:1455/auth/callback", "Codex callback URI changed unexpectedly.");
assert(codex.payload.state && codex.payload.codeVerifier, "Codex authorization is missing PKCE state.");

const invalidExchange = await post("/oauth/exchange", {
  provider: "antigravity",
  code: "not-a-real-code",
  redirectUri: gemini.payload.redirectUri,
  codeVerifier: gemini.payload.codeVerifier,
  state: gemini.payload.state,
});
assert(invalidExchange.response.status === 422, "Invalid Antigravity code must be rejected by AI Router.");
assert(typeof invalidExchange.payload.error === "string" && invalidExchange.payload.error.length > 0, "AI Router must return an OAuth error payload.");
assert(!invalidExchange.payload.error.includes("Load failed"), "OAuth exchange must not leak a WebView Load failed error.");

const invalidCodexExchange = await post("/oauth/exchange", {
  provider: "codex",
  code: "not-a-real-code",
  redirectUri: "http://localhost:1455/auth/callback",
  codeVerifier: codex.payload.codeVerifier,
  state: codex.payload.state,
});
assert(invalidCodexExchange.response.status === 422, "Invalid Codex code must be rejected by AI Router.");
assert(typeof invalidCodexExchange.payload.error === "string" && invalidCodexExchange.payload.error.length > 0, "AI Router must return a Codex OAuth error payload.");

console.log("desktop OAuth contract passed: sidecar boots, Antigravity + Claude + Codex authorize & exchange checked");
router?.kill();
