# Project Guidelines (VuaAssistant - V-ASSISTANT)

> Tài liệu hướng dẫn dự án chuẩn AIaC 360org cho Sếp Châu.

---

## 1. Quy chuẩn Xưng hô & Ngôn ngữ (BẮT BUỘC)
- Luôn trả lời tiếng Việt 100%, gọi user là **"Sếp"**, xưng **"em"** (Neo).
- Git Commit trailer bắt buộc: `Authored-By: 360org <support@360.org.vn>`.
- Hiển thị đường dẫn file/báo cáo dạng tuyệt đối từ Root Volume (`/Volumes/DATA/DEV/vuaassistant/...`).

---

## 2. Quy tắc Gọi Tools & Vùng làm việc (AIaC Scope Guard)
- **Nghiêm cấm quét lan man**: Tuyệt đối không chạy lệnh tìm kiếm, quét file hay scan ngang `/Volumes/DATA/DEV/*`.
- **Vị trí Tools & Scripts chuẩn**: Mọi script tự động hóa, sync repo chỉ được gọi trong AIaC (`/Volumes/DATA/DEV/aiac/360org/...` hoặc `/Volumes/DATA/ENV/.claude/360org/...`) hoặc bên trong thư mục dự án hiện tại.

---

## 3. Quy chuẩn Kiểm thử & Release
- **Test native bắt buộc**: Chạy `npm run check` (18 root contract checks) và `cd agent-runner && npm run check` (26 runner tests) trước khi commit/release.
- **Git workflow**: Commit kèm toàn bộ `.claude/` của project (sau khi quét secret).
- **Release tag**: Tag `v*` (VD: `v1.1.62`) đẩy lên remote để kích hoạt build installer.
- **Code sign macOS bắt buộc**: Public release macOS phải fail nếu thiếu Developer ID `Developer ID Application: W360S JOINT STOCK COMPANY (ZC3H8887XS)`, nếu `codesign --verify --deep --strict` lỗi, thiếu `TeamIdentifier=ZC3H8887XS`, có `Signature=adhoc`, hoặc `spctl -a -vv -t exec` không pass. Cấm skip bước này khi release.
