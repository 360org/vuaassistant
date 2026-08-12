---
name: vuaassistant-dev-guidelines
description: Quy chuẩn phát triển VuaAssistant — bám idea gốc, quy trình versioning, sidecar build, kiểm chứng thật. Load skill này TRƯỚC khi sửa bất cứ thứ gì trong repo vuaassistant.
---

# VuaAssistant — Quy chuẩn Phát triển

Quy chuẩn làm việc cho hệ thống VuaAssistant (Zero-Docker / Tauri Desktop / AI Router + Agent Runner Sidecar).

---

## 0. LUẬT SỐ 1 — BÁM IDEA GỐC (đọc trước mọi việc khác)

> **`idea.md` là nguồn chân lý về SẢN PHẨM. Code phải phục tùng idea, không phải ngược lại.**

### 0.1 Bắt buộc đọc trước khi đề xuất/thay đổi
Trước khi đề xuất bất kỳ thay đổi nào về **luồng người dùng, kiến trúc, hoặc cách xác thực**, BẮT BUỘC:
1. Đọc [`idea.md`](../../idea.md) — đặc biệt §1 (Tầm nhìn) và §3 (Bản đồ tính năng A–F)
2. Trích dẫn đúng mục idea mà thay đổi đó phục vụ
3. Nếu thay đổi **mâu thuẫn** với idea → **DỪNG LẠI, HỎI PO**, không tự quyết

### 0.2 Nguyên tắc bất di bất dịch (rút ra từ lỗi thật đã xảy ra)

| Nguyên tắc | Vì sao có luật này |
|---|---|
| **Đăng nhập bằng SUBSCRIPTION, không phải API key** | Agent từng đề xuất bỏ OAuth vendor để chuyển sang "dán API key" vì lo rủi ro kỹ thuật → **phá thẳng idea §A**. PO đã phản ứng gay gắt. API key CHỈ được nằm trong Advanced Options, sau khi đã login. |
| **Không expose Bash/Terminal cho model** | idea §B ghi rõ. Đã gỡ, không được thêm lại. |
| **Vault nội bộ, không phụ thuộc OS Keychain** | idea §F. Mã hoá AES-256 do VuaAssistant quản lý. |
| **Agent không bao giờ đọc secret thô** | idea §F. Chỉ `credential_ref` + `{{credential:field}}`; Trusted Connector Gateway mới được resolve. |
| **Zero-Docker cho người dùng cuối** | idea §1.3. Docker chỉ dành cho dev/server profile. |

### 0.3 Khi gặp rào cản kỹ thuật
**SAI:** thấy khó → đổi luôn hướng sản phẩm cho dễ làm.
**ĐÚNG:** nêu rõ rào cản + đề xuất 2–3 phương án **vẫn giữ đúng idea** → để PO chọn.

> Ví dụ có thật: OAuth vendor bị `Invalid request format`. Cách sai là bỏ OAuth. Cách đúng là soi tham số so với AI Router core → phát hiện `state` chỉ 16 byte thay vì 32 → sửa 1 dòng, giữ nguyên trải nghiệm subscription.

### 0.4 ĐỊNH DANH & THỨ TỰ KẾT NỐI — KHÔNG ĐƯỢC LÀM LẠI

**Tên gọi (chốt, không bàn lại):**

| Đúng | Sai |
|---|---|
| **AI Router** — tên chính thức của tầng chung chuyển, chạy local `127.0.0.1:36360` (`ai-router/`) | Gọi nó là "9router" trong UI/tài liệu sản phẩm |
| **9router** — chỉ là **công nghệ nền** (upstream) mà AI Router kế thừa | Đổi tên AI Router về 9router |
| **OpenRouter** — chỉ là **một provider** trong danh sách, ngang hàng ChatGPT/Claude/Gemini | Coi OpenRouter là hạ tầng chung chuyển của app |

> ⚠️ Đã có lượt làm việc nhầm OpenRouter là "kết nối chung chuyển" và định sửa lại màn Sign in. **Phần kết nối hiện tại ĐANG ĐÚNG — không được refactor, không được làm lại.**

**Thứ tự ưu tiên kết nối (bắt buộc giữ):**
1. **Subscription (OAuth 1-click)** — đường chính, hiển thị trước
2. **API key** — chỉ là phương án phụ, nằm dưới/Advanced Options

Mọi thay đổi làm đảo thứ tự này, hoặc đẩy API key lên trước, đều là **sai hướng sản phẩm**.

### 0.5 Không sửa thứ đang chạy đúng
Trước khi "sửa" một phần đang hoạt động: **hỏi PO xem nó có đang đúng ý không**. Nhiều thứ trông như bug thực ra là quyết định sản phẩm có chủ đích. Chi phí làm lại một phần đang chạy tốt luôn cao hơn chi phí hỏi một câu.

---

## 1. KIỂM CHỨNG THẬT — "compile được" ≠ "chạy được"

### 1.1 Ba mức kiểm chứng, không được nhảy cóc

| Mức | Lệnh | Chứng minh được gì |
|---|---|---|
| 1. Biên dịch | `npx tsc --noEmit` · `cargo check` | Cú pháp/kiểu đúng |
| 2. Test | `npm run check` | Logic đúng |
| 3. **Chạy thật trên app macOS** | `npm run tauri dev` (nhanh) hoặc `npm run build:local` (bản cài) → **thao tác thật trên UI** | **Sản phẩm dùng được** |

