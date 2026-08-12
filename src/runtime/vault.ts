/**
 * Credential Vault — front-end access to the secure secret store.
 *
 * On desktop, secrets live in VuaAssistant's encrypted SQLite Vault through
 * the Rust `vault_*` commands. Browser persistence is development-only and
 * is not the security boundary used by the shipped desktop app.
 */

const WEB_PREFIX = "vuaassistant-vault:";

function inDesktopShell(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

export async function vaultSet(key: string, value: string): Promise<void> {
  if (inDesktopShell()) {
    const { invoke } = await import("@tauri-apps/api/core");
    await invoke("vault_set", { key, value });
    return;
  }
  try {
    const res = await fetch("/api/vault", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key, value }),
    });
    if (res.ok) {
      try {
        localStorage.setItem(WEB_PREFIX + key, value);
      } catch {}
      return;
    }
  } catch {
    /* server API failed, proceed to localStorage */
  }
  try {
    localStorage.setItem(WEB_PREFIX + key, value);
  } catch {
    /* preview without persistence */
  }
}

export async function vaultGet(key: string): Promise<string | null> {
  if (inDesktopShell()) {
    const { invoke } = await import("@tauri-apps/api/core");
    return (await invoke<string | null>("vault_get", { key })) ?? null;
  }
  try {
    const res = await fetch(`/api/vault?key=${encodeURIComponent(key)}`);
    if (res.ok) {
      const data = (await res.json()) as { value: string | null };
      if (data && typeof data === "object" && "value" in data && data.value !== null) {
        try {
          localStorage.setItem(WEB_PREFIX + key, data.value);
        } catch {}
        return data.value;
      }
    }
  } catch {
    /* server API failed, proceed to localStorage */
  }
  try {
    const localVal = localStorage.getItem(WEB_PREFIX + key);
    if (localVal) {
      void fetch("/api/vault", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key, value: localVal }),
      }).catch(() => {});
      return localVal;
    }
  } catch {}
  return null;
}

export async function vaultDelete(key: string): Promise<void> {
  if (inDesktopShell()) {
    const { invoke } = await import("@tauri-apps/api/core");
    await invoke("vault_delete", { key });
    return;
  }
  try {
    const res = await fetch("/api/vault", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key, value: null }),
    });
    if (res.ok) {
      try {
        localStorage.removeItem(WEB_PREFIX + key);
      } catch {}
      return;
    }
  } catch {
    /* server API failed, proceed to localStorage */
  }
  try {
    localStorage.removeItem(WEB_PREFIX + key);
  } catch {}
}

/** True when running inside the Tauri desktop shell (App Vault available). */
export function vaultIsSecure(): boolean {
  return inDesktopShell();
}

/* ---------------------------------------------------------------------- *
 * User credential entries
 *
 * A user-managed Vault: store a service's login once (URL/endpoint,
 * username, password, API key, notes) and agents read it back to act on
 * the user's behalf — no re-entering credentials. Each entry is one secure
 * item; a small index lists them for the UI (secrets stay in the items).
 * ---------------------------------------------------------------------- */

/** The data type a user picks for a custom field. */
export type VaultFieldType =
  | "text"
  | "password"
  | "number"
  | "url"
  | "email"
  | "date"
  | "datetime";

/** A user-added custom field on a Vault entry (e.g. "API key", "Client ID"). */
export interface VaultField {
  label: string;
  value: string;
  /** Chosen when the field is added; drives the value input's behaviour. */
  type?: VaultFieldType;
  /** Legacy flag; a "password" type is the masked kind. */
  secret?: boolean;
}

/** Whether a field's value should be masked in the UI. */
export function isSecretField(field: VaultField): boolean {
  return field.type === "password" || field.secret === true;
}

export interface VaultEntry {
  id: string;
  /** Friendly name the user (and agents) refer to, e.g. "My WordPress". */
  label: string;
  /** Site URL or API endpoint. */
  url?: string;
  username?: string;
  password?: string;
  notes?: string;
  /** Extra fields the user adds themselves. */
  fields?: VaultField[];
  /** Optional service/type tag (set by integrations for lookup). */
  service?: string;
  updatedAt: number;
}

/** Read any field on an entry by name — default or custom (case-insensitive). */
export function readField(
  entry: VaultEntry,
  name: string,
): string | undefined {
  const q = name.trim().toLowerCase();
  const builtin: Record<string, string | undefined> = {
    url: entry.url,
    username: entry.username,
    user: entry.username,
    password: entry.password,
    pass: entry.password,
    notes: entry.notes,
    note: entry.notes,
  };
  if (q in builtin && builtin[q]) return builtin[q];
  return entry.fields?.find((f) => f.label.trim().toLowerCase() === q)?.value;
}

/** Non-secret summary used to render the list. */
export type VaultEntryMeta = Pick<VaultEntry, "id" | "label" | "service">;

const INDEX_KEY = "vault-index";
const entryKey = (id: string) => `vault-entry:${id}`;

export function newVaultId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

async function readIndex(): Promise<VaultEntryMeta[]> {
  const raw = await vaultGet(INDEX_KEY);
  if (!raw) return [];
  try {
    return JSON.parse(raw) as VaultEntryMeta[];
  } catch {
    return [];
  }
}

export async function listVaultEntries(): Promise<VaultEntryMeta[]> {
  return (await readIndex()).sort((a, b) => a.label.localeCompare(b.label));
}

export async function getVaultEntry(id: string): Promise<VaultEntry | null> {
  const raw = await vaultGet(entryKey(id));
  if (!raw) return null;
  try {
    return JSON.parse(raw) as VaultEntry;
  } catch {
    return null;
  }
}

/** Create or update an entry (secret fields included), refreshing the index. */
export async function saveVaultEntry(entry: VaultEntry): Promise<void> {
  await vaultSet(entryKey(entry.id), JSON.stringify(entry));
  const index = await readIndex();
  const meta: VaultEntryMeta = {
    id: entry.id,
    label: entry.label,
    service: entry.service,
  };
  const next = index.filter((e) => e.id !== entry.id);
  next.push(meta);
  await vaultSet(INDEX_KEY, JSON.stringify(next));
}

export async function deleteVaultEntry(id: string): Promise<void> {
  await vaultDelete(entryKey(id));
  const index = (await readIndex()).filter((e) => e.id !== id);
  await vaultSet(INDEX_KEY, JSON.stringify(index));
}

/**
 * Look up a stored credential by label or service (case-insensitive) — the
 * entry point an agent uses to fetch what it needs to perform a task.
 */
export async function findVaultEntry(query: string): Promise<VaultEntry | null> {
  const q = query.trim().toLowerCase();
  const index = await readIndex();
  const hit =
    index.find((e) => e.label.toLowerCase() === q) ??
    index.find((e) => (e.service ?? "").toLowerCase() === q) ??
    index.find((e) => e.label.toLowerCase().includes(q));
  return hit ? getVaultEntry(hit.id) : null;
}
