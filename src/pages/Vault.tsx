import { useEffect, useMemo, useState } from "react";
import {
  AtSign,
  Calendar,
  Clock,
  Eye,
  EyeOff,
  Globe,
  Hash,
  KeyRound,
  Link2,
  Lock,
  Pencil,
  Plus,
  StickyNote,
  Tag,
  Trash2,
  Type as TypeIcon,
  User,
  X,
  type LucideIcon,
} from "lucide-react";
import {
  vaultDelete,
  vaultGet,
  vaultSet,
  deleteVaultEntry,
  getVaultEntry,
  isSecretField,
  listVaultEntries,
  newVaultId,
  saveVaultEntry,
  vaultIsSecure,
  type VaultEntry,
  type VaultEntryMeta,
  type VaultField,
  type VaultFieldType,
} from "@/runtime/vault";
import {
  deleteAiRouterConnection,
  getAiRouterConnections,
  saveAiRouterConnection,
  type AiRouterConnection,
} from "@/runtime/aiRouter";

/** The field types a user can pick when adding a custom field. */
const FIELD_TYPES: {
  type: VaultFieldType;
  label: string;
  icon: LucideIcon;
  inputType: string;
}[] = [
  { type: "text", label: "Text", icon: TypeIcon, inputType: "text" },
  { type: "password", label: "Password", icon: Lock, inputType: "password" },
  { type: "number", label: "Number", icon: Hash, inputType: "number" },
  { type: "url", label: "URL", icon: Link2, inputType: "url" },
  { type: "email", label: "Email", icon: AtSign, inputType: "email" },
  { type: "date", label: "Date", icon: Calendar, inputType: "date" },
  {
    type: "datetime",
    label: "Date & time",
    icon: Clock,
    inputType: "datetime-local",
  },
];

const fieldTypeInfo = (t: VaultFieldType | undefined) =>
  FIELD_TYPES.find((f) => f.type === t) ?? FIELD_TYPES[0];
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

const baseInput =
  "rounded-xl border border-neutral-700 bg-neutral-950 px-3 py-2 " +
  "text-sm outline-none placeholder:text-neutral-600 focus:border-gold-400/60";

const blank = (): VaultEntry => ({
  id: newVaultId(),
  label: "",
  url: "",
  username: "",
  password: "",
  notes: "",
  fields: [],
  updatedAt: Date.now(),
});

