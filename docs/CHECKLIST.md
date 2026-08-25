# VuaAssistant — Checklist Tính năng Hoàn thành (Production Verified)

> **Quy chuẩn:**
> - `[x]` = 100% Đã hoàn thành, có bài kiểm chứng tự động (contract checks / invariants / live tests)
> - Toàn bộ tính năng trong danh sách này đều hoạt động thực tế trên bản macOS/Windows/Linux native.
>
> *Cập nhật: 2026-08-25 (Phiên bản v1.1.65 — AIaC 3.0 Standard Docs & Multi-Agent Protocols)*

---

## 1. Tài liệu & Quy chuẩn Dự án

- [x] `README.md` — Giới thiệu dự án & hướng dẫn sử dụng
- [x] `AGENTS.md` — Quy chuẩn điều phối Multi-Agent
- [x] `docs/SPEC.md` — Đặc tả kỹ thuật & yêu cầu chức năng
- [x] `docs/ARCH.md` — Tài liệu kiến trúc hệ thống
- [x] `docs/DEPLOY_GUIDE.md` — Hướng dẫn triển khai
- [x] `docs/CHANGELOGS.md` — Nhật ký thay đổi & phát triển kiến trúc
- [x] `docs/PROJECT-HISTORY.md` — Lịch sử toàn bộ hành trình dự án
- [x] `docs/DEVELOPMENT.md` — Quy trình phát triển cho developer
- [x] `docs/HARNESS-PLAN.md` — Kế hoạch & kiểm chứng kiến trúc Harness / Kernel Plugin
- [x] `docs/AUDIT.md` — Báo cáo audit định kỳ hệ thống & kiểm chứng CI/CD
- [x] Đồng bộ toàn bộ tài liệu khớp 100% với kiến trúc Universal Agent Runner & Zero-Docker

---

## 2. Giao diện Desktop (Tauri + React)

### 2.1 Khung ứng dụng & Điều hướng
- [x] Tauri 2 desktop shell (Rust backend)
- [x] React 18 + Vite 6 + TypeScript + TailwindCSS + CSS transitions
- [x] Sidebar navigation responsive (mobile drawer + desktop fixed)
- [x] Animated page transitions (CSS `@keyframes`)
- [x] Menu đầy đủ: Home, Chat, Sessions, Agents, Skills, Knowledge, Media, Vault, Scheduled, Integrations, Settings
- [x] Logo vương miện + đầu AI (360org branding)

### 2.2 Trang Sessions
- [x] Danh sách phiên chat đã lưu, tìm kiếm và lọc theo kênh
- [x] Mở lại phiên, đổi tên phiên và xóa phiên
- [x] Hiển thị phiên desktop/Telegram với channel badge

### 2.3 Trang Chat
- [x] Giao diện chat streaming real-time
- [x] Hiển thị typing indicator
- [x] Quản lý chat sessions: tạo, chuyển, đổi tên, xóa và persist qua reload
- [x] Mỗi UI session truyền `sessionId` riêng xuống Agent Runner để cô lập history
- [x] Chuyển đổi provider trong 1 click
- [x] Chọn Agent/Role khi chat
- [x] Chọn Skill khi chat
- [x] Giao tiếp thời gian thực qua SQLite IPC (`inbound.db` / `outbound.db`)

### 2.4 Trang Agents
- [x] Danh sách Agent với agent store catalog
- [x] Cấu hình Instructions (hướng dẫn nghiệp vụ) per-agent
- [x] Cấu hình Soul (tính cách/phong cách) per-agent
- [x] Cấu hình Memory (bộ nhớ lâu dài) per-agent
- [x] Cô lập vai trò: chuyển Agent không pha trộn dữ liệu
- [x] Import file markdown cấu hình Agent (persona "The Agency") từ URL → Agent (name/description/emoji/soul/instructions), cài & kích hoạt ngay (`scripts/agent-import-check.mjs`)
- [x] Người dùng nhập nhiều file markdown để định nghĩa Agent (dán URL trong Agent Store → "Nhập từ URL"). Tương thích bộ msitarzewski/agency-agents (230+ agent)
- [x] Export cấu hình Agent ra file markdown

