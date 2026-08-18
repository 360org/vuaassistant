//! Chuyển dữ liệu người dùng sang thư mục mới khi app đổi `identifier`.
//!
//! v1.1.59 đổi identifier từ `com.vuaai.assistant` sang `com.vuaai.vuaassistant`.
//! Tauri đặt thư mục dữ liệu theo đúng identifier, nên từ bản đó app đọc và ghi
//! ở một chỗ hoàn toàn mới: người đang dùng bản cũ nâng cấp lên sẽ mở app thấy
//! trắng trơn — mất Vault (toàn bộ khoá API), mất kết nối nhà cung cấp, mất lịch
//! sử chat, mất tác vụ hẹn giờ, mất tri thức đã nạp.
//!
//! `vault::migrate_legacy_vault` KHÔNG cứu được chuyện này: nó nâng cấp định
//! dạng mã hoá *bên trong* một thư mục, không chuyển giữa hai thư mục.
//!
//! Ba nguyên tắc, đều nghiêng về phía an toàn cho dữ liệu người dùng:
//!
//!   1. **Copy, không move.** Copy hỏng giữa chừng thì bản gốc vẫn còn nguyên để
//!      thử lại. Move hỏng giữa chừng là mất bản duy nhất.
//!   2. **Không bao giờ ghi đè.** Chỉ chuyển khi thư mục mới CHƯA có `vault.db`.
//!      Người dùng đã lỡ dùng bản mới và tạo khoá mới thì dữ liệu đó là thật, và
//!      đè lên bằng dữ liệu cũ còn tệ hơn cả không chuyển.
//!   3. **Chuyển đúng một lần.** Ghi cờ `migrated-from.json` để lần mở sau biết
//!      là đã xong, kể cả khi người dùng tự xoá bớt tệp trong thư mục mới.

use std::fs;
use std::path::{Path, PathBuf};

/// Identifier của các bản từ v1.1.58 trở về trước. Đây là dữ kiện lịch sử, cố
/// định — không phải thứ để cấu hình.
const LEGACY_IDENTIFIER: &str = "com.vuaai.assistant";

/// Tên tệp cờ đánh dấu đã chuyển xong, đặt trong thư mục runtime mới.
const MARKER: &str = "migrated-from.json";

/// Kết quả của một lần thử chuyển.
#[derive(Debug, PartialEq, Eq)]
pub enum Outcome {
    /// Đã chuyển, kèm số tệp đã copy.
    Migrated(usize),
    /// Không có gì để chuyển (cài mới, hoặc bản cũ chưa từng chạy).
    NothingToDo,
    /// Đã chuyển ở lần mở trước rồi.
    AlreadyDone,
    /// Thư mục mới đã có dữ liệu thật — không đụng vào.
    NewDataPresent,
}

/// Thư mục runtime của bản cũ, suy ra từ thư mục runtime mới.
///
/// Cả hai đều nằm cạnh nhau dưới cùng một thư mục cha do hệ điều hành quy định
/// (`~/Library/Application Support` trên macOS, `%APPDATA%` trên Windows,
/// `$XDG_DATA_HOME` trên Linux), chỉ khác đúng đoạn identifier.
pub fn legacy_runtime_dir(new_runtime_dir: &Path) -> Option<PathBuf> {
    let identifier_dir = new_runtime_dir.parent()?;
    let parent = identifier_dir.parent()?;
    Some(parent.join(LEGACY_IDENTIFIER).join("runtime"))
}

/// Chuyển dữ liệu nếu cần. Trả về việc đã thật sự làm, để chỗ gọi ghi log đúng.
pub fn migrate_data_dir(new_runtime_dir: &Path) -> Result<Outcome, String> {
    if new_runtime_dir.join(MARKER).exists() {
        return Ok(Outcome::AlreadyDone);
    }

    // Vault là thứ đắt nhất và không dựng lại được, nên lấy nó làm dấu hiệu
    // "thư mục này đã có dữ liệu thật".
    if new_runtime_dir.join("vault.db").exists() {
        return Ok(Outcome::NewDataPresent);
    }

    let Some(legacy) = legacy_runtime_dir(new_runtime_dir) else {
        return Ok(Outcome::NothingToDo);
    };
    if !legacy.join("vault.db").exists() {
        return Ok(Outcome::NothingToDo);
    }

    let copied = copy_tree(&legacy, new_runtime_dir)?;

    // Ghi cờ SAU khi copy xong. Ghi trước mà copy hỏng thì lần mở sau tưởng đã
    // xong và bỏ qua luôn — người dùng mất dữ liệu mà không ai biết vì sao.
    let marker = serde_json::json!({
        "from": legacy.to_string_lossy(),
        "files": copied,
        "at": std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_secs())
            .unwrap_or(0),
    });
    fs::write(
        new_runtime_dir.join(MARKER),
        serde_json::to_string_pretty(&marker).map_err(|e| e.to_string())?,
    )
    .map_err(|e| format!("ghi cờ đã chuyển thất bại: {e}"))?;

    Ok(Outcome::Migrated(copied))
}

/// Copy đệ quy, trả về số tệp đã copy.
///
/// Bỏ qua tệp đã tồn tại ở đích thay vì đè: nguyên tắc "không bao giờ ghi đè"
/// phải đúng ở từng tệp, không chỉ ở mức thư mục.
fn copy_tree(from: &Path, to: &Path) -> Result<usize, String> {
    fs::create_dir_all(to).map_err(|e| format!("tạo {} thất bại: {e}", to.display()))?;
    let mut count = 0;
    let entries = fs::read_dir(from).map_err(|e| format!("đọc {} thất bại: {e}", from.display()))?;
    for entry in entries {
        let entry = entry.map_err(|e| e.to_string())?;
        let source = entry.path();
        let target = to.join(entry.file_name());
        let kind = entry.file_type().map_err(|e| e.to_string())?;
        if kind.is_dir() {
            count += copy_tree(&source, &target)?;
        } else if kind.is_file() {
            if target.exists() {
                continue;
            }
            fs::copy(&source, &target)
                .map_err(|e| format!("copy {} thất bại: {e}", source.display()))?;
            count += 1;
        }
        // Symlink cố ý bỏ qua: thư mục dữ liệu không nên có, và đi theo nó có
        // thể copy ra ngoài phạm vi mong muốn.
    }
    Ok(count)
}
