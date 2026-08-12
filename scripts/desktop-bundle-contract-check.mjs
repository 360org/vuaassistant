import { readFile } from "node:fs/promises";

const [tauriConfig, runtime, workflow, runner, runnerPackage] = await Promise.all([
  readFile("src-tauri/tauri.conf.json", "utf8"),
  readFile("src-tauri/src/runtime.rs", "utf8"),
  readFile(".github/workflows/release.yml", "utf8"),
  readFile("agent-runner/src/db/sqlite.ts", "utf8"),
  readFile("agent-runner/package.json", "utf8"),
]);

const assertions = [
  [
    tauriConfig.includes('"../runtime/node/**/*"'),
    "Tauri must include the bundled Node runtime resource",
  ],
  [
    runtime.includes("pub fn resolve_project_dir")
      && runtime.includes('join("_up_")')
      && runtime.includes("current_exe()"),
    "desktop runtime must resolve Tauri's packaged resource layouts",
  ],
  [
    runtime.includes("fn router_healthcheck")
      && runtime.includes("fn wait_router_ready")
      && runtime.includes("AI Router did not become ready"),
    "AI Router startup must wait for HTTP readiness and report diagnostics",
  ],
  [
    runtime.includes("ai-router")
      && runtime.includes("sidecar.mjs")
      && runtime.includes("refusing to kill it"),
    "runtime must not kill unrelated processes that own the router port",
  ],
  [
    runtime.includes('"runtime/node/node.exe"')
      && runtime.includes('"runtime/node/node"'),
    "AI Router must prefer its bundled Node runtime on Windows and Unix",
  ],
  [
    runtime.includes('36360')
      && !runtime.includes('20128'),
    "desktop runtime must use port 36360 for AI Router and connectors",
  ],
  [
    runtime.includes('join("agent-runner/dist/index.js")')
      && runtime.includes("Bundled Agent Runner dist/index.js is missing"),
    "Desktop runtime must launch the compiled bundled Agent Runner",
  ],
  [
    workflow.includes("Bundle Node runtime for AI Router"),
    "macOS release workflow must bundle Node",
  ],
  [
    workflow.includes("Install AI Router runtime dependencies")
      && workflow.includes("npm ci --prefix ai-router"),
    "macOS release workflow must install AI Router dependencies from its lockfile",
  ],
  [
    workflow.includes("Build bundled Agent Runner runtime")
      && workflow.includes("npm ci --prefix agent-runner"),
    "macOS release workflow must compile and bundle the Agent Runner",
  ],
  [
    workflow.includes("Verify packaged AI Router runtime")
      && workflow.includes("ai-router/node_modules/undici/package.json")
      && workflow.includes('! grep -rqE "from [\\"\']better-sqlite3|require\\([\\"\']better-sqlite3" "$app_path/Contents/Resources/_up_/agent-runner/dist"'),
    "macOS release workflow must inspect bundled Router dependencies and keep the Runner native-addon free",
  ],
  [
    workflow.includes("agent-runner/dist/index.js")
      && workflow.includes('! grep -rqE "from [\\"\']better-sqlite3|require\\([\\"\']better-sqlite3" agent-runner/dist'),
    "macOS release workflow must verify the packaged Agent Runner runtime",
  ],
  [
    workflow.includes('vuaassistant.exe')
      && workflow.includes('sidecar.mjs')
      && workflow.includes('node.exe')
      && workflow.includes('packaged AI Router, Agent Runner, or node.exe resource is missing'),
    "Windows smoke test must verify packaged runtime resources after installation",
  ],
  [
    // One build, three platforms: the runner may not regain a native addon,
    // otherwise every target needs its own compiled binary again. Prose in
    // comments is fine — what matters is the import and the dependency list.
    runner.includes("from 'node:sqlite'") && !JSON.stringify({
      ...JSON.parse(runnerPackage).dependencies,
      ...JSON.parse(runnerPackage).devDependencies,
    }).includes("better-sqlite3"),
    "Agent Runner must stay free of native addons (use node:sqlite)",
  ],
];

for (const [condition, message] of assertions) {
  if (!condition) throw new Error(message);
}

console.log("desktop bundle contract passed: resource layout, Node runtime, CI artifact check");
