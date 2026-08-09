//! AI Runtime Service — the desktop side of the V-Assistant Agent Runner.
//!
//! Handles SQLite IPC layer (inbound.db/outbound.db) matching the new schema:
//!   inbound.db  — UI writes to messages_in; host uses even sequence numbers
//!   outbound.db — Runner writes to messages_out; UI polls this DB
//!
//! Spawns the Universal Agent Runner process, automatically writing runner.json
//! before startup to pass settings.

use crate::vault::VaultBroker;
use rusqlite::Connection;
use serde::{Deserialize, Serialize};
use std::io::{Read, Write};
use std::net::TcpStream;
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::time::{Duration, Instant};
use std::sync::{Arc, Mutex};
use tauri::Manager;

/// App-facing engine state, managed by Tauri.
pub struct Runtime {
    pub dir: PathBuf,
    workspace: Arc<Mutex<PathBuf>>,
    engine: Arc<Mutex<Option<Child>>>,
    ai_router: Arc<Mutex<Option<Child>>>,
    connector_token: String,
    /// Kept so the AI Router can be respawned on demand (Settings → "Thử lại"),
    /// not just at boot.
    project_dir: PathBuf,
    broker: VaultBroker,
}

#[derive(Serialize)]
pub struct RuntimeStatus {
    pub version: &'static str,
    /// True when a V-Assistant Agent Runner process is attached and alive.
    pub engine_running: bool,
    /// True when the native AI Router sidecar is attached and alive.
    pub ai_router_running: bool,
    /// Where the runtime exchanges messages with the engine.
    pub dir: String,
}

#[derive(Serialize, Deserialize, Clone, Default)]
pub struct McpServerConfig {
    pub command: String,
    pub args: Vec<String>,
    #[serde(default)]
    pub env: std::collections::HashMap<String, String>,
}

#[derive(Serialize, Deserialize, Clone)]
pub struct OutboundMessage {
    pub id: i64,
    pub group_id: String,
    pub content: String,
    pub created_at: i64,
    #[serde(rename = "type")]
    pub message_type: Option<String>,
    pub permission: Option<serde_json::Value>,
    /// Which channel produced the row — `chat`, `telegram`, … Callers filter on
    /// it so a Telegram reply is never handed to the chat window as its answer.
    pub channel_type: Option<String>,
    pub thread_id: Option<String>,
    /// `user` or `assistant` for channels that mirror both sides of a turn.
    pub role: Option<String>,
    /// `success` or `error` for a scheduled run, so the UI shows what happened
    /// instead of the seeded history it used to invent.
    pub status: Option<String>,
    pub duration_ms: Option<i64>,
}

/// One agent definition.
#[derive(Deserialize)]
pub struct AgentConfig {
    pub id: String,
    pub name: String,
    pub description: String,
    pub instructions: Option<String>,
    pub soul: Option<String>,
}

fn is_host_shell(command: &str) -> bool {
    Path::new(command)
        .file_name()
        .and_then(|name| name.to_str())
        .map(|name| matches!(name.to_ascii_lowercase().as_str(), "sh" | "bash" | "zsh" | "fish" | "cmd" | "cmd.exe" | "powershell" | "powershell.exe" | "pwsh" | "pwsh.exe"))
        .unwrap_or(false)
}

fn saved_workspace(dir: &Path) -> PathBuf {
    std::fs::read_to_string(dir.join("workspace-path.json"))
        .ok()
        .and_then(|text| serde_json::from_str::<serde_json::Value>(&text).ok())
        .and_then(|config| config.get("workspace")?.as_str().map(PathBuf::from))
        .filter(|workspace| workspace.is_absolute())
        .unwrap_or_else(|| dir.join("workspace"))
}

fn find_executable(name: &str) -> Option<PathBuf> {
    // Check system PATH env
    if let Ok(path_var) = std::env::var("PATH") {
        for path in std::env::split_paths(&path_var) {
            let p = path.join(name);
            if p.exists() {
                return Some(p);
            }
        }
    }
    
    // Check common installation paths
    let common_paths = [
        "/opt/homebrew/bin",
        "/usr/local/bin",
        "/usr/bin",
        "/bin",
    ];
    
    for path in &common_paths {
        let p = Path::new(path).join(name);
        if p.exists() {
            return Some(p);
        }
    }
    
    // Check NVM/Node paths
    if let Ok(home) = std::env::var("HOME") {
        let nvm_path = Path::new(&home).join(".nvm/versions/node");
        if nvm_path.exists() {
            if let Ok(entries) = std::fs::read_dir(nvm_path) {
                for entry in entries.flatten() {
                    let bin_path = entry.path().join("bin").join(name);
                    if bin_path.exists() {
                        return Some(bin_path);
                    }
                }
            }
        }
    }
    
    None
}