### 2.5 Trang Skills & Kỹ năng Thực thi (Executable Skills)
- [x] Hiển thị danh sách built-in skills (24 skills chuẩn Agent Skills spec)
- [x] Cài đặt skill từ URL (raw SKILL.md) & GitHub directory tree import
- [x] Validate skills khi build (`validate-skills.mjs`)
- [x] Inject skill instructions vào prompt Agent Runner
- [x] Per-role skill sets (mỗi Agent có bộ skill riêng)
- [x] **Executable Skills (DeepSeek Harness style)**: Skill khai báo & gọi trực tiếp plugins/tools (`file_read`, `http_request`, `mcp`, `schedule_task`...)
- [x] **In-chat Skill Management**: Người dùng ra lệnh trong chat để tạo mới hoặc cập nhật nội dung Skill (`create_or_update_skill`, `read_skill_file`)
- [x] **Live Skill Sync**: Tự động lưu file vật lý `skills/<name>/SKILL.md` và hot-reload lên UI/Runner không cần restart app (`scripts/executable-skills-check.mjs`)

### 2.6 Trang Knowledge
- [x] Upload tài liệu: PDF, Word, Excel, PowerPoint, Text
- [x] Trích xuất nội dung on-device (parsing cục bộ)
- [x] Chia nhỏ thành chunks & lập chỉ mục
- [x] Truy vấn TF-IDF cục bộ
- [x] Knowledge cô lập per-role (role này không thấy knowledge role khác)
- [x] RAG: inject excerpts vào prompt dựa trên câu hỏi (`scripts/rag-check.mjs`)

### 2.7 Trang Vault
- [x] CRUD credential (tạo/đọc/sửa/xóa)
- [x] Field động: chọn kiểu dữ liệu (text/password/number/url/email/date/datetime) + icon
- [x] VuaAssistant Vault nội bộ: SQLite mã hóa AES-256-CBC + HMAC-SHA256; không dùng OS Keychain
- [x] Opaque variable resolution: `{{credential:field}}` chỉ resolve trong AI Router trusted gateway, không lộ ra Webview/Model

### 2.8 Trang Scheduled
- [x] Lập lịch tác vụ (cron expression / interval / date-time)
- [x] Agent tự chạy theo lịch trong Host Process
- [x] Giao kết quả vào chat + Telegram
- [x] Lập lịch hàng loạt qua native tool `schedule_task`

### 2.9 Trang Integrations
- [x] Hiển thị danh sách integration templates
- [x] Connectors đọc Vault, tự áp auth & redaction response

### 2.10 Trang Media Gallery
- [x] Hiển thị gallery các media đã tạo hoặc tải lên
- [x] Nạp ảnh từ file record/đường dẫn native của app
- [x] Hiển thị trạng thái trống khi chưa có media

### 2.11 Trang Settings & Onboarding
- [x] Chọn AI provider, cấu hình model, API Key / Base URL
- [x] Onboarding: OAuth login, local user, bỏ qua Welcome lần sau
- [x] Tự động tải thẳng vào trang Chat khi đã onboarding
- [x] Kết nối vừa lưu là chat được ngay (`Pending test` vẫn phục vụ, chỉ `Failed` bị ẩn)
- [x] Lỗi nhà cung cấp hiển thị câu người dùng hiểu, không đổ JSON thô
- [x] Thư mục dữ liệu thống nhất `~/vuaassistant` ở cả vỏ desktop lẫn Agent Runner

---

## 3. Đăng nhập & Xác thực (Authentication)

- [x] Loopback OAuth desktop (PKCE) qua trình duyệt hệ thống
- [x] Đăng nhập qua OpenRouter (1-click OAuth)
- [x] Đăng nhập trực tiếp vendor: ChatGPT / Claude / Gemini / Codex / Grok
- [x] Local user creation sau OAuth thành công ở cả 4 lối đăng nhập (`scripts/local-user-check.mjs`)
- [x] Lối "dùng thử không cần tài khoản" cũng tạo hồ sơ local trước khi vào ứng dụng
- [x] Onboarding chờ ghi kết nối vào AI Router xong mới vào ứng dụng (`scripts/onboarding-connection-check.mjs`)
- [x] Tự động làm mới token (Token Refresh) cho Gemini OAuth / Antigravity

