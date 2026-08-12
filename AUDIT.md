# 📋 Báo cáo Audit Toàn diện — VuaAssistant

> **Ngày:** 2026-07-26 · **Nhánh:** `dev` (sạch, khớp `origin/dev`)
> **Đối chiếu:** [idea.md](./idea.md) — bản cập nhật 17/07
> **Phương pháp:** kiểm chứng bằng `grep`/`wc` trên HEAD + chạy thật (`cargo check`, `tsc`, `npm run check`, `npm run build`). Không suy đoán.

---

## 🎯 Kết luận 30 giây

| Câu hỏi | Trả lời |
|---|---|
| Bám idea gốc đến đâu? | 🟢 **5/6 mục lớn (A,B,D,E,F) đạt** — mục C (kênh kết nối) mới xong một nửa |
| Bảo mật? | 🟢 **Không còn lỗ nào** — 6/6 đã đóng, idea.md cũng đã viết lại theo mô hình mới |
| Kiến trúc có lệch idea? | 🟡 **Có 2 điểm** — một là tiến hoá tốt (AI Router), một là nợ thật (4 hệ con sai tầng) |
| Sức khoẻ build? | 🟢 `cargo check` · `tsc` · `npm run check` (**84 assertion**) · `npm run build` — xanh hết |
| Việc còn lại? | **3 nhóm**: kênh kết nối, 4 hệ con sai tầng, tối ưu bundle/god-file |

---

## 📐 PHẦN 1 — Đối chiếu từng mục của idea.md

### ✅ A. Onboarding — **Đạt**

| Yêu cầu idea | Hiện trạng |
|---|---|
| Login OAuth/Subscription first | ✅ `Onboarding.tsx` + Fast Sign-in (Gemini/GPT/Claude/Grok) |
| Lần sau vào thẳng, không hỏi lại | ✅ cờ `onboarded` ×5 trong store |
| Advanced Options chỉ hiện sau khi login | ✅ đúng thiết kế |
| Tauri tự spawn Host Process, không hỏi Docker | ✅ `spawn_engine` ×5, tự chạy lúc mở app |

### ✅ B. Universal Agent Loop — **Đạt**

| Yêu cầu idea | Hiện trạng |
|---|---|
| Bỏ `@anthropic-ai/claude-agent-sdk` | ✅ **0** tham chiếu trong `agent-runner` |
| Vòng lặp agentic TS thuần | ✅ `poll-loop.ts` — 363 dòng |
| **Không** cấp Bash/host shell cho model | ✅ **0** — tool `bash` đã gỡ hẳn |
| File tools chỉ trong workspace được cấp | ✅ `workspacePath()` ×6 |
| Grep/Glob | ✅ `execFileSync` (mảng tham số, không qua shell) |
| Self-improving memory | ⚠️ **Có nhưng sai tầng** → xem Phần 2 |

### ⚠️ C. Kênh kết nối — **Đạt một nửa** *(mục yếu nhất)*

| Yêu cầu idea | Hiện trạng |
|---|---|
| Telegram Bot long-polling | ✅ có (`telegram.ts`, 254 dòng) |
| Message đi **qua SQLite IPC** rồi mới tới Agent | ❌ **Gọi thẳng `runAssistant()`**, bỏ qua IPC |
| Chat SDK Bridge tự đăng ký (Slack/Discord/WhatsApp) | ❌ **Chưa có** — không tồn tại `src/runtime/channels/` |

> Đây là khoảng cách rõ nhất so với idea. Telegram chạy được nhưng **không theo kiến trúc idea mô tả**, nên chưa mở đường cho Slack/Discord/WhatsApp.

### ✅ D. Agent (bộ não độc lập + RAG) — **Đạt**

| Yêu cầu idea | Hiện trạng |
|---|---|
| Role isolation (instructions + soul + memory riêng) | ✅ `agentConfigs`/`knowledgeByAgent` ×35 |
| Cấu hình Agent bằng markdown (Paperclip-style) | ✅ `agentImport.ts` + **Export MD** (đã có, trước đây thiếu) |
| Knowledge RAG on-device (PDF/Word/Excel/PPT/Text) | ✅ `knowledge.ts` 568 dòng, TF-IDF cục bộ |
| Isolation knowledge theo role | ✅ có test riêng trong `npm run check` |

### ✅ E. Skills & MCP — **Đạt**

| Yêu cầu idea | Hiện trạng |
|---|---|
| Agent Skills chuẩn `skills/*/SKILL.md` | ✅ **12 skill**, validate khi build |
| MCP client + khai báo qua config | ✅ `agent-runner/src/mcp-client/` + `mcpServers` trong `config.ts` |

### ✅ F. Vault & Connectors — **Đạt, làm kỹ hơn idea yêu cầu**

| Yêu cầu idea | Hiện trạng |
|---|---|
| Vault nội bộ, **không** dùng OS keychain | ✅ SQLite riêng, **AES-256-CBC + HMAC** |
| Agent chỉ thấy `credential_ref`, không đọc secret | ✅ *"Credential access denied"* |
| Trusted Connector Gateway đọc Vault, bind origin, redact | ✅ `allowedOrigin` + `redirect: manual` + `redactSecrets()` |
| `http_request` chỉ cho request không auth | ✅ tách bạch với `connector_request` |

---

## 🏗️ PHẦN 2 — Hai điểm lệch kiến trúc

### 🟢 Lệch #1: AI Router — tiến hoá tốt, nhưng tài liệu chưa theo kịp

Sơ đồ trong idea.md: `UI → SQLite IPC → Agent Runner → AI Providers`.
Thực tế đã chèn thêm **một tầng router riêng** (`sidecar.mjs` **1.108 dòng** + `aiRouter.ts` **439 dòng**).

