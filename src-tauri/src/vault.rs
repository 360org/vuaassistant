//! VuaAssistant application Vault.
//!
//! Secrets live in the app's own SQLite database, encrypted with AES-256-CBC
//! and authenticated with HMAC-SHA256. The master key is generated locally in
//! app data with owner-only permissions. AI Router can resolve a credentialRef
//! through a capability-protected loopback broker; Agent Runner never receives
//! raw credentials.

use aes::Aes256;
use cbc::cipher::{block_padding::Pkcs7, BlockDecryptMut, BlockEncryptMut, KeyIvInit};
use hmac::{Hmac, Mac};
use rand::{rngs::OsRng, RngCore};
use rusqlite::Connection;
use serde_json::json;
use sha2::Sha256;
use std::fs::OpenOptions;
use std::io::{Read, Write};
use std::net::{TcpListener, TcpStream};
use std::path::{Path, PathBuf};
use std::thread;
use std::time::Duration;
use tauri::State;

type Aes256CbcEnc = cbc::Encryptor<Aes256>;
type Aes256CbcDec = cbc::Decryptor<Aes256>;
type HmacSha256 = Hmac<Sha256>;
const FORMAT: &str = "v2";

#[derive(Clone)]
pub struct VaultBroker {
    pub url: String,
    pub token: String,
    pub connector_token: String,
}

fn get_conn(runtime_dir: &Path) -> Result<Connection, String> {
    let conn = Connection::open(runtime_dir.join("vault.db")).map_err(|error| error.to_string())?;
    conn.execute(
        "CREATE TABLE IF NOT EXISTS secrets (key TEXT PRIMARY KEY, value TEXT NOT NULL)",
        [],
    )
    .map_err(|error| error.to_string())?;
    Ok(conn)
}

fn load_master_key(runtime_dir: &Path) -> Result<Vec<u8>, String> {
    let path = runtime_dir.join("vault.key");
    if path.exists() {
        let key = std::fs::read(&path).map_err(|error| error.to_string())?;
        if key.len() == 64 {
            return Ok(key);
        }
        return Err("VuaAssistant Vault master key is invalid".to_string());
    }
    std::fs::create_dir_all(runtime_dir).map_err(|error| error.to_string())?;
    let mut key = vec![0u8; 64];
    OsRng.fill_bytes(&mut key);
    let mut options = OpenOptions::new();
    options.create_new(true).write(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    options
        .open(&path)
        .and_then(|mut file| file.write_all(&key))
        .map_err(|error| error.to_string())?;
    Ok(key)
}

fn encrypt(runtime_dir: &Path, plaintext: &str) -> Result<String, String> {
    let key = load_master_key(runtime_dir)?;
    let mut iv = [0u8; 16];
    OsRng.fill_bytes(&mut iv);
    let mut buffer = vec![0u8; plaintext.len() + 16];
    buffer[..plaintext.len()].copy_from_slice(plaintext.as_bytes());
    let ciphertext = Aes256CbcEnc::new_from_slices(&key[..32], &iv)
        .map_err(|error| error.to_string())?
        .encrypt_padded_mut::<Pkcs7>(&mut buffer, plaintext.len())
        .map_err(|error| error.to_string())?
        .to_vec();
    let mut mac = <HmacSha256 as Mac>::new_from_slice(&key[32..]).map_err(|error| error.to_string())?;
    mac.update(&iv);
    mac.update(&ciphertext);
    let tag = mac.finalize().into_bytes();
    Ok(format!("{FORMAT}:{}:{}:{}", hex_encode(&iv), hex_encode(&ciphertext), hex_encode(&tag)))
}

fn decrypt(runtime_dir: &Path, encoded: &str) -> Result<String, String> {
    if !encoded.starts_with("v2:") {
        return decrypt_legacy(encoded);
    }
    let mut parts = encoded.split(':');
    let _ = parts.next();
    let iv = hex_decode(parts.next().ok_or("Vault IV is missing")?)?;
    let mut ciphertext = hex_decode(parts.next().ok_or("Vault ciphertext is missing")?)?;
    let tag = hex_decode(parts.next().ok_or("Vault authentication tag is missing")?)?;
    let key = load_master_key(runtime_dir)?;
    let mut mac = <HmacSha256 as Mac>::new_from_slice(&key[32..]).map_err(|error| error.to_string())?;
    mac.update(&iv);
    mac.update(&ciphertext);
    mac.verify_slice(&tag).map_err(|_| "Vault authentication failed".to_string())?;
    let plaintext = Aes256CbcDec::new_from_slices(&key[..32], &iv)
        .map_err(|error| error.to_string())?
        .decrypt_padded_mut::<Pkcs7>(&mut ciphertext)
        .map_err(|_| "Vault decryption failed".to_string())?;
    String::from_utf8(plaintext.to_vec()).map_err(|error| error.to_string())
}

fn set_secret(runtime_dir: &Path, key: &str, value: &str) -> Result<(), String> {
    let conn = get_conn(runtime_dir)?;
    let encrypted = encrypt(runtime_dir, value)?;
    conn.execute(
        "INSERT OR REPLACE INTO secrets (key, value) VALUES (?1, ?2)",
        (key, encrypted),
    )
    .map_err(|error| error.to_string())?;
    Ok(())
}

fn get_secret(runtime_dir: &Path, key: &str) -> Result<Option<String>, String> {
    let conn = get_conn(runtime_dir)?;
    let mut stmt = conn
        .prepare("SELECT value FROM secrets WHERE key = ?1")
        .map_err(|error| error.to_string())?;
    let mut rows = stmt.query([key]).map_err(|error| error.to_string())?;
    let Some(row) = rows.next().map_err(|error| error.to_string())? else {
        return Ok(None);
    };
    let encoded: String = row.get(0).map_err(|error| error.to_string())?;
    let value = decrypt(runtime_dir, &encoded)?;
    if !encoded.starts_with("v2:") {
        drop(rows);
        drop(stmt);
        set_secret(runtime_dir, key, &value)?;
    }
    Ok(Some(value))
}

fn delete_secret(runtime_dir: &Path, key: &str) -> Result<(), String> {
    let conn = get_conn(runtime_dir)?;
    conn.execute("DELETE FROM secrets WHERE key = ?1", [key])
        .map_err(|error| error.to_string())?;
    Ok(())
}

#[tauri::command]
pub async fn vault_set(state: State<'_, crate::runtime::Runtime>, key: String, value: String) -> Result<(), String> {
    set_secret(&state.dir, &key, &value)
}

#[tauri::command]
pub async fn vault_get(state: State<'_, crate::runtime::Runtime>, key: String) -> Result<Option<String>, String> {
    get_secret(&state.dir, &key)
}

#[tauri::command]
pub async fn vault_delete(state: State<'_, crate::runtime::Runtime>, key: String) -> Result<(), String> {
    delete_secret(&state.dir, &key)
}

pub fn migrate_legacy_vault(runtime_dir: &Path) -> Result<(), String> {
    if !runtime_dir.join("vault.db").exists() {
        return Ok(());
    }
    let conn = get_conn(runtime_dir)?;
    let mut stmt = conn.prepare("SELECT key, value FROM secrets").map_err(|error| error.to_string())?;
    let rows = stmt
        .query_map([], |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?)))
        .map_err(|error| error.to_string())?;
    let legacy = rows
        .filter_map(Result::ok)
        .filter(|(_, value)| !value.starts_with("v2:"))
        .collect::<Vec<_>>();
    drop(stmt);
    for (key, value) in legacy {
        set_secret(runtime_dir, &key, &decrypt_legacy(&value)?)?;
    }
    Ok(())
}

