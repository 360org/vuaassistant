/**
 * App-wide state with localStorage persistence. Deliberately simple: one
 * context, one reducer-less setter API. Everything a fresh install needs to
 * remember (onboarding, provider, agents, integrations, knowledge, chat)
 * lives here.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type { ProviderId } from "@/lib/catalog";
import type { Theme } from "@/lib/i18n";
import type { ChatMessage } from "@/runtime/engine";
import type { ProviderConfig } from "@/runtime/providers";
import {
  completeOAuthReturn,
  fetchVendorAccount,
  loadAntigravityProject,
  type OAuthReturn,
} from "@/runtime/oauth";

export const fileObjectURLs = new Map<string, string>();
import { parseSkillMd } from "@/lib/skills";

export function parseTasksFromMessages(messages: ChatMessage[]): ParsedTask[] {
  const assistantMsg = [...messages].reverse().find(
    (m) => m.role === "assistant" && (m.content.includes("- [ ]") || m.content.includes("- [x]")),
  );
  if (!assistantMsg) return [];

  const lines = assistantMsg.content.split("\n");
  const tasks: ParsedTask[] = [];
  const checklistRegex = /^\s*[-*]\s+\[([ xX])\]\s+(.+)$/;

  for (const line of lines) {
    const match = line.match(checklistRegex);
    if (match) {
      const isDone = match[1].toLowerCase() === "x";
      const name = match[2].trim();
      tasks.push({
        id: `t-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
        name,
        status: isDone ? "completed" : "pending",
      });
    }
  }

  // Assign the first pending task as "in_progress"
  const firstPending = tasks.find((t) => t.status === "pending");
  if (firstPending) {
    firstPending.status = "in_progress";
  }

  return tasks;
}
import { loginConfig, ROUTER_BASE_URL } from "@/runtime/providers";
import { checkAppUpdate, type AppUpdateInfo } from "@/runtime/updater";
import { vaultDelete, vaultGet, vaultSet } from "@/runtime/vault";
import {
  clearKnowledge,
  indexKnowledgeFile,
  savePhysicalDataFile,
  syncAllKnowledgeFilesToDisk,
} from "@/runtime/knowledge";
import { newMessageId } from "@/runtime/engine";
import { AGENT_STORE, getProvider, PROVIDERS, type AgentTemplate } from "@/lib/catalog";
import type { ImportedAgent } from "@/runtime/agentImport";
import {
  syncAgents,
  restartAgentRunner,
  receiveOutbound,
  latestOutboundSeq,
  runtimeDir,
  type OutboundMessage,
} from "@/runtime/nanoclaw";
import { AI_ROUTER_BASE_URL } from "@/runtime/aiRouter";

/** Vault key holding a provider's secret (API key / router token). */
function vaultKey(provider: ProviderId): string {
  return `provider:${provider}`;
}

function refreshVaultKey(provider: ProviderId): string {
  return `provider:${provider}:refresh`;
}

export type View =
  | "home"
  | "chat"
  | "sessions"
  | "agents"
  | "skills"
  | "knowledge"
  | "media"
  | "vault"
  | "scheduled"
  | "integrations"
  | "settings";

export type KnowledgeStatus = "processing" | "ready" | "error";

export interface KnowledgeFile {
  id: string;
  name: string;
  size: number;
  addedAt: number;
  status: KnowledgeStatus;
  chunks?: number;
  error?: string;
}

/** An external skill installed from a URL (raw SKILL.md, source kept). */
export interface CustomSkill {
  raw: string;
  source: string;
}

/** The skill steering a chat: its name and full SKILL.md instructions. */
export interface ActiveSkill {
  name: string;
  instructions: string;
}

/** Per-agent configuration: workflow instructions and a personality "soul". */
export interface McpServerConfig {
  /** Executable chosen and approved by the local user, never by the model. */
  command: string;
  /** Fixed arguments supplied by the local user when configuring this server. */
  args: string[];
}

/** Per-agent configuration: workflow instructions and a personality "soul". */
export interface AgentConfig {
  /** How the agent should work — its process/steps (ChatGPT-style). */
  instructions?: string;
  /** The agent's personality/voice. */
  soul?: string;
  /** Persistent memory notes the agent recalls across chats. */
  memory?: string[];
  /** Enabled skill IDs/names for this agent. */
  skills?: string[];
  /** Custom Markdown spec docs (SOUL.md, MISSION.md, NORTH_STAR.md, etc.) */
  docs?: Record<string, string>;
}

/**
 * The local user, created automatically on first sign-in from the vendor
 * account — no separate registration. Lives only on this device.
 */
export interface LocalUser {
  /** Display name from the first linked AI account, editable by the user. */
  name: string;
  /** Router/vendor identifier for the account that created this profile. */
  provider: string;
  /** Human name for a provider that is not in the legacy runtime catalog. */
  providerLabel?: string;
  /** Secondary line, normally the linked account identity. */
  detail?: string;
  /** AI Router connection that authenticated this device-local profile. */
  connectionId?: string;
  createdAt: number;
}

export interface ChatSession {
  id: string;
  title: string;
  agentId: string | null;
  channel: "desktop" | "telegram";
  externalId?: string;
  messages: ChatMessage[];
  createdAt: number;
  updatedAt: number;
}