---

## 4. AI Providers & AI Router

- [x] Provider Core snapshot v0.5.30 tại `ai-router/core/open-sse`
- [x] AI Router chạy sidecar độc lập tại cổng chuẩn `http://127.0.0.1:36360/v1`
- [x] Multi-account per vendor: quản lý nhiều tài khoản trên cùng 1 nhà cung cấp, reset và chuyển đổi độc lập (`scripts/ai-router-multi-account-check.mjs`)
- [x] AI Router Pack: gom nhóm các model ưa thích, tự động fallback và round-robin giữa các model Verified
- [x] Credential Boundary: Agent chỉ thấy opaque ref `{{credential:field}}`, không lộ API key / raw secret (`scripts/credential-boundary-check.mjs`)
- [x] Auto-retry & Fallback: Bounded exponential backoff khi gặp lỗi 429/529 từ Claude, ChatGPT, Gemini
- [x] OpenAI-compatible streaming (ChatGPT, OpenRouter, LocalAI)
- [x] Anthropic Messages API streaming (Claude)
- [x] Google Gemini streamGenerateContent
- [x] OpenRouter auto-routing & token credit capping
- [x] LocalAI / Ollama (endpoint localhost tuỳ chỉnh)
- [x] Model override cho từng provider

---

## 5. Universal Agent Runner (Host Process)

- [x] Chạy thuần Node.js native Host Process (Zero-Docker)
- [x] Provider Registry pattern & Seam kiến trúc trên Kernel (`agent-runner/src/kernel/`)
- [x] Adapter OpenAI-compatible, Anthropic Messages API, Google Gemini, Ollama/LocalAI
- [x] Two-DB SQLite IPC architecture (`inbound.db` + `outbound.db`)
- [x] Invariant Checks & "Model-visible ⟺ Logged" (`scripts/invariants-check.mjs`)
- [x] Native Tools an toàn: `FileRead`, `FileWrite`, `FileEdit`, `Grep`, `Glob`, `http_request`, `vault_list`, `connector_request`, `schedule_task`, `search_memory`, `computer_use`, `delegate_task`, `create_or_update_skill`, `read_skill_file`
- [x] Capability Rail & Policy Gate: Chặn đường dẫn cấm, yêu cầu người dùng phê duyệt với công cụ có tác dụng phụ (`scripts/capability-rail-check.mjs`, `scripts/native-tools-policy-check.mjs`)
- [x] Loop Guard & Context Pruning: Chống giậm chân tại chỗ, tự động tóm tắt và cắt tỉa lịch sử hội thoại dài (`scripts/loop-guard-check.mjs`, `scripts/context-prune-check.mjs`)
- [x] Daily Token Budget: Quản lý và giới hạn ngân sách token hàng ngày (`scripts/daily-budget-check.mjs`)
- [x] MCP Server built-in stdio (JSON-RPC 2.0): `initialize` / `tools/list` / `tools/call` (`agent-runner/src/mcp-tools/server.ts`)
- [x] Core tools: `send_message`, `ask_user_question`, `schedule_message`

---

## 6. Self-Improving Memory & Tri thức

- [x] Agent tự động suy ngẫm sau hội thoại và trích xuất dữ liệu người dùng vào `agents/<name>/memory/memories/learned.md`
- [x] Tự động tóm tắt và cô đọng bộ nhớ (`summarizeMemoryIfNeeded`) khi vượt quá 30 mục
- [x] Công cụ tra cứu bộ nhớ cục bộ `search_memory`
- [x] Cô lập bộ nhớ tuyệt đối giữa các vai trò (Role Isolation)

---

## 7. Kênh Giao tiếp (Channels)

- [x] Desktop Chat (Webview ↔ SQLite IPC)
- [x] Telegram Channel tích hợp trong Host Process (Long-polling 2 chiều, phản hồi tức thì, lưu phiên hội thoại)
- [x] Web Lock chống xung đột đa tiến trình trên cùng 1 Telegram Token

---

## 8. Bảo mật & Giới hạn Quyền

