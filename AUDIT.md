# 📋 Audit toàn bộ — VuaAssistant

> **Ngày:** 2026-08-16 (cập nhật 18/08) · **Phiên bản:** `v1.1.59` · **Nhánh:** `main` @ `da11837`
> **Phạm vi:** 29.414 dòng mã (frontend `src/`, Rust `src-tauri/`, Agent Runner, AI Router, 53 script kiểm chứng)
> **Cách làm:** chạy thật `cargo check`, `npm run check`, đọc log CI thật trên GitHub Actions, đối chiếu từng khẳng định với mã nguồn.

---

## 🎯 Kết luận 30 giây

| Câu hỏi | Trả lời |
|---|---|
| Kiến trúc có đúng ý đồ không? | 🟢 Đúng. Một bộ não duy nhất ở Host Process, rail công cụ thi hành bằng máy, Vault mã hoá. |
| Sức khoẻ CI? | 🟢 **Vừa sửa xong.** Trước `bde3115`, CI **đỏ trên cả 3 nền tảng** suốt 4 ngày. |
| Nợ kỹ thuật? | 🟡 Ba nhóm rõ ràng: một refactor bỏ dở, một hằng số nhân bản 8 lần, 13 cảnh báo Rust. |
| Có lỗi nào ảnh hưởng người dùng đang cài? | 🟢 **Đã sửa** ở `da11837`. Đổi `identifier` ở v1.1.59 từng làm người dùng cũ mất toàn bộ dữ liệu khi nâng cấp; nay có mã di trú, copy chứ không move và không bao giờ đè. |

---

## 🔴 P0 — Chặn phát hành / mất dữ liệu người dùng

### 1. `identifier` lệch làm CI đỏ cả 3 nền tảng — ĐÃ SỬA ở `bde3115`

v1.1.59 đổi `com.vuaai.assistant` → `com.vuaai.vuaassistant` trong `tauri.conf.json`,
nhưng `scripts/desktop-smoke-check.mjs` và `scripts/packaged-smoke-check.mjs` vẫn
giữ chuỗi cũ **chép tay**. Tauri đặt thư mục dữ liệu theo đúng `identifier`, nên
từ đó hai bài smoke đi tìm nhầm chỗ.

Log CI thật (run 31961618598, job `rust`):

```
✓ app desktop chạy được, không thoát sớm
✓ AI Router tự khởi động và trả /health
✗ thư mục dữ liệu được tạo (/home/runner/.local/share/com.vuaai.assistant/runtime)
✗ Agent Runner đập nhịp sau khi app mở
✗ tạo ipc/inbound.db · ✗ tạo ipc/outbound.db · ✗ tạo vault.db
```

Hỏng từ `52d9f24` (12/08) tới `e5adb2b` (16/08) — 3 lần đẩy `main` liên tiếp đều đỏ.
Đây cũng chính là thứ **chặn nút Tag Release**, vì workflow bắt buộc CI xanh mới đẩy tag.

**Đã sửa:** cả hai script đọc thẳng `identifier` từ `tauri.conf.json` — một nguồn
sự thật duy nhất. Kiểm chứng đảo ngược: đặt identifier thành `com.test.sentinel`
thì bài test đi theo đúng `.../com.test.sentinel/runtime`, chứng minh nó thật sự
đọc tệp cấu hình chứ không trùng chuỗi ngẫu nhiên.

### 2. Đổi `identifier` = xoá sổ dữ liệu người dùng cũ — ĐÃ SỬA ở `da11837`

Cùng lần đổi tên đó, app từ v1.1.59 trở đi đọc/ghi ở thư mục hoàn toàn mới:

| | Thư mục dữ liệu |
|---|---|
| v1.1.58 trở về trước | `~/Library/Application Support/com.vuaai.assistant/runtime` |
| v1.1.59 trở đi | `~/Library/Application Support/com.vuaai.vuaassistant/runtime` |