function newChatSession(
  agentId: string | null = null,
  channel: "desktop" | "telegram" = "desktop",
  externalId?: string,
): ChatSession {
  const now = Date.now();
  return {
    id: `chat-${now.toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
    title: "New chat",
    agentId,
    channel,
    externalId,
    messages: [],
    createdAt: now,
    updatedAt: now,
  };
}

/** A recurring job the assistant runs on a schedule (NanoClaw scheduling). */
export interface ScheduledTask {
  id: string;
  name: string;
  /** What the assistant should do each run. */
  prompt: string;
  /** Human recurrence, e.g. "Every day at 9:00". */
  schedule: string;
  enabled: boolean;
  /** User-defined labels for filtering and grouping task work. */
  tags?: string[];
  createdAt: number;
  /** When the task last ran (ms), so it isn't fired twice. */
  lastRun?: number;
  /** Autonomy Loop (#14): parent task id for DAG delegation. Undefined = root task. */
  parentTaskId?: string;
  /** Status for Kanban view. "pending" | "running" | "done" | "failed" */
  kanbanStatus?: "pending" | "running" | "done" | "failed";
}

/** History is unbounded otherwise; a scheduled task runs forever. */
const MAX_TASK_RUN_LOGS = 200;

export interface TaskRunLog {
  id: string;
  taskId: string;
  taskName: string;
  runAt: number;
  duration: number; // in ms
  status: "success" | "error" | "running";
  output: string;
}

interface PersistedState {
  onboarded: boolean;
  /** The auto-created local user, or null before first sign-in. */
  user: LocalUser | null;
  provider: ProviderId | null;
  /** Per-provider credentials/config — stored on this device only. */
  providerConfigs: Partial<Record<ProviderId, ProviderConfig>>;
  installedAgents: string[];
  /** Per-agent instructions + soul, keyed by agent id. */
  agentConfigs: Record<string, AgentConfig>;
  /** NanoClaw engine skills the user has installed (channel/provider/etc). */
  installedEngineSkills: string[];
  /** Local-user-approved MCP servers. Commands never come from a model turn. */
  mcpServers: Record<string, McpServerConfig>;
  connectedIntegrations: string[];
  /**
   * Knowledge is isolated per role: each agent id (or "general" for the base
   * assistant) has its own bucket, so switching roles never mixes knowledge.
   */
  knowledgeByAgent: Record<string, KnowledgeFile[]>;
  messages: ChatMessage[];
  chatSessions: ChatSession[];
  activeSessionId: string | null;
  activeAgentId: string | null;
  customSkills: CustomSkill[];
  scheduledTasks: ScheduledTask[];
  /** Shared task-tag catalog; tasks select from this list instead of inventing labels ad hoc. */
  taskTags?: string[];
  taskRunLogs?: TaskRunLog[];
  /** Roles learn durable facts from chats and save them to their own memory. */
  selfImprove: boolean;
  /** Agents (roles) người dùng nhập từ persona markdown/URL. */
  customAgents: ImportedAgent[];
  /** Thư mục lưu trữ dữ liệu tùy chỉnh trên máy host. */
  customDataPath?: string;
  /** Ngôn ngữ giao diện hệ thống: "vi" | "en" */
  language?: "vi" | "en";
  /** Chủ đề giao diện: "system" | "light" | "dark" | "gold" | "midnight" */
  theme?: Theme;
}

export interface ActiveBackgroundTask {
  id: string;
  name: string;
  command?: string;
  startedAt: number;
}

const STORAGE_KEY = "vuaassistant-state-v1";

const initialChatSession = newChatSession();

const initialState: PersistedState = {
  onboarded: false,
  user: null,
  provider: null,
  providerConfigs: {},
  installedAgents: [],
  agentConfigs: {},
  installedEngineSkills: ["skill-creator", "write-email", "summarize-document", "odoo-post-publisher"],
  mcpServers: {},
  connectedIntegrations: [],
  knowledgeByAgent: {},
  messages: [],
  chatSessions: [initialChatSession],
  activeSessionId: initialChatSession.id,
  activeAgentId: null,
  customSkills: [],
  scheduledTasks: [],
  taskTags: [],
  taskRunLogs: [],
  selfImprove: true,
  customAgents: [],
  customDataPath: "",
  language: "vi",
  theme: "dark",
};

/** Knowledge bucket for a role: an agent id, or "general" for no agent. */
const GENERAL_KNOWLEDGE = "general";
const knowledgeBucket = (agentId: string | null): string =>
  agentId ?? GENERAL_KNOWLEDGE;

function getUserStorageKey(user: LocalUser | null): string {
  if (!user) return "vuaassistant-guest-state";
  const id = user.detail || user.name || "user";
  return `vuaassistant-user-${id.toLowerCase().replace(/[^a-z0-9]/g, "_")}`;
}

function loadStateForUser(key: string): PersistedState {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return initialState;
    const parsed = JSON.parse(raw) as Partial<PersistedState> & {
      knowledgeFiles?: KnowledgeFile[];
    };
    const merged = { ...initialState, ...parsed };
    merged.taskRunLogs = merged.taskRunLogs ?? [];
    merged.taskTags = Array.from(new Set([
      ...(merged.taskTags ?? []),
      ...merged.scheduledTasks.flatMap((task) => task.tags ?? []),
    ])).sort();
    if (parsed.knowledgeFiles && !parsed.knowledgeByAgent) {
      merged.knowledgeByAgent = { [GENERAL_KNOWLEDGE]: parsed.knowledgeFiles };
    }
    if (!merged.chatSessions?.length) {
      const migrated = newChatSession(merged.activeAgentId);
      migrated.messages = merged.messages ?? [];
      migrated.title = migrated.messages.find((message) => message.role === "user")?.content.slice(0, 48) || "New chat";
      migrated.updatedAt = migrated.messages[migrated.messages.length - 1]?.createdAt ?? migrated.createdAt;
      merged.chatSessions = [migrated];
      merged.activeSessionId = migrated.id;
    }
    const active = merged.chatSessions.find((session) => session.id === merged.activeSessionId) ?? merged.chatSessions[0];
    if (merged.customDataPath) {
      try {
        localStorage.setItem("vua:custom-data-path", merged.customDataPath);
      } catch {
        /* storage restricted */
      }
    }
    merged.chatSessions = merged.chatSessions.map((session) => ({
      ...session,
      channel: session.channel ?? "desktop",
    }));
    merged.activeSessionId = active.id;
    merged.messages = active.messages;
    merged.activeAgentId = active.agentId;
    return merged;
  } catch {
    return initialState;
  }
}

function loadState(): PersistedState {
  const lastActiveKey = localStorage.getItem("vuaassistant-last-active-user-key") || STORAGE_KEY;
  return loadStateForUser(lastActiveKey);
}

export interface ParsedTask {
  id: string;
  name: string;
  status: "pending" | "in_progress" | "completed";
}

interface AppStore extends PersistedState {
  view: View;
  setView: (view: View) => void;
  /** Active session tasks parsed from Agent Plan checklist */
  activeSessionTasks: ParsedTask[];
  /** One-shot draft for the chat composer (set by Skills → Use). */
  chatDraft: string | null;
  /** The skill whose instructions are steering the current chat, if any. */
  activeSkill: ActiveSkill | null;
  useSkill: (prompt: string, skill?: ActiveSkill) => void;
  clearActiveSkill: () => void;
  consumeChatDraft: () => void;
  /** Set when the app just returned from a provider sign-in redirect. */
  oauthReturn: OAuthReturn | null;
  /** Error from a failed sign-in return, for the UI to surface. */
  oauthError: string | null;
  completeOnboarding: (provider: ProviderId, integrations: string[]) => void;
  /** Change the local profile label without changing any vendor credential. */
  updateLocalUser: (name: string) => void;
  /** Create the device-local profile from its first linked AI account only. */
  ensureLocalUser: (input: Omit<LocalUser, "createdAt">) => void;
  /** Remove the device-local profile after its linked credential is revoked. */
  clearLocalUser: () => void;
  setProvider: (provider: ProviderId) => void;
  setProviderConfig: (
    provider: ProviderId,
    config: ProviderConfig | null,
  ) => void;
  /**
   * Connect a provider and, on first sign-in, create the local user from
   * the vendor account. Makes the provider active.
   */
  connectProvider: (
    provider: ProviderId,
    config: ProviderConfig,
  ) => Promise<void>;
  addCustomSkill: (skill: CustomSkill) => void;
  removeCustomSkill: (source: string) => void;
  toggleEngineSkill: (skillId: string) => void;
  setMcpServers: (servers: Record<string, McpServerConfig>) => void;
  setTaskTags: (tags: string[]) => void;
  taskRunLogs: TaskRunLog[];
  addTaskRunLog: (log: Omit<TaskRunLog, "id">) => void;
  clearTaskRunLogs: (taskId?: string) => void;
  addScheduledTask: (task: Omit<ScheduledTask, "id" | "createdAt">) => void;
  updateScheduledTask: (id: string, patch: Partial<ScheduledTask>) => void;
  removeScheduledTask: (id: string) => void;
  toggleAgent: (agentId: string) => void;
  setAgentConfig: (agentId: string, patch: AgentConfig) => void;
  /** Append newly-learned memory notes to a role (deduped, capped). */
  addAgentMemory: (agentId: string, notes: string[]) => void;
  setSelfImprove: (on: boolean) => void;
  setCustomDataPath: (path: string) => void;
  language: "vi" | "en";
  setLanguage: (lang: "vi" | "en") => void;
  theme: Theme;
  setTheme: (theme: Theme) => void;
  exportFullBackupData: () => string;
  importFullBackupData: (jsonStr: string) => boolean;
  activeBackgroundTasks: ActiveBackgroundTask[];
  startBackgroundTask: (name: string, command?: string) => string;
  stopBackgroundTask: (id: string) => void;
  appUpdate: AppUpdateInfo | null;
  checkForAppUpdate: () => Promise<AppUpdateInfo>;
  setActiveAgent: (agentId: string | null) => void;
  /** Mọi agent cài được: dựng sẵn (AGENT_STORE) + đã nhập từ ngoài. */
  agents: AgentTemplate[];
  /** Nhập một agent từ persona markdown → cài + kích hoạt persona. */
  importAgent: (agent: ImportedAgent) => void;
  removeCustomAgent: (id: string) => void;
  toggleIntegration: (integrationId: string) => void;
  /** The active role's knowledge (derived from `knowledgeByAgent`). */
  knowledgeFiles: KnowledgeFile[];
  addKnowledgeFiles: (files: File[]) => void;
  removeKnowledgeFile: (fileId: string) => void;
  setMessages: (
    update: ChatMessage[] | ((prev: ChatMessage[]) => ChatMessage[]),
  ) => void;
  clearChat: () => void;
  createChatSession: () => void;
  switchChatSession: (sessionId: string) => void;
  renameChatSession: (sessionId: string, title: string) => void;
  deleteChatSession: (sessionId: string) => void;
  resetApp: () => void;
}

const AppContext = createContext<AppStore | null>(null);

export function AppProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<PersistedState>(loadState);
  const [view, setView] = useState<View>("chat");
  const [chatDraft, setChatDraft] = useState<string | null>(null);
  const [activeSkill, setActiveSkill] = useState<ActiveSkill | null>(null);
  const [appUpdate, setAppUpdate] = useState<AppUpdateInfo | null>(null);

  const checkForAppUpdate = useCallback(async () => {
    const info = await checkAppUpdate();
    setAppUpdate(info);
    return info;
  }, []);

  // Task #10: Disk-fallback session hydration.
  // Khi localStorage bị xóa (storage migration, privacy mode, clear site data),
  // chatSessions sẽ chỉ có 1 session mới toanh. Load lại từ disk để khôi phục.
  useEffect(() => {
    if (state.chatSessions.length > 1) return; // đã có sessions — không cần
    if (state.chatSessions[0]?.messages.length) return; // session có tin nhắn — không cần
    if (typeof window === "undefined" || !("__TAURI_INTERNALS__" in window)) return;
    const dataDir = state.customDataPath || localStorage.getItem("vua:custom-data-path") || "~/vuaassistant";
    import("@tauri-apps/api/core").then(({ invoke }) =>
      invoke<string>("load_sessions_from_disk", { customDir: dataDir })
        .then((raw) => {
          if (!raw) return;
          const sessions = JSON.parse(raw) as ChatSession[];
          if (!Array.isArray(sessions) || sessions.length === 0) return;
          setState((s) => {
            if (s.chatSessions.length > 1) return s; // đã được cập nhật bởi effect khác
            const active = sessions.find((session) => session.id === s.activeSessionId) ?? sessions[0];
            return { ...s, chatSessions: sessions, activeSessionId: active.id, messages: active.messages, activeAgentId: active.agentId };
          });
        })
        .catch(() => {})
    ).catch(() => {});
  // ponytail: chỉ chạy một lần sau mount
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    void checkForAppUpdate();
    const interval = window.setInterval(checkForAppUpdate, 300_000);
    return () => window.clearInterval(interval);
  }, [checkForAppUpdate]);
  const [oauthReturn, setOauthReturn] = useState<OAuthReturn | null>(null);
  const [oauthError, setOauthError] = useState<string | null>(null);
  const [hasHydratedCredentials, setHasHydratedCredentials] = useState(false);

  // Dev server synchronization + vault rehydrate: run sequentially to avoid
  // race conditions. Host state is loaded first (contains provider metadata
  // like model names, but apiKey is always ""), then vault keys are read and
  // injected into providerConfigs, guaranteeing the engine always has real
  // credentials in memory.
  useEffect(() => {
    let cancelled = false;

    (async () => {
      // The first render can have no local provider metadata while the dev
      // host already has it. Track IDs separately so Vault rehydration never
      // races React's asynchronous host-state merge.
      // A prior preview session may have persisted only the Vault secret and
      // lost its non-secret provider metadata. Check every known vendor so a
      // valid saved credential always restores a usable connection.
      const providerIds = new Set<ProviderId>(PROVIDERS.map((provider) => provider.id));
      // Step 1: Load host state (dev server only, non-Tauri browsers)
      if (typeof window !== "undefined" && !("__TAURI_INTERNALS__" in window)) {
        try {
          const res = await fetch("/api/state");
          if (res.ok) {
            const hostState = await res.json();
            if (hostState && typeof hostState === "object" && Object.keys(hostState).length > 0) {
              for (const id of Object.keys(hostState.providerConfigs ?? {})) {
                providerIds.add(id as ProviderId);
              }
              if (cancelled) return;
              setState((s) => {
                const mergedConfigs = { ...s.providerConfigs };
                if (hostState.providerConfigs) {
                  for (const [id, cfg] of Object.entries(hostState.providerConfigs)) {
                    mergedConfigs[id as ProviderId] = {
                      ...(cfg as ProviderConfig),
                      // Never overwrite an already-loaded in-memory key
                      apiKey: s.providerConfigs[id as ProviderId]?.apiKey || (cfg as ProviderConfig).apiKey || "",
                    };
                  }
                }
                return {
                  ...s,
                  ...hostState,
                  providerConfigs: mergedConfigs,
                };
              });
            }
          }
        } catch {
          /* dev server not available, proceed */
        }
      }

      // Step 2: Rehydrate provider secrets from the Vault back into memory.
      // This MUST run after hostState is merged, so vault keys always win
      // over the empty apiKey:"" values from persisted state.
      if (cancelled) return;
      for (const id of providerIds) {
        if (cancelled) break;
        const key = await vaultGet(vaultKey(id));
        if (cancelled || !key) continue;
        const refreshToken = (id === "gemini" || id === "claude")
          ? await vaultGet(refreshVaultKey(id))
          : null;
        const legacyGemini = id === "gemini" && !state.providerConfigs.gemini?.projectId;
        const projectId = legacyGemini
          ? await loadAntigravityProject(key).catch(() => undefined)
          : undefined;
        setState((s) => {
          const current = s.providerConfigs[id];
          const restored = current ?? loginConfig(id, key);
          // Always write the vault key — it's the authoritative source.
          // Also ensure baseUrl is set for routed models (format "vendor/model"):
          // if the model contains '/' and no baseUrl, it was signed in through
          // the router, so attach the router base URL so requests reach
          // OpenRouter instead of a native vendor API.
          const isRoutedModel = restored.model?.includes("/") && id !== "local";
          const baseUrl = restored.baseUrl || (isRoutedModel ? ROUTER_BASE_URL : undefined);
          // Claude subscription model ids can expire, but Antigravity models
          // are a user-facing subscription choice and must survive restart.
          const { model, ...rest } = restored;
          const next = restored.oauth && id === "claude" ? rest : restored;
          // A credential recovered from the Vault is an established local
          // connection. A future 401/403 downgrades it to "expired" at the
          // point of use; until then it belongs in the connected provider list.
          const connectionStatus = next.connectionStatus ?? "connected";
          return {
            ...s,
            providerConfigs: {
              ...s.providerConfigs,
              [id]: {
                ...next,
                apiKey: key,
                ...(connectionStatus ? { connectionStatus } : {}),
                ...(refreshToken ? { refreshToken } : {}),
                ...(projectId ? { projectId, authMode: "antigravity" as const, model: "gemini-3.1-pro-low" } : {}),
                ...(baseUrl ? { baseUrl } : {}),
              },
            },
          };
        });
      }
      if (!cancelled) setHasHydratedCredentials(true);
    })();

    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Returning from a provider's sign-in page: finish the code exchange and
  // store the credential, then let the UI (onboarding/settings) continue.
  useEffect(() => {
    completeOAuthReturn()
      .then(async (result) => {
        if (!result) return;
        // Sets config (routed to the chosen vendor) + creates the local user.
        await connectProvider(
          result.provider,
          loginConfig(result.provider, result.apiKey, result),
        );
        setOauthReturn(result);
      })
      .catch((e) => setOauthError(e instanceof Error ? e.message : String(e)));
    // connectProvider is stable (useCallback with no deps).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const useSkill = useCallback((prompt: string, skill?: ActiveSkill) => {
    setChatDraft(prompt);
    setActiveSkill(skill ?? null);
    setView("chat");
  }, []);

  const clearActiveSkill = useCallback(() => setActiveSkill(null), []);

  const consumeChatDraft = useCallback(() => setChatDraft(null), []);

  /**
   * True once the scheduled-task file has been read at least once. Until then
   * the app must not write the list back, or a cold start would overwrite tasks
   * the agent scheduled for itself with an empty array.
   */
  const tasksLoadedRef = useRef(false);

  useEffect(() => {
    if (!hasHydratedCredentials) return;

    const timer = setTimeout(() => {
      try {
        const providerConfigs = Object.fromEntries(
          Object.entries(state.providerConfigs).map(([id, cfg]) => [
            id,
            cfg
              ? { ...cfg, apiKey: cfg.apiKey ? "" : undefined, refreshToken: undefined }
              : cfg,
          ]),
        );
        const safe = { ...state, providerConfigs };
        const currentKey = getUserStorageKey(state.user);
        localStorage.setItem(currentKey, JSON.stringify(safe));
        if (state.user) {
          localStorage.setItem("vuaassistant-last-active-user-key", currentKey);
        }

        const dataDir = state.customDataPath || localStorage.getItem("vua:custom-data-path") || "~/vuaassistant";
        if (state.customDataPath) {
          localStorage.setItem("vua:custom-data-path", state.customDataPath);
        } else {
          localStorage.removeItem("vua:custom-data-path");
        }
        if (typeof window !== "undefined" && "__TAURI_INTERNALS__" in window) {
          void import("@tauri-apps/api/core").then(({ invoke }) => {
            void invoke("save_custom_data_text", {
              customDir: dataDir,
              relativePath: "vuaassistant_backup.json",
              content: JSON.stringify(safe, null, 2),
            }).catch(() => {});

            void invoke("save_custom_data_text", {
              customDir: dataDir,
              relativePath: "chats/sessions.json",
              content: JSON.stringify(safe.chatSessions, null, 2),
            }).catch(() => {});

            // The Host Process scheduler reads this file — it is how a task
            // created here reaches the runner that actually fires it. It has to
            // land in the runner's own data dir, not the default one.
            //
            // Held back until the file has been read once, so a cold start
            // cannot overwrite the agent's own tasks with an empty array.
            if (tasksLoadedRef.current || safe.scheduledTasks.length > 0) {
              void runtimeDir().then((dir) => {
                if (!dir) return;
                void invoke("write_host_file", {
                  path: `${dir}/scheduled_tasks.json`,
                  content: JSON.stringify(safe.scheduledTasks, null, 2),
                }).catch(() => {});
              });
            }

            void syncAllKnowledgeFilesToDisk();
          }).catch(() => {});
        }
      } catch {
        /* storage full / blocked */
      }
    }, 500);

    return () => clearTimeout(timer);
  }, [state, hasHydratedCredentials]);

  const stateRef = useRef(state);
  stateRef.current = state;

  // Telegram and the scheduler live in the Host Process (idea.md §1.3): both
  // have to keep working with this window closed, so neither runs here any
  // more. What is left is the display side — poll the runner's outbound queue
  // and file each turn into the session it belongs to.
  useEffect(() => {
    const WATERMARK = "vua:host-outbound-seq";
    const POLL_MS = 2_000;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let after = Number(localStorage.getItem(WATERMARK));

    const appendTelegram = (chatId: string, row: OutboundMessage) => {
      const message: ChatMessage = {
        id: newMessageId(),
        role: row.role === "user" ? "user" : "assistant",
        content: row.content,
        createdAt: row.created_at * 1000,
      };
      setState((s) => {
        const sessionId = `telegram:${chatId}`;
        const existing = s.chatSessions.find((session) => session.id === sessionId);
        const messages = [...(existing?.messages ?? []), message];
        const updated: ChatSession = existing
          ? { ...existing, messages, updatedAt: message.createdAt }
          : {
              id: sessionId,
              title: `Telegram ${chatId}`,
              agentId: s.activeAgentId,
              channel: "telegram",
              externalId: chatId,
              messages,
              createdAt: message.createdAt,
              updatedAt: message.createdAt,
            };
        return {
          ...s,
          chatSessions: existing
            ? s.chatSessions.map((session) => (session.id === sessionId ? updated : session))
            : [updated, ...s.chatSessions],
          messages: s.activeSessionId === sessionId ? messages : s.messages,
        };
      });
    };

    const appendScheduled = (row: OutboundMessage) => {
      const runAt = row.created_at * 1000;
      setState((s) => {
        const task = s.scheduledTasks.find((item) => item.id === row.thread_id);
        // Real history, written only when the Host Process actually ran the
        // task. Nothing seeds this list any more.
        const runLog: TaskRunLog = {
          id: newMessageId(),
          taskId: row.thread_id ?? "",
          taskName: task?.name ?? row.thread_id ?? "",
          runAt,
          duration: row.duration_ms ?? 0,
          status: row.status === "error" ? "error" : "success",
          output: row.content,
        };
        return {
          ...s,
          messages: [
            ...s.messages,
            { id: newMessageId(), role: "assistant", content: row.content, createdAt: runAt },
          ],
          scheduledTasks: row.thread_id
            ? s.scheduledTasks.map((item) =>
                item.id === row.thread_id ? { ...item, lastRun: runAt } : item,
              )
            : s.scheduledTasks,
          taskRunLogs: [runLog, ...(s.taskRunLogs ?? [])].slice(0, MAX_TASK_RUN_LOGS),
        };
      });
    };

    const drain = async () => {
      const rows = await receiveOutbound(after);
      for (const row of rows) {
        after = Math.max(after, row.id);
        if (row.channel_type === "telegram" && row.thread_id) appendTelegram(row.thread_id, row);
        else if (row.channel_type === "scheduled") appendScheduled(row);
      }
      if (rows.length > 0) localStorage.setItem(WATERMARK, String(after));
    };

    const tick = async () => {
      try {
        await drain();
      } catch {
        // The runner may be restarting; the watermark keeps our place.
      }
      if (!stopped) timer = setTimeout(() => void tick(), POLL_MS);
    };

    void (async () => {
      // On a first ever launch, start from the end so an existing queue is not
      // replayed into the UI. Afterwards the stored watermark wins, which is
      // what surfaces a conversation that happened while the app was closed.
      if (!Number.isFinite(after)) after = await latestOutboundSeq().catch(() => 0);
      if (!stopped) await tick();
    })();

    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
    };
  }, []);

  const completeOnboarding = useCallback(
    (provider: ProviderId, integrations: string[]) => {
      setState((s) => ({
        ...s,
        onboarded: true,
        provider,
        connectedIntegrations: [
          ...new Set([...s.connectedIntegrations, ...integrations]),
        ],
      }));
      setView("chat");
    },
    [],
  );

  const updateLocalUser = useCallback((name: string) => {
    const clean = name.trim().slice(0, 80);
    if (!clean) return;
    setState((s) => s.user ? { ...s, user: { ...s.user, name: clean } } : s);
  }, []);

  const ensureLocalUser = useCallback((input: Omit<LocalUser, "createdAt">) => {
    setState((s) => {
      // Nếu đã có Local User profile trên thiết bị, giữ nguyên profile người dùng hiện tại
      if (s.user) {
        return {
          ...s,
          onboarded: true,
        };
      }

      // Nếu là lần đầu tiên chưa từng có Local User profile, tạo mới từ thông tin vendor kết nối đầu tiên
      const newUser: LocalUser = { ...input, createdAt: Date.now() };
      const userKey = getUserStorageKey(newUser);
      const existingState = loadStateForUser(userKey);

      return {
        ...existingState,
        user: newUser,
        onboarded: true,
      };
    });
  }, []);

  const clearLocalUser = useCallback(() => {
    localStorage.removeItem("vuaassistant-last-active-user-key");
    setState(initialState);
  }, []);

  const setProvider = useCallback((provider: ProviderId) => {
    setState((s) => ({ ...s, provider }));
  }, []);

  const setProviderConfig = useCallback(
    (provider: ProviderId, config: ProviderConfig | null) => {
      // The secret goes to the Vault; only the config shape stays in state.
      if (config?.apiKey) void vaultSet(vaultKey(provider), config.apiKey);
      if (config?.refreshToken) void vaultSet(refreshVaultKey(provider), config.refreshToken);
      else if (!config) {
        void vaultDelete(vaultKey(provider));
        void vaultDelete(refreshVaultKey(provider));
      }
      setState((s) => {
        const providerConfigs = { ...s.providerConfigs };
        if (config) providerConfigs[provider] = config;
        else delete providerConfigs[provider];
        return { ...s, providerConfigs };
      });
    },
    [],
  );

  const connectProvider = useCallback(
    async (provider: ProviderId, config: ProviderConfig) => {
      // Persist credentials only through VuaAssistant's App Vault boundary.
      if (config.apiKey) await vaultSet(vaultKey(provider), config.apiKey);
      if (config.refreshToken) await vaultSet(refreshVaultKey(provider), config.refreshToken);
      setState((s) => ({
        ...s,
        provider,
        providerConfigs: { ...s.providerConfigs, [provider]: config },
      }));
      const account = config.apiKey
        ? await fetchVendorAccount(provider, config.apiKey)
        : null;
      setState((s) => ({
        ...s,
        // First sign-in creates the local user; later connects only fill in
        // details we didn't have yet.
        user: s.user ?? {
          name: account?.label ?? getProvider(provider).name,
          provider,
          providerLabel: getProvider(provider).name,
          detail: account?.detail,
          createdAt: Date.now(),
        },
      }));
    },
    [],
  );

  const addCustomSkill = useCallback((skill: CustomSkill) => {
    let skillId = "";
    try {
      const parsed = parseSkillMd(skill.raw);
      skillId = parsed.name;
    } catch {
      /* fallback */
    }

    setState((s) => {
      const nextCustom = [
        ...s.customSkills.filter((c) => c.source !== skill.source),
        skill,
      ];
      if (!skillId) return { ...s, customSkills: nextCustom };

      const nextEngineSkills = Array.from(new Set([...s.installedEngineSkills, skillId]));
      const activeId = s.activeAgentId;
      let nextAgentCfgs = s.agentConfigs;

      if (activeId && s.agentConfigs[activeId]) {
        const cfg = s.agentConfigs[activeId];
        if (cfg.skills && !cfg.skills.includes(skillId)) {
          nextAgentCfgs = {
            ...s.agentConfigs,
            [activeId]: {
              ...cfg,
              skills: [...cfg.skills, skillId],
            },
          };
        }
      }

      return {
        ...s,
        customSkills: nextCustom,
        installedEngineSkills: nextEngineSkills,
        agentConfigs: nextAgentCfgs,
      };
    });
  }, []);

  const removeCustomSkill = useCallback((source: string) => {
    setState((s) => ({
      ...s,
      customSkills: s.customSkills.filter((c) => c.source !== source),
    }));
  }, []);

  const toggleEngineSkill = useCallback((skillId: string) => {
    setState((s) => ({
      ...s,
      installedEngineSkills: s.installedEngineSkills.includes(skillId)
        ? s.installedEngineSkills.filter((id) => id !== skillId)
        : [...s.installedEngineSkills, skillId],
    }));
  }, []);

  const setMcpServers = useCallback((servers: Record<string, McpServerConfig>) => {
    setState((s) => ({ ...s, mcpServers: servers }));
  }, []);

  const setTaskTags = useCallback((tags: string[]) => {
    setState((s) => ({ ...s, taskTags: Array.from(new Set(tags.map((tag) => tag.trim().toLowerCase()).filter(Boolean))).sort() }));
  }, []);

  const addScheduledTask = useCallback(
    (task: Omit<ScheduledTask, "id" | "createdAt">) => {
      const taskId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
      const createdAt = Date.now();

      // No seeded history. This used to inject two fabricated runs per task —
      // a "success" claiming a report had been sent to Telegram and a "401
      // Unauthorized" failure — neither of which ever happened. Real history is
      // written when the Host Process actually runs the task.

      setState((s) => ({
        ...s,
        scheduledTasks: [
          {
            ...task,
            id: taskId,
            createdAt,
            lastRun: Date.now(),
          },
          ...s.scheduledTasks,
        ],
        taskTags: Array.from(new Set([...(s.taskTags ?? []), ...(task.tags ?? [])])).sort(),
      }));
    },
    [],
  );

  useEffect(() => {
    const handleCreateSchedule = (e: Event) => {
      const detail = (e as CustomEvent).detail as { name: string; prompt: string; schedule: string };
      if (detail && detail.name && detail.prompt) {
        addScheduledTask({
          name: detail.name,
          prompt: detail.prompt,
          schedule: detail.schedule || "Hàng ngày",
          enabled: true,
        });
      }
    };
    window.addEventListener("vua:create-schedule", handleCreateSchedule);
    return () => window.removeEventListener("vua:create-schedule", handleCreateSchedule);
  }, [addScheduledTask]);

  useEffect(() => {
    // Pick up tasks the agent created for itself through the schedule_task tool.
    // Same file the effect above writes, in the runner's own data dir.
    const interval = setInterval(async () => {
      try {
        if (typeof window !== "undefined" && "__TAURI_INTERNALS__" in window) {
          const { invoke } = await import("@tauri-apps/api/core");
          const dir = await runtimeDir();
          if (!dir) return;
          const content = await invoke<string>("read_host_file", {
            path: `${dir}/scheduled_tasks.json`,
          }).catch(() => null);
          if (content) {
            const parsed = JSON.parse(content) as ScheduledTask[];
            // Read at least once — the app may now write the list back, even
            // when the user has emptied it.
            if (Array.isArray(parsed)) tasksLoadedRef.current = true;
            if (Array.isArray(parsed) && parsed.length > 0) {
              setState((s) => {
                const existingIds = new Set(s.scheduledTasks.map((t) => t.id));
                const newItems = parsed.filter((item) => !existingIds.has(item.id));
                if (newItems.length === 0) return s;
                const updated = [...newItems, ...s.scheduledTasks];
                try {
                  localStorage.setItem("vua_scheduled_tasks", JSON.stringify(updated));
                } catch {
                  /* ignore */
                }
                return {
                  ...s,
                  scheduledTasks: updated,
                };
              });
            }
          }
        }
      } catch {
        /* ignore */
      }
    }, 2000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    const handleCreateSkill = (e: Event) => {
      const detail = (e as CustomEvent).detail as { raw: string; source: string };
      if (detail && detail.raw) {
        addCustomSkill({ raw: detail.raw, source: detail.source || `created:${Date.now()}` });
      }
    };
    window.addEventListener("vua:create-skill", handleCreateSkill);
    return () => window.removeEventListener("vua:create-skill", handleCreateSkill);
  }, [addCustomSkill]);

  const updateScheduledTask = useCallback(
    (id: string, patch: Partial<ScheduledTask>) => {
      setState((s) => ({
        ...s,
        scheduledTasks: s.scheduledTasks.map((t) =>
          t.id === id ? { ...t, ...patch } : t,
        ),
        taskTags: Array.from(new Set([...(s.taskTags ?? []), ...(patch.tags ?? [])])).sort(),
      }));
    },
    [],
  );

  const removeScheduledTask = useCallback((id: string) => {
    setState((s) => ({
      ...s,
      scheduledTasks: s.scheduledTasks.filter((t) => t.id !== id),
      taskRunLogs: (s.taskRunLogs ?? []).filter((l) => l.taskId !== id),
    }));
  }, []);

  const addTaskRunLog = useCallback(
    (log: Omit<TaskRunLog, "id">) => {
      setState((s) => ({
        ...s,
        taskRunLogs: [
          {
            ...log,
            id: `log-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
          },
          ...(s.taskRunLogs ?? []),
        ],
      }));
    },
    [],
  );

  const clearTaskRunLogs = useCallback(
    (taskId?: string) => {
      setState((s) => ({
        ...s,
        taskRunLogs: taskId
          ? (s.taskRunLogs ?? []).filter((l) => l.taskId !== taskId)
          : [],
      }));
    },
    [],
  );

  const [activeBackgroundTasks, setActiveBackgroundTasks] = useState<ActiveBackgroundTask[]>([]);

  const startBackgroundTask = useCallback((name: string, command?: string) => {
    const id = `bg-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    setActiveBackgroundTasks((prev) => [...prev, { id, name, command, startedAt: Date.now() }]);
    return id;
  }, []);

  const stopBackgroundTask = useCallback((id: string) => {
    setActiveBackgroundTasks((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const toggleAgent = useCallback((agentId: string) => {
    setState((s) => ({
      ...s,
      installedAgents: s.installedAgents.includes(agentId)
        ? s.installedAgents.filter((id) => id !== agentId)
        : [...s.installedAgents, agentId],
      activeAgentId:
        s.activeAgentId === agentId && s.installedAgents.includes(agentId)
          ? null
          : s.activeAgentId,
    }));
  }, []);

  const setAgentConfig = useCallback((agentId: string, patch: AgentConfig) => {
    setState((s) => ({
      ...s,
      agentConfigs: {
        ...s.agentConfigs,
        [agentId]: { ...s.agentConfigs[agentId], ...patch },
      },
    }));
  }, []);

  const MEMORY_CAP = 50;
  const addAgentMemory = useCallback((agentId: string, notes: string[]) => {
    if (!notes.length) return;
    setState((s) => {
      const cfg = s.agentConfigs[agentId] ?? {};
      const memory = cfg.memory ?? [];
      const seen = new Set(memory.map((m) => m.trim().toLowerCase()));
      const fresh = notes
        .map((n) => n.trim())
        .filter((n) => n && !seen.has(n.toLowerCase()));
      if (!fresh.length) return s;
      return {
        ...s,
        agentConfigs: {
          ...s.agentConfigs,
          [agentId]: { ...cfg, memory: [...memory, ...fresh].slice(-MEMORY_CAP) },
        },
      };
    });
  }, []);

  const setSelfImprove = useCallback((on: boolean) => {
    setState((s) => ({ ...s, selfImprove: on }));
  }, []);

  const setCustomDataPath = useCallback((path: string) => {
    try {
      if (path) {
        localStorage.setItem("vua:custom-data-path", path);
      } else {
        localStorage.removeItem("vua:custom-data-path");
      }
    } catch {
      /* storage restricted */
    }
    setState((s) => ({ ...s, customDataPath: path }));
  }, []);

  const setLanguage = useCallback((lang: "vi" | "en") => {
    try {
      localStorage.setItem("vua:language", lang);
    } catch {
      /* ignore storage error */
    }
    document.documentElement.setAttribute("lang", lang);
    setState((s) => ({ ...s, language: lang }));
  }, []);

  const setTheme = useCallback((theme: Theme) => {
    try {
      localStorage.setItem("vua:theme", theme);
    } catch {
      /* ignore storage error */
    }
    setState((s) => ({ ...s, theme }));
  }, []);

  useEffect(() => {
    const currentTheme = state.theme || "system";

    const applyThemeToDOM = (resolvedTheme: "light" | "dark" | "gold" | "midnight") => {
      document.documentElement.classList.remove(
        "theme-system",
        "theme-light",
        "theme-dark",
        "theme-gold",
        "theme-midnight",
        "dark",
        "light"
      );
      if (resolvedTheme === "light") {
        document.documentElement.classList.add("light", "theme-light");
      } else {
        document.documentElement.classList.add("dark", `theme-${resolvedTheme}`);
      }
      document.documentElement.setAttribute("data-theme", resolvedTheme);
    };

    if (currentTheme === "system") {
      const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
      const handleSystemThemeChange = (e: MediaQueryListEvent | MediaQueryList) => {
        applyThemeToDOM(e.matches ? "dark" : "light");
      };
      handleSystemThemeChange(mediaQuery);
      mediaQuery.addEventListener("change", handleSystemThemeChange);
      return () => mediaQuery.removeEventListener("change", handleSystemThemeChange);
    } else {
      applyThemeToDOM(currentTheme);
    }
  }, [state.theme]);

  useEffect(() => {
    const currentLang = state.language || "vi";
    document.documentElement.setAttribute("lang", currentLang);
  }, [state.language]);

  const exportFullBackupData = useCallback((): string => {
    const backupObj = {
      version: "1.0.43",
      exportedAt: new Date().toISOString(),
      state: stateRef.current,
    };
    return JSON.stringify(backupObj, null, 2);
  }, []);

  const importFullBackupData = useCallback((jsonStr: string): boolean => {
    try {
      const parsed = JSON.parse(jsonStr);
      const incomingState = parsed.state || parsed;
      if (incomingState && typeof incomingState === "object") {
        setState((s) => ({
          ...s,
          ...incomingState,
        }));
        return true;
      }
      return false;
    } catch (e) {
      console.error("Failed to import backup data:", e);
      return false;
    }
  }, []);

  const setActiveAgent = useCallback((agentId: string | null) => {
    setState((s) => ({
      ...s,
      activeAgentId: agentId,
      chatSessions: s.chatSessions.map((session) =>
        session.id === s.activeSessionId
          ? { ...session, agentId, updatedAt: Date.now() }
          : session,
      ),
    }));
  }, []);

  // Nhập một agent từ persona markdown: lưu vào customAgents, gieo Soul +
  // Instructions vào cấu hình vai trò, đánh dấu đã cài và chọn làm vai trò hiện tại.
  const importAgent = useCallback((agent: ImportedAgent) => {
    setState((s) => {
      const customAgents = [
        ...s.customAgents.filter((a) => a.id !== agent.id),
        agent,
      ];
      const existing = s.agentConfigs[agent.id] ?? {};
      return {
        ...s,
        customAgents,
        agentConfigs: {
          ...s.agentConfigs,
          [agent.id]: {
            ...existing,
            soul: agent.soul || existing.soul,
            instructions: agent.instructions || existing.instructions,
          },
        },
        installedAgents: [...new Set([...s.installedAgents, agent.id])],
        activeAgentId: agent.id,
      };
    });
  }, []);

  const removeCustomAgent = useCallback((id: string) => {
    setState((s) => ({
      ...s,
      customAgents: s.customAgents.filter((a) => a.id !== id),
      installedAgents: s.installedAgents.filter((x) => x !== id),
      activeAgentId: s.activeAgentId === id ? null : s.activeAgentId,
    }));
  }, []);

  const toggleIntegration = useCallback((integrationId: string) => {
    setState((s) => ({
      ...s,
      connectedIntegrations: s.connectedIntegrations.includes(integrationId)
        ? s.connectedIntegrations.filter((id) => id !== integrationId)
        : [...s.connectedIntegrations, integrationId],
    }));
  }, []);

  const addKnowledgeFiles = useCallback(
    (files: File[]) => {
      const now = Date.now();
      // Capture the bucket at drop time so status updates land in the same
      // role even if the user switches roles while a file is still indexing.
      const agentId = stateRef.current.activeAgentId;
      const bucket = knowledgeBucket(agentId);
      const entries: KnowledgeFile[] = files.map((f, i) => {
        const id = `${now.toString(36)}-${i}-${Math.random().toString(36).slice(2, 6)}`;
        const ext = f.name.toLowerCase().split(".").pop() ?? "";
        const imgExtensions = ["png", "jpg", "jpeg", "gif", "webp", "svg", "bmp"];
        // Always save physical file into <DATA_DIR>/uploads/<filename> on disk!
        void savePhysicalDataFile(f.name, f, "uploads");

        if (imgExtensions.includes(ext)) {
          try {
            const url = URL.createObjectURL(f);
            fileObjectURLs.set(id, url);
          } catch (e) {
            console.error("Failed to create ObjectURL:", e);
          }
          const reader = new FileReader();
          reader.onload = () => {
            const b64 = reader.result as string;
            if (b64) fileObjectURLs.set(id, b64);
          };
          reader.readAsDataURL(f);
        }
        return {
          id,
          name: f.name,
          size: f.size,
          addedAt: now,
          status: "processing",
        };
      });
      setState((s) => ({
        ...s,
        knowledgeByAgent: {
          ...s.knowledgeByAgent,
          [bucket]: [...entries, ...(s.knowledgeByAgent[bucket] ?? [])],
        },
      }));
      const patchFile = (id: string, patch: Partial<KnowledgeFile>) =>
        setState((s) => ({
          ...s,
          knowledgeByAgent: {
            ...s.knowledgeByAgent,
            [bucket]: (s.knowledgeByAgent[bucket] ?? []).map((f) =>
              f.id === id ? { ...f, ...patch } : f,
            ),
          },
        }));
      // Real indexing: extract text → chunk → persist in the role's bucket.
      // The user never sees the pipeline — just "Processing" then "Ready".
      for (const [i, file] of files.entries()) {
        const entry = entries[i];
        void indexKnowledgeFile(agentId, entry.id, file)
          .then((chunks) => patchFile(entry.id, { status: "ready", chunks }))
          .catch((e) =>
            patchFile(entry.id, {
              status: "error",
              error: e instanceof Error ? e.message : String(e),
            }),
          );
      }
    },
    [],
  );

  const removeKnowledgeFile = useCallback((fileId: string) => {
    setState((s) => {
      const key = knowledgeBucket(s.activeAgentId);
      return {
        ...s,
        knowledgeByAgent: {
          ...s.knowledgeByAgent,
          [key]: (s.knowledgeByAgent[key] ?? []).filter((f) => f.id !== fileId),
        },
      };
    });
  }, []);

  const setMessages = useCallback(
    (update: ChatMessage[] | ((prev: ChatMessage[]) => ChatMessage[])) => {
      setState((s) => {
        const messages = typeof update === "function" ? update(s.messages) : update;
        const firstUser = messages.find((message) => message.role === "user")?.content.trim();
        return {
          ...s,
          messages,
          chatSessions: s.chatSessions.map((session) =>
            session.id === s.activeSessionId
              ? {
                  ...session,
                  messages,
                  title: session.title === "New chat" && firstUser
                    ? firstUser.slice(0, 48)
                    : session.title,
                  updatedAt: Date.now(),
                }
              : session,
          ),
        };
      });
    },
    [],
  );

  const clearChat = useCallback(() => {
    setState((s) => ({
      ...s,
      messages: [],
      chatSessions: s.chatSessions.map((session) =>
        session.id === s.activeSessionId
          ? { ...session, messages: [], updatedAt: Date.now() }
          : session,
      ),
    }));
  }, []);

  const createChatSession = useCallback(() => {
    setState((s) => {
      const session = newChatSession(s.activeAgentId);
      return {
        ...s,
        chatSessions: [session, ...s.chatSessions],
        activeSessionId: session.id,
        messages: [],
      };
    });
  }, []);

  const switchChatSession = useCallback((sessionId: string) => {
    setState((s) => {
      const session = s.chatSessions.find((item) => item.id === sessionId);
      if (!session) return s;
      return {
        ...s,
        activeSessionId: session.id,
        activeAgentId: session.agentId,
        messages: session.messages,
      };
    });
  }, []);

  const renameChatSession = useCallback((sessionId: string, title: string) => {
    const clean = title.trim().slice(0, 80);
    if (!clean) return;
    setState((s) => ({
      ...s,
      chatSessions: s.chatSessions.map((session) =>
        session.id === sessionId ? { ...session, title: clean, updatedAt: Date.now() } : session,
      ),
    }));
  }, []);

  const deleteChatSession = useCallback((sessionId: string) => {
    setState((s) => {
      const remaining = s.chatSessions.filter((session) => session.id !== sessionId);
      const sessions = remaining.length ? remaining : [newChatSession()];
      if (s.activeSessionId !== sessionId) return { ...s, chatSessions: sessions };
      const next = sessions[0];
      return {
        ...s,
        chatSessions: sessions,
        activeSessionId: next.id,
        activeAgentId: next.agentId,
        messages: next.messages,
      };
    });
  }, []);

  const resetApp = useCallback(() => {
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {
      /* run without persistence */
    }
    // Purge secrets from the Vault and every role's indexed documents too.
    for (const p of PROVIDERS) {
      void vaultDelete(vaultKey(p.id));
      void vaultDelete(refreshVaultKey(p.id));
    }
    void clearKnowledge();
    setState(initialState);
    setView("home");
  }, []);

  // Synchronize agent configs to the runner's instructions.md and soul.md
  useEffect(() => {
    if (!state.installedAgents.length) return;
    const agentsToSync = [...AGENT_STORE, ...state.customAgents]
      .filter((a) => state.installedAgents.includes(a.id))
      .map((a) => {
        const cfg = state.agentConfigs[a.id] ?? {};
        return {
          id: a.id,
          name: a.name,
          description: a.description,
          instructions: cfg.instructions,
          soul: cfg.soul,
        };
      });
    void syncAgents(agentsToSync);
  }, [state.installedAgents, state.agentConfigs]);

  // Everything the runner is actually configured with, as one primitive.
  //
  // Keying the restart on `providerConfigs` restarted it on *every* store
  // update, because that object gets a new identity each time — one dev session
  // respawned the runner 177 times. That is no longer merely wasteful: the
  // runner owns the scheduler and the Telegram channel, so each respawn tore
  // down the long-poll and re-fired the scheduler's start-up tick.
  const runnerAgentId = state.activeAgentId || "default";
  const runnerModel =
    (state.provider ? state.providerConfigs[state.provider]?.model : undefined) || "auto";
  const runnerMcpServers = JSON.stringify(state.mcpServers);
  const runnerSignature = `${runnerAgentId}|${runnerModel}|${state.selfImprove ? "1" : "0"}|${runnerMcpServers}`;

  useEffect(() => {
    let cancelled = false;
    const [agentId, model, selfImprove] = runnerSignature.split("|");

    (async () => {
      if (cancelled) return;
      console.log(`[store] Syncing & starting runner: agent=${agentId}, model=${model}`);
      // Self-improvement runs in the runner, which reads the flag from
      // runner.json — restarting is how a flipped switch reaches it.
      await restartAgentRunner(
        agentId,
        AI_ROUTER_BASE_URL,
        model,
        selfImprove === "1",
        state.mcpServers,
      );
    })();

    return () => {
      cancelled = true;
    };
  }, [runnerSignature]);

  const activeSessionTasks = useMemo(
    () => parseTasksFromMessages(state.messages),
    [state.messages],
  );

  const value = useMemo<AppStore>(
    () => ({
      ...state,
      activeSessionTasks,
      // The Knowledge page and Home badge show the active role's knowledge.
      knowledgeFiles:
        state.knowledgeByAgent[knowledgeBucket(state.activeAgentId)] ?? [],
      // Mọi agent cài được: dựng sẵn + đã nhập (đưa về dạng AgentTemplate).
      agents: [
        ...AGENT_STORE,
        ...state.customAgents.map(
          (a): AgentTemplate => ({
            id: a.id,
            name: a.name,
            emoji: a.emoji,
            category: "Đã nhập",
            description: a.description,
          }),
        ),
      ],
      view,
      setView,
      chatDraft,
      useSkill,
      consumeChatDraft,
      activeSkill,
      clearActiveSkill,
      oauthReturn,
      oauthError,
      completeOnboarding,
      updateLocalUser,
      ensureLocalUser,
      clearLocalUser,
      setProvider,
      setProviderConfig,
      connectProvider,
      importAgent,
      removeCustomAgent,
      addCustomSkill,
      removeCustomSkill,
      toggleEngineSkill,
      setMcpServers,
      setTaskTags,
      taskRunLogs: state.taskRunLogs ?? [],
      addTaskRunLog,
      clearTaskRunLogs,
      addScheduledTask,
      updateScheduledTask,
      removeScheduledTask,
      toggleAgent,
      setAgentConfig,
      addAgentMemory,
      setSelfImprove,
      setCustomDataPath,
      language: state.language || "vi",
      setLanguage,
      theme: state.theme || "dark",
      setTheme,
      exportFullBackupData,
      importFullBackupData,
      activeBackgroundTasks,
      startBackgroundTask,
      stopBackgroundTask,
      appUpdate,
      checkForAppUpdate,
      setActiveAgent,
      toggleIntegration,
      addKnowledgeFiles,
      removeKnowledgeFile,
      setMessages,
      clearChat,
      createChatSession,
      switchChatSession,
      renameChatSession,
      deleteChatSession,
      resetApp,
    }),
    [
      state,
      view,
      chatDraft,
      useSkill,
      consumeChatDraft,
      activeSkill,
      clearActiveSkill,
      oauthReturn,
      oauthError,
      completeOnboarding,
      updateLocalUser,
      ensureLocalUser,
      clearLocalUser,
      setProvider,
      setProviderConfig,
      connectProvider,
      importAgent,
      removeCustomAgent,
      activeSessionTasks,
      addCustomSkill,
      removeCustomSkill,
      toggleEngineSkill,
      setMcpServers,
      setTaskTags,
      addTaskRunLog,
      clearTaskRunLogs,
      addScheduledTask,
      updateScheduledTask,
      removeScheduledTask,
      toggleAgent,
      setAgentConfig,
      addAgentMemory,
      setSelfImprove,
      setCustomDataPath,
      setActiveAgent,
      toggleIntegration,
      addKnowledgeFiles,
      removeKnowledgeFile,
      setMessages,
      clearChat,
      createChatSession,
      switchChatSession,
      renameChatSession,
      deleteChatSession,
      resetApp,
    ],
  );

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

export function useApp(): AppStore {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error("useApp must be used inside <AppProvider>");
  return ctx;
}
