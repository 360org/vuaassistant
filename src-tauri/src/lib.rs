//! VuaAssistant desktop shell.
//!
//! The window hosts the React UI; the `runtime` module is the AI Runtime
//! Service boundary: it speaks the NanoClaw engine's channel contract
//! (SQLite inbound/outbound queues, per-agent groups, skills, connector
//! channels) so the UI never deals with engines, containers or config
//! files.

pub mod agent_fs;
pub mod auth;
pub mod computer_action;
pub mod knowledge;
pub mod runtime;
#[cfg(feature = "sandbox")]
pub mod sandbox;
pub mod vault;

use knowledge::{KnowledgeContent, KnowledgeRecord};
use runtime::{AgentConfig, OutboundMessage, Runtime, RuntimeStatus};
use tauri::{Manager, Emitter};
use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, ShortcutState};

/// Phím tắt toàn cục, theo quy ước của từng hệ điều hành.
///
/// Trên Windows "Cmd" được ánh xạ thành phím Windows, mà Win+Shift+R là tổ hợp
/// quay màn hình do chính Windows 11 giữ — đăng ký sẽ hỏng. Vì vậy máy không
/// phải macOS dùng Ctrl+Alt, tổ hợp hiếm khi bị hệ thống chiếm.
#[cfg(target_os = "macos")]
const GLOBAL_SHORTCUTS: [&str; 3] = ["Cmd+Shift+Q", "Cmd+Shift+R", "Cmd+Shift+E"];
#[cfg(not(target_os = "macos"))]
const GLOBAL_SHORTCUTS: [&str; 3] = ["Ctrl+Alt+Q", "Ctrl+Alt+R", "Ctrl+Alt+E"];

#[tauri::command]
fn runtime_status(state: tauri::State<Runtime>) -> RuntimeStatus {
    state.status()
}

/// Queue a user message for the engine; returns the inbound message id.
#[tauri::command]
fn runtime_send(
    state: tauri::State<Runtime>,
    group_id: String,
    content: String,
    meta: String,
) -> Result<i64, String> {
    state.send(&group_id, &content, &meta)
}

/// Poll engine replies for a group newer than `after_id`.
#[tauri::command]
fn runtime_receive(
    state: tauri::State<Runtime>,
    group_id: String,
    after_id: i64,
) -> Result<Vec<OutboundMessage>, String> {
    state.receive(&group_id, after_id)
}

/// Materialize installed agents (and the skills library) for the engine.
#[tauri::command]
fn runtime_sync(state: tauri::State<Runtime>, agents: Vec<AgentConfig>) -> Result<(), String> {
    state.sync(&agents, None)
}

/// Try to attach the engine; false means no engine is installed and the
/// app stays on the built-in preview engine.
#[tauri::command]
fn runtime_start_engine(app: tauri::AppHandle, state: tauri::State<Runtime>) -> Result<bool, String> {
    state.spawn_engine(Some(&app))
}

/// Respawn the AI Router sidecar (Settings → "Thử lại").
#[tauri::command]
fn runtime_restart_ai_router(state: tauri::State<Runtime>) -> Result<bool, String> {
    state.restart_ai_router().map(|()| true)
}

/// Restart the agent runner with a new agent and provider configuration.
#[tauri::command]
fn runtime_restart_runner(
    state: tauri::State<Runtime>,
    agent_name: String,
    base_url: Option<String>,
    model: Option<String>,
    self_improve: Option<bool>,
    // `env` remains deliberately unavailable to the webview: integration
    // secrets belong in the Vault/Connector Gateway, never runner.json.
    mcp_servers: Option<std::collections::HashMap<String, runtime::McpServerConfig>>,
    app: tauri::AppHandle,
) -> Result<bool, String> {
    state.spawn_engine_with_config(
        &agent_name,
        base_url.as_deref(),
        model.as_deref(),
        self_improve.unwrap_or(true),
        mcp_servers.unwrap_or_default(),
        Some(&app),
    )
}

// --- Knowledge store -------------------------------------------------------
//
// The app owns the writes: it holds the picked file and does the extraction
// (pdfjs and the Office formats are browser code). The runner opens the same
// database read-only to ground its answers.

#[tauri::command]
fn knowledge_put(
    state: tauri::State<Runtime>,
    file_id: String,
    bucket: String,
    name: String,
    chunks: Vec<String>,
    data_url: Option<String>,
) -> Result<(), String> {
    knowledge::put(&state.dir, &file_id, &bucket, &name, &chunks, data_url.as_deref())
}