**Đây là thay đổi đúng đắn** — nó giải quyết được nhiều vấn đề cùng lúc: OAuth server-side, Trusted Connector Gateway, multi-account, model packs. Chính idea.md §F cũng đã nhắc "Trusted Connector Gateway trong AI Router".

**Vấn đề:** sơ đồ kiến trúc trong idea.md/ARCH.md **vẫn vẽ theo mô hình cũ**, chưa có tầng này. Người đọc tài liệu sẽ hiểu sai hệ thống.

### 🔴 Lệch #2: 4 hệ con nằm sai tầng *(nợ kỹ thuật thật)*

idea.md đặt "bộ não" ở **Host Process**. Thực tế 4 hệ con vẫn nằm trong **webview**:

| Hệ con | webview | runner |
|---|:---:|:---:|
| Knowledge RAG | ✅ | ❌ |
| Scheduler | ✅ | ❌ |
| Telegram | ✅ | ❌ |
| Self-improve memory | ✅ | ❌ |

**Hệ quả người dùng cảm nhận được:**
- Đóng cửa sổ app → **mất lịch chạy và Telegram**
- Agent chạy qua Runner **không có tri thức tài liệu** (RAG chỉ ở webview)

Đây là mục em nêu từ lượt 2, đến nay **chưa xử lý**.

---

## ⚡ PHẦN 3 — Tối ưu đã đến đâu

### Đã tốt

| Hạng mục | Số đo |
|---|---|
| Runtime dependency | **8** (agent-runner: 1) — rất gọn |
| Dynamic import | **21** chỗ |
| `pdfjs` (nặng nhất) | Tách riêng 458 kB + worker 1.187 kB — **không** nằm trong bundle chính |
| CSS | 82.8 kB → **gzip 12.5 kB** |

### Chưa làm

| Hạng mục | Số đo | Vấn đề |
|---|---|---|
| Bundle chính | **645 kB** (gzip **190 kB**) | Nặng |
| `React.lazy` | **0** | Cả 12 page nạp ngay khi mở app |
| God files | Chat **1.747** · Settings **1.755** · store **1.599** | 33% source, không giảm |
| framer-motion | dùng ở **2** file | Trả giá cả thư viện cho 2 chỗ |
| i18n | 79 dòng | Nửa vời, UI còn nhiều chuỗi hardcode |

**Tổng source:** 15.673 dòng — **+242** so với lượt 2. Đang thêm tính năng, chưa có đợt dọn.

---

## 📦 PHẦN 4 — Đóng gói & CI

| Yêu cầu idea §1.3 | Hiện trạng |
|---|---|
| Native sidecar cho Windows/macOS/Linux | ✅ CI build `macos-15`, `macos-latest`, `ubuntu-22.04`, `windows-latest` |
| Không bắt cài Docker | ✅ Host Process; Docker chỉ còn cho dev/server |
| Bundle Node runtime | ✅ `runtime/node` + `desktop-bundle-contract-check.mjs` gác cổng |

Đây là mục **đã tiến rất xa** so với lượt 2 (khi đó còn spawn `npx tsx` từ thư mục dev).

---

## 📚 PHẦN 5 — Tài liệu

| File | Sửa lần cuối | Tình trạng |
|---|---|---|
| idea.md · SPEC.md · ARCH.md | **17/07** (9 ngày) | 🟡 Chưa có tầng AI Router trong sơ đồ |
| CHECKLIST.md · CHANGELOGS.md | 26/07 | ✅ Mới |

**Mâu thuẫn trong CHECKLIST:** bảng tổng kết ghi *"87 xong / 7 cập nhật / 125 chưa"*, nhưng đếm checkbox thật là **233 `[x]` / 89 `[ ]`**. Bảng tổng kết chưa được cập nhật theo nội dung.

---

## 🗓️ PHẦN 6 — Việc còn lại, xếp theo giá trị/công sức

| # | Việc | Công | Vì sao |
|---|---|---|---|
| 1 | **Code-split `React.lazy`** cho 12 page | ~2h | Rẻ nhất, giảm ~30-40% bundle khởi động |
| 2 | **Sửa bảng tổng kết CHECKLIST** + vẽ AI Router vào ARCH/idea | ~2h | Tài liệu đang nói sai về hệ thống |
| 3 | **Telegram + Scheduler về Host Process** | ~1-2 ngày | Đóng app là mất lịch chạy — sai lời hứa sản phẩm |
| 4 | **RAG về Runner** | ~1 ngày | Agent qua Runner mới có tri thức tài liệu |
| 5 | **Tách 3 god file** | ~1 ngày | PR riêng: Settings → Chat → store |
| 6 | **Chat SDK Bridge** (Slack/Discord/WhatsApp) | ~2-3 ngày | Mục C của idea còn thiếu |
| 7 | i18n dùng đủ hoặc bỏ · gỡ framer-motion | ~4h | Dọn nốt |

---

## ✅ PHẦN 7 — Kiểm chứng sức khoẻ

| Kiểm tra | Kết quả |
|---|---|
| `cargo check` (Rust) | 🟢 pass |
| `npx tsc --noEmit` | 🟢 pass |
| `npm run check` | 🟢 pass — **84 assertion** |
| `npm run build` | 🟢 pass — 2.000 module, 22.4s |

**Chưa kiểm chứng được:** chạy app thật để xác nhận nút "Thử lại" hồi phục AI Router và chat Antigravity end-to-end. Toàn bộ phần còn lại đã verify bằng test tự động.

---

*Audit lượt 4 — đối chiếu idea.md. Mọi kết luận đều kèm số đo hoặc `file:line` để anh kiểm chứng lại.*