**Chỉ được báo "đã xong" sau khi qua mức 3.** Nhiều lỗi nghiêm trọng nhất (sidecar sai đường dẫn, runner crash loop, router không được giám sát) đều **xanh ở mức 1–2 nhưng app hoàn toàn không dùng được**.

### 1.2 Khi báo cáo trạng thái
- Mỗi kết luận phải kèm **bằng chứng**: `file:line`, output lệnh, hoặc ảnh chụp màn hình
- Phát hiện cũ **phải verify lại** trước khi nhắc lại — đã từng báo nhầm 2 mục đã được fix từ lâu
- Không chắc thì ghi rõ "chưa kiểm chứng", **không đoán**

---

## 2. Versioning & Release (BẮT BUỘC)

* **CHANGELOGS**: mọi thay đổi ghi ngay vào `CHANGELOGS.md` mục `[Unreleased]` + commit.
* **TUYỆT ĐỐI KHÔNG tự ý tag version** cho từng sửa lẻ.
* Chỉ tag/build release **khi PO ra lệnh rõ ràng** ("tag version", "build release", "merge to main & release").

---

## 3. Sidecar & Sub-module Build Guard

* `agent-runner/` là Node sidecar độc lập, output `agent-runner/dist/index.js`.
* Sửa `agent-runner/src/` → phải biên dịch `npx tsc --project agent-runner/tsconfig.json`.
* **Native module (`better-sqlite3`)**: phải khớp phiên bản Node đang chạy.
  - Node mới hơn CI → `NODE_MODULE_VERSION mismatch` → runner crash loop.
  - **KHÔNG chạy `npm rebuild` bừa**: rebuild thất bại sẽ **xoá luôn binding cũ đang chạy được**, biến lỗi nhẹ thành app chết hẳn. Nâng version package là đường an toàn hơn.
* **AI Router sidecar** (`ai-router/src/sidecar.mjs`) nằm ở **gốc repo**, không phải trong `src-tauri/`. Dev chạy cargo từ `src-tauri/` nên phải đi ngược cây thư mục để tìm.

---

## 4. Tiến trình nền phải được GIÁM SÁT

* Mọi sidecar (AI Router, agent-runner) **bắt buộc** có: health check định kỳ · tự restart · **cap số lần** · dump log khi bó tay.
* Router là **đường duy nhất** tới model — router chết = app vô dụng. Từng có bug: spawn đúng 1 lần, chết là chết luôn, nút "Thử lại" chỉ fetch lại HTTP nên không bao giờ cứu được.
* Nút retry trên UI phải **respawn tiến trình thật**, không chỉ gọi lại API.
* **Không `pkill` theo tên tiến trình một cách vô điều kiện** — sẽ giết luôn sidecar của instance khác. Probe port trước, chỉ dọn khi thật sự bị chiếm, và log rõ.

---

## 5. Chạy & test trên máy PO — **KHÔNG DÙNG DOCKER**

> **Chốt 2026-07-27:** bỏ hẳn bước test qua Docker. Build bản **macOS local** và test **app live**.

| Việc | Lệnh |
|---|---|
| Vòng lặp sửa nhanh (hot reload, cửa sổ native) | `npm run tauri dev` |
| Bản cài thật vào `/Applications/VuaAssistant.app` | `npm run build:local` |
| Chỉ biên dịch sidecar sau khi sửa `agent-runner/src` | `npm run build:runner` |

* Docker/Colima profile cũ đã xoá khỏi repo; không dùng `./dev up|ui|all` nữa.
* Host đã có `node`/`npm` (`/usr/local/bin`) và `cargo` (`~/.cargo/bin`).
* **Dev build và app release dùng chung** bundle id + Vault + port 36360 → chạy song song sẽ đá nhau. Chỉ chạy **một instance** khi test, và nói rõ đang test instance nào.
* **Vòng chờ (`until … do sleep`) phải có điều kiện thoát khi tiến trình chết**, nếu không sẽ treo vĩnh viễn. Luôn dọn task nền đã xong.
* Không thao tác UI khi PO đang dùng app.

---

## 6. Cơ chế Cấp quyền 1-Click

* Không bắt người dùng vào Cài đặt để cấp quyền thủ công.
* Hiện **Permission Approval Card** ngay trong Chat với nút **[ Cho phép ]** 1-click.

---

## 7. Đa định dạng tài liệu & PDF fallback

* Luôn bọc `try/catch` cho `extractPdf` / `extractText`.
* PDF scan ảnh (không có text layer) → đăng ký asset `[Tệp PDF: … | Dung lượng: … KB]`, trạng thái `Ready` ngay.
* **Đính kèm phải nhúng dữ liệu thật (base64 data URL / text đã trích) vào tin nhắn TRƯỚC khi dọn state** — nếu không sẽ gửi đi `blob:` tạm và vision endpoint từ chối (`fetch failed`).

---

## 8. Tài liệu phải khớp thực tế

* Sơ đồ kiến trúc trong `idea.md` / `ARCH.md` phải phản ánh **hệ thống hiện tại** (đã có tầng AI Router).
* Bảng tổng kết trong `CHECKLIST.md` phải khớp số checkbox thật.
* Tài liệu sai còn nguy hiểm hơn không có: nó khiến lượt làm việc sau đi sai hướng.