Người dùng nâng cấp sẽ mở app lên thấy **trắng trơn**: mất Vault (toàn bộ khoá API),
mất kết nối nhà cung cấp, mất lịch sử chat, mất tác vụ hẹn giờ, mất tri thức đã nạp.

`vault::migrate_legacy_vault` **không** giải quyết chuyện này — nó chỉ nâng cấp
định dạng mã hoá (`v2:`) *bên trong* một thư mục, không chuyển giữa hai thư mục.

**Đã sửa:** `src-tauri/src/migrate.rs` chuyển dữ liệu một lần lúc app khởi động, chạy
**trước** khi mở Vault. Ba nguyên tắc đều nghiêng về phía an toàn: **copy chứ không
move** (hỏng giữa chừng thì bản gốc còn nguyên), **không bao giờ đè** ở cả mức thư mục
lẫn từng tệp, và ghi cờ `migrated-from.json` **sau** khi copy xong.

Kiểm chứng bằng 14 mục trên thư mục thật, kèm hai phép đảo ngược: bỏ chốt không-đè và
biến copy thành move — cả hai đều bị bắt. Đã nối vào CI (`cargo run --example migrate_check`).

---

## 🟡 P1 — Nợ kỹ thuật có bằng chứng

### 3. Refactor "phân rã god file" bỏ dở, để lại 351 dòng mã chết

Báo cáo audit ngày 13/08 ghi *"Đã phân rã thành hơn 10 file chuyên biệt dưới
`src/components/settings/`, `src/components/chat/` và `src/lib/store/`"*. Đối chiếu thật:

| File | Dòng | Thực tế |
|---|---|---|
| `src/pages/Settings.tsx` | 49 | 🟢 phân rã thật, xong |
| `src/lib/store.tsx` | **1742** | 🔴 chưa động tới (audit cũ ghi "cũ: 1599" — nay còn **phình thêm**) |
| `src/pages/Chat.tsx` | **1734** | 🔴 chưa động tới (audit cũ ghi "cũ: 1747") |

23 file vẫn `import … from "@/lib/store"` → trỏ vào `store.tsx` 1742 dòng.
Các file "phân rã" ra thì **không ai dùng**:

```
src/components/chat/ChatComposer.tsx      122 dòng — 0 chỗ dùng
src/components/chat/ChatMessageList.tsx   126 dòng — 0 chỗ dùng
src/lib/store/AgentStateContext.tsx        50 dòng — 0 chỗ dùng
src/lib/store/VaultContext.tsx             28 dòng — 0 chỗ dùng
src/lib/store/KnowledgeContext.tsx         25 dòng — 0 chỗ dùng
src/lib/store/types.ts                      7 dòng — 0 chỗ dùng
```

**Đề xuất:** chọn một trong hai, đừng để lơ lửng — hoặc làm nốt (chuyển 23 import
sang `store/`), hoặc xoá 6 file kia đi. Để nguyên là bẫy: người sau sửa nhầm bản
không chạy mà tưởng đã sửa.

### 4. Cách tìm thư mục dữ liệu bị chép 8 lần, và **3 bản không giống nhau**

```
agent-runner/src/db/connection.ts:19    VUA_DATA_DIR || HOME||'/tmp' + /vuaassistant
agent-runner/src/config.ts:14           VUA_DATA_DIR || HOME||'/tmp' + /vuaassistant
agent-runner/src/policy.ts:47           VUA_DATA_DIR || HOME||''    + /vuaassistant  ← HOME rỗng ⇒ đường dẫn tương đối!
agent-runner/src/native-tools/index.ts:32   VUA_DATA_DIR || '/tmp/vuaassistant'      ← gốc khác hẳn
agent-runner/src/mcp-tools/core.ts:10,14,242,283,319   trộn cả hai kiểu
agent-runner/src/scheduler/index.ts:52  VUA_DATA_DIR || HOME + /vuaassistant
```

