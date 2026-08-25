# VuaAssistant — Lịch sử phát triển

> Tổng hợp toàn bộ hành trình dự án, từ ý tưởng ban đầu đến hiện tại.
> "AI cho mọi người — tải, cài, đăng nhập, kết nối, dùng." Cài trong 2 phút,
> không cấu hình, không terminal, không Docker cho người dùng cuối.

Tài liệu này kể lại **cái gì đã làm, quyết định ra sao, và vì sao**. Trạng thái
chi tiết từng tính năng nằm ở [`docs/IDEA.md`](./IDEA.md); nhật ký phiên bản ở
[`docs/CHANGELOGS.md`](./CHANGELOGS.md); quy trình dev ở [`docs/DEVELOPMENT.md`](./DEVELOPMENT.md).

---

## 1. Tầm nhìn & nguyên tắc

- **Sản phẩm**: trợ lý AI để bàn cho người thường, cài đặt 2 phút.
- **Triết lý**: Download → Install → Login → Connect → Start. Không lộ API key,
  terminal, Docker.
- **Menu**: Home, Chat, Agents, Skills, Knowledge, Vault, Scheduled,
  Integrations, Settings.
- **Công nghệ**: Tauri 2 (vỏ Rust) + React 18 + Vite 6 + TypeScript +
  TailwindCSS + Framer Motion.
- **Thương hiệu**: 360org · vuaai.net · support@vuaai.net. Logo vương miện +
  đầu AI dùng cho toàn bộ icon.
- **NanoClaw**: ban đầu định làm "engine ẩn"; về sau chuyển thành nguồn cảm hứng
  thiết kế + ổ cắm tùy chọn (xem mục 6). Tên NanoClaw **không xuất hiện** trong UI.

---

## 2. Các mốc phát triển (theo thứ tự)

