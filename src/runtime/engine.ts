/**
 * AI Runtime Service — the only place the UI talks to when it needs a model.
 *
 *   V Assistant Desktop  →  AI Runtime (this module)  →  Engine
 *
 * The engine behind this interface is an implementation detail and is never
 * surfaced in the UI. Today it ships with a local demo engine so the app is
 * fully navigable offline; wiring a real provider only means replacing
 * `createEngine` — no UI changes.
 */

import { getProvider, type ProviderId } from "@/lib/catalog";
import {
  isConfigured,
  isRateLimitError,
  streamProvider,
  streamProviderWithFallback,
  type ProviderConfig,
  type ProviderConfigs,
} from "./providers";
import { buildAgentTools } from "./tools";
import { retrieveKnowledge, type KnowledgeExcerpt } from "./knowledge";
import { DEMO_MODE } from "./oauth";
import { vaultGet } from "./vault";

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  createdAt: number;
  attachments?: { id: string; name: string; dataUrl?: string }[];
}

export interface ChatOptions {
  provider: ProviderId;
  /** Credentials for the provider; real calls happen when present. */
  config?: ProviderConfig;
  /** Other connected providers eligible for rate-limit failover. */
  providerConfigs?: ProviderConfigs;
  agentName?: string;
  agentDescription?: string;
  /** The agent's configured workflow/process instructions. */
  agentInstructions?: string;
  /** The agent's personality/voice ("soul"). */
  agentSoul?: string;
  /** The agent's persistent memory notes. */
  agentMemory?: string[];
  /** Knowledge available to THIS role only (names of ready documents). */
  agentKnowledge?: string[];
  /** Excerpts retrieved from this role's documents for the current question. */
  knowledgeExcerpts?: KnowledgeExcerpt[];
  /** Installed-agent id; maps to a NanoClaw group on the engine side. */
  agentId?: string;
  /** Active UI chat session; scopes runner history independently per chat. */
  sessionId?: string;
  /** Active skill's name — shown to the model as the task it's running. */
  skillName?: string;
  /** Active skill's full SKILL.md instructions, injected as guidance. */
  skillInstructions?: string;
  /** True when the user has an active global subscription (OpenRouter key in Vault) */
  hasSubscription?: boolean;
}