Khi chạy bản cài thật thì `runtime.rs:312` luôn set `VUA_DATA_DIR`, nên lỗi này
**chưa cắn người dùng**. Nhưng lúc chạy dev / chạy test / chạy tay runner thì
native-tools ghi vào `/tmp/vuaassistant` còn database mở ở `$HOME/vuaassistant` —
hai nơi khác nhau, và `policy.ts` với `HOME` rỗng còn tạo thư mục tương đối ngay
cạnh chỗ đang đứng.

**Đề xuất:** một hàm `dataDir()` duy nhất trong `agent-runner/src/paths.ts`, 6 file
kia import lại. Giảm 8 chỗ xuống 1.

### 5. 13 cảnh báo Rust — **đừng xoá, phải `cfg`-gate**

`cargo check` trên Linux báo 13 cảnh báo, tất cả ở `src-tauri/src/auth.rs`.
Nguyên nhân: phần đọc cookie Chrome của Grok được `#[cfg(target_os = "macos")]`
(11 khối), nhưng `use` ở đầu tệp và 2 type alias thì **không** gate.

⚠️ Cẩn thận: `hex_encode`, `HmacSha1`, `Aes128CbcDec` **được dùng thật** ở
`auth.rs:279`, `:241`, `:247`, `:333` — chỉ là bên trong khối macOS. `cargo fix`
tự động xoá chúng sẽ **làm hỏng bản build macOS**. Cách đúng là thêm
`#[cfg(target_os = "macos")]` lên các dòng `use` và 2 type alias.

---

## 🟢 P2 — Gọn gàng, làm khi rảnh

| Điểm | Số liệu | Ghi chú |
|---|---|---|
| File quá lớn | `store.tsx` 1742 · `Chat.tsx` 1734 · `sidecar.mjs` 1440 · `runtime.rs` 1152 | 3 file đầu = 16% toàn bộ mã |
| `mock-mcp-server.mjs` | không nằm trong `npm test` lẫn CI | script mồ côi duy nhất trong 53 script |
| Bundle UI | `index-*.js` 556 KB, `pdf.worker` 1.2 MB, tổng `dist` 4,1 MB | đã tách chunk & lazy-load sẵn; app desktop đọc từ đĩa nên **không cấp bách** |
| `console.log` trong `src/` | 3 | không đáng lo |
| `TODO` / `FIXME` / `HACK` | **0** | 🟢 sạch |
| `: any` / `@ts-ignore` | 11 | ngưỡng chấp nhận được |
| Cảnh báo phụ thuộc | `screenshots v0.8.10` sẽ bị Rust bản sau từ chối | theo dõi, chưa gấp |

---

## 📌 Nhận xét về quy trình

Bản audit 13/08 ghi *"Sức khoẻ build & test: 🟢 Hoàn toàn sạch"* — nhưng CI ở đúng
commit đó (`52d9f24`) là **đỏ**. Nó cũng ghi 3 god file "đã phân rã" trong khi 2/3
còn nguyên. Bài học: audit phải đọc log CI thật, và mọi khẳng định "đã xong" phải
đối chiếu lại số dòng / chỗ dùng thật, không chép từ ý định.

---

## ✅ Thứ tự đề nghị làm

1. ~~Di trú thư mục dữ liệu~~ (P0-2) — xong ở `da11837`.
2. ~~Sửa identifier trong smoke test~~ — xong ở `bde3115`.
3. Gộp `dataDir()` về một chỗ (P1-4) — nhỏ, ít rủi ro, chặn hẳn một lớp lỗi.
4. `cfg`-gate `auth.rs` (P1-5) — 15 phút, `cargo check` sạch tiếng.
5. Quyết dứt điểm refactor `store.tsx` / `Chat.tsx` (P1-3) — hoặc làm nốt, hoặc xoá mã chết.

---
*Audit v1.1.59 · 2026-08-16 · đối chiếu bằng CI log thật và `cargo check` thật.*