/// Tauri preserves `../` resource globs beneath `_up_` in packaged apps.
/// Development uses the checkout directly; release builds resolve that bundled
/// project root before spawning JavaScript sidecars.
pub fn resolve_project_dir(resource_dir: PathBuf) -> PathBuf {
    #[cfg(windows)]
    {
        if let Ok(exe_path) = std::env::current_exe() {
            if let Some(exe_dir) = exe_path.parent() {
                let local_up = exe_dir.join("_up_");
                if local_up.join("ai-router/src/sidecar.mjs").exists() {
                    return local_up;
                }
            }
        }
    }

    if resource_dir.join("ai-router/src/sidecar.mjs").exists() {
        return resource_dir;
    }
    let tauri_parent = resource_dir.join("_up_");
    if tauri_parent.join("ai-router/src/sidecar.mjs").exists() {
        return tauri_parent;
    }
    resource_dir
}

fn find_node(project_dir: &Path) -> Option<PathBuf> {
    let bundled = project_dir.join(if cfg!(windows) {
        "runtime/node/node.exe"
    } else {
        "runtime/node/node"
    });
    if bundled.exists() {
        // Kiểm tra xem bundled node có thực sự chạy được không (tránh lỗi glibc/permission trên Linux)
        if let Ok(output) = Command::new(&bundled).arg("--version").output() {
            if output.status.success() {
                return Some(bundled);
            }
        }
    }
    find_executable("node")
}

/// Stop a runner left behind by a previous app process.
///
/// The runner now owns the scheduler and the Telegram channel, so a survivor
/// is not merely idle: it keeps ticking schedules and long-polling Telegram
/// alongside the new one, which shows up as duplicate answers. The pid is
/// recorded per data directory, so this only ever targets our own child.
fn kill_stale_runner(dir: &Path) {
    let pidfile = dir.join("runner.pid");
    let Ok(raw) = std::fs::read_to_string(&pidfile) else { return };
    let Ok(pid) = raw.trim().parse::<u32>() else {
        let _ = std::fs::remove_file(&pidfile);
        return;
    };

    // Confirm the pid is still our runner before signalling it. Pids are
    // reused, and a stale file must never take down an unrelated process.
    // `tasklist` only reports the image name (node.exe); the command line is
    // what identifies the runner, so ask CIM for it.
    #[cfg(windows)]
    let (probe, kill) = (
        (
            "powershell",
            vec![
                "-NoProfile".to_string(),
                "-Command".into(),
                format!("(Get-CimInstance Win32_Process -Filter 'ProcessId={pid}').CommandLine"),
            ],
        ),
        ("taskkill", vec!["/PID".into(), pid.to_string(), "/F".into()]),
    );
    #[cfg(not(windows))]
    let (probe, kill) = (
        ("ps", vec!["-p".to_string(), pid.to_string(), "-o".into(), "command=".into()]),
        ("kill", vec![pid.to_string()]),
    );

    let mut probe_cmd = Command::new(probe.0);
    probe_cmd.args(&probe.1);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        probe_cmd.creation_flags(0x08000000);
    }

    let is_ours = probe_cmd
        .output()
        .map(|out| String::from_utf8_lossy(&out.stdout).contains("agent-runner"))
        .unwrap_or(false);
    if is_ours {
        let mut kill_cmd = Command::new(kill.0);
        kill_cmd.args(&kill.1);
        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            kill_cmd.creation_flags(0x08000000);
        }
        let _ = kill_cmd.status();
        eprintln!("[tauri-runtime] Stopped stale agent-runner (pid {pid})");
    }
    let _ = std::fs::remove_file(&pidfile);
}

