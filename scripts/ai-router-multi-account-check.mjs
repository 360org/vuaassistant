import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import REGISTRY from "../ai-router/core/open-sse/providers/registry/index.js";

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const root = path.resolve(import.meta.dirname, "..");
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "vuaassistant-multi-account-"));
const vaultPath = path.join(tempDir, "vault.json");
const port = 22000 + Math.floor(Math.random() * 1000);
const connections = [1, 2].map((number) => ({
  id: `codex:test-${number}`,
  provider: "codex",
  name: "OpenAI Codex",
  accountLabel: `Account ${number}`,
  priority: number,
  authType: "subscription",
  credentialRef: `ai-router:credential:codex:test-${number}`,
  isActive: true,
  testStatus: "Verified",
}));
fs.writeFileSync(vaultPath, JSON.stringify({
  "ai-router:connections": JSON.stringify({ connections }),
  "ai-router:credential:codex:test-1": JSON.stringify({ accessToken: "test-one" }),
  "ai-router:credential:codex:test-2": JSON.stringify({ accessToken: "test-two" }),
}));

const child = spawn(process.execPath, ["ai-router/src/sidecar.mjs"], {
  cwd: root,
  env: {
    ...process.env,
    AI_ROUTER_PORT: String(port),
    AI_ROUTER_VAULT_PATH: vaultPath,
    AI_ROUTER_UI_ORIGIN: "http://127.0.0.1:1420",
  },
  stdio: "ignore",
});

try {
  let ready = false;
  for (let attempt = 0; attempt < 50; attempt += 1) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/health`);
      if (response.ok) { ready = true; break; }
    } catch { /* wait for sidecar */ }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  assert(ready, "Temporary AI Router did not start");

  const providerPayload = await fetch(`http://127.0.0.1:${port}/v1/providers`).then((response) => response.json());
  assert(providerPayload.connections?.length === 2, "AI Router did not preserve two accounts for one provider");
  assert(providerPayload.connections[0].accountLabel === "Account 1", "First account label was not preserved");
  assert(providerPayload.connections[1].accountLabel === "Account 2", "Second account label was not preserved");

  const modelPayload = await fetch(`http://127.0.0.1:${port}/v1/models`).then((response) => response.json());
  const expectedModels = REGISTRY.find((provider) => provider.id === "codex").models
    .filter((model) => !model.kind || model.kind === "llm").length;
  assert(
    modelPayload.data?.length === expectedModels * 2,
    "Each connected account must expose its own selectable model variants"
  );
  for (const account of connections) {
    const accountModels = modelPayload.data.filter((model) => model.connectionId === account.id);
    assert(accountModels.length === expectedModels, "Connected account is missing its model variants");
    assert(
      accountModels.every((model) => model.accountLabel === account.accountLabel),
      "Model variants must retain their connected account label"
    );
  }

  const deleted = await fetch(`http://127.0.0.1:${port}/v1/providers/${encodeURIComponent(connections[0].id)}`, {
    method: "DELETE",
  });
  assert(deleted.status === 204, "AI Router could not remove one account independently");
  const remaining = await fetch(`http://127.0.0.1:${port}/v1/providers`).then((response) => response.json());
  assert(remaining.connections?.length === 1 && remaining.connections[0].id === connections[1].id, "Deleting one account affected the other account");

  console.log(`AI Router multi-account OK: 2 Codex accounts, ${expectedModels} models per account, independent reset`);
} finally {
  child.kill("SIGTERM");
  fs.rmSync(tempDir, { recursive: true, force: true });
}