pub fn start_broker(runtime_dir: PathBuf) -> Result<VaultBroker, String> {
    let listener = TcpListener::bind("127.0.0.1:0").map_err(|error| error.to_string())?;
    let address = listener.local_addr().map_err(|error| error.to_string())?;
    let mut random = [0u8; 32];
    OsRng.fill_bytes(&mut random);
    let token = hex_encode(&random);
    OsRng.fill_bytes(&mut random);
    let connector_token = hex_encode(&random);
    let thread_token = token.clone();
    thread::spawn(move || {
        for stream in listener.incoming().flatten() {
            handle_broker_request(stream, &thread_token, &runtime_dir);
        }
    });
    Ok(VaultBroker {
        url: format!("http://{address}/credential"),
        token,
        connector_token,
    })
}

fn handle_broker_request(mut stream: TcpStream, token: &str, runtime_dir: &Path) {
    let _ = stream.set_read_timeout(Some(Duration::from_secs(2)));
    let mut bytes = Vec::new();
    loop {
        let mut buffer = [0u8; 8_192];
        let size = match stream.read(&mut buffer) {
            Ok(size) if size > 0 => size,
            _ => break,
        };
        bytes.extend_from_slice(&buffer[..size]);
        if bytes.len() > 2 * 1024 * 1024 {
            write_response(&mut stream, "413 Payload Too Large", json!({"error": "vault broker payload is too large"}));
            return;
        }
        let Some(header_end) = bytes.windows(4).position(|window| window == b"\r\n\r\n") else {
            continue;
        };
        let headers = String::from_utf8_lossy(&bytes[..header_end]);
        let content_length = headers
            .lines()
            .find_map(|line| {
                let (name, value) = line.split_once(':')?;
                name.eq_ignore_ascii_case("content-length")
                    .then(|| value.trim().to_owned())
            })
            .and_then(|value| value.parse::<usize>().ok())
            .unwrap_or(0);
        if bytes.len() >= header_end + 4 + content_length {
            break;
        }
    }
    if bytes.is_empty() {
        return;
    }
    let request = String::from_utf8_lossy(&bytes);
    let (headers, body) = request.split_once("\r\n\r\n").unwrap_or((request.as_ref(), ""));
    let mut lines = headers.lines();
    let request_line = lines.next().unwrap_or_default();
    let authorized = lines.any(|line| {
        let Some((name, value)) = line.split_once(':') else { return false };
        name.eq_ignore_ascii_case("authorization")
            && value.trim().strip_prefix("Bearer ").is_some_and(|value| value == token)
    });
    if !authorized {
        write_response(&mut stream, "401 Unauthorized", json!({"error": "unauthorized"}));
        return;
    }
    let target = request_line.split_whitespace().nth(1).unwrap_or_default();
    let method = request_line.split_whitespace().next().unwrap_or_default();
    let credential_ref = target.split_once("?ref=").and_then(|(_, value)| percent_decode(value).ok());
    let Some(credential_ref) = credential_ref else {
        write_response(&mut stream, "400 Bad Request", json!({"error": "credential reference required"}));
        return;
    };
    let readable = credential_ref == "vault-index"
        || credential_ref.starts_with("ai-router:")
        || credential_ref.starts_with("vault-entry:");
    let writable = credential_ref.starts_with("ai-router:");
    if (method == "GET" && !readable) || (method != "GET" && !writable) {
        write_response(&mut stream, "403 Forbidden", json!({"error": "reference outside gateway namespace"}));
        return;
    }
    match method {
        "GET" => match get_secret(runtime_dir, &credential_ref) {
            Ok(Some(value)) => write_response(&mut stream, "200 OK", json!({"value": value})),
            Ok(None) => write_response(&mut stream, "404 Not Found", json!({"error": "credential not found"})),
            Err(_) => write_response(&mut stream, "500 Internal Server Error", json!({"error": "vault unavailable"})),
        },
        "PUT" => {
            let value = serde_json::from_str::<serde_json::Value>(body)
                .ok()
                .and_then(|payload| payload.get("value").and_then(|value| value.as_str()).map(str::to_owned));
            match value {
                Some(value) => match set_secret(runtime_dir, &credential_ref, &value) {
                    Ok(()) => write_response(&mut stream, "200 OK", json!({"ok": true})),
                    Err(_) => write_response(&mut stream, "500 Internal Server Error", json!({"error": "vault unavailable"})),
                },
                None => write_response(&mut stream, "400 Bad Request", json!({"error": "string value required"})),
            }
        }
        "DELETE" => match delete_secret(runtime_dir, &credential_ref) {
            Ok(()) => write_response(&mut stream, "200 OK", json!({"ok": true})),
            Err(_) => write_response(&mut stream, "500 Internal Server Error", json!({"error": "vault unavailable"})),
        },
        _ => write_response(&mut stream, "405 Method Not Allowed", json!({"error": "method not allowed"})),
    }
}