fn spawn_process(
    dir: &Path,
    workspace: &Path,
    project_dir: &Path,
    config_path: &Path,
    connector_token: &str,
) -> Result<Child, String> {
    kill_stale_runner(dir);

    let runner_src = project_dir.join("agent-runner/src/index.ts");
    let runner_dist = project_dir.join("agent-runner/dist/index.js");
    let node_bin = find_node(project_dir).unwrap_or_else(|| PathBuf::from("node"));

    // Production bundles the compiled runner and its dependencies alongside the
    // app. Never invoke npx/tsx from a user's machine: a desktop install must
    // be self-contained and use the Node runtime shipped in Resources.
    let mut cmd = if runner_dist.exists() {
        let mut c = Command::new(&node_bin);
        c.arg(runner_dist.to_str().unwrap());
        c
    } else if cfg!(debug_assertions) && runner_src.exists() {
        let npx_bin = find_executable("npx")
            .ok_or_else(|| "Development runner needs npx/tsx or a compiled agent-runner/dist".to_string())?;
        let mut c = Command::new(&npx_bin);
        c.args(["tsx", runner_src.to_str().unwrap()]);
        c
    } else {
        return Err("Bundled Agent Runner dist/index.js is missing".to_string());
    };

    // Construct a robust PATH env including common local bins
    let mut paths = Vec::new();
    if let Ok(path_var) = std::env::var("PATH") {
        paths.extend(std::env::split_paths(&path_var));
    }
    paths.push(PathBuf::from("/opt/homebrew/bin"));
    paths.push(PathBuf::from("/usr/local/bin"));
    
    if let Ok(home) = std::env::var("HOME") {
        let nvm_path = Path::new(&home).join(".nvm/versions/node");
        if nvm_path.exists() {
            if let Ok(entries) = std::fs::read_dir(nvm_path) {
                for entry in entries.flatten() {
                    paths.push(entry.path().join("bin"));
                }
            }
        }
    }
    let new_path = std::env::join_paths(paths).unwrap_or_default();

    cmd.env("VUA_DATA_DIR", dir)
        .env("VUA_IPC_DIR", dir.join("ipc"))
        .env("VUA_AGENT_WORKSPACE", workspace)
        .env("VUA_AGENT_APPROVED_READ_PATHS_FILE", dir.join("approved-read-paths.json"))
        .env("VUA_AI_ROUTER_URL", "http://127.0.0.1:36360")
        .env("VUA_CONNECTOR_GATEWAY_TOKEN", connector_token)
        .env("CONFIG_PATH", config_path)
        .env("PATH", new_path)
        .stdin(Stdio::null());

    // Redirect stdout/stderr to runner.log for easier diagnostics
    let log_file = std::fs::OpenOptions::new()
        .create(true)
        .write(true)
        .truncate(true)
        .open(dir.join("runner.log"));

    if let Ok(file) = log_file {
        if let Ok(stderr_file) = file.try_clone() {
            cmd.stdout(file).stderr(stderr_file);
        } else {
            cmd.stdout(file).stderr(Stdio::null());
        }
    } else {
        cmd.stdout(Stdio::null()).stderr(Stdio::null());
    }

    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x08000000); // CREATE_NO_WINDOW
    }
    let child = cmd.spawn().map_err(err)?;
    let _ = std::fs::write(dir.join("runner.pid"), child.id().to_string());
    Ok(child)
}

/// Free the router port if a previous run left a sidecar behind.
///
/// This used to `pkill -f sidecar.mjs` unconditionally, which killed *every*
/// sidecar on the machine — including the one belonging to another running
/// V Assistant instance (dev build vs installed app). That instance was then
/// left with a dead router and no way to recover. Now the port is probed
/// first, so a free port means nothing is killed, and the kill is announced.
fn kill_stale_port_process(port: u16) {
    let occupied = std::net::TcpListener::bind(("127.0.0.1", port)).is_err();
    if !occupied {
        return;
    }

    println!("[tauri-runtime] Port {port} is busy; checking its owner before restart.");

    #[cfg(unix)]
    {
        use std::process::Command;
        let pids = Command::new("lsof")
            .args(["-nP", "-iTCP:36360", "-sTCP:LISTEN", "-t"])
            .output()
            .ok()
            .map(|output| String::from_utf8_lossy(&output.stdout).into_owned())
            .unwrap_or_default();
        for pid in pids.lines().filter(|pid| !pid.trim().is_empty()) {
            let command = Command::new("ps")
                .args(["-p", pid.trim(), "-o", "command="])
                .output()
                .ok()
                .map(|output| String::from_utf8_lossy(&output.stdout).into_owned())
                .unwrap_or_default();
            if command.contains("ai-router") && command.contains("sidecar.mjs") {
                let _ = Command::new("kill").arg(pid.trim()).status();
                println!("[tauri-runtime] Stopped stale AI Router (pid {}).", pid.trim());
            } else {
                eprintln!("[tauri-runtime] Port {port} belongs to another process; refusing to kill it.");
            }
        }
        std::thread::sleep(Duration::from_millis(300));
    }

    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        use std::process::Command;
        let script = format!(
            "Get-NetTCPConnection -LocalPort {port} -ErrorAction SilentlyContinue | ForEach-Object {{ $p = Get-CimInstance Win32_Process -Filter ('ProcessId=' + $_.OwningProcess); if ($p.CommandLine -like '*ai-router*sidecar.mjs*') {{ Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue }} }}"
        );
        let mut cmd = Command::new("powershell");
        cmd.args(["-NoProfile", "-Command", &script]);
        cmd.creation_flags(0x08000000); // CREATE_NO_WINDOW
        let _ = cmd.status();
        std::thread::sleep(Duration::from_millis(500));
    }
}

fn router_healthcheck() -> Result<(), String> {
    let mut stream = TcpStream::connect_timeout(
        &"127.0.0.1:36360".parse().map_err(err)?,
        Duration::from_millis(250),
    ).map_err(err)?;
    stream.set_read_timeout(Some(Duration::from_millis(500))).map_err(err)?;
    stream.write_all(b"GET /health HTTP/1.1\r\nHost: 127.0.0.1:36360\r\nConnection: close\r\n\r\n").map_err(err)?;
    let mut response = String::new();
    stream.read_to_string(&mut response).map_err(err)?;
    if response.starts_with("HTTP/1.1 200") || response.starts_with("HTTP/1.0 200") {
        Ok(())
    } else {
        Err(format!("health returned {}", response.lines().next().unwrap_or("no response")))
    }
}