- [x] API keys chỉ gửi đến vendor, không gửi nơi khác
- [x] Agent chỉ thấy opaque ref + tên biến, không thấy giá trị bí mật
- [x] Secret chỉ resolve trong trusted AI Router gateway và response được redaction trước khi trả về agent
- [x] Vault mã hóa AES-256-CBC + HMAC-SHA256 nội bộ
- [x] Không expose Bash/host shell trực tiếp cho model
- [x] File system sandboxing ở `VUA_AGENT_WORKSPACE`
- [x] Egress lockdown: credentialed request đã bind đúng origin trong Vault
- [x] Màn hình chính sách trong Settings (`PolicySettingsSection.tsx` → `policy.json` → `capability rail`)
- [x] Vai kiểm độc lập (maker/checker) (`agent-runner/src/verifier.ts`) trong phiên riêng, không công cụ

---

## 9. Vòng lặp Tự chủ & Điều khiển Nâng cao

- [x] **Cơ chế Lập kế hoạch (Planning Mechanism):** Phân rã tác vụ thành Plan chi tiết, xác định Done criteria và cập nhật tiến trình
- [x] **Tự sửa lỗi & Phục hồi (Self-Correction):** Tự động phân tích nguyên nhân khi tool lỗi và thử phương án khắc phục
- [x] **Chủ động hoàn tất tác vụ (Task Completion):** Tự động thực thi từng bước trong kế hoạch mà không cần nhắc lệnh
- [x] **Web Search & HTTP Fetch:** Tìm kiếm thông tin web và đọc trang HTML/Markdown an toàn
- [x] **Rich Markdown Blocks:** Hiển thị Code block syntax highlighting + Copy 1-click, Tables, Blockquotes

---

## 10. Kiểm Thử & CI/CD

- [x] `npm run check` tích hợp 18 bài kiểm chứng contract tự động
- [x] `cd agent-runner && npm run check` chạy toàn bộ 26 bài test Kernel & Invariants
- [x] `cargo check` biên dịch sạch Rust backend
- [x] Desktop Bundle Contract Check (`scripts/desktop-bundle-contract-check.mjs`)
- [x] Desktop OAuth Check (`scripts/desktop-oauth-check.mjs`)
- [x] Executable Skills Lifecycle Check (`scripts/executable-skills-check.mjs`)
- [x] GitHub Actions Release Workflow: Tự động build installer đa nền tảng (macOS Intel/Apple Silicon, Windows, Linux) khi có tag `v*`
- [x] Bundle Agent Runner + Node runtime vào Tauri resources (Zero-dependency)
- [x] Code signing & notarize macOS

---

## Bảng Tổng kết Trạng thái

| Nhóm Tính năng | Trạng thái | Kiểm chứng Thực tế |
|---|:---:|---|
| **Tài liệu & Đặc tả** | 100% Hoàn thành | Đầy đủ 10/10 file Markdown chuẩn 360org |
| **Giao diện Desktop (Tauri + React)** | 100% Hoàn thành | 11 trang giao diện responsive, real-time streaming |
| **Authentication & Local User** | 100% Hoàn thành | PKCE OAuth, multi-vendor login, token refresh |
| **AI Providers & AI Router Sidecar** | 100% Hoàn thành | 116 providers kế thừa, multi-account, combo packs |
| **Universal Agent Runner & Kernel** | 100% Hoàn thành | Kernel plugin seam, Two-DB SQLite IPC, loop guard |
| **Executable Skills & In-Chat Lifecycle** | 100% Hoàn thành | YAML frontmatter tools, CRUD skill in chat, hot sync |
| **Knowledge RAG & Tri thức On-device** | 100% Hoàn thành | Local TF-IDF chunking, PDF/Word/Excel parsing |
| **Vault & Bảo mật Credential** | 100% Hoàn thành | AES-256-CBC, opaque ref boundary, auto-redact |
| **Channels (Desktop + Telegram)** | 100% Hoàn thành | Long-polling 2 chiều, web lock single-instance |
| **Testing & CI/CD** | 100% Hoàn thành | 44 contract tests (18 root + 26 runner) 100% PASS |
