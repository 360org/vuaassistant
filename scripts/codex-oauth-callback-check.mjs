#!/usr/bin/env node

import { readFileSync } from "node:fs";

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const aiRouterClient = readFileSync("src/runtime/aiRouter.ts", "utf8");
const codexProvider = readFileSync("ai-router/core/open-sse/providers/registry/codex.js", "utf8");
const oauthCore = readFileSync("ai-router/core/src/lib/oauth/providers.js", "utf8");

assert(
  aiRouterClient.includes('normalized === "chatgpt" || normalized === "openai" ? "codex" : normalized'),
  "ChatGPT/OpenAI sign-in must normalize to the Codex OAuth provider.",
);
assert(
  aiRouterClient.includes('body: JSON.stringify({ provider: coreProvider, redirectUri })'),
  "ChatGPT/OpenAI OAuth authorize must send the normalized core provider to AI Router.",
);
assert(
  aiRouterClient.includes('provider: coreProvider'),
  "OAuth token exchange must send the normalized core provider to AI Router.",
);
assert(
  codexProvider.includes('openid profile email offline_access api.connectors.read api.connectors.invoke'),
  "Codex OAuth must request the official connector scopes used by upstream Codex CLI.",
);
assert(
  oauthCore.includes('originator: config.extraParams?.originator || "codex_cli_rs"') && oauthCore.includes('"User-Agent": "codex_cli_rs/0.136.0"'),
  "Codex token exchange must include upstream-compatible originator and User-Agent headers.",
);

console.log("codex OAuth callback contract passed");
