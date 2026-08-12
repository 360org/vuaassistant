//! Desktop OAuth via loopback redirect.
//!
//! The webview can't complete a provider OAuth by itself (the vendor won't
//! render inside an embedded view, and there's no public callback URL). The
//! standard native pattern instead:
//!
//!   1. app opens a throwaway `http://127.0.0.1:<port>` listener,
//!   2. app opens the vendor's login in the user's real browser, passing
//!      that loopback as the callback URL,
//!   3. the browser redirects back to the loopback with `?code=…`,
//!   4. the app reads the code and finishes the token exchange.
//!
//! Only the listen + browser-open steps are native; the PKCE challenge and
//! the code→key exchange stay in the frontend so all providers share one
//! path. The obtained key is then stored in the credential Vault.

use aes::Aes128;
use cbc::cipher::{block_padding::Pkcs7, BlockDecryptMut, KeyIvInit};
use hmac::{Hmac, Mac};
use rand::{rngs::OsRng, RngCore};
use rusqlite::Connection;
use sha1::Sha1;
use sha2::{Digest, Sha256};
use std::fs::{self, OpenOptions};
use std::io::{BufRead, BufReader, Write};
use std::net::{TcpListener, TcpStream};
use std::path::{Path, PathBuf};
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter};

type Aes128CbcDec = cbc::Decryptor<Aes128>;
type HmacSha1 = Hmac<Sha1>;

/// Landing page shown in the browser after the redirect.
const DONE_PAGE: &str = "<!doctype html><html><head><meta charset=\"utf-8\">\
<title>VuaAssistant</title></head>\
<body style=\"font-family:system-ui;background:#0a0a0a;color:#eaeaea;\
text-align:center;padding-top:22vh\">\
<h2>VuaAssistant</h2><p>Signed in successfully. You can close this tab and \
return to the app.</p></body></html>";

/// Start the loopback listener and return its port. Accepts exactly one
/// redirect, emits `oauth-code` (or `oauth-error`) to the frontend, and
/// exits.
#[tauri::command]
pub fn oauth_listen(app: AppHandle) -> Result<u16, String> {
    let listener = TcpListener::bind("127.0.0.1:0").map_err(|e| e.to_string())?;
    let port = listener.local_addr().map_err(|e| e.to_string())?.port();
    std::thread::spawn(move || {
        if let Ok((stream, _)) = listener.accept() {
            match handle_connection(stream) {
                Some(code) => {
                    let _ = app.emit("oauth-code", code);
                }
                None => {
                    let _ = app.emit(
                        "oauth-error",
                        "no authorization code in callback".to_string(),
                    );
                }
            }
        }
    });
    Ok(port)
}

/// Read one HTTP request, reply with the landing page, and return the
/// `code` query parameter. Kept Tauri-free so it is unit-testable.
pub fn handle_connection(mut stream: TcpStream) -> Option<String> {
    let request_line = {
        let mut reader = BufReader::new(&stream);
        let mut line = String::new();
        reader.read_line(&mut line).ok()?;
        line
    };
    let response = format!(
        "HTTP/1.1 200 OK\r\nContent-Type: text/html; charset=utf-8\r\n\
         Content-Length: {}\r\nConnection: close\r\n\r\n{}",
        DONE_PAGE.len(),
        DONE_PAGE,
    );
    let _ = stream.write_all(response.as_bytes());
    let _ = stream.flush();
    query_param(&request_line, "code")
}

/// Pull a query parameter out of an HTTP request line such as
/// `GET /callback?code=abc&state=xyz HTTP/1.1`.
pub fn query_param(request_line: &str, key: &str) -> Option<String> {
    let path = request_line.split_whitespace().nth(1)?;
    let query = path.split_once('?')?.1;
    for pair in query.split('&') {
        if let Some((k, v)) = pair.split_once('=') {
            if k == key {
                return Some(percent_decode(v));
            }
        }
    }
    None
}

/// Minimal percent-decoding for query values (`%XX` and `+` → space).
fn percent_decode(value: &str) -> String {
    let bytes = value.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        match bytes[i] {
            b'%' if i + 2 < bytes.len() => {
                let hi = (bytes[i + 1] as char).to_digit(16);
                let lo = (bytes[i + 2] as char).to_digit(16);
                if let (Some(hi), Some(lo)) = (hi, lo) {
                    out.push((hi * 16 + lo) as u8);
                    i += 3;
                    continue;
                }
                out.push(bytes[i]);
                i += 1;
            }
            b'+' => {
                out.push(b' ');
                i += 1;
            }
            b => {
                out.push(b);
                i += 1;
            }
        }
    }
    String::from_utf8_lossy(&out).into_owned()
}