#[tauri::command]
fn knowledge_delete(state: tauri::State<Runtime>, file_id: String) -> Result<(), String> {
    knowledge::delete(&state.dir, &file_id)
}

#[tauri::command]
fn knowledge_clear(state: tauri::State<Runtime>) -> Result<(), String> {
    knowledge::clear(&state.dir)
}

#[tauri::command]
fn knowledge_get(
    state: tauri::State<Runtime>,
    file_id: String,
) -> Result<Option<KnowledgeContent>, String> {
    knowledge::get(&state.dir, &file_id)
}

#[tauri::command]
fn knowledge_list(
    state: tauri::State<Runtime>,
    bucket: Option<String>,
) -> Result<Vec<KnowledgeRecord>, String> {
    knowledge::list(&state.dir, bucket.as_deref())
}

/// Execute a credentialed connector call without exposing the gateway
/// capability or resolved Vault values to Webview/agent code.
#[tauri::command]
fn runtime_connector_request(
    state: tauri::State<Runtime>,
    payload: String,
) -> Result<String, String> {
    state.connector_request(&payload)
}

#[tauri::command]
fn pick_directory() -> Option<String> {
    rfd::FileDialog::new()
        .set_title("Chọn thư mục lưu trữ dữ liệu VuaAssistant")
        .pick_folder()
        .map(|path| path.to_string_lossy().to_string())
}

#[tauri::command]
fn grant_agent_read_path(state: tauri::State<Runtime>, path: String) -> Result<String, String> {
    let selected = std::fs::canonicalize(path.trim()).map_err(|e| format!("Không thể cấp quyền: {e}"))?;
    let approved = if selected.is_dir() {
        selected
    } else {
        selected.parent().ok_or("Không tìm thấy thư mục chứa tệp")?.to_path_buf()
    };
    let grants_file = state.dir.join("approved-read-paths.json");
    let mut grants: Vec<String> = std::fs::read_to_string(&grants_file)
        .ok()
        .and_then(|text| serde_json::from_str(&text).ok())
        .unwrap_or_default();
    let approved = approved.to_string_lossy().to_string();
    if !grants.contains(&approved) {
        grants.push(approved.clone());
        std::fs::create_dir_all(&state.dir).map_err(|e| e.to_string())?;
        std::fs::write(&grants_file, serde_json::to_string(&grants).map_err(|e| e.to_string())?)
            .map_err(|e| e.to_string())?;
    }
    Ok(approved)
}

fn resolve_data_dir(custom_dir: &str) -> std::path::PathBuf {
    use std::path::PathBuf;
    let trimmed = custom_dir.trim();
    if trimmed.is_empty() || trimmed == "~/vuaassistant" {
        if let Ok(home) = std::env::var("HOME") {
            return PathBuf::from(home).join("vuaassistant");
        }
    }
    if trimmed.starts_with("~/") {
        if let Ok(home) = std::env::var("HOME") {
            return PathBuf::from(home).join(trimmed.trim_start_matches("~/"));
        }
    }
    PathBuf::from(trimmed)
}

#[tauri::command]
fn resolve_data_dir_path(custom_dir: String) -> String {
    resolve_data_dir(&custom_dir).to_string_lossy().to_string()
}

#[tauri::command]
fn set_workspace_path(
    app: tauri::AppHandle,
    state: tauri::State<Runtime>,
    custom_dir: String,
) -> Result<String, String> {
    let workspace = resolve_data_dir(&custom_dir).join("workspace/output-data");
    state.set_workspace(workspace.clone())?;
    state.spawn_engine(Some(&app))?;
    Ok(workspace.to_string_lossy().to_string())
}

