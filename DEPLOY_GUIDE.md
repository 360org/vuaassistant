# DEPLOYMENT GUIDE: Hướng dẫn Đóng gói & Triển khai Đa nền tảng (Zero-Docker)

Tài liệu này hướng dẫn cách đóng gói ứng dụng VuaAssistant kèm theo động cơ Agentic nhúng NanoClaw (chế độ Host Process) hỗ trợ đầy đủ các hệ điều hành: macOS, Windows và Linux.

---

## 1. Chuẩn bị Tài nguyên đóng gói (Embedded Assets)

Tauri App sẽ đóng gói toàn bộ thư mục `NanoClaw` (trong đó chứa Agent Runner và các file thực thi Bun) vào trong tài nguyên cài đặt (`resources`) của ứng dụng để đảm bảo cài đặt một bước chạy ngay.

### Cấu hình `tauri.conf.json`
Thêm thư mục NanoClaw vào danh sách tài nguyên bundle:
```json
{
  "bundle": {
    "resources": [
      "../NanoClaw/**/*"
    ]
  }
}
```

---

## 2. Quản lý Quy trình Khởi chạy trong Rust (`runtime.rs`)

Khi đóng gói phiên bản Release (Production), Tauri tự động định vị tài nguyên cài đặt và khởi chạy daemon nền:
```rust
// Định vị thư mục tài nguyên nhúng
let resource_dir = app_handle.path().resource_dir()?;
let engine_dir = resource_dir.join("NanoClaw");

// Khởi chạy tiến trình Bun/Node trực tiếp trên máy host
Command::new("node")
    .arg(engine_dir.join("dist/index.js"))
    .env("CONTAINER_RUNTIME_BIN", "process") // Chạy ở chế độ Host Process
    .env("VUA_RUNTIME_DIR", &runtime_dir)
    .spawn()?;
```

---

## 3. Quy trình Biên dịch cho từng Hệ điều hành (Build Commands)

### 3.1. Biên dịch trên macOS (DMG / APP)
Yêu cầu: Xcode Command Line Tools.
```bash
# Cài đặt các thư viện cần thiết
npm install
# Build ứng dụng tauri
npm run tauri build
```
*Kết quả:* File bộ cài `.dmg` và ứng dụng `.app` nằm tại thư mục `src-tauri/target/release/bundle/dmg/`.

---

## 4. Code Signing & Notarization (Ký & Chứng thực ứng dụng trên macOS)

Để tránh cảnh báo **"VuaAssistant cannot be opened because it is from an unidentified developer"** trên macOS, ứng dụng cần phải được ký bằng chứng chỉ Apple Developer và gửi lên Apple Notarization Service để xác thực trước khi phân phối.

### 4.1. Cách build & ký ứng dụng dưới máy Local
Nếu bạn tự đóng gói trực tiếp trên máy Mac của mình và đã có tài khoản Apple Developer:

1. **Chuẩn bị chứng chỉ:**
   * Truy cập [Apple Developer Connection](https://developer.apple.com) ➔ Certificates, Identifiers & Profiles.
   * Tạo và tải xuống chứng chỉ **Developer ID Application**.
   * Double-click vào tệp `.cer` đã tải về để cài đặt chứng chỉ này vào ứng dụng **Keychain Access (Móc khóa)** trên máy Mac của bạn.

2. **Tạo App-Specific Password:**
   * Truy cập [appleid.apple.com](https://appleid.apple.com) đăng nhập tài khoản Apple ID của bạn.
   * Tại mục bảo mật, tạo một mật khẩu ứng dụng riêng (App-Specific Password) dành cho tauri (ví dụ: `abcd-efgh-ijkl-mnop`).

3. **Cấu hình biến môi trường trước khi Build:**
   Chạy các lệnh xuất biến môi trường trong Terminal trước khi build ứng dụng (hoặc lưu vào file `.zshrc`/`.bash_profile` của bạn):
   ```bash
   # Email Apple ID của bạn
   export APPLE_ID="chaulb@icloud.com"
   # Mật khẩu ứng dụng (App-Specific Password) vừa tạo
   export APPLE_PASSWORD="abcd-efgh-ijkl-mnop"
   # Mã Team ID Apple Developer (chuỗi 10 ký tự, ví dụ: ABCDE12345)
   export APPLE_TEAM_ID="YOUR_TEAM_ID"
   ```

4. **Chạy Build:**
   ```bash
   npm run tauri build
   ```
   Tauri sẽ tự động tìm chứng chỉ `Developer ID Application` trong Keychain của bạn để ký mã nguồn, đóng gói DMG và tự động gọi công cụ `notarytool` của Apple để chứng thực tệp đóng gói trực tuyến.

---

### 4.2. Cấu hình ký tự động qua GitHub Actions (CI/CD)
Để quy trình đóng gói tự động trên GitHub Actions có thể ký và chứng thực ứng dụng khi release:

1. **Chuẩn bị các thông tin cần thiết:**
   * **Chứng chỉ P12:** Xuất chứng chỉ `Developer ID Application` kèm khóa bí mật từ Keychain Access thành tệp `.p12`.
   * Mã hóa tệp `.p12` này thành chuỗi Base64 bằng lệnh:
     ```bash
     base64 -i certificate.p12 -o certificate.txt
     ```
     Copy toàn bộ nội dung tệp `certificate.txt`.

2. **Cấu hình GitHub Repository Secrets:**
   Vào Settings của repository GitHub của bạn ➔ Secrets and variables ➔ Actions, bấm **New repository secret** để thêm các khóa sau:
   * `APPLE_CERTIFICATE`: Chuỗi Base64 của tệp chứng chỉ `.p12` vừa tạo.
   * `APPLE_CERTIFICATE_PASSWORD`: Mật khẩu bảo vệ của tệp `.p12` khi xuất.
   * `APPLE_ID`: Email Apple ID của bạn (ví dụ: `chaulb@icloud.com`).
   * `APPLE_PASSWORD`: Mật khẩu ứng dụng (App-Specific Password) của Apple ID.
   * `APPLE_TEAM_ID`: Mã Apple Team ID của bạn.

Sau khi cấu hình đầy đủ các secrets trên, mỗi khi sếp push thẻ phiên bản mới (`v*`), hệ thống CI/CD sẽ tự động tải chứng chỉ, ký ứng dụng và chứng thực hoàn tất với Apple. Bộ cài tải từ trang Release về sẽ không bao giờ bị hiện cảnh báo bảo mật nữa.

### 3.2. Biên dịch trên Windows (MSI / EXE)
Yêu cầu: WiX Toolset v3.
```bash
npm run tauri build
```
*Kết quả:* Bộ cài đặt Windows Installer `.msi` nằm tại thư mục `src-tauri/target/release/bundle/msi/`.

### 3.3. Biên dịch trên Linux (DEB / AppImage)
```bash
npm run tauri build
```
*Kết quả:* Gói cài đặt `.deb` nằm tại thư mục `src-tauri/target/release/bundle/deb/`.