/// Open a URL in the user's default browser (for the login redirect).
#[tauri::command]
pub fn open_external(url: String) -> Result<(), String> {
    open_url(&url).map_err(|e| e.to_string())
}

/// Open Grok in Chrome and capture only the `sso` session cookie from an
/// already signed-in grok.com tab. The value is returned to the frontend so it
/// can be stored in the App Vault through the normal credential path.
#[tauri::command]
pub fn capture_grok_sso_cookie() -> Result<String, String> {
    capture_grok_sso_cookie_impl()
}

#[cfg(target_os = "macos")]
fn capture_grok_sso_cookie_impl() -> Result<String, String> {
    let _ = open_url("https://grok.com");
    let deadline = Instant::now() + Duration::from_secs(90);
    while Instant::now() < deadline {
        if let Some(cookie) = read_grok_sso_from_chrome_cookie_store()? {
            return Ok(cookie);
        }
        std::thread::sleep(Duration::from_secs(2));
    }
    Err("No grok.com sso cookie found. Sign in to Grok in Chrome, then try again.".to_string())
}

#[cfg(not(target_os = "macos"))]
fn capture_grok_sso_cookie_impl() -> Result<String, String> {
    let _ = open_url("https://grok.com");
    Err("Automatic Grok cookie capture is currently available on macOS Chrome only.".to_string())
}

#[cfg(target_os = "macos")]
fn read_grok_sso_from_chrome_cookie_store() -> Result<Option<String>, String> {
    let chrome_root = chrome_profiles_root()?;
    if !chrome_root.exists() {
        return Ok(None);
    }
    let key = chrome_cookie_key()?;
    for profile in chrome_profile_dirs(&chrome_root)? {
        if let Some(cookie) = read_grok_cookie_from_profile(&profile, &key)? {
            return Ok(Some(cookie));
        }
    }
    Ok(None)
}

#[cfg(target_os = "macos")]
fn chrome_profiles_root() -> Result<PathBuf, String> {
    let home = std::env::var("HOME").map_err(|error| error.to_string())?;
    Ok(PathBuf::from(home).join("Library/Application Support/Google/Chrome"))
}

#[cfg(target_os = "macos")]
fn chrome_profile_dirs(root: &Path) -> Result<Vec<PathBuf>, String> {
    let mut dirs = Vec::new();
    for entry in fs::read_dir(root).map_err(|error| error.to_string())? {
        let entry = entry.map_err(|error| error.to_string())?;
        let path = entry.path();
        if !path.is_dir() {
            continue;
        }
        let Some(name) = path.file_name().and_then(|value| value.to_str()) else {
            continue;
        };
        if name == "Default" || name.starts_with("Profile ") {
            dirs.push(path);
        }
    }
    dirs.sort();
    Ok(dirs)
}

#[cfg(target_os = "macos")]
fn chrome_cookie_key() -> Result<Vec<u8>, String> {
    let password = chrome_safe_storage_password()?;
    Ok(pbkdf2_hmac_sha1(password.trim().as_bytes(), b"saltysalt", 1003, 16))
}

#[cfg(target_os = "macos")]
fn chrome_safe_storage_password() -> Result<String, String> {
    let attempts: &[&[&str]] = &[
        &["find-generic-password", "-w", "-s", "Chrome Safe Storage"],
        &["find-generic-password", "-w", "-s", "Chrome", "-a", "Chrome"],
        &["find-generic-password", "-w", "-s", "Google Chrome Safe Storage"],
    ];
    for args in attempts {
        let output = std::process::Command::new("security")
            .args(*args)
            .output()
            .map_err(|error| error.to_string())?;
        if output.status.success() {
            let secret = String::from_utf8_lossy(&output.stdout).trim().to_string();
            if !secret.is_empty() {
                return Ok(secret);
            }
        }
    }
    Err("Could not read Chrome Safe Storage from macOS Keychain.".to_string())
}

#[cfg(target_os = "macos")]
fn pbkdf2_hmac_sha1(password: &[u8], salt: &[u8], iterations: u32, output_len: usize) -> Vec<u8> {
    let mut out = vec![0u8; output_len];
    let mut block_index = 1u32;
    let mut offset = 0usize;
    while offset < output_len {
        let mut mac = <HmacSha1 as Mac>::new_from_slice(password).expect("HMAC can take key of any size");
        mac.update(salt);
        mac.update(&block_index.to_be_bytes());
        let mut u = mac.finalize().into_bytes().to_vec();
        let mut t = u.clone();
        for _ in 1..iterations {
            let mut mac = <HmacSha1 as Mac>::new_from_slice(password).expect("HMAC can take key of any size");
            mac.update(&u);
            u = mac.finalize().into_bytes().to_vec();
            for (left, right) in t.iter_mut().zip(u.iter()) {
                *left ^= right;
            }
        }
        let copy_len = usize::min(t.len(), output_len - offset);
        out[offset..offset + copy_len].copy_from_slice(&t[..copy_len]);
        offset += copy_len;
        block_index += 1;
    }
    out
}