#[tauri::command]
fn save_custom_data_file(custom_dir: String, subfolder: String, filename: String, content_b64: String) -> Result<String, String> {
    use std::fs;
    use base64::Engine;

    let path = resolve_data_dir(&custom_dir);
    let target_dir = path.join(&subfolder);
    fs::create_dir_all(&target_dir).map_err(|e| e.to_string())?;

    // Anti-collision: macOS clipboard pastes default to "image.png"
    let mut file_path = target_dir.join(&filename);
    if file_path.exists() {
        let stem = file_path.file_stem().and_then(|s| s.to_str()).unwrap_or("file");
        let ext = file_path.extension().and_then(|s| s.to_str()).unwrap_or("");
        let now_ms = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_millis())
            .unwrap_or(0);
        let new_filename = if ext.is_empty() {
            format!("{}_{}", stem, now_ms)
        } else {
            format!("{}_{}.{}", stem, now_ms, ext)
        };
        file_path = target_dir.join(new_filename);
    }

    // Strip data URL header if present (e.g. data:image/png;base64,...)
    let clean_b64 = if let Some(pos) = content_b64.find(";base64,") {
        &content_b64[pos + 8..]
    } else {
        &content_b64
    };

    let bytes = if let Ok(data) = base64::engine::general_purpose::STANDARD.decode(clean_b64.as_bytes()) {
        data
    } else {
        content_b64.into_bytes()
    };

    fs::write(&file_path, bytes).map_err(|e| e.to_string())?;

    Ok(file_path.to_string_lossy().to_string())
}

#[tauri::command]
fn save_custom_data_text(custom_dir: String, relative_path: String, content: String) -> Result<String, String> {
    use std::fs;

    let path = resolve_data_dir(&custom_dir);
    let target_file = path.join(&relative_path);
    if let Some(parent) = target_file.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }

    fs::write(&target_file, content).map_err(|e| e.to_string())?;

    Ok(target_file.to_string_lossy().to_string())
}

/// Load chat sessions from disk as fallback when localStorage is empty.
/// Reads `chats/sessions.json` from the custom data dir (or ~/vuaassistant).
/// Returns the raw JSON string; empty-string on any error so the UI can
/// fall through to its own defaults without throwing.
#[tauri::command]
fn load_sessions_from_disk(custom_dir: String) -> String {
    let path = resolve_data_dir(&custom_dir).join("chats/sessions.json");
    std::fs::read_to_string(&path).unwrap_or_default()
}

#[tauri::command]
fn load_task_run_logs(state: tauri::State<Runtime>) -> Result<Vec<runtime::TaskRunLog>, String> {
    state.get_task_run_logs()
}

#[tauri::command]
fn clear_task_run_logs(state: tauri::State<Runtime>, task_id: Option<String>) -> Result<(), String> {
    state.clear_task_run_logs(task_id)
}

#[tauri::command]
fn read_host_file(path: String) -> Result<String, String> {
    use std::fs;
    use std::path::PathBuf;

    let mut file_path = PathBuf::from(&path);
    if path.starts_with("~/") {
        if let Ok(home) = std::env::var("HOME") {
            file_path = PathBuf::from(home).join(path.trim_start_matches("~/"));
        }
    }

    fs::read_to_string(&file_path).map_err(|e| format!("Lỗi đọc file: {}", e))
}

#[tauri::command]
fn write_host_file(path: String, content: String) -> Result<String, String> {
    use std::fs;
    use std::path::PathBuf;

    let mut file_path = PathBuf::from(&path);
    if path.starts_with("~/") {
        if let Ok(home) = std::env::var("HOME") {
            file_path = PathBuf::from(home).join(path.trim_start_matches("~/"));
        }
    }

    if let Some(parent) = file_path.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("Lỗi tạo thư mục: {}", e))?;
    }

    fs::write(&file_path, content).map_err(|e| format!("Lỗi ghi file: {}", e))?;
    Ok(format!("Ghi file thành công vào: {}", file_path.to_string_lossy()))
}

#[tauri::command]
fn list_host_dir(path: String) -> Result<Vec<String>, String> {
    use std::fs;
    use std::path::PathBuf;

    let mut dir_path = PathBuf::from(&path);
    if path.starts_with("~/") {
        if let Ok(home) = std::env::var("HOME") {
            dir_path = PathBuf::from(home).join(path.trim_start_matches("~/"));
        }
    }

    let entries = fs::read_dir(&dir_path).map_err(|e| format!("Lỗi đọc thư mục: {}", e))?;
    let mut files = Vec::new();
    for entry in entries.flatten() {
        let name = entry.file_name().to_string_lossy().to_string();
        let is_dir = entry.file_type().map(|t| t.is_dir()).unwrap_or(false);
        files.push(if is_dir { format!("{}/", name) } else { name });
    }
    Ok(files)
}

