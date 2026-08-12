### 360 Agent Map

- Nguồn: 490 tệp; 2411 symbol; 47 tín hiệu domain.
- Mục tiêu: chọn đúng file/symbol trước khi đọc sâu; chống viết trùng/viết thừa.
- Quy tắc: đọc map trước; nếu cần flow/impact/caller/callee hoặc bug fail lần 3 thì dùng 360-codegraph.

#### Domain signals
- v-assistant: 47

#### Hotspots
- `src-tauri/src/lib.rs` — 54 tín hiệu
- `ai-router/core/open-sse/utils/cursorProtobuf.js` — 52 tín hiệu
- `ai-router/core/open-sse/shared/zedAuth.js` — 39 tín hiệu
- `ai-router/core/open-sse/config/kiroConstants.js` — 38 tín hiệu
- `ai-router/core/open-sse/services/tokenRefresh/providers.js` — 37 tín hiệu
- `src/runtime/knowledge.ts` — 35 tín hiệu
- `src-tauri/src/runtime.rs` — 34 tín hiệu
- `src/runtime/oauth.ts` — 34 tín hiệu
- `src/runtime/aiRouter.ts` — 30 tín hiệu
- `ai-router/core/open-sse/services/accountFallback.js` — 28 tín hiệu
- `src/runtime/vault.ts` — 28 tín hiệu
- `ai-router/core/src/lib/oauth/utils/server.js` — 27 tín hiệu

#### Symbol mẫu
- `log` (function) — `agent-runner/scripts/demo-send.ts:20`
- `ensureDir` (function) — `agent-runner/scripts/demo-send.ts:25`
- `createInboundSchema` (function) — `agent-runner/scripts/demo-send.ts:31`
- `sendMessage` (function) — `agent-runner/scripts/demo-send.ts:73`
- `latestOutboundSeq` (function) — `agent-runner/scripts/demo-send.ts:89`
- `pollResponse` (function) — `agent-runner/scripts/demo-send.ts:99`
- `sleep` (function) — `agent-runner/scripts/demo-send.ts:134`
- `main` (function) — `agent-runner/scripts/demo-send.ts:139`
- `capabilityFromTool` (function) — `agent-runner/src/capability-rail.ts:61`
- `capabilityFromTool` (function) — `agent-runner/src/capability-rail.ts:61`
- `searchCapabilities` (function) — `agent-runner/src/capability-rail.ts:73`
- `searchCapabilities` (function) — `agent-runner/src/capability-rail.ts:73`
- `sideEffectDenied` (function) — `agent-runner/src/capability-rail.ts:96`
- `sideEffectDenied` (function) — `agent-runner/src/capability-rail.ts:96`
- `log` (function) — `agent-runner/src/channels/telegram.ts:37`
- `sleep` (function) — `agent-runner/src/channels/telegram.ts:42`
- `done` (function) — `agent-runner/src/channels/telegram.ts:46`
- `generateId` (function) — `agent-runner/src/channels/telegram.ts:55`
- `telegramRouting` (function) — `agent-runner/src/channels/telegram.ts:60`
- `telegramRouting` (function) — `agent-runner/src/channels/telegram.ts:60`
- `telegramConfigured` (function) — `agent-runner/src/channels/telegram.ts:81`
- `telegramConfigured` (function) — `agent-runner/src/channels/telegram.ts:81`
- `getUpdates` (function) — `agent-runner/src/channels/telegram.ts:86`
- `sendMessage` (function) — `agent-runner/src/channels/telegram.ts:94`
- `notifyTelegram` (function) — `agent-runner/src/channels/telegram.ts:105`
- `notifyTelegram` (function) — `agent-runner/src/channels/telegram.ts:105`
- `handleMessage` (function) — `agent-runner/src/channels/telegram.ts:121`
- `handleMessage` (function) — `agent-runner/src/channels/telegram.ts:121`
- `runTelegramLoop` (function) — `agent-runner/src/channels/telegram.ts:152`
- `runTelegramLoop` (function) — `agent-runner/src/channels/telegram.ts:152`
