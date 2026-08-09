//! Computer Use — mouse, keyboard, and screen capture.
//!
//! Exposed as Tauri commands so the Agent Runner native tools can call them
//! via `invoke()`. All actions are intentionally simple: no macro recording,
//! no complex gesture support — just the primitives an Agent needs to automate
//! routine desktop tasks.
//!
//! Security: these commands are only useful when the user has explicitly
//! granted the Agent "Computer Use" capability in Settings → Agent Limits.
//! The capability-rail in the Agent Runner enforces that gate before calling;
//! the Rust side does not re-check to avoid duplicating policy logic.
//!
//! ponytail: Enigo is created fresh per call (not Send, so no static Mutex).
//!   Cost: one allocation per action — negligible for human-paced automation.
//!   Upgrade path: thread-local storage if high-frequency macro replay needed.

use base64::{engine::general_purpose::STANDARD as B64, Engine};
use enigo::{
    Button, Coordinate,
    Direction::{Click, Press, Release},
    Enigo, Key, Keyboard, Mouse, Settings,
};

fn with_enigo<F, T>(f: F) -> Result<T, String>
where
    F: FnOnce(&mut Enigo) -> Result<T, String>,
{
    // ponytail: fresh Enigo per call — not Send, no static storage needed.
    let mut e = Enigo::new(&Settings::default()).map_err(|err| err.to_string())?;
    f(&mut e)
}

/// Move the mouse pointer to absolute screen coordinates.
#[tauri::command]
pub fn computer_mouse_move(x: i32, y: i32) -> Result<(), String> {
    with_enigo(|e| e.move_mouse(x, y, Coordinate::Abs).map_err(|err| err.to_string()))
}

/// Click a mouse button at the current pointer position.
/// `button`: "left" | "right" | "middle" (default "left").
#[tauri::command]
pub fn computer_mouse_click(button: Option<String>) -> Result<(), String> {
    let btn = parse_button(button.as_deref());
    with_enigo(|e| e.button(btn, Click).map_err(|err| err.to_string()))
}

/// Press and hold a mouse button (pair with `computer_mouse_up`).
#[tauri::command]
pub fn computer_mouse_down(button: Option<String>) -> Result<(), String> {
    let btn = parse_button(button.as_deref());
    with_enigo(|e| e.button(btn, Press).map_err(|err| err.to_string()))
}

/// Release a held mouse button.
#[tauri::command]
pub fn computer_mouse_up(button: Option<String>) -> Result<(), String> {
    let btn = parse_button(button.as_deref());
    with_enigo(|e| e.button(btn, Release).map_err(|err| err.to_string()))
}

fn parse_button(s: Option<&str>) -> Button {
    match s.unwrap_or("left") {
        "right" => Button::Right,
        "middle" => Button::Middle,
        _ => Button::Left,
    }
}

/// Type a string of text through the OS keyboard input pipeline.
#[tauri::command]
pub fn computer_type_text(text: String) -> Result<(), String> {
    with_enigo(|e| e.text(&text).map_err(|err| err.to_string()))
}

/// Press a named key once (press + release).
/// Common names: "return", "tab", "escape", "space", "backspace",
///               "up", "down", "left", "right", "f1"–"f12",
///               "control", "alt", "shift", "meta".
#[tauri::command]
pub fn computer_key_press(key: String) -> Result<(), String> {
    let k = parse_key(&key)?;
    with_enigo(|e| e.key(k, Click).map_err(|err| err.to_string()))
}

/// Hold a key down (pair with `computer_key_up` for combos like Ctrl+C).
#[tauri::command]
pub fn computer_key_down(key: String) -> Result<(), String> {
    let k = parse_key(&key)?;
    with_enigo(|e| e.key(k, Press).map_err(|err| err.to_string()))
}

/// Release a held key.
#[tauri::command]
pub fn computer_key_up(key: String) -> Result<(), String> {
    let k = parse_key(&key)?;
    with_enigo(|e| e.key(k, Release).map_err(|err| err.to_string()))
}

fn parse_key(name: &str) -> Result<Key, String> {
    Ok(match name.to_lowercase().as_str() {
        "return" | "enter" => Key::Return,
        "tab" => Key::Tab,
        "escape" | "esc" => Key::Escape,
        "space" => Key::Space,
        "backspace" => Key::Backspace,
        "delete" | "del" => Key::Delete,
        "up" => Key::UpArrow,
        "down" => Key::DownArrow,
        "left" => Key::LeftArrow,
        "right" => Key::RightArrow,
        "home" => Key::Home,
        "end" => Key::End,
        "pageup" | "page_up" => Key::PageUp,
        "pagedown" | "page_down" => Key::PageDown,
        "f1"  => Key::F1,  "f2"  => Key::F2,  "f3"  => Key::F3,  "f4"  => Key::F4,
        "f5"  => Key::F5,  "f6"  => Key::F6,  "f7"  => Key::F7,  "f8"  => Key::F8,
        "f9"  => Key::F9,  "f10" => Key::F10, "f11" => Key::F11, "f12" => Key::F12,
        "control" | "ctrl" => Key::Control,
        "alt" | "option"   => Key::Alt,
        "shift"            => Key::Shift,
        "meta" | "command" | "super" | "win" => Key::Meta,
        "capslock" | "caps_lock" => Key::CapsLock,
        other => {
            let mut chars = other.chars();
            let ch = chars.next().ok_or_else(|| "Empty key name".to_string())?;
            if chars.next().is_some() {
                return Err(format!("Unknown key: {other}"));
            }
            Key::Unicode(ch)
        }
    })
}

/// Capture a screenshot of a display and return it as a base64-encoded PNG.
/// `display_index`: 0 = primary (default).
#[tauri::command]
pub fn computer_screenshot(display_index: Option<usize>) -> Result<String, String> {
    use screenshots::image::{codecs::png::PngEncoder, ColorType, ImageEncoder};

    let screens = screenshots::Screen::all().map_err(|e| e.to_string())?;
    let idx = display_index.unwrap_or(0);
    let screen = screens
        .into_iter()
        .nth(idx)
        .ok_or_else(|| format!("Display {idx} not found"))?;

    let image = screen.capture().map_err(|e| e.to_string())?;

    // screenshots returns an RGBA ImageBuffer; encode to PNG in memory.
    let (width, height) = (image.width(), image.height());
    let raw = image.into_raw();
    let mut png_bytes: Vec<u8> = Vec::new();
    PngEncoder::new(&mut png_bytes)
        .write_image(&raw, width, height, ColorType::Rgba8)
        .map_err(|e| e.to_string())?;

    Ok(B64.encode(&png_bytes))
}

/// List available displays: returns "{index}: {width}x{height} @{scale}x".
#[tauri::command]
pub fn computer_list_displays() -> Result<Vec<String>, String> {
    let screens = screenshots::Screen::all().map_err(|e| e.to_string())?;
    Ok(screens
        .iter()
        .enumerate()
        .map(|(i, s)| {
            let info = s.display_info;
            format!("{i}: {}x{} @{:.1}x", info.width, info.height, info.scale_factor)
        })
        .collect())
}