// --- Agent file tools ------------------------------------------------------
//
// The webview keeps its own agent path for when the runner is down and for
// providers that bypass it. These are the only file operations that path may
// perform: every one is confined to the granted workspace. `execute_cli_command`
// used to sit here and ran `sh -c <anything>` for the model — idea.md §22 and
// §92 forbid giving the model a host shell, so it is gone rather than guarded.

fn agent_workspace(state: &tauri::State<Runtime>) -> std::path::PathBuf {
    state.workspace()
}

fn approved_read_paths(state: &tauri::State<Runtime>) -> Vec<String> {
    std::fs::read_to_string(state.dir.join("approved-read-paths.json"))
        .ok()
        .and_then(|text| serde_json::from_str(&text).ok())
        .unwrap_or_default()
}

#[tauri::command]
fn agent_read_file(state: tauri::State<Runtime>, path: String) -> Result<String, String> {
    agent_fs::read(&agent_workspace(&state), &approved_read_paths(&state), &path)
}

#[tauri::command]
fn agent_write_file(
    state: tauri::State<Runtime>,
    path: String,
    content: String,
) -> Result<String, String> {
    agent_fs::write(&agent_workspace(&state), &path, &content)
}

#[tauri::command]
fn agent_list_dir(state: tauri::State<Runtime>, path: String) -> Result<Vec<String>, String> {
    agent_fs::list(&agent_workspace(&state), &approved_read_paths(&state), &path)
}

