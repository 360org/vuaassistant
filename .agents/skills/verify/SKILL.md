---
name: verify
description: Builds, launches and drives the VuaAssistant app to verify changes end-to-end at the UI surface. Use when verifying a diff, checking that a feature works in the running app, or before committing nontrivial changes to this repository.
license: MIT
compatibility: Requires Node.js 20+ and Playwright with Chromium; the Rust shell check additionally needs pkg-config, libgtk-3-dev and libwebkit2gtk-4.1-dev on Linux.
metadata:
  vua-author: 360org
---

# Verifying VuaAssistant

## Build

```bash
npm install
npm run build            # tsc + vite build — must pass
cd src-tauri && cargo check   # Rust shell; needs libgtk-3-dev + libwebkit2gtk-4.1-dev
```

On a bare Linux container install Tauri prerequisites first:
`apt-get update && apt-get install -y pkg-config libgtk-3-dev libwebkit2gtk-4.1-dev librsvg2-dev`

## Launch (UI surface)

The whole product UI runs in the browser via Vite — no Tauri window needed
to verify UI changes:

```bash
npm run dev &            # serves http://localhost:1420 (strict port)
```

Drive with Playwright headless Chromium (globally installed; executable at
`/opt/pw-browsers/chromium-*/chrome-linux/chrome` in Codex remote envs —
import from `/opt/node22/lib/node_modules/playwright/index.mjs` since ESM
ignores NODE_PATH).

## Engine seam (NanoClaw runtime)

The desktop ↔ engine IPC contract (SQLite inbound/outbound queues) is
exercised cross-process without Docker or credentials:

```bash
cd src-tauri
VUA_ENGINE_DIR=../scripts/engine-stub.mjs cargo run --example ipc_check
```

Prints ✓ lines for engine attach, group/skills sync, chat round-trips on
`main` and an agent group, and engine shutdown. In the web preview (no
Tauri) chat must silently fall back to the preview engine.

## Flows worth driving

1. Onboarding is login-first: the sign-in screen shows only "Continue
   with …" buttons (OpenRouter top, 1-click badge) and no API-key field.
   OpenRouter → real PKCE OAuth redirect; other vendors open a dialog whose
   API key sits under "Advanced options". First sign-in auto-creates the
   local user from the vendor account (label + credit), shown in the sidebar
   footer and Settings → Account. Stub the openrouter.ai routes to drive
   this without real credentials (see scratch tests).
2. Chat: fill composer, Enter → assistant reply streams (demo engine echoes
   with "preview response" text). Empty Enter must not send.
3. Provider switch: chat header dropdown; sidebar "Powered by X" updates.
4. Agents: Install on a card → button becomes Chat → click Chat → composer
   placeholder becomes "Ask your <Agent>…".
5. Skills: Use on a card → lands on Chat with the composer pre-filled and
   focused; navigating away and back must not re-fill it.
6. Knowledge: `setInputFiles` on the hidden `input[type=file]` → row shows
   Processing → Ready (~1–3s).
6. Integrations: Connect on a card → Connected badge.
7. Persistence probe: `page.reload()` → app skips onboarding (localStorage),
   chat history/agents/provider survive. App lands on Home after reload.

8. Responsive: at a mobile viewport (e.g. 390×844) the sidebar is replaced
   by a top bar; "Open menu" opens the drawer, picking an item or clicking
   the backdrop closes it, and `scrollWidth <= clientWidth` (no horizontal
   scroll). At ≥768px the sidebar returns and the top bar disappears.

## Gotchas

- Many labels are substrings of each other ("Chat" nav vs "Start a chat"
  card, provider name in header vs "Powered by X" sidebar) — always use
  `exact: true` on `getByRole` name matches.
- User message text is echoed inside the assistant reply, so `getByText` on
  the sent message resolves to 2 nodes — scope or use `.first()`.
- State lives in localStorage key `vuaassistant-state-v1`; clear it (or
  Settings → Reset) to re-run onboarding.