export function Vault() {
  const [entries, setEntries] = useState<VaultEntryMeta[]>([]);
  const [providerCredentials, setProviderCredentials] = useState<AiRouterConnection[]>([]);
  const [editing, setEditing] = useState<VaultEntry | null>(null);
  const [editingProvider, setEditingProvider] = useState<AiRouterConnection | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = async () => {
    const [savedEntries, connections] = await Promise.all([
      listVaultEntries(),
      getAiRouterConnections().catch(() => []),
    ]);
    setEntries(savedEntries);
    setProviderCredentials(
      connections
        .filter((connection) => Boolean(connection.credentialRef))
        .sort((a, b) => {
          const providerOrder = (a.name ?? a.provider).localeCompare(b.name ?? b.provider);
          return providerOrder || (a.priority ?? 0) - (b.priority ?? 0);
        }),
    );
    setLoading(false);
  };

  useEffect(() => {
    void refresh();
  }, []);

  const startEdit = async (id: string) => {
    setEditing((await getVaultEntry(id)) ?? blank());
  };

  const remove = async (id: string) => {
    await deleteVaultEntry(id);
    await refresh();
  };

  const removeProviderCredential = async (connection: AiRouterConnection) => {
    await deleteAiRouterConnection(connection.id);
    if (connection.credentialRef) await vaultDelete(connection.credentialRef);
    await refresh();
  };

  return (
    <div className="mx-auto max-w-3xl px-4 py-6 sm:px-8 sm:py-10">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Vault</h1>
          <p className="mt-1 text-neutral-400">
            Save a service's login once. Your agents use it to act for you —
            no re-entering passwords.
          </p>
        </div>
        <Button onClick={() => setEditing(blank())}>
          <Plus className="size-4" /> Add
        </Button>
      </div>

      <div className="mt-3 flex items-center gap-1.5 text-xs text-neutral-500">
        <Lock className="size-3.5" />
        {vaultIsSecure()
          ? "Stored in VuaAssistant's encrypted App Vault."
          : "Development preview storage; desktop uses the encrypted App Vault."}
      </div>

      {loading ? null : entries.length === 0 && providerCredentials.length === 0 ? (
        <Card className="mt-8 flex flex-col items-center gap-2 py-12 text-center">
          <KeyRound className="size-8 text-gold-300" />
          <div className="font-semibold">No saved logins yet</div>
          <p className="max-w-sm text-sm text-neutral-500">
            Add a website or service with its URL and login. Then just ask an
            agent — e.g. "post this to my blog" — and it signs in for you.
          </p>
        </Card>
      ) : (
        <section className="mt-6">
          <ul className="flex flex-col gap-2">
          {providerCredentials.map((connection) => (
            <li
              key={connection.id}
              className="flex items-center gap-3 rounded-xl border border-neutral-800 bg-neutral-900/60 px-4 py-3"
            >
              <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-neutral-800 text-gold-300">
                <KeyRound className="size-4" />
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <div className="truncate text-sm font-medium">{connection.label || connection.name || connection.provider}</div>
                  <Badge tone={connection.testStatus === "Verified" ? "green" : connection.isActive === false ? "neutral" : "gold"}>
                    {connection.isActive === false ? "Disabled" : connection.testStatus || "Connected"}
                  </Badge>
                </div>
                <div className="truncate text-xs text-neutral-500">
                  {connection.email || connection.accountLabel || connection.id}
                </div>
              </div>
              <button
                onClick={() => setEditingProvider(connection)}
                className="cursor-pointer rounded-lg p-1.5 text-neutral-500 hover:bg-neutral-800 hover:text-neutral-200"
                title="Manage connection"
              >
                <Pencil className="size-4" />
              </button>
              <button
                onClick={() => void removeProviderCredential(connection)}
                className="cursor-pointer rounded-lg p-1.5 text-neutral-500 hover:bg-neutral-800 hover:text-red-400"
                title="Delete connection and credential"
              >
                <Trash2 className="size-4" />
              </button>
            </li>
          ))}
          {entries.map((e) => (
            <li
              key={e.id}
              className="flex items-center gap-3 rounded-xl border border-neutral-800 bg-neutral-900/60 px-4 py-3"
            >
              <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-neutral-800 text-gold-300">
                <KeyRound className="size-4" />
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <div className="truncate text-sm font-medium">{e.label}</div>
                  <Badge>Stored</Badge>
                </div>
                {e.service && (
                  <div className="text-xs text-neutral-500">{e.service}</div>
                )}
              </div>
              <button
                onClick={() => void startEdit(e.id)}
                className="cursor-pointer rounded-lg p-1.5 text-neutral-500 hover:bg-neutral-800 hover:text-neutral-200"
                title="Edit"
              >
                <Pencil className="size-4" />
              </button>
              <button
                onClick={() => void remove(e.id)}
                className="cursor-pointer rounded-lg p-1.5 text-neutral-500 hover:bg-neutral-800 hover:text-red-400"
                title="Delete"
              >
                <Trash2 className="size-4" />
              </button>
            </li>
          ))}
          </ul>
        </section>
      )}

      {editing && (
        <VaultEditor
          entry={editing}
          onClose={() => setEditing(null)}
          onSaved={async () => {
            setEditing(null);
            await refresh();
          }}
        />
      )}
      {editingProvider && (
        <AiProviderCredentialEditor
          connection={editingProvider}
          onClose={() => setEditingProvider(null)}
          onSaved={async () => {
            setEditingProvider(null);
            await refresh();
          }}
        />
      )}
    </div>
  );
}

type AiCredentialForm = {
  label: string;
  email: string;
  apiKey: string;
  accessToken: string;
  refreshToken: string;
  projectId: string;
};

