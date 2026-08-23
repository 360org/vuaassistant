# 📋 Audit toàn bộ — VuaAssistant v1.1.63

> **Ngày:** 2026-08-23 · **Nhánh:** `main` @ `db81dc4` · **Phiên bản:** `v1.1.63`
> **Cách làm:** chạy thật `npm run check`, `tsc`, `cargo check`, `npm run build`; đọc log CI
> thật trên GitHub Actions; dò trạng thái cây plugin đang chạy bằng lệnh, không chép từ tài liệu.

---

## 🎯 Kết luận 30 giây

| Câu hỏi | Trả lời |
|---|---|
| Kiến trúc plugin có trụ được qua 3 bản phát hành mới? | 🟢 **Có.** 15 plugin, 25 tool, 4 invariant — **0 tool nào thiếu trong prompt**. |
| Sức khoẻ CI? | 🟢 **Vừa vá.** Trước `db81dc4`, CI đỏ ở **cả 3 bản phát hành** v1.1.61/62/63. |
| "Executable Skills" có mở lối vòng qua cửa duyệt không? | 🟢 **Không.** Skill chỉ là quy trình; tool nó dùng vẫn qua thác nước. |
| Nợ mới? | 🟡 Sổ skill lệch khỏi kỷ luật kernel ở 3 điểm; mã chết frontend vẫn còn. |

---

## 🔴 P0 — Ba bản phát hành ra đời trong lúc CI đỏ (ĐÃ VÁ `db81dc4`)

Job `agent-runner` đỏ liên tục ở v1.1.61, v1.1.62, v1.1.63 — trong khi 4/5 job còn lại
đều xanh, nên nhìn lướt rất dễ tưởng chỉ là trục trặc lặt vặt.

```
Error [ERR_MODULE_NOT_FOUND]: Cannot find module
  '.../agent-runner/dist/memory/self-improve.js'
  imported from '.../agent-runner/scripts/self-improve-check.mjs'
```

`self-improve-check.mjs` nạp từ `dist/` — bản **đã build** — nhưng job đó chỉ chạy
`npm install` rồi `npm run check`, **không hề build**. Ở máy dev thì `dist/` còn sót lại
từ lần build trước nên vẫn xanh. Đúng kiểu lỗi *"máy em chạy được"*, và nó là script duy
nhất trong 27 script làm vậy.

**Đã vá:** trỏ vào `src/` như 26 script còn lại. **Kiểm chứng:** tái hiện đúng lỗi CI ở
máy bằng cách tạm cất `dist/` đi; sửa xong thì `npm run check` xanh **cả hai cảnh** —
có `dist/` và không có `dist/`.

---

## 🟢 Kiến trúc plugin: trụ được

Dò trạng thái cây đang chạy bằng lệnh, không đọc tài liệu:

```
plugin nạp : tools, native-tools, builtin-tools, skills, mcp-manager, prompt,
             prompt-tool-list, model-visible, invariants, core-invariants,
             model-visible-invariant, providers, policy, scheduler, telegram
tool tổng  : 25          invariant : model-visible, prompt, providers, tools
tool thiếu trong prompt : (không thiếu)
```

- **15 plugin** (trước 11) — scheduler, telegram, mcp, skills đã cắm vào đúng lối.
- **25 tool** (trước 21), tất cả tự khai `sideEffect`/`requiresApproval`; 4 tool mới của
  v1.1.62/63 khai đầy đủ, không cái nào lọt.
- **Invariant `prompt` đang làm việc thật:** thêm 4 tool mới mà prompt vẫn phủ hết — đây
  chính là chỗ từng lệch 9/21 trước khi có invariant.
- **`cargo check`: 0 lỗi**, cảnh báo từ 13 xuống còn **1**.

**"Executable Skills" không mở lối vòng.** Em đọc `kernel/skills.ts`: skill chỉ là sổ
đăng ký quy trình (prompt + instructions + tên tool cần dùng), không tự thực thi mã. Mọi
tool nó dùng vẫn đi qua `ctx.tools.execute()` → thác nước chính sách. `create_or_update_skill`
tuy không cần duyệt nhưng không tạo ra được đường chạy nào vượt cửa.

---

## 🟡 P1 — Sổ skill lệch khỏi kỷ luật của kernel

Ba điểm, đo bằng lệnh chạy thật, kèm đối chứng bằng chính sổ tool:

```
skills trùng tên  : IM LẶNG ĐÈ ✗ → title thành "Bản đè"
tools  trùng tên  : NỔ ✓ (đối chứng — cùng dự án, cùng kỷ luật)
skill khai tool ma: 2 tool không tồn tại → tool_khong_ton_tai, mot_tool_bia_dat
invariant chạy    : 4 — vẫn qua dù có tool ma ⇒ không ai bắt ✗
chủ sở hữu        : model-visible, prompt, providers, tools (thiếu "skills")
```

1. **Trùng tên skill thì im lặng đè.** `skills.set()` ghi chồng, trong khi sổ tool ném lỗi.
   Một skill người dùng tạo có thể âm thầm che mất skill built-in cùng tên.
2. **Skill khai tool không tồn tại thì không ai bắt.** `getRequiredTools` trả về tên trần;
   đây đúng là quan hệ hai phía có thể lệch — loại quan hệ mà invariant sinh ra để giữ.
3. **Không có invariant `skills`.** Bốn subsystem kia đều có; subsystem mới ra đời không
   theo mẫu.

**Đề xuất:** cho `skills.register()` ném khi trùng tên, và thêm invariant `skills` khẳng
định mọi tool một skill khai đều có trong sổ. Cả hai đều nhỏ.

---

## 🟡 P1 — Nợ cũ còn nguyên

| Điểm | Trạng thái |
|---|---|
| `src/lib/store.tsx` | **1.817 dòng** — trước 1.742, tức là **còn phình thêm** |
| `src/pages/Chat.tsx` | 1.736 dòng |
| Mã chết frontend | `ChatComposer`, `ChatMessageList`, `AgentStateContext` — vẫn **0 chỗ dùng** |
| `hex_encode` (Rust) | Cảnh báo cuối còn lại: chỉ được gọi từ hàm gated macOS nhưng bản thân chưa gate |
| `native-tools-policy-check.mjs` | Kiểm 17 tool nhưng thông điệp vẫn ghi "13 tool" — lệch chữ |

---

## ✅ Thứ tự đề nghị

1. ~~Vá CI~~ — xong ở `db81dc4`. **Xác nhận CI xanh trước khi phát hành v1.1.64.**
2. Ném khi trùng tên skill + thêm invariant `skills` (P1) — nhỏ, chặn hẳn một lớp lỗi.
3. `#[cfg(target_os = "macos")]` cho `hex_encode` — hết sạch cảnh báo Rust.
4. Quyết dứt điểm `store.tsx` / `Chat.tsx` và 3 tệp mã chết — đang xấu đi chứ không đứng yên.

---
*Audit v1.1.63 · đối chiếu bằng log CI thật, lệnh dò cây plugin đang chạy, và build thật.*
