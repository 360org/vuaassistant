# AI Router

AI Router is VuaAssistant's local provider gateway. It has two responsibilities:

1. expose a loopback, OpenAI-compatible proxy for the application and Agent
   Runner; and
2. inherit the complete 9router Provider Core instead of reimplementing vendor
   OAuth, model catalogs, translators, executors, token refresh, quota handling,
   and fallback behavior one provider at a time.

## Boundary

`core/open-sse` is the inherited source snapshot. It deliberately includes the
whole provider core, including every registry entry under `open-sse/providers`.
AI Router must not expose or inherit the upstream dashboard, account management,
billing, analytics UI, or MITM server as VuaAssistant product surfaces.

The local contract is intentionally small:

```text
GET  /health
GET  /v1/models
GET  /v1/providers
POST /v1/chat/completions
POST /v1/responses
POST /v1/embeddings
```

The service binds only to `127.0.0.1:36360`. The Agent Runner calls it using
the provider id `ai-router`; it must never call a vendor directly in production.

`src/sidecar.mjs` is the API-only boundary. It is a first-party VuaAssistant
service and does not start, embed, proxy to, or authenticate against a 9router
dashboard. The copied core supplies provider implementations only.

## Credential boundary

Credentials remain in the Tauri Vault. The Runner sends a connection or
credential reference, never a raw provider token. AI Router resolves that
reference through a scoped local broker, refreshes credentials when needed, and
forwards only the appropriate vendor authorization header upstream.

`/v1/models` deliberately returns an empty list until the native Vault-backed
connection store has a verified vendor connection; it never advertises a static
catalog as usable models.

The current sidecar does not yet implement this Vault broker. It must not be
treated as ready for a real VuaAssistant credential until that bridge and the
end-to-end smoke test are complete.

## Upstream update

The source snapshot is updated intentionally, with a reviewable attribution
update, rather than by reconnecting to an upstream installation:

```sh
git -C /path/to/9router archive <reviewed-upstream-commit> open-sse src/lib/oauth src/lib/qoder | tar -x
```

See `THIRD_PARTY_NOTICES.md` for the upstream license and attribution.