#[tauri::command]
fn set_autostart(enable: bool) -> Result<bool, String> {
    if let Ok(home) = std::env::var("HOME") {
        let plist_path = std::path::PathBuf::from(home).join("Library/LaunchAgents/net.vuaai.vuaassistant.plist");
        if enable {
            if let Ok(exe_path) = std::env::current_exe() {
                let plist_content = format!(
                    r#"<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>net.vuaai.vuaassistant</string>
    <key>ProgramArguments</key>
    <array>
        <string>{}</string>
    </array>
    <key>RunAtLoad</key>
    <true/>
</dict>
</plist>"#,
                    exe_path.to_string_lossy()
                );
                if let Some(parent) = plist_path.parent() {
                    let _ = std::fs::create_dir_all(parent);
                }
                let _ = std::fs::write(plist_path, plist_content);
            }
        } else {
            if plist_path.exists() {
                let _ = std::fs::remove_file(plist_path);
            }
        }
    }
    Ok(enable)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_global_shortcut::Builder::new()
            // Không đăng ký phím tắt ngay ở đây: `with_shortcuts(...).unwrap()`
            // sẽ panic nếu hệ điều hành đã giữ tổ hợp đó, và app chết ngay khi
            // mở. Việc đăng ký chuyển xuống `setup` để lỗi chỉ là mất phím tắt.
            .with_handler(|app, shortcut, event| {
                if event.state == ShortcutState::Pressed {
                    // So khớp theo phím chữ, không theo chuỗi tổ hợp: mỗi hệ
                    // điều hành dùng một bộ phím bổ trợ khác nhau.
                    match shortcut.key {
                        Code::KeyQ => {
                            if let Some(window) = app.get_webview_window("main") {
                                let _ = window.is_visible().map(|visible| {
                                    if visible {
                                        let _ = window.hide();
                                    } else {
                                        let _ = window.show();
                                        let _ = window.set_focus();
                                    }
                                });
                            }
                        }
                        Code::KeyR => {
                            if let Some(window) = app.get_webview_window("main") {
                                let _ = window.eval("window.location.reload()");
                            }
                        }
                        Code::KeyE => {
                            let _ = app.emit("global-shortcut", "toggle-input");
                        }
                        _ => {}
                    }
                }
            })
            .build())
        .setup(|app| {
            // Phím tắt là tiện ích, không phải điều kiện để app chạy. Nếu hệ
            // điều hành hoặc một ứng dụng khác đã giữ tổ hợp nào thì bỏ qua
            // đúng tổ hợp đó — tuyệt đối không để app không mở được vì nó.
            for accelerator in GLOBAL_SHORTCUTS {
                if let Err(err) = app.global_shortcut().register(accelerator) {
                    eprintln!("[vuaassistant] bỏ qua phím tắt {accelerator}: {err}");
                }
            }

            #[cfg(target_os = "macos")]
            {
                use tauri::menu::{Menu, Submenu, PredefinedMenuItem, MenuItem};

                // App Menu (VuaAssistant) - must be first submenu to become the macOS app menu
                let app_menu = Submenu::new(app, "VuaAssistant", true)?;
                app_menu.append_items(&[
                    &PredefinedMenuItem::about(app, Some("About VuaAssistant"), None)?,
                    &PredefinedMenuItem::separator(app)?,
                    &MenuItem::new(app, "Settings...", true, Some("Cmd+,"))?,
                    &PredefinedMenuItem::separator(app)?,
                    &PredefinedMenuItem::services(app, None)?,
                    &PredefinedMenuItem::separator(app)?,
                    &PredefinedMenuItem::hide(app, Some("Hide VuaAssistant"))?,
                    &PredefinedMenuItem::hide_others(app, Some("Hide Others"))?,
                    &PredefinedMenuItem::show_all(app, Some("Show All"))?,
                    &PredefinedMenuItem::separator(app)?,
                    &PredefinedMenuItem::quit(app, Some("Quit VuaAssistant"))?,
                ])?;

                // File Menu
                let file_menu = Submenu::new(app, "File", true)?;
                file_menu.append_items(&[
                    &MenuItem::new(app, "New Chat", true, Some("Cmd+N"))?,
                    &PredefinedMenuItem::separator(app)?,
                    &PredefinedMenuItem::close_window(app, Some("Close Window"))?,
                    &PredefinedMenuItem::separator(app)?,
                    &MenuItem::new(app, "Save Conversation...", true, Some("Cmd+S"))?,
                ])?;

                // Edit Menu - use MenuItem::new for standard items to avoid macOS auto-placing them in app menu
                let edit_menu = Submenu::new(app, "Edit", true)?;
                edit_menu.append_items(&[
                    &MenuItem::new(app, "Undo", true, Some("Cmd+Z"))?,
                    &MenuItem::new(app, "Redo", true, Some("Cmd+Shift+Z"))?,
                    &PredefinedMenuItem::separator(app)?,
                    &MenuItem::new(app, "Cut", true, Some("Cmd+X"))?,
                    &MenuItem::new(app, "Copy", true, Some("Cmd+C"))?,
                    &MenuItem::new(app, "Paste", true, Some("Cmd+V"))?,
                    &MenuItem::new(app, "Select All", true, Some("Cmd+A"))?,
                    &PredefinedMenuItem::separator(app)?,
                    &MenuItem::new(app, "Find...", true, Some("Cmd+F"))?,
                    &MenuItem::new(app, "Find Next", true, Some("Cmd+G"))?,
                    &MenuItem::new(app, "Find Previous", true, Some("Cmd+Shift+G"))?,
                ])?;

                // View Menu
                let view_menu = Submenu::new(app, "View", true)?;
                view_menu.append_items(&[
                    &MenuItem::new(app, "Toggle Sidebar", true, Some("Cmd+B"))?,
                    &PredefinedMenuItem::separator(app)?,
                    &MenuItem::new(app, "Reload", true, Some("Cmd+R"))?,
                    &MenuItem::new(app, "Toggle Full Screen", true, Some("Ctrl+Cmd+F"))?,
                    &PredefinedMenuItem::separator(app)?,
                    &MenuItem::new(app, "Actual Size", true, Some("Cmd+0"))?,
                    &MenuItem::new(app, "Zoom In", true, Some("Cmd+="))?,
                    &MenuItem::new(app, "Zoom Out", true, Some("Cmd+-"))?,
                    &PredefinedMenuItem::separator(app)?,
                    &MenuItem::new(app, "Toggle Developer Tools", true, Some("Cmd+Option+I"))?,
                ])?;

                // Window Menu
                let window_menu = Submenu::new(app, "Window", true)?;
                window_menu.append_items(&[
                    &PredefinedMenuItem::minimize(app, Some("Minimize"))?,
                    &PredefinedMenuItem::maximize(app, Some("Zoom"))?,
                    &PredefinedMenuItem::separator(app)?,
                    &PredefinedMenuItem::bring_all_to_front(app, Some("Bring All to Front"))?,
                ])?;

                // Help Menu
                let help_menu = Submenu::new(app, "Help", true)?;
                help_menu.append_items(&[
                    &MenuItem::new(app, "Documentation", true, None::<&str>)?,
                    &MenuItem::new(app, "Report Issue...", true, None::<&str>)?,
                    &PredefinedMenuItem::separator(app)?,
                    &PredefinedMenuItem::about(app, Some("About VuaAssistant"), None)?,
                ])?;

                let menu = Menu::new(app)?;
                menu.append(&app_menu)?;
                menu.append(&file_menu)?;
                menu.append(&edit_menu)?;
                menu.append(&view_menu)?;
                menu.append(&window_menu)?;
                menu.append(&help_menu)?;
                app.set_menu(menu)?;
            }

            let dir = app.path().app_data_dir()?.join("runtime");
            
            // Only development resolves the project from the current checkout.
            // A packaged app must use Tauri's resource directory, where the
            // bundled agent-runner and AI Router sidecar live.
            #[cfg(debug_assertions)]
            if std::env::var("VUA_PROJECT_DIR").is_err() {
                if let Ok(cwd) = std::env::current_dir() {
                    // `tauri dev` runs cargo from src-tauri/, but the JS sidecars
                    // live at the checkout root one level up. Taking cwd verbatim
                    // pointed the runtime at src-tauri/ai-router (nonexistent), so
                    // the AI Router never started and every chat turn failed with
                    // "AI Router unavailable". Walk up to whichever directory
                    // actually holds the sidecar.
                    let root = std::iter::successors(Some(cwd.as_path()), |dir| dir.parent())
                        .find(|dir| dir.join("ai-router/src/sidecar.mjs").exists())
                        .map(std::path::Path::to_path_buf);
                    std::env::set_var("VUA_PROJECT_DIR", root.unwrap_or(cwd));
                }
            }

            // `unwrap_or` tính tham số ngay cả khi giá trị đã có, nên
            // `resource_dir()?` vẫn chạy dù VUA_PROJECT_DIR đã được đặt. Ở đâu
            // resource_dir() lỗi (chạy binary trần chưa đóng gói) thì setup trả
            // Err và app tắt ngay khi vừa mở — không kịp in gì. Dùng
            // `unwrap_or_else` để chỉ dò thư mục resource khi thật sự cần.
            let project_dir = match std::env::var("VUA_PROJECT_DIR") {
                Ok(value) => std::path::PathBuf::from(value),
                Err(_) => runtime::resolve_project_dir(app.path().resource_dir()?),
            };
            vault::migrate_legacy_vault(&dir).map_err(std::io::Error::other)?;
            let broker = vault::start_broker(dir.clone()).map_err(std::io::Error::other)?;
            let runtime = Runtime::new(dir, project_dir, broker).map_err(std::io::Error::other)?;
            // Attach a NanoClaw engine when one is installed; otherwise the
            // UI silently falls back to the preview engine.
            let _ = runtime.spawn_engine(Some(app.app_handle()));
            app.manage(runtime);
            Ok(())
        })
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::Destroyed = event {
                if let Some(runtime) = window.app_handle().try_state::<Runtime>() {
                    runtime.stop_engine();
                }
            }
        })
        .invoke_handler(tauri::generate_handler![
            runtime_status,
            runtime_send,
            runtime_receive,
            runtime_sync,
            runtime_start_engine,
            runtime_restart_runner,
            runtime_restart_ai_router,
            runtime_connector_request,
            knowledge_put,
            knowledge_delete,
            knowledge_clear,
            knowledge_get,
            knowledge_list,
            auth::oauth_listen,
            auth::open_external,
            auth::capture_grok_sso_cookie,
            vault::vault_set,
            vault::vault_get,
            vault::vault_delete,
            pick_directory,
            grant_agent_read_path,
            resolve_data_dir_path,
            set_workspace_path,
            save_custom_data_file,
            save_custom_data_text,
            load_sessions_from_disk,
            load_task_run_logs,
            clear_task_run_logs,
            read_host_file,
            write_host_file,
            list_host_dir,
            agent_read_file,
            agent_write_file,
            agent_list_dir,
            set_autostart,
            computer_action::computer_mouse_move,
            computer_action::computer_mouse_click,
            computer_action::computer_mouse_down,
            computer_action::computer_mouse_up,
            computer_action::computer_type_text,
            computer_action::computer_key_press,
            computer_action::computer_key_down,
            computer_action::computer_key_up,
            computer_action::computer_screenshot,
            computer_action::computer_list_displays
        ])
        .build(tauri::generate_context!())
        .expect("error while building VuaAssistant")
        .run(|app_handle, event| {
            if let tauri::RunEvent::Exit = event {
                if let Some(runtime) = app_handle.try_state::<Runtime>() {
                    runtime.stop_engine();
                }
            }
        });
}