fn wait_router_ready(log_path: &Path) -> Result<(), String> {
    let deadline = Instant::now() + Duration::from_secs(10);
    let mut last_error = String::from("not started");
    while Instant::now() < deadline {
        match router_healthcheck() {
            Ok(()) => return Ok(()),
            Err(error) => last_error = error,
        }
        std::thread::sleep(Duration::from_millis(250));
    }
    let log_tail = std::fs::read_to_string(log_path)
        .ok()
        .map(|log| log.lines().rev().take(8).collect::<Vec<_>>().into_iter().rev().collect::<Vec<_>>().join("\\n"))
        .unwrap_or_default();
    Err(format!("AI Router did not become ready: {last_error}\\n{log_tail}"))
}

fn spawn_ai_router(
    dir: &Path,
    project_dir: &Path,
    broker: &VaultBroker,
) -> Result<Child, String> {
    kill_stale_port_process(36360);
    let sidecar = project_dir.join("ai-router/src/sidecar.mjs");
    if !sidecar.exists() {
        return Err("AI Router sidecar source not found".to_string());
    }
    let node_bin = find_node(project_dir).ok_or_else(|| {
        "Bundled Node runtime not found; AI Router cannot start.".to_string()
    })?;
    let mut command = Command::new(node_bin);
    command
        .arg(sidecar)
        .current_dir(project_dir.join("ai-router"))
        .env("AI_ROUTER_VAULT_BROKER_URL", &broker.url)
        .env("AI_ROUTER_VAULT_BROKER_TOKEN", &broker.token)
        .env("AI_ROUTER_CONNECTOR_TOKEN", &broker.connector_token)
        .stdin(Stdio::null());

    let log_path = dir.join("ai-router.log");
    let log = std::fs::OpenOptions::new()
        .create(true)
        .write(true)
        .truncate(true)
        .open(&log_path);
    if let Ok(file) = log {
        if let Ok(stderr) = file.try_clone() {
            command.stdout(file).stderr(stderr);
        }
    }

    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x08000000); // CREATE_NO_WINDOW
    }
    let mut child = command.spawn().map_err(err)?;
    if let Err(error) = wait_router_ready(&log_path) {
        let _ = child.kill();
        let _ = child.wait();
        return Err(error);
    }
    Ok(child)
}

/// Restart the AI Router when its process is gone.
///
/// Covers both "was never started" (spawn failed at boot, e.g. the port was
/// still held by another instance) and "died later". Capped like the agent
/// runner so a permanently broken setup does not respawn forever; the last
/// lines of `ai-router.log` are printed when giving up.
const MAX_ROUTER_RESTARTS: u32 = 5;

fn supervise_ai_router(
    router: &Arc<Mutex<Option<Child>>>,
    dir: &Path,
    project_dir: &Path,
    broker: &VaultBroker,
    failures: &mut u32,
) {
    if *failures >= MAX_ROUTER_RESTARTS {
        return;
    }

    let mut guard = match router.lock() {
        Ok(guard) => guard,
        Err(_) => return,
    };

    let needs_restart = match guard.as_mut() {
        Some(child) => matches!(child.try_wait(), Ok(Some(_))),
        None => true,
    };
    if !needs_restart {
        *failures = 0;
        return;
    }

    *failures += 1;
    println!(
        "[tauri-runtime] AI Router is not running. Restart attempt {}/{}",
        failures, MAX_ROUTER_RESTARTS
    );

    match spawn_ai_router(dir, project_dir, broker) {
        Ok(child) => {
            *guard = Some(child);
            println!("[tauri-runtime] AI Router restarted successfully.");
        }
        Err(error) => {
            *guard = None;
            eprintln!("[tauri-runtime] Failed to restart AI Router: {error}");
            if *failures >= MAX_ROUTER_RESTARTS {
                eprintln!(
                    "[tauri-runtime] AI Router failed {MAX_ROUTER_RESTARTS} times; giving up."
                );
                if let Ok(log) = std::fs::read_to_string(dir.join("ai-router.log")) {
                    let tail: Vec<&str> = log.lines().rev().take(10).collect();
                    eprintln!(
                        "[tauri-runtime] Last ai-router.log lines:\n{}",
                        tail.into_iter().rev().collect::<Vec<&str>>().join("\n")
                    );
                }
            }
        }
    }
}