#[cfg(target_os = "macos")]
fn read_grok_cookie_from_profile(profile_dir: &Path, key: &[u8]) -> Result<Option<String>, String> {
    let cookie_db = profile_dir.join("Cookies");
    if !cookie_db.exists() {
        return Ok(None);
    }
    let copy_path = temp_cookie_copy_path()?;
    fs::copy(&cookie_db, &copy_path).map_err(|error| error.to_string())?;
    let result = read_grok_cookie_from_db(&copy_path, key);
    let _ = fs::remove_file(&copy_path);
    result
}

#[cfg(target_os = "macos")]
fn temp_cookie_copy_path() -> Result<PathBuf, String> {
    let mut random = [0u8; 8];
    OsRng.fill_bytes(&mut random);
    let suffix = hex_encode(&random);
    let path = std::env::temp_dir().join(format!("vassistant-chrome-cookies-{suffix}.sqlite"));
    OpenOptions::new()
        .create_new(true)
        .write(true)
        .open(&path)
        .map_err(|error| error.to_string())?;
    Ok(path)
}

#[cfg(target_os = "macos")]
fn read_grok_cookie_from_db(db_path: &Path, key: &[u8]) -> Result<Option<String>, String> {
    let conn = Connection::open(db_path).map_err(|error| error.to_string())?;
    let mut stmt = conn
        .prepare(
            "SELECT host_key, value, encrypted_value
             FROM cookies
             WHERE name = 'sso' AND host_key LIKE '%grok.com'
             ORDER BY expires_utc DESC",
        )
        .map_err(|error| error.to_string())?;
    let rows = stmt
        .query_map([], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, Vec<u8>>(2)?,
            ))
        })
        .map_err(|error| error.to_string())?;
    for row in rows {
        let (host_key, value, encrypted_value) = row.map_err(|error| error.to_string())?;
        if !value.trim().is_empty() {
            return Ok(Some(value));
        }
        if let Some(cookie) = decrypt_chrome_cookie_value(&host_key, &encrypted_value, key)? {
            return Ok(Some(cookie));
        }
    }
    Ok(None)
}

#[cfg(target_os = "macos")]
fn decrypt_chrome_cookie_value(host_key: &str, encrypted_value: &[u8], key: &[u8]) -> Result<Option<String>, String> {
    if encrypted_value.is_empty() {
        return Ok(None);
    }
    let ciphertext = if encrypted_value.starts_with(b"v10") || encrypted_value.starts_with(b"v11") {
        &encrypted_value[3..]
    } else {
        encrypted_value
    };
    let iv = [b' '; 16];
    let mut buffer = ciphertext.to_vec();
    let plaintext = Aes128CbcDec::new_from_slices(key, &iv)
        .map_err(|error| error.to_string())?
        .decrypt_padded_mut::<Pkcs7>(&mut buffer)
        .map_err(|_| "Failed to decrypt Chrome cookie.".to_string())?;
    if let Ok(text) = std::str::from_utf8(plaintext) {
        return Ok(Some(text.to_string()));
    }
    if plaintext.len() > 32 {
        let host_hash = Sha256::digest(host_key.as_bytes());
        if plaintext.starts_with(host_hash.as_slice()) {
            if let Ok(text) = std::str::from_utf8(&plaintext[32..]) {
                return Ok(Some(text.to_string()));
            }
        }
    }
    Ok(None)
}

fn hex_encode(bytes: &[u8]) -> String {
    const HEX: &[u8; 16] = b"0123456789abcdef";
    let mut out = String::with_capacity(bytes.len() * 2);
    for byte in bytes {
        out.push(HEX[(byte >> 4) as usize] as char);
        out.push(HEX[(byte & 0x0f) as usize] as char);
    }
    out
}

#[cfg(target_os = "linux")]
fn open_url(url: &str) -> std::io::Result<()> {
    std::process::Command::new("xdg-open").arg(url).spawn().map(|_| ())
}
#[cfg(target_os = "macos")]
fn open_url(url: &str) -> std::io::Result<()> {
    std::process::Command::new("open").arg(url).spawn().map(|_| ())
}
#[cfg(target_os = "windows")]
fn open_url(url: &str) -> std::io::Result<()> {
    std::process::Command::new("cmd")
        .args(["/C", "start", "", url])
        .spawn()
        .map(|_| ())
}
