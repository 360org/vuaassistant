/**
 * NanoClaw engine adapter — the desktop app acts as a NanoClaw channel.
 *
 * Messages go to the Rust runtime via Tauri commands, which queues them on
 * the engine's inbound SQLite database; replies come back on the outbound
 * queue, produced by the per-agent containers (Claude Agent SDK). This
 * module never renders anything: the UI only sees the `Engine` interface.
 */

import { invoke } from "@tauri-apps/api/core";
import type { Engine, ChatMessage } from "./engine";
import type { ProviderId } from "@/lib/catalog";

export interface OutboundMessage {
  id: number;
  group_id: string;
  content: string;
  created_at: number;
  type: "permission_request" | null;
  permission: { tool: string; path: string; access: "read" } | null;
  /** `chat`, `telegram`, `scheduled` — which channel produced the row. */
  channel_type: string | null;
  thread_id: string | null;
  /** `user` or `assistant` for channels that mirror both sides of a turn. */
  role: string | null;
  /** `success` or `error` for a scheduled run. */
  status: string | null;
  duration_ms: number | null;
}

const POLL_INTERVAL_MS = 500;
const REPLY_TIMEOUT_MS = 120_000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** True when running inside the Tauri shell (not the web preview). */
export function inDesktopShell(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

/** True when a NanoClaw engine is attached behind the runtime. */
export async function engineRunning(): Promise<boolean> {
  if (!inDesktopShell()) return false;
  try {
    const status = await invoke<{ engine_running: boolean }>("runtime_status");
    return status.engine_running;
  } catch {
    return false;
  }
}

/** Get detailed desktop runtime status from Rust. */
export async function getRuntimeStatus(): Promise<{ engine_running: boolean; ai_router_running: boolean; version: string; dir: string } | null> {
  if (!inDesktopShell()) return null;
  try {
    return await invoke<{ engine_running: boolean; ai_router_running: boolean; version: string; dir: string }>("runtime_status");
  } catch {
    return null;
  }
}

/**
 * The runtime directory the Host Process actually uses (`VUA_DATA_DIR`). Files
 * shared with the runner — the scheduled-task list above all — must be written
 * here; guessing `~/vuaassistant` puts them where nothing reads them.
 */
export async function runtimeDir(): Promise<string | null> {
  if (!inDesktopShell()) return null;
  try {
    const status = await invoke<{ dir: string }>("runtime_status");
    return status.dir || null;
  } catch {
    return null;
  }
}

export const nanoclawEngine: Engine = {
  async *chat(
    messages: ChatMessage[],
    options: { provider: ProviderId; agentName?: string; agentId?: string; sessionId?: string },
  ) {
    const lastUser = [...messages].reverse().find((m) => m.role === "user");
    if (!lastUser) return;
    // Each installed agent maps to a NanoClaw group; plain chat is "main".
    const groupId = options.agentId ?? "main";

    let fullContent = lastUser.content || "";
    if (lastUser.attachments && lastUser.attachments.length > 0) {
      const attLines = lastUser.attachments.map((att) => `[Tệp đính kèm: ${att.name}]`);
      fullContent = `${fullContent}\n\n${attLines.join("\n")}`.trim();
    }

    const lastSeen = await latestOutboundId(groupId);
    await invoke<number>("runtime_send", {
      groupId,
      content: fullContent,
      meta: JSON.stringify({
        provider: options.provider,
        agent: options.agentName ?? null,
        platformId: "desktop",
        channelType: "chat",
        threadId: options.sessionId ?? groupId,
      }),
    });

    const deadline = Date.now() + REPLY_TIMEOUT_MS;
    let after = lastSeen;
    while (Date.now() < deadline) {
      await sleep(POLL_INTERVAL_MS);
      const replies = await invoke<OutboundMessage[]>("runtime_receive", {
        groupId,
        afterId: after,
      });
      // The Host Process shares one outbound queue across every channel, so a
      // Telegram reply or a scheduled result can land mid-turn. Only rows this
      // window produced may be shown as its answer.
      let answered = false;
      for (const reply of replies) {
        after = reply.id;
        if (reply.channel_type !== "chat") continue;
        answered = true;
        yield reply.type === "permission_request" && reply.permission
          ? `[[VUA_PERMISSION:${JSON.stringify(reply.permission)}]]`
          : reply.content;
      }
      if (answered) return;
    }
    throw new Error("The assistant did not reply in time. Please try again.");
  },
};

async function latestOutboundId(groupId: string): Promise<number> {
  const backlog = await invoke<OutboundMessage[]>("runtime_receive", {
    groupId,
    afterId: 0,
  });
  return backlog.length ? backlog[backlog.length - 1].id : 0;
}

/**
 * Every outbound row newer than `afterId`. The app polls this so a Telegram
 * conversation or a scheduled result that happened while the window was closed
 * still shows up; the caller picks the channels it cares about and advances its
 * watermark past the rest.
 */
export async function receiveOutbound(afterId: number): Promise<OutboundMessage[]> {
  if (!inDesktopShell()) return [];
  return invoke<OutboundMessage[]>("runtime_receive", { groupId: "main", afterId });
}

/** Highest outbound seq right now, used to start polling without replaying. */
export async function latestOutboundSeq(): Promise<number> {
  if (!inDesktopShell()) return 0;
  return latestOutboundId("main");
}

/** Push installed agents to the runtime so the engine has their groups. */
export async function syncAgents(
  agents: { id: string; name: string; description: string; instructions?: string; soul?: string }[],
): Promise<void> {
  if (!inDesktopShell()) return;
  try {
    await invoke("runtime_sync", { agents });
  } catch (err) {
    console.error("Failed to sync agents:", err);
  }
}

/** Restart the agent runner process with new configurations. */
export async function restartAgentRunner(
  agentName: string,
  baseUrl?: string | null,
  model?: string | null,
  selfImprove?: boolean,
  mcpServers: Record<string, { command: string; args: string[] }> = {},
): Promise<boolean> {
  if (!inDesktopShell()) return false;
  try {
    return await invoke<boolean>("runtime_restart_runner", {
      agentName,
      baseUrl: baseUrl || null,
      model: model || null,
      selfImprove: selfImprove ?? true,
      mcpServers,
    });
  } catch (err) {
    console.error("Failed to restart agent runner:", err);
    return false;
  }
}