impl Runtime {
    pub fn new(dir: PathBuf, project_dir: PathBuf, broker: VaultBroker) -> Result<Self, String> {
        std::fs::create_dir_all(dir.join("ipc")).map_err(err)?;
        std::fs::create_dir_all(dir.join("agents")).map_err(err)?;
        let workspace = Arc::new(Mutex::new(saved_workspace(&dir)));
        std::fs::create_dir_all(workspace.lock().map_err(err)?.as_path()).map_err(err)?;

        let engine = Arc::new(Mutex::new(None));
        let ai_router = Arc::new(Mutex::new(None));

        let runtime = Runtime {
            dir: dir.clone(),
            workspace: workspace.clone(),
            engine: engine.clone(),
            ai_router: ai_router.clone(),
            connector_token: broker.connector_token.clone(),
            project_dir: project_dir.clone(),
            broker: broker.clone(),
        };

        match spawn_ai_router(&dir, &project_dir, &broker) {
            Ok(child) => {
                if let Ok(mut guard) = ai_router.lock() {
                    *guard = Some(child);
                }
            }
            Err(error) => {
                let message = format!(
                    "AI Router startup failed: {error}\nproject_dir={}\n",
                    project_dir.display()
                );
                eprintln!("{message}");
                let _ = std::fs::write(dir.join("ai-router.log"), message);
            }
        }

        // Initialize schema for both DBs
        runtime.init_inbound_schema()?;
        runtime.init_outbound_schema()?;
        crate::knowledge::init_schema(&runtime.dir)?;

        // Spawning background process monitor (health check & auto-restart)
        let dir_clone = dir;
        let workspace_clone = workspace.clone();
        let engine_clone = engine.clone();
        let router_clone = ai_router.clone();
        let project_dir_val = project_dir;
        let router_broker = broker.clone();
        let connector_token = broker.connector_token;

        std::thread::spawn(move || {
            let mut consecutive_failures = 0;
            // The AI Router is the only path to a model ("Chat never calls a
            // vendor endpoint directly"), so a dead router makes the whole app
            // unusable. Supervise it exactly like the agent runner: without
            // this it was spawned once and, if it ever died, stayed dead until
            // the app restarted while chat showed only "Load failed".
            let mut router_failures = 0;
            loop {
                std::thread::sleep(std::time::Duration::from_secs(5));

                supervise_ai_router(
                    &router_clone,
                    &dir_clone,
                    &project_dir_val,
                    &router_broker,
                    &mut router_failures,
                );

                let mut guard = match engine_clone.lock() {
                    Ok(g) => g,
                    Err(_) => continue,
                };

                if let Some(child) = guard.as_mut() {
                    match child.try_wait() {
                        Ok(Some(status)) => {
                            consecutive_failures += 1;
                            println!("[tauri-runtime] Agent runner exited unexpectedly with status: {}. Failure count: {}/5", status, consecutive_failures);
                            
                            if consecutive_failures >= 5 {
                                eprintln!("[tauri-runtime] Agent runner failed 5 consecutive times. Stopping restart loop to prevent crash loop.");
                                let log_path = dir_clone.join("runner.log");
                                if let Ok(err_log) = std::fs::read_to_string(&log_path) {
                                    let last_lines: Vec<&str> = err_log.lines().rev().take(10).collect();
                                    eprintln!("[tauri-runtime] Last runner.log errors:\n{}", last_lines.into_iter().rev().collect::<Vec<&str>>().join("\n"));
                                }
                                break;
                            }

                            let config_path = dir_clone.join("runner.json");
                            let workspace = match workspace_clone.lock() {
                                Ok(workspace) => workspace.clone(),
                                Err(_) => continue,
                            };
                            match spawn_process(
                                &dir_clone,
                                &workspace,
                                &project_dir_val,
                                &config_path,
                                &connector_token,
                            ) {
                                Ok(new_child) => {
                                    *child = new_child;
                                    println!("[tauri-runtime] Agent runner auto-restarted successfully.");
                                }
                                Err(e) => {
                                    println!("[tauri-runtime] Failed to auto-restart agent runner: {}", e);
                                }
                            }
                        }
                        Ok(None) => {
                            consecutive_failures = 0;
                        }
                        Err(e) => {
                            println!("[tauri-runtime] Error checking agent runner status: {}", e);
                        }
                    }
                }
            }
        });

        Ok(runtime)
    }

    fn inbound(&self) -> PathBuf {
        self.dir.join("ipc/inbound.db")
    }

    fn outbound(&self) -> PathBuf {
        self.dir.join("ipc/outbound.db")
    }

    fn init_inbound_schema(&self) -> Result<(), String> {
        let conn = Connection::open(self.inbound()).map_err(err)?;
        conn.execute_batch(
            "PRAGMA journal_mode = DELETE;
             CREATE TABLE IF NOT EXISTS messages_in (
               id            TEXT PRIMARY KEY,
               seq           INTEGER UNIQUE,
               kind          TEXT NOT NULL DEFAULT 'chat',
               timestamp     TEXT NOT NULL DEFAULT (datetime('now')),
               status        TEXT NOT NULL DEFAULT 'pending',
               process_after TEXT,
               recurrence    TEXT,
               tries         INTEGER NOT NULL DEFAULT 0,
               trigger       INTEGER NOT NULL DEFAULT 1,
               platform_id   TEXT,
               channel_type  TEXT,
               thread_id     TEXT,
               content       TEXT NOT NULL
             );
             CREATE TABLE IF NOT EXISTS destinations (
               name          TEXT PRIMARY KEY,
               type          TEXT NOT NULL DEFAULT 'channel',
               channel_type  TEXT,
               platform_id   TEXT,
               metadata      TEXT
             );
             CREATE TABLE IF NOT EXISTS session_routing (
               key           TEXT PRIMARY KEY DEFAULT 'current',
               channel_type  TEXT,
               platform_id   TEXT,
               thread_id     TEXT
             );"
        )
        .map_err(err)?;
        Ok(())
    }

