// Guards the Host Process boundary (idea.md §1.3): the brain runs in the Agent
// Runner, the webview only displays. These are the rules that are invisible at
// compile time and were each broken at least once in practice.

import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const read = (...parts) => fs.readFileSync(path.join(root, ...parts), "utf8");
const exists = (...parts) => fs.existsSync(path.join(root, ...parts));

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

// --- the webview must not run a second brain --------------------------------
// Two copies of a loop is worse than none: the scheduler fired every task twice.
for (const gone of ["telegram.ts", "scheduler.ts", "schedule.ts", "selfImprove.ts"]) {
  assert(
    !exists("src", "runtime", gone),
    `src/runtime/${gone} is back — that subsystem belongs to the Agent Runner alone`,
  );
}

const store = read("src", "lib", "store.tsx");

// The runner holds the scheduler and the Telegram long-poll, so every restart
// tears both down. Keying the effect on an object identity respawned it 177
// times in one session.
assert(
  !/}, \[[^\]]*state\.providerConfigs[^\]]*\]\);/.test(store)
    || !/restartAgentRunner\(/.test(store),
  "The runner restart must not depend on providerConfigs — use a primitive signature",
);
assert(
  store.includes("runnerSignature"),
  "The runner restart must be keyed on a stable signature",
);

// A cold start must not overwrite the agent's own scheduled tasks with [].
assert(
  store.includes("tasksLoadedRef"),
  "scheduled_tasks.json must only be written after it has been read once",
);
assert(
  store.includes("runtimeDir()"),
  "Files shared with the runner must go to the runtime dir, not ~/vuaassistant",
);

// --- one outbound queue, three channels -------------------------------------
// Untagged rows let a Telegram reply surface as the chat window's answer.
assert(
  read("agent-runner", "src", "scheduler", "index.ts").includes("const CHANNEL = 'scheduled'"),
  "Scheduled results must be tagged as their own channel",
);
assert(
  read("agent-runner", "src", "channels", "telegram.ts").includes("channelType: 'telegram'"),
  "Telegram turns must be tagged as their own channel",
);
assert(
  read("src", "runtime", "nanoclaw.ts").includes('reply.channel_type !== "chat"'),
  "The chat window must ignore outbound rows from other channels",
);

// --- knowledge is readable by the runner ------------------------------------
const knowledge = read("src", "runtime", "knowledge.ts");
assert(
  !knowledge.includes("indexedDB"),
  "Knowledge chunks must live in knowledge.db — the runner cannot read IndexedDB",
);
assert(
  knowledge.includes("knowledge_put") && knowledge.includes("knowledge_list"),
  "The app must write knowledge through the runtime store",
);
assert(
  read("agent-runner", "src", "poll-loop.ts").includes("retrieveKnowledge(config.agentId"),
  "The runner must ground its answers in the role's documents",
);

// --- exactly one runner ------------------------------------------------------
const runtimeRs = read("src-tauri", "src", "runtime.rs");
assert(
  runtimeRs.includes("kill_stale_runner(dir)") && runtimeRs.includes('dir.join("runner.pid")'),
  "An orphaned runner must be stopped before a new one is spawned",
);
assert(
  runtimeRs.includes('.contains("agent-runner")'),
  "A recorded pid must be verified before it is killed — pids get reused",
);

// --- the model gets no shell, and no file access outside its workspace -------
// idea.md §22 and §92. The runner never offered a shell; the webview agent path
// did, and its file tools took any absolute path.
const tools = read("src", "runtime", "tools.ts");
assert(
  !/name:\s*"execute_cli"/.test(tools),
  "The model must not be given a host shell (idea.md §22, §92)",
);
assert(
  !read("src-tauri", "src", "lib.rs").includes("fn execute_cli_command"),
  "The shell command must not exist at all, not merely go uncalled",
);
for (const [tool, command] of [
  ["file_read", "agent_read_file"],
  ["file_write", "agent_write_file"],
  ["file_list", "agent_list_dir"],
]) {
  assert(
    tools.includes(`"${command}"`),
    `${tool} must go through the workspace-scoped ${command}, not an unrestricted host command`,
  );
}
assert(
  !/invoke<[^>]*>\("(read|write)_host_file"|invoke<[^>]*>\("list_host_dir"/.test(tools),
  "Agent file tools must not call the app's unrestricted host file commands",
);

// --- nothing fabricated is shown to the user --------------------------------
// Every scheduled task used to be seeded with two invented runs, one of them a
// 401 failure that never happened; `execute_mcp_tool` reported success without
// doing anything.
assert(!store.includes("mockLogs"), "Run history must never be seeded with invented runs");
assert(
  !/name:\s*"execute_mcp_tool"/.test(tools),
  "A tool must not report success for work it did not do",
);
assert(
  read("agent-runner", "src", "scheduler", "index.ts").includes("durationMs"),
  "A scheduled run must report how long it took",
);
assert(
  store.includes("taskRunLogs: [runLog"),
  "Run history must be written from real runs reported by the Host Process",
);

// --- the agent can reach its own memory --------------------------------------
assert(
  read("agent-runner", "src", "native-tools", "index.ts").includes("ALLOWED_ROOTS"),
  "The sandbox must grant the agent its own directory as well as the workspace",
);

console.log(
  "host process contract passed: single brain, tagged channels, shared knowledge, one runner",
);
