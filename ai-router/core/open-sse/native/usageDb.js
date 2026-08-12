/**
 * VuaAssistant compatibility adapter for the vendored 9router Provider Core.
 *
 * The upstream core records request telemetry through its dashboard database.
 * VuaAssistant has no dashboard database: connection secrets belong in Vault
 * and the host owns operational logs. Keep the upstream call contract intact
 * while retaining only bounded, non-secret in-process telemetry.
 */
const MAX_EVENTS = 200;
const events = [];
const pending = new Map();

function record(kind, payload) {
  events.push({ kind, at: Date.now(), payload });
  if (events.length > MAX_EVENTS) events.splice(0, events.length - MAX_EVENTS);
  return Promise.resolve();
}

export function trackPendingRequest(model, provider, connectionId, active, failed = false) {
  const key = `${provider || "unknown"}:${connectionId || "default"}:${model || "unknown"}`;
  if (active) pending.set(key, { model, provider, connectionId, startedAt: Date.now() });
  else pending.delete(key);
  return record("pending", { model, provider, connectionId, active, failed });
}

export function appendRequestLog(payload) {
  return record("request", payload);
}

export function saveRequestDetail(payload) {
  return record("detail", payload);
}

export function saveRequestUsage(payload) {
  return record("usage", payload);
}

export function getNativeUsageSnapshot() {
  return { pending: [...pending.values()], events: [...events] };
}