    fn init_outbound_schema(&self) -> Result<(), String> {
        let conn = Connection::open(self.outbound()).map_err(err)?;
        conn.execute_batch(
            "PRAGMA journal_mode = DELETE;
             CREATE TABLE IF NOT EXISTS messages_out (
               id            TEXT PRIMARY KEY,
               seq           INTEGER UNIQUE,
               in_reply_to   TEXT,
               timestamp     TEXT NOT NULL DEFAULT (datetime('now')),
               deliver_after TEXT,
               recurrence    TEXT,
               kind          TEXT NOT NULL DEFAULT 'chat',
               platform_id   TEXT,
               channel_type  TEXT,
               thread_id     TEXT,
               content       TEXT NOT NULL
             );
             CREATE TABLE IF NOT EXISTS processing_ack (
               message_id    TEXT PRIMARY KEY,
               status        TEXT NOT NULL DEFAULT 'processing',
               updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
             );
             CREATE TABLE IF NOT EXISTS session_state (
               key           TEXT PRIMARY KEY,
               value         TEXT NOT NULL,
               updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
             );"
        )
        .map_err(err)?;
        Ok(())
    }

    fn get_next_seq(&self) -> Result<i64, String> {
        let conn_in = Connection::open(self.inbound()).map_err(err)?;
        let max_in: i64 = conn_in
            .query_row("SELECT COALESCE(MAX(seq), 0) FROM messages_in", [], |row| row.get(0))
            .unwrap_or(0);

        let conn_out = Connection::open(self.outbound()).map_err(err)?;
        let max_out: i64 = conn_out
            .query_row("SELECT COALESCE(MAX(seq), 0) FROM messages_out", [], |row| row.get(0))
            .unwrap_or(0);

        let max_seq = std::cmp::max(max_in, max_out);
        let next_seq = if max_seq % 2 == 0 { max_seq + 2 } else { max_seq + 1 };
        Ok(next_seq)
    }

    pub fn send(&self, _group_id: &str, content: &str, meta: &str) -> Result<i64, String> {
        let seq = self.get_next_seq()?;
        let conn = Connection::open(self.inbound()).map_err(err)?;
        
        let id = format!("{}-{}", chrono::Utc::now().timestamp_millis(), uuid::Uuid::new_v4().simple());
        
        let mut platform_id = meta.to_string();
        let mut channel_type = "chat".to_string();
        let mut thread_id = "default".to_string();
        if let Ok(parsed) = serde_json::from_str::<serde_json::Value>(meta) {
            if let Some(p) = parsed.get("platformId").and_then(|x| x.as_str()) {
                platform_id = p.to_string();
            }
            if let Some(c) = parsed.get("channelType").and_then(|x| x.as_str()) {
                channel_type = c.to_string();
            }
            if let Some(t) = parsed.get("threadId").and_then(|x| x.as_str()) {
                thread_id = t.to_string();
            }
        }

        conn.execute(
            "INSERT INTO messages_in (id, seq, kind, status, platform_id, channel_type, thread_id, content)
             VALUES (?1, ?2, 'chat', 'pending', ?3, ?4, ?5, ?6)",
            (&id, &seq, &platform_id, &channel_type, &thread_id, content),
        )
        .map_err(err)?;

        Ok(seq)
    }

    pub fn receive(&self, _group_id: &str, after_id: i64) -> Result<Vec<OutboundMessage>, String> {
        let conn = Connection::open(self.outbound()).map_err(err)?;
        let mut stmt = conn
            .prepare(
                "SELECT seq, content, channel_type, thread_id, kind FROM messages_out
                 WHERE seq > ?1
                 ORDER BY seq ASC",
            )
            .map_err(err)?;

        let rows = stmt
            .query_map([after_id], |row| {
                let seq: i64 = row.get(0)?;
                let content: String = row.get(1)?;
                let channel_type: Option<String> = row.get(2)?;
                let thread_id: Option<String> = row.get(3)?;
                let kind: String = row.get(4)?;

                let mut text = content.clone();
                let mut role = None;
                let mut status = None;
                let mut duration_ms = None;
                let mut message_type = Some(kind);
                let mut permission = None;
                if let Ok(parsed) = serde_json::from_str::<serde_json::Value>(&content) {
                    if let Some(t) = parsed.get("text").and_then(|x| x.as_str()) {
                        text = t.to_string();
                    }
                    if let Some(t) = parsed.get("type").and_then(|x| x.as_str()) {
                        message_type = Some(t.to_string());
                    }
                    permission = parsed.get("permission").cloned();
                    role = parsed
                        .get("role")
                        .and_then(|x| x.as_str())
                        .map(|x| x.to_string());
                    status = parsed
                        .get("status")
                        .and_then(|x| x.as_str())
                        .map(|x| x.to_string());
                    duration_ms = parsed.get("durationMs").and_then(|x| x.as_i64());
                }

                Ok(OutboundMessage {
                    id: seq,
                    group_id: "default".to_string(),
                    content: text,
                    created_at: chrono::Utc::now().timestamp(),
                    message_type,
                    permission,
                    channel_type,
                    thread_id,
                    role,
                    status,
                    duration_ms,
                })
            })
            .map_err(err)?;

        let mut results = Vec::new();
        for r in rows {
            results.push(r.map_err(err)?);
        }
        Ok(results)
    }