function AiProviderCredentialEditor({
  connection,
  onClose,
  onSaved,
}: {
  connection: AiRouterConnection;
  onClose: () => void;
  onSaved: () => void | Promise<void>;
}) {
  const [form, setForm] = useState<AiCredentialForm>({
    label: connection.label || connection.name || connection.provider,
    email: connection.email ?? "",
    apiKey: "",
    accessToken: "",
    refreshToken: "",
    projectId: "",
  });
  const [storedCredential, setStoredCredential] = useState<Record<string, unknown>>({});
  const [revealed, setRevealed] = useState<Record<string, boolean>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const raw = connection.credentialRef ? await vaultGet(connection.credentialRef) : null;
        const credential = raw ? JSON.parse(raw) as Record<string, unknown> : {};
        if (cancelled) return;
        setStoredCredential(credential);
        setForm((current) => ({
          ...current,
          email: typeof credential.email === "string" ? credential.email : current.email,
          apiKey: typeof credential.apiKey === "string" ? credential.apiKey : "",
          accessToken: typeof credential.accessToken === "string" ? credential.accessToken : "",
          refreshToken: typeof credential.refreshToken === "string" ? credential.refreshToken : "",
          projectId: typeof credential.projectId === "string" ? credential.projectId : "",
        }));
      } catch (loadError) {
        if (!cancelled) setError(loadError instanceof Error ? loadError.message : String(loadError));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [connection]);

  const update = (key: keyof AiCredentialForm, value: string) => {
    setForm((current) => ({ ...current, [key]: value }));
  };

  const save = async () => {
    if (!connection.credentialRef) return;
    setSaving(true);
    setError(null);
    try {
      const nextCredential = {
        ...storedCredential,
        apiKey: form.apiKey || undefined,
        accessToken: form.accessToken || undefined,
        refreshToken: form.refreshToken || undefined,
        email: form.email || undefined,
        projectId: form.projectId || undefined,
      };
      await vaultSet(connection.credentialRef, JSON.stringify(nextCredential));
      await saveAiRouterConnection({
        id: connection.id,
        provider: connection.provider,
        name: connection.name,
        label: form.label.trim() || connection.name || connection.provider,
        email: form.email.trim() || undefined,
        accountLabel: connection.accountLabel || form.email.trim() || undefined,
        priority: connection.priority,
        authType: connection.authType ?? (form.apiKey ? "api-key" : "subscription"),
        credentialRef: connection.credentialRef,
        defaultModel: connection.defaultModel,
      });
      await onSaved();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : String(saveError));
    } finally {
      setSaving(false);
    }
  };

  const field = (label: string, key: keyof AiCredentialForm, secret = false) => (
    <div>
      <div className="mb-1 text-xs text-neutral-400">{label}</div>
      <div className="flex gap-2">
        <input
          value={form[key]}
          onChange={(event) => update(key, event.target.value)}
          type={secret && !revealed[key] ? "password" : "text"}
          className={`${baseInput} min-w-0 flex-1`}
        />
        {secret && (
          <button
            onClick={() => setRevealed((current) => ({ ...current, [key]: !current[key] }))}
            title={revealed[key] ? `Hide ${label}` : `Show ${label}`}
            className="cursor-pointer rounded-lg bg-neutral-800 px-2 text-neutral-400 hover:text-neutral-100"
          >
            {revealed[key] ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
          </button>
        )}
      </div>
    </div>
  );

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" onClick={onClose}>
      <div className="max-h-[90vh] w-full max-w-md overflow-y-auto rounded-2xl border border-neutral-800 bg-neutral-900 p-5" onClick={(event) => event.stopPropagation()}>
        <div className="flex items-center justify-between">
          <div>
            <div className="flex items-center gap-2">
              <h2 className="font-semibold">Edit {connection.label || connection.name || connection.provider}</h2>
              <Badge tone={connection.testStatus === "Verified" ? "green" : "gold"}>
                {connection.testStatus || "Connected"}
              </Badge>
            </div>
            <p className="text-xs text-neutral-500">{connection.email || connection.accountLabel || connection.provider}</p>
          </div>
          <button onClick={onClose} className="cursor-pointer rounded-lg p-1 text-neutral-500 hover:bg-neutral-800"><X className="size-4" /></button>
        </div>
        {loading ? (
          <div className="py-10 text-center text-sm text-neutral-500">Loading credential…</div>
        ) : (
          <div className="mt-4 flex flex-col gap-3">
            {field("Account label", "label")}
            {field("Email", "email")}
            {(connection.authType === "api-key" || Boolean(form.apiKey)) && field("API key", "apiKey", true)}
            {(connection.authType !== "api-key" || Boolean(form.accessToken)) && field("Access token", "accessToken", true)}
            {Boolean(form.refreshToken) && field("Refresh token", "refreshToken", true)}
            {(connection.provider === "antigravity" || Boolean(form.projectId)) && field("Project ID", "projectId")}
          </div>
        )}
        {error && <p className="mt-3 text-xs text-red-300">{error}</p>}
        <div className="mt-5 flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button onClick={() => void save()} disabled={loading || saving || !connection.credentialRef}>
            {saving ? "Saving…" : "Save"}
          </Button>
        </div>
      </div>
    </div>
  );
}