fn write_response(stream: &mut TcpStream, status: &str, body: serde_json::Value) {
    let body = body.to_string();
    let response = format!(
        "HTTP/1.1 {status}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
        body.len()
    );
    let _ = stream.write_all(response.as_bytes());
}

fn percent_decode(value: &str) -> Result<String, String> {
    let bytes = value.as_bytes();
    let mut output = Vec::with_capacity(bytes.len());
    let mut index = 0;
    while index < bytes.len() {
        match bytes[index] {
            b'%' if index + 2 < bytes.len() => {
                let hex = std::str::from_utf8(&bytes[index + 1..index + 3]).map_err(|e| e.to_string())?;
                output.push(u8::from_str_radix(hex, 16).map_err(|e| e.to_string())?);
                index += 3;
            }
            b'+' => { output.push(b' '); index += 1; }
            byte => { output.push(byte); index += 1; }
        }
    }
    String::from_utf8(output).map_err(|error| error.to_string())
}

fn decrypt_legacy(input: &str) -> Result<String, String> {
    let legacy_key = b"vuaassistant-secure-vault-salt-key-360org";
    let bytes = hex_decode(input)?;
    let output = bytes
        .iter()
        .enumerate()
        .map(|(index, byte)| byte ^ legacy_key[index % legacy_key.len()])
        .collect::<Vec<_>>();
    String::from_utf8(output).map_err(|error| error.to_string())
}

fn hex_encode(bytes: &[u8]) -> String {
    bytes.iter().map(|byte| format!("{byte:02x}")).collect()
}

fn hex_decode(value: &str) -> Result<Vec<u8>, String> {
    if !value.len().is_multiple_of(2) {
        return Err("Invalid Vault hex value".to_string());
    }
    (0..value.len())
        .step_by(2)
        .map(|index| u8::from_str_radix(&value[index..index + 2], 16).map_err(|error| error.to_string()))
        .collect()
}