    /// Forward an opaque connector request through AI Router. The Webview and
    /// model never receive the process capability or any resolved Vault value.
    pub fn connector_request(&self, payload: &str) -> Result<String, String> {
        let mut stream = TcpStream::connect("127.0.0.1:36360").map_err(err)?;
        stream
            .set_read_timeout(Some(std::time::Duration::from_secs(30)))
            .map_err(err)?;
        let request = format!(
            "POST /v1/connectors/request HTTP/1.1\r\nHost: 127.0.0.1:36360\r\nAuthorization: Bearer {}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
            self.connector_token,
            payload.len(),
            payload,
        );
        stream.write_all(request.as_bytes()).map_err(err)?;
        let mut response = String::new();
        stream.read_to_string(&mut response).map_err(err)?;
        response
            .split_once("\r\n\r\n")
            .map(|(_, body)| body.to_string())
            .ok_or_else(|| "AI Router connector returned an invalid response".to_string())
    }

    pub fn sync(&self, agents: &[AgentConfig], _active_id: Option<&str>) -> Result<(), String> {
        for agent in agents {
            let agent_dir = self.dir.join("agents").join(&agent.name);
            std::fs::create_dir_all(&agent_dir).map_err(err)?;

            if let Some(ref inst) = agent.instructions {
                std::fs::write(agent_dir.join("instructions.md"), inst).map_err(err)?;
            }
            if let Some(ref soul) = agent.soul {
                std::fs::write(agent_dir.join("soul.md"), soul).map_err(err)?;
            }
        }
        Ok(())
    }

    pub fn workspace(&self) -> PathBuf {
        self.workspace.lock().map(|workspace| workspace.clone()).unwrap_or_else(|_| self.dir.join("workspace"))
    }

    pub fn set_workspace(&self, workspace: PathBuf) -> Result<(), String> {
        std::fs::create_dir_all(&workspace).map_err(err)?;
        std::fs::write(
            self.dir.join("workspace-path.json"),
            serde_json::json!({ "workspace": workspace }).to_string(),
        )
        .map_err(err)?;
        *self.workspace.lock().map_err(err)? = workspace;
        Ok(())
    }

    pub fn spawn_engine_with_config(
        &self,
        agent_name: &str,
        base_url: Option<&str>,
        model: Option<&str>,
        // User setting: let the role learn durable facts from conversations.
        self_improve: bool,
        // Configured by the local user, passed through without exposing a shell.
        mcp_servers: std::collections::HashMap<String, McpServerConfig>,
        app: Option<&tauri::AppHandle>,
    ) -> Result<bool, String> {
        for (name, server) in &mcp_servers {
            if server.command.trim().is_empty() || is_host_shell(&server.command) {
                return Err(format!("MCP server \"{}\" must use a dedicated MCP executable, not a host shell.", name));
            }
        }
        self.stop_runner();

        let config_path = self.dir.join("runner.json");
        let config_json = serde_json::json!({
            "provider": "ai-router",
            "assistantName": "V-Assistant",
            "agentName": agent_name,
            "maxMessagesPerPrompt": 10,
            "mcpServers": mcp_servers,
            "model": model.unwrap_or("auto"),
            "baseUrl": base_url.unwrap_or("http://127.0.0.1:36360/v1"),
            "selfImprove": self_improve
        });
        std::fs::write(&config_path, serde_json::to_string_pretty(&config_json).map_err(err)?)
            .map_err(err)?;

        let mut guard = self.engine.lock().map_err(|e| e.to_string())?;

        let project_dir = if let Ok(dir) = std::env::var("VUA_PROJECT_DIR") {
            PathBuf::from(dir)
        } else if let Some(app) = app {
            let Ok(resource_dir) = app.path().resource_dir() else {
                return Ok(false);
            };
            resolve_project_dir(resource_dir)
        } else {
            return Ok(false);
        };

        let child = spawn_process(
            &self.dir,
            &self.workspace(),
            &project_dir,
            &config_path,
            &self.connector_token,
        )?;
        *guard = Some(child);

        println!("[tauri-runtime] Spawned agent-runner for agent: {}", agent_name);

        Ok(true)
    }

