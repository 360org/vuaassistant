//! Kiểm phần chuyển dữ liệu khi app đổi `identifier`.
//!
//! Đây là mã đụng vào dữ liệu thật của người dùng — Vault, lịch sử chat, tri
//! thức đã nạp — nên mỗi khẳng định đều đo trên thư mục thật, và mỗi luật an
//! toàn đều có một phép ĐẢO NGƯỢC dựng lại đúng cảnh mà luật đó phải chặn.

use std::fs;
use std::path::{Path, PathBuf};
use vuaassistant_lib::migrate::{legacy_runtime_dir, migrate_data_dir, Outcome};

fn write(path: &Path, content: &str) {
    fs::create_dir_all(path.parent().unwrap()).unwrap();
    fs::write(path, content).unwrap();
}

/// Dựng lại đúng bố cục thật: <gốc>/<identifier>/runtime
fn layout(root: &Path) -> (PathBuf, PathBuf) {
    let new_dir = root.join("com.vuaai.vuaassistant").join("runtime");
    let old_dir = root.join("com.vuaai.assistant").join("runtime");
    (new_dir, old_dir)
}

fn temp(name: &str) -> PathBuf {
    let dir = std::env::temp_dir().join(format!("vua-migrate-{name}-{}", std::process::id()));
    let _ = fs::remove_dir_all(&dir);
    fs::create_dir_all(&dir).unwrap();
    dir
}

fn main() {
    let mut pass = true;
    let mut check = |name: &str, cond: bool| {
        println!("{} {name}", if cond { "✓" } else { "✗" });
        if !cond {
            pass = false;
        }
    };

    // --- 1. Suy ra thư mục cũ đúng chỗ -------------------------------------
    {
        let root = temp("path");
        let (new_dir, old_dir) = layout(&root);
        check(
            "suy ra đúng thư mục runtime của bản cũ",
            legacy_runtime_dir(&new_dir).as_deref() == Some(old_dir.as_path()),
        );
    }

    // --- 2. Có dữ liệu cũ, bên mới trống ⇒ chuyển --------------------------
    {
        let root = temp("copy");
        let (new_dir, old_dir) = layout(&root);
        write(&old_dir.join("vault.db"), "KHOA-API-THAT");
        write(&old_dir.join("ipc/inbound.db"), "lich-su-chat");
        write(&old_dir.join("agents/default/soul.md"), "tinh cach");
        fs::create_dir_all(&new_dir).unwrap();

        let outcome = migrate_data_dir(&new_dir).unwrap();
        check(
            "có dữ liệu cũ, bên mới trống ⇒ chuyển sang",
            matches!(outcome, Outcome::Migrated(n) if n == 3),
        );
        check(
            "Vault theo sang, nội dung nguyên vẹn",
            fs::read_to_string(new_dir.join("vault.db")).unwrap() == "KHOA-API-THAT",
        );
        check(
            "thư mục con lồng nhau cũng theo sang",
            new_dir.join("ipc/inbound.db").exists() && new_dir.join("agents/default/soul.md").exists(),
        );
        // COPY chứ không MOVE: hỏng giữa chừng thì bản gốc vẫn còn để thử lại.
        check(
            "bản cũ CÒN NGUYÊN sau khi chuyển (copy, không move)",
            old_dir.join("vault.db").exists() && old_dir.join("ipc/inbound.db").exists(),
        );

        // Lần mở sau không được chuyển lại.
        let again = migrate_data_dir(&new_dir).unwrap();
        check("lần mở sau ⇒ biết là đã chuyển rồi", again == Outcome::AlreadyDone);
    }

    // --- 3. Bên mới đã có dữ liệu thật ⇒ TUYỆT ĐỐI không đè ----------------
    // Người dùng đã lỡ dùng bản mới và tạo khoá mới thì dữ liệu đó là thật; đè
    // lên bằng dữ liệu cũ còn tệ hơn cả không chuyển.
    {
        let root = temp("noclobber");
        let (new_dir, old_dir) = layout(&root);
        write(&old_dir.join("vault.db"), "KHOA-CU");
        write(&new_dir.join("vault.db"), "KHOA-MOI-NGUOI-DUNG-VUA-TAO");

        let outcome = migrate_data_dir(&new_dir).unwrap();
        check("bên mới đã có Vault ⇒ không đụng vào", outcome == Outcome::NewDataPresent);
        check(
            "ĐẢO NGƯỢC: Vault mới KHÔNG bị dữ liệu cũ đè lên",
            fs::read_to_string(new_dir.join("vault.db")).unwrap() == "KHOA-MOI-NGUOI-DUNG-VUA-TAO",
        );
    }

    // --- 4. Không ghi đè ở mức TỪNG TỆP ------------------------------------
    // Luật "không đè" phải đúng ở từng tệp, không chỉ ở mức thư mục.
    {
        let root = temp("perfile");
        let (new_dir, old_dir) = layout(&root);
        write(&old_dir.join("vault.db"), "KHOA-CU");
        write(&old_dir.join("runner.json"), "cau-hinh-cu");
        // Bên mới chưa có vault.db (nên vẫn chuyển), nhưng đã có runner.json.
        write(&new_dir.join("runner.json"), "cau-hinh-moi");

        let outcome = migrate_data_dir(&new_dir).unwrap();
        check(
            "vẫn chuyển vì bên mới chưa có Vault",
            matches!(outcome, Outcome::Migrated(_)),
        );
        check(
            "tệp đã có sẵn bên mới KHÔNG bị đè",
            fs::read_to_string(new_dir.join("runner.json")).unwrap() == "cau-hinh-moi",
        );
        check(
            "tệp chưa có thì vẫn được mang sang",
            fs::read_to_string(new_dir.join("vault.db")).unwrap() == "KHOA-CU",
        );
    }

    // --- 5. Cài mới hoàn toàn ⇒ không có gì để làm -------------------------
    {
        let root = temp("fresh");
        let (new_dir, _) = layout(&root);
        fs::create_dir_all(&new_dir).unwrap();
        check(
            "cài mới, không có bản cũ ⇒ không có gì để chuyển",
            migrate_data_dir(&new_dir).unwrap() == Outcome::NothingToDo,
        );
        check(
            "không tự ý tạo cờ khi chẳng chuyển gì",
            !new_dir.join("migrated-from.json").exists(),
        );
    }

    // --- 6. Bản cũ có thư mục nhưng chưa từng chạy ⇒ bỏ qua ----------------
    {
        let root = temp("emptyold");
        let (new_dir, old_dir) = layout(&root);
        fs::create_dir_all(&old_dir).unwrap();
        fs::create_dir_all(&new_dir).unwrap();
        check(
            "bản cũ có thư mục nhưng không có Vault ⇒ bỏ qua",
            migrate_data_dir(&new_dir).unwrap() == Outcome::NothingToDo,
        );
    }

    println!();
    println!(
        "{}",
        if pass {
            "✓ chuyển dữ liệu: copy chứ không move, và không bao giờ đè lên dữ liệu đang có"
        } else {
            "✗ FAILED"
        }
    );
    std::process::exit(if pass { 0 } else { 1 });
}