function VaultEditor({
  entry,
  onClose,
  onSaved,
}: {
  entry: VaultEntry;
  onClose: () => void;
  onSaved: () => void | Promise<void>;
}) {
  const [form, setForm] = useState<VaultEntry>(entry);
  const [saving, setSaving] = useState(false);
  const [typeMenuOpen, setTypeMenuOpen] = useState(false);
  const [revealed, setRevealed] = useState<Record<number, boolean>>({});
  const set = (patch: Partial<VaultEntry>) =>
    setForm((f) => ({ ...f, ...patch }));

  const valid = useMemo(() => form.label.trim().length > 0, [form.label]);

  const setCustom = (i: number, patch: Partial<VaultField>) =>
    setForm((f) => ({
      ...f,
      fields: (f.fields ?? []).map((row, idx) =>
        idx === i ? { ...row, ...patch } : row,
      ),
    }));
  const addCustom = (type: VaultFieldType) => {
    setForm((f) => ({
      ...f,
      fields: [...(f.fields ?? []), { label: "", value: "", type }],
    }));
    setTypeMenuOpen(false);
  };
  const removeCustom = (i: number) =>
    setForm((f) => ({
      ...f,
      fields: (f.fields ?? []).filter((_, idx) => idx !== i),
    }));

  const save = async () => {
    setSaving(true);
    try {
      await saveVaultEntry({
        ...form,
        label: form.label.trim(),
        // Drop custom rows with no name.
        fields: (form.fields ?? []).filter((f) => f.label.trim() !== ""),
        updatedAt: Date.now(),
      });
      await onSaved();
    } finally {
      setSaving(false);
    }
  };

  const field = (
    label: string,
    key: "label" | "url" | "username" | "password" | "notes",
    Icon: LucideIcon,
    opts: { placeholder?: string; type?: string } = {},
  ) => (
    <div>
      <div className="mb-1 text-xs text-neutral-400">{label}</div>
      <div className="flex items-center gap-2">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-neutral-800 text-neutral-400">
          <Icon className="size-4" />
        </span>
        <input
          className={`${baseInput} min-w-0 flex-1`}
          type={opts.type ?? "text"}
          value={form[key] ?? ""}
          onChange={(e) => set({ [key]: e.target.value } as Partial<VaultEntry>)}
          placeholder={opts.placeholder}
        />
      </div>
    </div>
  );

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      onClick={onClose}
    >
      <div
        className="max-h-[90vh] w-full max-w-md overflow-y-auto rounded-2xl border border-neutral-800 bg-neutral-900 p-5"
        onClick={(ev) => ev.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <h2 className="font-semibold">
            {entry.label ? "Edit login" : "Add login"}
          </h2>
          <button
            onClick={onClose}
            className="cursor-pointer rounded-lg p-1 text-neutral-500 hover:bg-neutral-800"
            aria-label="Close"
          >
            <X className="size-4" />
          </button>
        </div>

        {/* Default fields */}
        <div className="mt-4 flex flex-col gap-3">
          {field("Name *", "label", Tag, { placeholder: "My WordPress blog" })}
          {field("URL / endpoint", "url", Globe, {
            placeholder: "https://blog.example.com",
          })}
          {field("Username / email", "username", User)}
          {field("Password", "password", Lock, { type: "password" })}
          {field("Notes", "notes", StickyNote)}
        </div>

        {/* Custom fields the user adds themselves */}
        {(form.fields ?? []).length > 0 && (
          <div className="mt-4 flex flex-col gap-2 border-t border-neutral-800 pt-4">
            <div className="text-xs font-medium text-neutral-400">
              Custom fields
            </div>
            {(form.fields ?? []).map((row, i) => {
              const info = fieldTypeInfo(row.type);
              const Icon = info.icon;
              const secret = isSecretField(row);
              const inputType = secret
                ? revealed[i]
                  ? "text"
                  : "password"
                : info.inputType;
              return (
                <div key={i} className="flex items-center gap-2">
                  <span
                    className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-neutral-800 text-neutral-400"
                    title={info.label}
                  >
                    <Icon className="size-4" />
                  </span>
                  <input
                    className={`${baseInput} w-1/3 shrink-0`}
                    value={row.label}
                    onChange={(e) => setCustom(i, { label: e.target.value })}
                    placeholder="Field name"
                  />
                  <input
                    className={`${baseInput} min-w-0 flex-1`}
                    type={inputType}
                    value={row.value}
                    onChange={(e) => setCustom(i, { value: e.target.value })}
                    placeholder={info.label}
                  />
                  {secret && (
                    <button
                      onClick={() =>
                        setRevealed((r) => ({ ...r, [i]: !r[i] }))
                      }
                      className="cursor-pointer rounded-lg p-1.5 text-neutral-500 hover:bg-neutral-800 hover:text-neutral-200"
                      title={revealed[i] ? "Hide value" : "Show value"}
                    >
                      {revealed[i] ? (
                        <EyeOff className="size-4" />
                      ) : (
                        <Eye className="size-4" />
                      )}
                    </button>
                  )}
                  <button
                    onClick={() => removeCustom(i)}
                    className="cursor-pointer rounded-lg p-1.5 text-neutral-500 hover:bg-neutral-800 hover:text-red-400"
                    title="Remove field"
                  >
                    <Trash2 className="size-4" />
                  </button>
                </div>
              );
            })}
          </div>
        )}

        {/* Add field: pick a type first, then the row appears */}
        <div className="relative mt-3 inline-block">
          <button
            onClick={() => setTypeMenuOpen((o) => !o)}
            className="inline-flex cursor-pointer items-center gap-1.5 text-xs text-gold-300 hover:underline"
          >
            <Plus className="size-3.5" /> Add field
          </button>
          {typeMenuOpen && (
            <>
              <div
                className="fixed inset-0 z-10"
                onClick={() => setTypeMenuOpen(false)}
              />
              <div className="absolute left-0 top-full z-20 mt-1 w-40 rounded-xl border border-neutral-800 bg-neutral-900 p-1 shadow-xl">
                <div className="px-2 py-1 text-[10px] uppercase tracking-wide text-neutral-600">
                  Field type
                </div>
                {FIELD_TYPES.map(({ type, label, icon: Icon }) => (
                  <button
                    key={type}
                    onClick={() => addCustom(type)}
                    className="flex w-full cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm text-neutral-300 hover:bg-neutral-800"
                  >
                    <Icon className="size-4 text-neutral-500" />
                    {label}
                  </button>
                ))}
              </div>
            </>
          )}
        </div>

        <div className="mt-5 flex justify-end gap-2">
          <Button variant="ghost" size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button size="sm" disabled={!valid || saving} onClick={() => void save()}>
            {saving ? "Saving…" : "Save to Vault"}
          </Button>
        </div>

        <div className="mt-4 flex items-center gap-1.5 text-[11px] text-neutral-600">
          <Badge tone="green">Agents can use this</Badge>
          Ask an agent to act on this service and it reads the login from here.
        </div>
      </div>
    </div>
  );
}