export interface Engine {
  /** Streams the assistant reply as text chunks. */
  chat(messages: ChatMessage[], options: ChatOptions): AsyncGenerator<string>;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Demo engine: streams a canned, context-aware reply so the full product
 * experience (streaming, typing indicator, provider switching) works before
 * any account is wired up.
 */
const demoEngine: Engine = {
  async *chat(messages, { provider, agentName }) {
    const lastUser = [...messages].reverse().find((m) => m.role === "user");
    const providerName = getProvider(provider).name;
    const persona = agentName ? ` as your ${agentName}` : "";
    const reply =
      `You said: “${lastUser?.content ?? ""}”.\n\n` +
      `I'm V Assistant, running${persona} on ${providerName}. ` +
      `This is a preview response — once your ${providerName} account is ` +
      `connected, real answers will stream here. Everything else already ` +
      `works: switch providers in one click, install agents from the store, ` +
      `and drop files into Knowledge to teach me about your work.`;

    // Stream word by word to exercise the same code path a real
    // network-streamed response will use.
    for (const word of reply.split(/(?<=\s)/)) {
      await sleep(24);
      yield word;
    }
  },
};

/** The persona sent to real providers as the system prompt. */
export function buildSystemPrompt(options: ChatOptions): string {
  let prompt =
    "You are V Assistant, a highly autonomous personal AI assistant for everyday work. " +
    "Be concise, concrete, and act with a clear engineering mindset. Always answer in the user's language.\n\n" +
    "=== CORE BEHAVIOR & PROCESS AUTONOMY ===\n" +
    "1. PLANNING: When given a complex request (anything requiring more than 2 steps or multiple tool calls), you MUST formulate a brief, structured Plan in Markdown (with checkable boxes) in your initial response. Explain the task breakdown, specify clear completion criteria (Done criteria), and keep track of these steps. Update your progress as you complete them so the user always knows what has been completed, what is in progress, and what remains.\n" +
    "2. SELF-CORRECTION & ERROR HANDLING: When a tool execution fails (e.g., returns is_error: true, 'Permission denied', 'Command failed', 'File not found', or network errors), you MUST NOT give up or stop immediately. Analyze the error root cause. Attempt self-correction: if a file path is wrong, glob the directory to locate the correct file; if a command failed, refine the syntax or arguments; if a connection fails, explain and suggest a path forward. Do not yield a final failure unless all recovery attempts have been exhausted.\n" +
    "3. TASK COMPLETION & EVALUATION: Always evaluate whether the user's ultimate goal has been fully met before completing the conversation. If a sub-task is done, proceed to the next step automatically. Do not wait for manual input for obvious follow-ups unless clarification is absolutely necessary.\n\n" +
    "=== TOOLS & VAULT INTEGRATION ===\n" +
    "You can act on the user's behalf using tools. The user keeps logins, " +
    "API keys and endpoints in their Vault. When a task needs a credential " +
    "(e.g. \"post this to my blog\"), call vault_list to see what is stored, " +
    "then use connector_request with its opaque ref and " +
    "{{credential:<field>}} variables. The trusted gateway resolves those " +
    "values outside your context. Do not ask " +
    "the user for a password that is already in the Vault.\n\n" +
    "When the user provides a working directory or file path (e.g. \"Thư mục/File làm việc: 📁 /path/to/folder\" or relative/absolute file paths), immediately call glob with that exact path to inspect it. If access is denied, respond with exactly `PERMISSION_REQUEST: <the exact absolute directory path>` and nothing else; never ask the user to copy it into a workspace. Do NOT output generic responses when a file or directory path is given.\n\n" +
    "When the user asks to schedule a job, recurring task, reminder, or automated posting (e.g. \"đặt lịch đăng bài\", \"lập lịch\", \"tạo schedule\"), you MUST call the create_schedule tool with { name, prompt, schedule } to officially register and display the scheduled task on the Scheduled page.\n\n" +
    "When the user asks to create, write, or design a new skill or custom skill (e.g. \"tạo skill\", \"tạo kỹ năng\", \"viết skill mới\"), you MUST call the create_skill tool with { name, description, title, emoji, category, prompt, instructions } to automatically package, save, and display the new Skill directly in the user's Skills menu and application storage.";
  if (options.agentName) {
    prompt +=
      `\n\nYou are currently acting as the user's ${options.agentName}. ` +
      `${options.agentDescription ?? ""}`;
    if (options.agentSoul) {
      prompt += `\n\nYour personality:\n${options.agentSoul}`;
    }
    if (options.agentInstructions) {
      prompt += `\n\nHow you work (follow this process):\n${options.agentInstructions}`;
    }
    const memory = (options.agentMemory ?? []).filter((m) => m.trim());
    if (memory.length) {
      prompt +=
        `\n\nWhat you remember about the user (use it when relevant):\n` +
        memory.map((m) => `- ${m}`).join("\n");
    }
  }
  // Knowledge is scoped to this role only — the caller passes just the active
  // role's documents, so one role never sees another's knowledge.
  const knowledge = (options.agentKnowledge ?? []).filter((k) => k.trim());
  if (knowledge.length) {
    prompt +=
      `\n\nKnowledge available to you in this role (do not rely on knowledge ` +
      `from other roles):\n` +
      knowledge.map((k) => `- ${k}`).join("\n");
  }
  // Retrieved excerpts ground the answer in the role's actual documents.
  const excerpts = options.knowledgeExcerpts ?? [];
  if (excerpts.length) {
    prompt +=
      `\n\nRelevant excerpts from this role's documents — ground your answer ` +
      `on them and cite the document name when you use one:\n\n` +
      excerpts.map((e) => `[${e.name}]\n${e.text}`).join("\n\n");
  }
  // The active skill's full instructions steer how the model does the task.
  if (options.skillInstructions) {
    prompt +=
      `\n\nYou are performing the "${options.skillName ?? "task"}" skill. ` +
      `Follow these instructions exactly:\n\n${options.skillInstructions}`;
  }
  return prompt;
}

/** Streams from the selected provider's real API. */
async function* streamFromProviders(
  messages: ChatMessage[],
  options: ChatOptions,
  skipPrimary = false,
): AsyncGenerator<string> {
  if (options.config?.router) {
    yield* streamProvider(
      options.provider,
      options.config,
      buildSystemPrompt(options),
      messages,
      buildAgentTools(),
    );
    return;
  }
  yield* streamProviderWithFallback(
    options.provider,
    { ...options.providerConfigs, [options.provider]: options.config ?? {} },
    buildSystemPrompt(options),
    messages,
    buildAgentTools(),
    { skipPrimary },
  );
}

const providerEngine: Engine = {
  async *chat(messages, options) {
    yield* streamFromProviders(messages, options);
  },
};

/**
 * Engine selection, decided per message:
 *  1. Desktop shell with a NanoClaw engine attached → the agent runtime.
 *  2. Provider configured (API key / local server) → real provider API.
 *  3. Otherwise → the built-in preview engine, so the app is always usable.
 */
export function createEngine(): Engine {
  return {
    async *chat(messages, options) {
      // Demo build has no real backend and a strict CSP: always preview.
      if (DEMO_MODE) {
        yield* demoEngine.chat(messages, options);
        return;
      }
      // RAG: pull the excerpts from this role's documents that best match
      // the user's question, so the reply is grounded in their files.
      const lastUser = [...messages].reverse().find((m) => m.role === "user");
      if (lastUser) {
        const knowledgeExcerpts = await retrieveKnowledge(
          options.agentId ?? null,
          lastUser.content,
        ).catch(() => []);
        if (knowledgeExcerpts.length) options = { ...options, knowledgeExcerpts };
      }

      // Secrets deliberately never persist in localStorage. The initial Vault
      // rehydrate is asynchronous, so resolve the active credential here too:
      // a message sent immediately after launch must never fall back to preview.
      if (options.provider !== "local" && !options.config?.apiKey && !options.config?.router) {
        const key = await vaultGet(`provider:${options.provider}`).catch(() => null);
        if (key) {
          const config = { ...options.config, apiKey: key };
          options = {
            ...options,
            config,
            providerConfigs: { ...options.providerConfigs, [options.provider]: config },
          };
        }
      }
      const { engineRunning, nanoclawEngine } = await import("./nanoclaw");
      if (await engineRunning()) {
        let runnerEmitted = false;
        try {
          for await (const chunk of nanoclawEngine.chat(messages, options)) {
            runnerEmitted = true;
            yield chunk;
          }
          return;
        } catch (error) {
          // The Runner is an execution layer, not the only path to a model.
          // If it fails before yielding anything (for example it is restarting
          // after a sidecar crash), send the turn through AI Router directly.
          // Once it has emitted text we must preserve that partial response and
          // surface the error instead of risking a duplicate provider request.
          if (
            runnerEmitted ||
            !isConfigured(options.provider, options.config, options.hasSubscription)
          ) {
            throw error;
          }
          yield* streamFromProviders(messages, options, isRateLimitError(error));
          return;
        }
      }
      if (isConfigured(options.provider, options.config, options.hasSubscription)) {
        yield* providerEngine.chat(messages, options);
        return;
      }
      throw new Error(`${getProvider(options.provider).name} is not connected. Connect it before sending a message.`);
    },
  };
}

export function newMessageId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Run one assistant turn to completion and return the full text — the same
 * engine, tools and system prompt as the chat UI, but for callers that need
 * a whole reply rather than a stream (e.g. the Telegram channel).
 */
export async function runAssistant(
  messages: ChatMessage[],
  options: ChatOptions,
): Promise<string> {
  const engine = createEngine();
  let out = "";
  for await (const chunk of engine.chat(messages, options)) out += chunk;
  return out;
}