| Giai đoạn | Nội dung |
|-----------|----------|
| **Khởi tạo** | Dựng khung app: menu, các trang, logo, responsive, bản demo/preview offline |
| **Skills** | Viết Skills đúng chuẩn [Agent Skills](https://agentskills.io); nạp thêm Skills của NanoClaw (channels/providers) |
| **Đăng nhập thật** | OAuth trực tiếp qua OpenRouter (PKCE), tạo user local từ tài khoản vendor |
| **Providers** | Stream thật: Anthropic, Google Gemini, OpenAI-compat (OpenRouter/OpenAI/Local) |
| **Vault** | Kho credential trên OS keychain; field động **chọn kiểu dữ liệu** (text/password/number/url/email/date/datetime) + icon |
| **Agents** | Instructions + Soul + Memory cho từng agent, tiêm vào system prompt |
| **Scheduled + Telegram** | Menu hẹn giờ; cấu hình Telegram (bot token) → Vault |
| **Hợp nhất** | Gom toàn bộ vào `idea.md` (feature → checklist); kỷ luật commit sau mỗi phần |
| **Đóng gói** | docker-compose test local; CI/CD; phát hành **v0.1.0** (installer macOS/Windows/Linux) |
| **Engine nhúng** | Bỏ yêu cầu Docker; agent tự thao tác qua Vault ngay trong app |
| **Telegram 2 chiều** | Kênh Telegram chạy thật trong app |
| **Scheduled chạy thật** | Bộ hẹn giờ tự chạy, giao kết quả vào chat + Telegram |
| **Kiểm chứng login** | Test luồng đăng nhập; tạo `CHANGELOG.md` |
| **Cô lập vai trò + Sandbox** | Mỗi role bộ nhớ/kiến thức riêng; WASM sandbox chạy code an toàn |
| **Tự học** | Self-improving memory (kiểu Hermes) |
| **Connectors** | Integration thành plugin, agent gọi tên → tự lấy credential từ Vault |
| **Quy trình dev** | `npm run check`, `version:set`, `DEVELOPMENT.md` |
| **Docker live-dev** *(đã bỏ)* | `docker-compose.dev.yml` + `dev.sh` (Colima). **Không còn dùng** — xem mốc "Bỏ Docker khỏi dev/test" bên dưới |
| **Đăng nhập thẳng vendor** | ChatGPT/Claude/Gemini kết nối trực tiếp vendor (mở trang → dán key → xong) |
| **Knowledge thật (RAG)** | Trích xuất PDF/Word/Excel/PowerPoint thật → chunks → truy xuất theo câu hỏi, tiêm vào prompt của đúng role |
| **Universal Agent Runner** | Kiến trúc độc lập SDK: tách "bộ não" & tool execution ra host process, giao tiếp qua SQLite IPC (inbound.db/outbound.db), Local Vault bảo mật, và Memory Scaffold per-agent |
| **Bỏ Docker khỏi dev/test** | Gỡ `dev.sh`, `docker-compose*.yml`, `Dockerfile`. Dev/test chạy **Tauri Host Process native** (`npm run tauri dev`) để kiểm đúng Vault, sidecar, filesystem và IPC thật — thứ Docker không phản ánh được |

---

## 3. Tính năng & mức kiểm chứng

Mọi tính năng đều có **test tự động** chạy trong CI (`npm run check`), không nói suông.

| Tính năng | Trạng thái | Kiểm chứng |
|-----------|-----------|-----------|
| Đăng nhập (OpenRouter OAuth + vendor trực tiếp) | ✅ | `scripts/login-check.mjs` |
| Streaming providers (Anthropic/Gemini/OpenAI-compat) | ✅ | trong build |
| Vault (keychain, field động có kiểu + icon) | ✅ | dùng trong app |
| Agent tự thao tác qua Vault (đăng blog, gọi API) | ✅ | `scripts/tool-loop-check.mjs` |
| Telegram 2 chiều trong app | ✅ | `scripts/telegram-check.mjs` |
| Scheduled tự chạy + giao kết quả | ✅ | `scripts/schedule-check.mjs` |
| Cô lập vai trò (memory + knowledge riêng) | ✅ | `scripts/isolation-check.mjs` |
| Self-improving memory (Hermes) | ✅ | `scripts/self-improve-check.mjs` |
| Connectors (đọc Vault, tự áp auth) | ✅ | `scripts/connector-check.mjs` |
| WASM code sandbox (feature tùy chọn) | ✅ | `examples/sandbox_check` |
| Loopback OAuth (desktop) | ✅ | `examples/oauth_loopback_check` |
| Knowledge thật: trích xuất + RAG theo role | ✅ | `scripts/rag-check.mjs` |

Còn lại (chưa làm): OAuth Drive/Outlook/Calendar; native OAuth cho từng vendor;
per-role skill sets; MCP client; ký & notarize macOS.

---

## 4. Kiến trúc hiện tại (Độc lập SDK - SQLite IPC)

```
Webview (React) ── Giao diện Desktop
   ├─ engine.ts        chọn engine & giao tiếp với SQLite IPC qua Tauri command
   └─ nanoclaw.ts      adapter kết nối trực tiếp inbound.db/outbound.db

Rust (Tauri) ── Vỏ Desktop & Cầu nối Tiến trình
   ├─ main.rs          khởi tạo, quản lý vòng đời ứng dụng
   ├─ lib.rs           tauri command handlers (runtime_send/receive/restart_runner)
   ├─ runtime.rs       quản lý tiến trình Agent Runner & khởi tạo schema SQLite IPC
   └─ vault.rs         VuaAssistant local secure vault (mã hóa XOR, lưu vault.db)

Agent Runner (Host) ── Bộ não độc lập (Node.js/TypeScript)
   ├─ index.ts         khởi chạy, nạp cấu hình, dựng system prompt
   ├─ poll-loop.ts     vòng lặp agentic loop tự động nhận tin & gọi công cụ (max 25 rounds)
   ├─ db/              connection.ts & sqlite.ts quản lý Two-DB SQLite IPC
   ├─ providers/       Gemini, OpenAI, Anthropic adapters trực tiếp (không dùng SDK)
   ├─ native-tools/    bash, file_read/write/edit, grep, glob, http_request
   ├─ mcp-client/      mcp-client stdio connection để chạy mcp servers ngoài
   └─ memory/          memory-scaffold.ts tạo cấu trúc memory cô lập per-agent
```

---

## 5. Quyết định kiến trúc quan trọng

- **Bỏ Docker cho người dùng cuối.** Ban đầu NanoClaw = engine + Docker per-agent.
  Chuyển sang **engine nhúng** để giữ lời hứa "cài 2 phút, chạy ngay". Docker chỉ
  còn là đường nâng cao tùy chọn.
- **Đa vai trò, không đa tiến trình.** Người dùng cần **chuyển vai trò cô lập**
  (Sale Expert ↔ Marketing Expert, mỗi bên memory/knowledge riêng), **không** cần
  chạy song song. → cô lập theo state, chuyển tức thì, 0 thời gian khởi động.
- **Sandbox = WASM (Wasmtime), tự viết bằng Rust.** Nhẹ, một binary, đa nền tảng;
  guest không có host import, có trần bộ nhớ + fuel → code loạn cũng không hại host.
  Để **tùy chọn** (`--features sandbox`) cho binary mặc định nhẹ.
- **Bảo mật credential.** Agent chỉ thấy *tên* thông tin, không thấy giá trị;
  secret được thay tại chỗ (`{{vault:...}}`) hoặc do connector tự áp auth → **không
  lọt vào model**.
- **Đăng nhập thẳng vendor.** ChatGPT/Claude/Gemini nối trực tiếp API vendor
  (không qua OpenRouter); OpenRouter giữ 1-click OAuth thật.

---

## 6. Vai trò của NanoClaw

- **Nguồn gốc thiết kế**: khái niệm channel, Agent Skills, Vault-cho-agent,
  scheduling đều lấy cảm hứng từ NanoClaw.
- **Ổ cắm tùy chọn (đang "ngủ")**: `runtime.rs` (IPC), `nanoclaw.ts` (adapter),
  `spawn_engine()` qua `VUA_ENGINE_DIR`. Mặc định không bật → app luôn dùng engine
  nhúng. Đây là chỗ duy nhất Docker có thể quay lại (cho power user cần sandbox
  container per-agent).

---

## 7. Quy trình phát triển & phát hành

```bash
# Chạy live native
npm run tauri dev

# Test trước khi commit (build + kiểm thử đầu-cuối)
npm run check

# Commit khi xanh
git commit -am "…" && git push

# Cắt phiên bản
npm run version:set 0.1.1     # đổi version 4 file
git tag v0.1.1 && git push --tags   # → Release workflow build installer
```

Chi tiết: [`DEVELOPMENT.md`](./DEVELOPMENT.md).

---

## 8. Phát hành

- **v0.1.0** — bản cài đầu tiên cho macOS (Apple Silicon + Intel), Windows, Linux
  (`.dmg/.exe/.msi/.deb/.AppImage/.rpm`) qua GitHub Actions.
- Nhánh phát triển hiện tại: `claude/vuaassistant-desktop-abs2gw` (chưa merge main).

---

*Cập nhật liên tục khi có tính năng mới. Xem `docs/CHANGELOGS.md` để biết chi tiết từng thay đổi.*