    pub fn spawn_engine(&self, app: Option<&tauri::AppHandle>) -> Result<bool, String> {
        let config_path = self.dir.join("runner.json");
        if config_path.exists() {
            if let Ok(content) = std::fs::read_to_string(&config_path) {
                if let Ok(parsed) = serde_json::from_str::<serde_json::Value>(&content) {
                    let agent_name = parsed.get("agentName").and_then(|x| x.as_str()).unwrap_or("default");
                    let base_url = parsed.get("baseUrl").and_then(|x| x.as_str());
                    let model = parsed.get("model").and_then(|x| x.as_str());
                    let self_improve = parsed.get("selfImprove").and_then(|x| x.as_bool()).unwrap_or(true);
                    let mcp_servers = parsed
                        .get("mcpServers")
                        .cloned()
                        .and_then(|value| serde_json::from_value(value).ok())
                        .unwrap_or_default();
                    return self.spawn_engine_with_config(agent_name, base_url, model, self_improve, mcp_servers, app);
                }
            }
        }
        self.spawn_engine_with_config("default", None, Some("auto"), true, Default::default(), app)
    }

    /// Respawn the AI Router now, killing any process still attached.
    ///
    /// The supervisor restarts it on its own within seconds, but it gives up
    /// after a few failures. This is the explicit user-driven path behind
    /// Settings → "Thử lại", which previously only re-issued the HTTP request
    /// and so could never recover a router that was not running.
    pub fn restart_ai_router(&self) -> Result<(), String> {
        if let Ok(mut guard) = self.ai_router.lock() {
            if let Some(child) = guard.as_mut() {
                let _ = child.kill();
                let _ = child.wait();
            }
            *guard = None;
        }
        let child = spawn_ai_router(&self.dir, &self.project_dir, &self.broker)?;
        if let Ok(mut guard) = self.ai_router.lock() {
            *guard = Some(child);
        }
        Ok(())
    }

    pub fn status(&self) -> RuntimeStatus {
        let engine_running = self
            .engine
            .lock()
            .ok()
            .and_then(|mut g| g.as_mut().map(|c| c.try_wait().ok().flatten().is_none()))
            .unwrap_or(false);
        let ai_router_running = self
            .ai_router
            .lock()
            .ok()
            .and_then(|mut guard| guard.as_mut().map(|child| child.try_wait().ok().flatten().is_none()))
            .unwrap_or(false);
        RuntimeStatus {
            version: env!("CARGO_PKG_VERSION"),
            engine_running,
            ai_router_running,
            dir: self.dir.display().to_string(),
        }
    }

    pub fn stop_engine(&self) {
        self.stop_runner();
        if let Ok(mut guard) = self.ai_router.lock() {
            if let Some(mut child) = guard.take() {
                let _ = child.kill();
                let _ = child.wait();
            }
        }
    }

    fn stop_runner(&self) {
        if let Ok(mut guard) = self.engine.lock() {
            if let Some(mut child) = guard.take() {
                let _ = child.kill();
                let _ = child.wait();
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::{is_host_shell, resolve_project_dir, saved_workspace};

    #[test]
    fn rejects_host_shells_as_mcp_servers() {
        assert!(is_host_shell("/bin/sh"));
        assert!(is_host_shell("bash"));
        assert!(is_host_shell("pwsh.exe"));
        assert!(!is_host_shell("npx"));
        assert!(!is_host_shell("/usr/local/bin/my-mcp-server"));
    }

    use std::fs;

    #[test]
    fn restores_saved_workspace_path() {
        let root = std::env::temp_dir().join(format!("v-assistant-workspace-test-{}", std::process::id()));
        fs::create_dir_all(&root).expect("runtime directory must be created");
        let expected = root.join("custom/workspace/output-data");
        fs::write(
            root.join("workspace-path.json"),
            serde_json::json!({ "workspace": expected }).to_string(),
        )
        .expect("workspace configuration must be written");

        assert_eq!(saved_workspace(&root), expected);
        fs::remove_dir_all(root).expect("runtime directory must be removed");
    }

    #[test]
    fn resolves_tauri_parent_resource_layout() {
        let root = std::env::temp_dir().join(format!(
            "v-assistant-resource-test-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .expect("system clock must be after the Unix epoch")
                .as_nanos()
        ));
        let sidecar = root.join("_up_/ai-router/src/sidecar.mjs");
        fs::create_dir_all(sidecar.parent().expect("sidecar must have a parent"))
            .expect("test resource path must be created");
        fs::write(&sidecar, "export {};").expect("test sidecar must be written");

        assert_eq!(resolve_project_dir(root.clone()), root.join("_up_"));
        fs::remove_dir_all(root).expect("test resource path must be removed");
    }
}

fn err<E: std::fmt::Display>(e: E) -> String {
    e.to_string()
}
