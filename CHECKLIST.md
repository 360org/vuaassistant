# VuaAssistant — Checklist Tính năng Tổng thể

> **Nguồn tham chiếu chéo:**
> - [NanoClaw](file:///Volumes/DATA/DEV/NanoClaw) — Agent Runner, Poll Loop, SQLite IPC, MCP Tools, Channels, Provider Registry
> - [Hermes](file:///Volumes/DATA/DEV/hermes) — Agent Souls, Memory, Dashboard, Gateway, 9router integration
> - [Claw (GitLab)](file:///Volumes/DATA/DEV/claw) — Script quản trị, Telegram Webhook, Docker deployment, Security patterns
> - [9router](file:///Volumes/DATA/DEV/9router-temp) — AI Router proxy, Multi-provider, RTK Token Saver, Skills, OAuth, MCP
>
> **Quy ước:**
> - `[x]` = Đã hoàn thành & có test
> - `[~]` = Đã có code nhưng cần refactor/cập nhật cho kiến trúc mới
> - `[ ]` = Chưa triển khai
> - `[REF: ...]` = Tham chiếu file/module gốc cần kế thừa
>
> *Cập nhật lần cuối: 2026-08-04*

---

## 1. Tài liệu & Quy chuẩn Dự án

- [x] `README.md` — Giới thiệu dự án & hướng dẫn sử dụng
- [x] `SPEC.md` — Đặc tả kỹ thuật & yêu cầu chức năng
- [x] `ARCH.md` — Tài liệu kiến trúc hệ thống
- [x] `DEPLOY_GUIDE.md` — Hướng dẫn triển khai
- [x] `CHANGELOGS.md` — Nhật ký phát triển module
- [x] `CHANGELOG.md` — Lịch sử thay đổi theo phiên bản
- [x] `PROJECT-HISTORY.md` — Lịch sử toàn bộ hành trình dự án
- [x] `DEVELOPMENT.md` — Quy trình phát triển cho developer
- [x] `idea.md` — Ý tưởng sản phẩm & thiết kế kiến trúc tầm nhìn
- [x] Đồng bộ lại tất cả tài liệu khớp 100% với kiến trúc Universal Agent Runner mới
- [x] Cập nhật `PROJECT-HISTORY.md` ghi nhận quyết định chuyển sang Universal Agent Loop

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
- [x] Chuyển từ gọi engine nhúng trực tiếp → giao tiếp qua SQLite IPC (cho kiến trúc mới)
  `[REF: NanoClaw/container/agent-runner/src/db/messages-in.ts + messages-out.ts]`

### 2.4 Trang Agents
- [x] Danh sách Agent với agent store catalog
- [x] Cấu hình Instructions (hướng dẫn nghiệp vụ) per-agent
- [x] Cấu hình Soul (tính cách/phong cách) per-agent
- [x] Cấu hình Memory (bộ nhớ lâu dài) per-agent
- [x] Cô lập vai trò: chuyển Agent không pha trộn dữ liệu
- [x] Import file markdown cấu hình Agent (persona "The Agency") từ URL →
      Agent (name/description/emoji/soul/instructions), cài & kích hoạt ngay.
      `src/runtime/agentImport.ts` · test `scripts/agent-import-check.mjs`
- [x] Người dùng nhập nhiều file markdown để định nghĩa Agent (dán URL trong
      Agent Store → "Nhập từ URL"). Tương thích bộ msitarzewski/agency-agents (230+ agent)
- [x] Export cấu hình Agent ra file markdown

### 2.5 Trang Skills
- [x] Hiển thị danh sách built-in skills (10 skills)
- [x] Cài đặt skill từ URL (raw SKILL.md)
- [x] Validate skills khi build (`validate-skills.mjs`)
- [x] Inject skill instructions vào prompt Agent Runner (cần cập nhật cho IPC)
- [x] Per-role skill sets (mỗi Agent có bộ skill riêng)
  `[REF: NanoClaw/src/group-skills.ts — quản lý skill per-group]`

### 2.6 Trang Knowledge
- [x] Upload tài liệu: PDF, Word, Excel, PowerPoint, Text
- [x] Trích xuất nội dung on-device (parsing cục bộ)
- [x] Chia nhỏ thành chunks & lập chỉ mục
- [x] Truy vấn TF-IDF cục bộ
- [x] Knowledge cô lập per-role (role này không thấy knowledge role khác)
- [x] RAG: inject excerpts vào prompt dựa trên câu hỏi

### 2.7 Trang Vault
- [x] CRUD credential (tạo/đọc/sửa/xóa)
- [x] Field động: chọn kiểu dữ liệu (text/password/number/url/email/date/datetime) + icon
- [x] VuaAssistant Vault nội bộ: SQLite mã hóa AES-256-CBC + HMAC-SHA256;
  không dùng OS Keychain

### 2.8 Trang Scheduled
- [x] Lập lịch tác vụ (cron expression / interval)
- [x] Agent tự chạy theo lịch
- [x] Giao kết quả vào chat + Telegram
- [ ] UI quản lý lịch sử chạy / logs per-task
  `[REF: NanoClaw/container/agent-runner/src/mcp-tools/scheduling.ts — scheduling MCP tools]`

### 2.9 Trang Integrations
- [x] Hiển thị danh sách integration templates
- [x] Connectors đọc Vault, tự áp auth
- [ ] Wizard kết nối từng bước cho connector mới
- [ ] Trạng thái connected / disconnected realtime

### 2.10 Trang Media Gallery
- [x] Hiển thị gallery các media đã tạo hoặc tải lên
- [x] Nạp ảnh từ file record/đường dẫn native của app
- [x] Hiển thị trạng thái trống khi chưa có media

### 2.11 Trang Settings & Onboarding
- [x] Chọn AI provider, cấu hình model, API Key / Base URL
- [x] Onboarding: OAuth login, local user, bỏ qua Welcome lần sau
- [x] Đồng bộ hóa React state & Vault lưu trên host qua Vite API dev middleware (tránh mất kết nối khi đổi trình duyệt)
- [x] Tự động tải thẳng vào trang Chat (thay vì Home) khi onboarded = true
- [x] Quản lý phiên đăng nhập và yêu cầu đăng nhập lại khi session hết hạn
- [x] Kết nối vừa lưu là chat được ngay: model không đòi smoke test phải xong
      trước (`Pending test` vẫn phục vụ, chỉ `Failed` bị ẩn) — #19/#16
- [x] Lỗi nhà cung cấp hiển thị câu người dùng hiểu, không đổ JSON thô — #13
- [x] Thư mục dữ liệu thống nhất `~/vuaai-data` ở cả vỏ desktop lẫn Agent Runner
      (trước đây runner mặc định `~/.v-vuaai` nên ghi lệch chỗ) — #15
- [ ] Theme / Language settings
- [ ] Data export / import

---

## 3. Đăng nhập & Xác thực (Authentication)

> **Luồng thật trên desktop — đọc trước khi sửa bất cứ thứ gì ở đây.**
> `Onboarding` → `beginManualSignIn` → mở **trình duyệt hệ thống**
> (`openExternal`) → người dùng đăng nhập → **tự dán URL callback** trở lại ứng
> dụng (`setStep("manual")`).
>
> - OAuth **không** chạy trong webview (đã bỏ từ trước). Chữ "WebView" còn trong
>   mã chỉ là nơi Tauri render giao diện.
> - Desktop **không hứng callback**: mã uỷ quyền quay về **bằng thao tác dán**.
>   Vì vậy cổng 1420 **không cần** ai lắng nghe ở bản đóng gói. Chỉ Codex (1455)
>   và xAI (56121) có relay vì hai nhà cung cấp đó cần.
> - Đọc lỗi OAuth: lỗi hiện **trên trang nhà cung cấp** ⇒ sai ở bước uỷ quyền
>   (`client_id` / `redirect_uri` / `scope`); lỗi hiện **trong ứng dụng** ⇒ sai
>   ở bước đổi mã hoặc nhận callback. Xác định đúng bước rồi mới sửa.
> - Đã có một lần chẩn đoán sai theo hướng "thiếu relay hứng callback"
>   (`3b28047`, đã revert ở `ed9ba92`). Đừng lặp lại.

- [x] Loopback OAuth desktop (PKCE) qua trình duyệt hệ thống
- [x] Đăng nhập qua OpenRouter (1-click OAuth)
- [x] Đăng nhập trực tiếp vendor: ChatGPT / Claude / Gemini (dán API key)
- [x] Local user creation sau OAuth thành công — hồ sơ tạo trong `connectProvider`
      ở cả 4 lối đăng nhập (một chạm, dán callback thủ công, nhập khoá, OAuth
      quay lại trên web); tra cứu danh tính hỏng vẫn tạo hồ sơ với tên đường lui.
      Test: `scripts/local-user-check.mjs`
- [x] Lối "dùng thử không cần tài khoản" cũng tạo hồ sơ local trước khi vào ứng
      dụng. Thiếu bước này thì App (`!onboarded || !user`) đá ngược về
      Onboarding và nút "Start chatting" trông như nút hỏng.
      Test: `scripts/local-user-check.mjs` (đã thử nghịch đảo — bỏ
      `ensureLocalUser` là hai mục đỏ ngay).
- [x] Onboarding chờ ghi kết nối vào AI Router xong mới vào ứng dụng; ghi hỏng
      thì thử lại (sau khi restart AI Router) rồi báo lỗi, không im lặng đi tiếp
      (#18). Test: `scripts/onboarding-connection-check.mjs`
- [ ] **Windows 10 Home Single Language: Google trả `400: invalid_request`**
      (#11 Gemini, #12 Claude, #14 ChatGPT). Lỗi hiện trên trang nhà cung cấp ⇒
      thuộc bước uỷ quyền. **Cần URL uỷ quyền thật người dùng gặp** (đầy đủ
      `client_id`, `redirect_uri`, `scope`) mới chẩn đoán được. Chưa có cách tái
      hiện trong CI vì cần máy Windows thật + tài khoản thật.
- [~] Native OAuth flow cho từng vendor (không cần dán key thủ công). Desktop
  manual callback Gemini/Claude đã chuyển authorize/exchange sang AI Router
  sidecar và có contract `npm run check:desktop-oauth`; còn cần real
  desktop smoke với từng subscription trước khi đánh dấu hoàn thành.
- [~] AI Router desktop sidecar phải chạy từ bundled resource và bundled Node
  runtime, không phụ thuộc Node cài trên máy. Chờ kiểm tra DMG macOS artifact
  có `Resources/_up_/runtime/node/node`, runtime dependencies và real provider
  catalog smoke. Có contract `npm run check:desktop-bundle`; CI kiểm tra
  lại artifact sau build.
  `[REF: 9router/src/lib/oauth/ — OAuth flows cho nhiều provider]`
- [ ] OAuth Drive / Outlook / Calendar
- [ ] Token refresh tự động

---

## 4. AI Providers — Đa nhà cung cấp

### 4.1 Streaming & API hiện có (Engine nhúng Webview)
- [x] OpenAI-compatible streaming (ChatGPT, OpenRouter, LocalAI)
- [x] Anthropic Messages API streaming (Claude)
- [x] Google Gemini streamGenerateContent
- [x] OpenRouter auto-routing
- [x] LocalAI / Ollama (endpoint localhost tuỳ chỉnh)
- [x] Model override cho từng provider

### 4.2 AI Router (kế thừa 9router Provider Core)
- [x] Copy snapshot 9router Provider Core v0.5.30 vào
  `ai-router/core/open-sse` (commit nguồn `9845a17`). Bao gồm
  registry/executor/translator/OAuth/refresh/model catalog cho tất cả vendor;
  không phụ thuộc Git submodule, dashboard hay process 9router.
- [x] Đổi ranh giới Runner sang provider nội bộ `ai-router`; giữ `9router` chỉ
  là alias tương thích config cũ. Contract proxy: `http://127.0.0.1:36360/v1`.
- [x] Chat không còn dropdown vendor. Model selector đọc `/v1/models` của AI
  Router; request được đánh dấu router-only để không lén gọi vendor trực tiếp.
- [~] Settings bỏ trạng thái "active provider" cũ và chỉ hiển thị connection
  thực qua `/v1/providers`. Provider Manager dùng catalog nguồn và có hành
  động Subscription/API key; tất cả connection có Test/Reset; không hiển thị
  model trước khi Core probe inference thành công.
- [x] Live catalog guard: với `connections=[]`, AI Router `/v1/models` trả
  `0` model thay vì static catalog upstream. Đã probe loopback ngày 2026-07-15.
- [x] Build AI Router native host chỉ expose local API `/v1` và health/models;
  không mang dashboard, user management, billing, i18n hay MITM của 9router.
- [ ] Chạy nguyên Provider Core đã copy qua compatibility adapter: thay các
  dependency 9router (`@/lib/usageDb`, account store, auth/session, config)
  bằng implementation nội bộ AI Router, không viết lại registry/executor/
  translator của từng vendor.
- [x] Native connection metadata store không chứa secret; credential được ghi
  vào Vault với `ai-router:credential:<connection-id>`. `/v1/models` chỉ trả
  models từ connection metadata, đã smoke-test Antigravity: 0 -> 9 models.
- [x] Antigravity vertical smoke qua native Router: Vault credential reference
  -> `/v1/chat/completions` -> inherited `handleChatCore`/`AntigravityExecutor`
  -> OpenAI SSE. Ngày 2026-07-15 nhận HTTP 200 và content tiếng Việt thực.
- [x] Router connection state chỉ lưu `credentialRef`; AI Router tự resolve
  ref từ Vault dev broker. Smoke 2026-07-15 gửi request không có credential
  header vẫn nhận HTTP 200/SSE `Vault bridge passed` từ Antigravity.
- [~] Port OAuth/subscription Core: native host đã expose provider catalog,
  PKCE authorize/exchange và device-code start/poll từ source copied. UI dùng
  một browser OAuth client chung cho authorization-code providers; cần real
  smoke theo từng subscription trước khi đánh dấu vendor Connected.
- [x] Codex OAuth callback compatibility: authorize dùng URI đã đăng ký
  `http://localhost:1455/auth/callback`, relay giữ nguyên origin khởi tạo của
  VuaAssistant (`localhost` hoặc `127.0.0.1`) để callback thực sự cập nhật UI.
- [x] AI Router CORS cho phép đúng hai UI loopback origin `localhost:1420` và
  `127.0.0.1:1420`; không dùng wildcard vì Router có quyền dùng Vault credential.
- [x] Bản dev dùng một App Vault duy nhất: UI dev broker và AI Router cùng
  đọc/ghi `.vua_vault_dev.json`; connection metadata chỉ giữ `credentialRef`.
- [x] Claude OAuth callback compatibility: authorize/exchange dùng URI cố định
  `http://localhost:443/callback`; Provider Manager cho dán full callback URL
  và không coi việc đóng popup là đăng nhập thất bại.
- [x] Real OAuth smoke Codex và Claude: callback tạo credential trong App Vault,
  `POST /v1/providers/:id/test` trả Verified; Codex HTTP 200 với
  `codex/gpt-5.6-sol`, Claude HTTP 200 với model native và models đã xuất hiện.
- [x] Provider Manager dọn manual callback state ngay khi connection chuyển
  sang `Verified`; không giữ form callback/loading hoặc nút đăng nhập cũ.
- [x] Multi-account per vendor theo cơ chế 9router: mỗi login/API key có UUID,
  `accountLabel/email/priority` và Vault credentialRef riêng; card hiển thị account,
  models được dedupe theo provider/model, reset độc lập từng account và lỗi
  401/403/429/5xx thử account tiếp theo cùng vendor trước.
- [x] Generic connection verification and reset: `POST /v1/providers/:id/test`
  gọi `handleChatCore` + registry model đầu tiên; `DELETE /v1/providers/:id`
  xóa metadata và Settings xóa Vault credential reference. Models chỉ load
  khi `testStatus=Verified`. Smoke Antigravity ngày 2026-07-17: HTTP 200,
  test model `antigravity/gemini-3-flash-agent`, sau đó `/v1/models` trả đúng
  9 model của connection này.
- [x] Bridge Vault theo opaque `credentialRef` + process capability từ Tauri.
  Connection metadata và secret đều có nguồn duy nhất trong App Vault;
  Runner/`runner.json` không chứa raw access token/API key.
- [x] Agent credential boundary: model chỉ nhận ref + tên biến
  `{{credential:field}}`; Tauri/AI Router resolve trong memory, bind request
  vào origin của Vault entry và redaction response trước khi trả về agent.
  `vault_list` query sanitized manifest trực tiếp từ App Vault, không dùng
  metadata cache/file ngoài Vault.
  Test: `scripts/credential-boundary-check.mjs` và
  `scripts/connector-capability-check.mjs`.
- [ ] Thay provider state lạc quan bằng health check thật qua AI Router; chỉ
  hiển thị provider/model đã login, còn hiệu lực và probe thành công.
- [ ] Real vertical smoke: Vault -> AI Router -> Agent Runner -> SQLite
  inbound/outbound -> UI, bắt đầu với OpenRouter. Chỉ tick sau khi nhận được
  một response thực và một tool call thực.
- [ ] Real catalog smoke: connect two different vendor accounts in AI Router,
  verify Settings lists both connections and Chat lists only their available
  models; disconnect one and verify its models disappear.
- [ ] Bật lần lượt Antigravity Gemini, Codex ChatGPT, Claude và các vendor
  upstream khác bằng cùng bridge, với smoke test mỗi vendor.
- [ ] RTK Token Saver — auto-compress tool_result, tiết kiệm 20-40% token
  `[REF: 9router/src/sse/ — server-sent events + token compression]`
- [ ] Multi-account round-robin giữa nhiều API key/provider
  `[REF: 9router/src/lib/headroom/ — quota tracking & fallback tiers]`
- [ ] Auto-fallback: Subscription → Cheap → Free (zero downtime)
  `[REF: 9router architecture: Tier 1 → Tier 2 → Tier 3]`
- [ ] Provider normalization (OpenAI ↔ Claude format translation)
  `[REF: 9router/src/lib/providerNormalization.js]`

---

## 5. Universal Agent Runner (Host Process)

> **Trạng thái: HOÀN THÀNH** — Đã kế thừa và tối ưu hóa kiến trúc từ `NanoClaw/container/agent-runner/`
> chạy hoàn toàn không cần Docker.

### 5.1 Khung dự án
- [x] Tạo thư mục `agent-runner/` trong repo
- [x] `package.json` (Bun/Node compatible)
  `[REF: NanoClaw/container/agent-runner/ — project structure]`
- [x] Cấu hình TypeScript riêng
- [x] Entry point: `index.ts` — khởi động daemon poll loop
  `[REF: NanoClaw/container/agent-runner/src/index.ts — main entry + config loading]`

### 5.2 Config system
- [x] `config.ts` — đọc `container.json` (provider, assistantName, mcpServers, model, effort)
  `[REF: NanoClaw/container/agent-runner/src/config.ts — RunnerConfig interface]`
- [x] Hỗ trợ đọc config từ Tauri app data directory thay vì `/workspace/agent/`

### 5.3 Universal LLM Client (Thay thế Claude SDK)
- [x] Provider Registry pattern (factory + self-registration)
  `[REF: NanoClaw/container/agent-runner/src/providers/provider-registry.ts]`
  `[REF: NanoClaw/container/agent-runner/src/providers/factory.ts — createProvider()]`
- [x] `AgentProvider` interface thống nhất
  `[REF: NanoClaw/container/agent-runner/src/providers/types.ts — AgentProvider, AgentQuery, ProviderEvent]`
- [x] Adapter OpenAI-compatible (ChatGPT, OpenRouter, LocalAI/Ollama)
- [x] Adapter Anthropic Messages API (Claude) — **KHÔNG dùng Claude Agent SDK**
  `[REF: NanoClaw/container/agent-runner/src/providers/claude.ts — hiện dùng SDK, cần viết lại bằng API trực tiếp]`
- [x] Adapter Google Gemini (streamGenerateContent)
- [x] Streaming support cho tất cả adapters (AsyncIterable<ProviderEvent>)
- [x] Tool call / function calling chuẩn hoá chung
- [x] Continuation/session management: state được cô lập theo
      agent/channel/platform/thread, provider stateless persist transcript,
      resume qua runner restart và `/clear` chỉ xóa session hiện tại
  `[REF: NanoClaw poll-loop.ts L89-L112 — continuation management + rotation]`

### 5.4 Poll Loop (Vòng lặp chính)
- [x] `poll-loop.ts` — poll `inbound.db` → format → query provider → write `outbound.db`
  `[REF: NanoClaw/container/agent-runner/src/poll-loop.ts — 696 dòng, logic đầy đủ]`
- [x] Heartbeat liveness detection
  `[REF: NanoClaw/container/agent-runner/src/db/connection.ts — touchHeartbeat()]`
- [x] Command handling (/clear, /upload-trace)
  `[REF: NanoClaw poll-loop.ts L158-L191 — command detection]`
- [x] Message formatting & routing extraction
  `[REF: NanoClaw/container/agent-runner/src/formatter.ts — formatMessages, extractRouting]`
- [x] Accumulate gate (trigger=0 context-only, trigger=1 wake-eligible)
  `[REF: NanoClaw poll-loop.ts L145-L148]`
- [x] Corruption detection & auto-recovery
  `[REF: NanoClaw poll-loop.ts L43-L49 — isCorruptionError()]`
- [x] Idle timeout & retry logic
- [x] Activity tracking (liveness signals during long tool runs)

### 5.5 System Prompt Composition
- [x] `destinations.ts` — agent identity + destination map → system prompt addendum
  `[REF: NanoClaw/container/agent-runner/src/destinations.ts — buildSystemPromptAddendum()]`
- [x] Compose CLAUDE.md equivalent từ nhiều fragment (Instructions + Soul + Memory + Skills)
  `[REF: NanoClaw/src/claude-md-compose.ts — compose entry file from fragments]`
- [x] Compact instructions (tối ưu token count)
  `[REF: NanoClaw/container/agent-runner/src/compact-instructions.ts]`

### 5.6 Native Tools (Chạy trong workspace được cấp)
- [x] Không expose `Bash`/host shell cho model
- [x] `FileRead` — chỉ đọc trong `VUA_AGENT_WORKSPACE`
- [x] `FileWrite` — chỉ ghi trong `VUA_AGENT_WORKSPACE`
- [x] `FileEdit` — tìm & thay thế nội dung file
- [x] `Grep` — tìm kiếm nội dung (ripgrep-style)
- [x] `Glob` — liệt kê file theo glob pattern
- [x] `http_request` — chỉ cho request không credential; chặn auth header,
  token literal và Vault placeholder
- [x] `vault_list` — chỉ trả opaque ref + tên biến, không trả giá trị
- [x] `connector_request` — gửi opaque ref qua trusted gateway; agent không
  nhận capability hay secret đã resolve

### 5.7 MCP Tools (Kế thừa NanoClaw)
- [x] MCP Server built-in stdio (JSON-RPC 2.0): `initialize` / `tools/list` / `tools/call`
  `agent-runner/src/mcp-tools/server.ts` — `startBuiltinMcpServer()`
- [x] Core tools: `send_message`, `ask_user_question`, `schedule_message`
  `agent-runner/src/mcp-tools/core.ts` — registry thống nhất
- [ ] Self-mod tools: self-improvement memory mutations
  `[REF: NanoClaw/container/agent-runner/src/mcp-tools/self-mod.ts]`
- [ ] Agent management tools: `list_agents`, `switch_agent`
  `[REF: NanoClaw/container/agent-runner/src/mcp-tools/agents.ts]`
- [x] Khai báo MCP servers bên ngoài qua `container.json`
  `[REF: NanoClaw/container/agent-runner/src/index.ts L77-L88 — mcpServers config]`

### 5.8 SQLite IPC Layer
- [x] Two-DB architecture: `inbound.db` (read-only) + `outbound.db` (write)
  `[REF: NanoClaw/container/agent-runner/src/db/connection.ts — Two-DB connection layer]`
- [x] `messages_in` table: id, seq, kind, timestamp, status, process_after, recurrence, trigger, platform_id, channel_type, thread_id, content
  `[REF: NanoClaw/container/agent-runner/src/db/messages-in.ts — MessageInRow]`
- [x] `messages_out` table: id, seq, in_reply_to, timestamp, deliver_after, recurrence, kind, platform_id, channel_type, thread_id, content
  `[REF: NanoClaw/container/agent-runner/src/db/messages-out.ts — MessageOutRow]`
- [x] `processing_ack` table (status tracking without writing to inbound.db)
- [x] `session_state` table (key-value: continuation, settings)
  `[REF: NanoClaw/container/agent-runner/src/db/session-state.ts]`
- [x] `session_routing` table (current channel/platform/thread binding)
  `[REF: agent-runner/src/db/session-routing.ts — stable scoped session identity]`
- [x] Poll batch không trộn message giữa hai channel/platform/thread
- [x] E2E session tests: isolation, restart resume, scoped clear
  `agent-runner/scripts/session-management-check.mjs`
- [x] Seq numbering: odd for container, even for host (tránh collision)
  `[REF: NanoClaw messages-out.ts L42-L54 — disjoint namespace]`
- [x] Journal mode DELETE (không dùng WAL vì cross-mount visibility)
  `[REF: NanoClaw connection.ts L12-L18 — VirtioFS mmap coherency issue]`
- [x] Liveness heartbeat file (`.heartbeat`)

### 5.9 Memory Scaffold
- [x] `memory-scaffold.ts` — tạo thư mục `memory/` per-agent khi boot
  `[REF: NanoClaw/container/agent-runner/src/memory-scaffold.ts]`
- [x] Memory templates (summaries, preferences, learnings)
  `[REF: NanoClaw/container/agent-runner/src/memory-templates/]`
- [x] Provider opt-in: `usesMemoryScaffold` flag
  `[REF: NanoClaw providers/types.ts L14-L15]`
- [ ] Hermes-style self-improving memory
  `[REF: Hermes/data/memories/ — bộ nhớ lưu dưới dạng file text/JSON]`

---

## 6. Tauri Desktop Shell (Rust Backend)

### 6.1 Quản lý Engine Process
- [x] `spawn_engine()` trong `runtime.rs` — spawn Bun/Node process
- [x] Inject biến môi trường (`CONTAINER_RUNTIME_BIN=process`, `VUA_DATA_DIR`, `VUA_IPC_DIR`)
- [x] Truyền AppHandle từ Tauri context khi spawn
- [x] Health check: kiểm tra Agent Runner còn sống, auto-restart nếu crash
  `[REF: NanoClaw/src/host-sweep.ts — host-sweep loop, restart crashed containers]`
- [x] Graceful shutdown: gửi signal dừng Agent Runner khi thoát app

### 6.2 Host-side Session Management
- [ ] Session manager: tạo/quản lý IPC databases per-agent
  `[REF: NanoClaw/src/session-manager.ts — 18886 bytes, quản lý session SQLite]`
- [ ] Container runner: spawn + monitor agent process lifecycle
  `[REF: NanoClaw/src/container-runner.ts — 22922 bytes, spawn + logging + restart]`
- [ ] Container config: generate `container.json` cho mỗi agent group
  `[REF: NanoClaw/src/container-config.ts]`
- [ ] Group folder management: thư mục làm việc per-agent
  `[REF: NanoClaw/src/group-folder.ts]`
- [ ] Group persona: instructions + soul file per-agent
  `[REF: NanoClaw/src/group-persona.ts]`

### 6.3 Message Delivery (Host → Container → Channels)
- [ ] Delivery system: đọc `outbound.db`, gửi message đến đúng channel
  `[REF: NanoClaw/src/delivery.ts — 16550 bytes, dispatch to channels]`
- [ ] Router: nhận message từ channels, ghi vào `inbound.db`
  `[REF: NanoClaw/src/router.ts — 20666 bytes, message routing]`
- [ ] Response registry: theo dõi message đã gửi / chưa gửi
  `[REF: NanoClaw/src/response-registry.ts]`

### 6.4 WASM Sandbox (Tùy chọn)
- [x] Wasmtime sandbox cho code execution an toàn
- [x] Feature flag `--features sandbox` (off mặc định)

---

## 7. Vault — Kho bảo mật Cốt lõi

> **Vault là tính năng chính của VuaAssistant, KHÔNG lấy từ OS Keychain**

- [x] CRUD credential cơ bản (hoàn toàn dùng local SQLite `vault.db`)
- [x] Chuyển sang VuaAssistant Vault nội bộ (SQLite mã hóa hoặc encrypted file)
- [x] Mã hóa AES-256-CBC + HMAC-SHA256; tự migrate format XOR legacy sang v2
- [ ] Master password hoặc device-bound key để unlock Vault
- [x] UI Vault API: `vault_set`, `vault_get`, `vault_delete`; Agent Runner
  không được gọi các API đọc secret này
- [x] Opaque variable resolution: `{{credential:field}}` chỉ được resolve
  trong AI Router trusted gateway, không resolve trong Agent/Webview
- [x] Agent chỉ thấy `vault-entry:<id>` + tên biến; không thấy password,
  token, auth code, API key hoặc gateway capability
- [x] Vault UI hiển thị credential của tài khoản AI Router bằng account identity
  + opaque `credentialRef`; không render token/API key và không cho sửa secret
  trực tiếp từ UI
- [x] AI Router Pack kế thừa nội bộ `handleComboChat`: CRUD ngay tại model
  picker, lưu trong config riêng ngoài Vault, fallback/round-robin giữa model
  Verified, Pack ưu tiên trên đầu và model riêng được thu gọn mặc định
- [x] Vault dùng một kiểu danh sách thống nhất như credential Telegram; AI
  provider có thao tác Manage và Delete thực, không render token/API key
- [x] OpenRouter dùng OAuth PKCE để tự cấp user key; model passthrough được tải
  động và test bằng model free thay vì đòi model LLM tĩnh trong registry
- [x] Pack editor có nút Expand/Collapse để chọn nhanh catalog model lớn
- [x] AI vendor credential mở editor ngay trong Vault như Telegram; sửa được
  account metadata và key/token hiện có, giữ nguyên trạng thái Verified
- [x] Mỗi model là một account-bound variant; model picker và Pack editor hiển
  thị vendor + email/account label và Router gọi đúng connection đã chọn
- [x] Chuẩn hóa Vault schema: editable `label` tách khỏi account identity và
  mọi credential row hiển thị status badge thống nhất
- [x] Pack editor có checkbox filter theo từng connected account, kèm Select
  all/Clear all và số model của mỗi account
- [x] Account filters được gom vào dropdown menu có bộ đếm selected/total để
  không chiếm diện tích Pack editor
- [x] Account filter chỉ hiển thị và có hiệu lực trong Pack Editor expanded;
  editor thu nhỏ luôn hiện đầy đủ model
- [x] Không dùng `Account 1` khi vendor có identity: Claude backfill email từ
  bootstrap; OpenRouter dùng email/name/username/user ID theo dữ liệu API trả về
- [x] Tách đúng auth Grok: Grok CLI dùng subscription device-code, Grok Web
  dùng subscription `sso` cookie, xAI Grok giữ phần API/OAuth riêng với
  callback loopback đã đăng ký
- [x] Grok Web có nút direct `Open Grok & capture session`: desktop app mở
  Chrome/Grok, tự bắt riêng cookie `sso`, lưu vào App Vault rồi test connection;
  web preview vẫn giữ fallback nhập tay do browser sandbox không đọc được
  cross-origin cookie.
- [x] External MCP subprocess không inherit/override connector gateway capability
- [x] Migration format Vault nội bộ legacy (XOR) sang AES/HMAC v2
- [x] Field động: chọn kiểu dữ liệu (text/password/number/url/email/date/datetime) + icon

---

## 8. Kênh kết nối (Channels)

### 8.1 Kênh mặc định
- [x] CLI Channel — kênh dòng lệnh cục bộ
- [x] Telegram Bot — long-polling 2 chiều trong app
- [x] Telegram chat được materialize thành UI session theo `telegram:<chatId>`,
      persist transcript và hiển thị badge channel trong Chat → Sessions
- [x] Single-instance Web Lock ngăn nhiều tab cùng poll và trả lời trùng Telegram

### 8.2 Channel Architecture (Kế thừa NanoClaw)
- [ ] Channel adapter interface chuẩn hóa
  `[REF: NanoClaw/src/channels/ — thư mục chứa channel adapters]`
- [ ] Chat SDK Bridge: cơ chế tự đăng ký adapter
- [ ] Message flow chuẩn: Channel → Router → `inbound.db` → Agent → `outbound.db` → Delivery → Channel
  `[REF: NanoClaw/src/router.ts + delivery.ts]`
- [ ] Webhook server cho channel nhận callback
  `[REF: NanoClaw/src/webhook-server.ts — 5965 bytes]`

### 8.3 Kênh mở rộng
- [ ] Slack adapter
- [ ] Discord adapter
- [ ] WhatsApp adapter
- [ ] Webhook adapter (generic HTTP)

### 8.4 Telegram nâng cao (Kế thừa Claw)
- [ ] Telegram Webhook mode (thay vì long-polling, cho production)
  `[REF: Claw SPEC.md §8 — Webhook Telegram qua Nginx reverse proxy]`
- [ ] Đồng bộ 2 chiều cấu hình Telegram (.env ↔ gateway config)
  `[REF: Claw SPEC.md §7 — sync cấu hình Telegram 2 chiều]`

---

## 9. Integrations & Connectors

- [x] Connector framework qua `connector_request` trusted gateway
- [x] Connector lấy credential từ App Vault bằng ref, bind origin, tự áp biến
  auth và redaction response; không trả raw secret cho agent
- [ ] Connector **GitHub** — thao tác repo, issue, PR
- [ ] Connector **Notion** — đọc/ghi database, page
- [ ] Connector **Slack** — gửi tin nhắn, quản lý channel
- [ ] Connector **Discord** — bot commands
- [ ] Connector **Google Drive** — upload/download/search
- [ ] Connector **Google Calendar** — tạo/đọc/sửa sự kiện
- [ ] Wizard cài đặt connector từng bước trên UI

---

## 10. Agent Skills & MCP

### 10.1 Skills hiện có
- [x] 10 built-in skills
- [x] Skills chuẩn `skills/*/SKILL.md`
- [x] Cài đặt skill từ URL
- [x] Validate skills khi build
- [x] Inject skill instructions vào system prompt

### 10.2 Skills mở rộng
- [ ] Per-role skill sets (mỗi Agent gán bộ skill riêng)
  `[REF: NanoClaw/src/group-skills.ts]`
- [ ] 9router Skills integration
  `[REF: 9router/skills/ — 8 skill modules: chat, web-fetch, web-search, embeddings, stt, tts, image]`
- [ ] Skill marketplace / community store

### 10.3 MCP (Model Context Protocol)
- [x] MCP Client tích hợp trong Agent Runner
  `[REF: NanoClaw/container/agent-runner/src/mcp-tools/server.ts — MCP server implementation]`
- [x] Khai báo MCP servers qua config file
- [x] Agent tự discovery & gọi MCP tools
- [ ] MCP built-in: expose native tools qua MCP protocol
- [ ] 9router MCP integration
  `[REF: 9router/src/lib/mcp/ — MCP tools]`

---

## 11. Self-Improving Memory

- [x] Hermes-style: Agent tự suy ngẫm sau cuộc hội thoại
- [x] Trích xuất thông tin quan trọng → lưu vào memory riêng per-Agent
- [x] Memory kế thừa cho các phiên chat sau
- [x] Memory lưu dưới dạng mảng string trong state → cần chuyển sang file markdown per-Agent
  `[REF: Hermes/data/memories/ — lưu bộ nhớ dưới dạng file]`
  `[REF: NanoClaw/container/agent-runner/src/memory-scaffold.ts — memory tree structure]`
  `[REF: NanoClaw/container/agent-runner/src/mcp-tools/self-mod.ts — self-modification MCP]`
- [ ] Memory summarization (tóm tắt khi memory quá dài)
- [ ] Memory search (tìm kiếm trong memory cũ)

---

## 12. Scheduled Tasks (Lập lịch)

- [x] Tạo/sửa/xóa scheduled task trên UI
- [x] Trình lập lịch kiểm tra mỗi phút
- [x] Kích hoạt Agent thực thi theo chu kỳ
- [x] Giao kết quả vào chat + Telegram
- [x] `schedule_message` MCP tool tích hợp trong core tools
- [x] Scheduler tích hợp `daily-budget` — ngân sách token/ngày
- [ ] Lịch sử chạy & logs per-task (`task_run_logs` table)
- [ ] Retry on failure policy (backoff tự động)

---

## 13. Bảo mật & Hiệu năng

- [x] API keys chỉ gửi đến vendor, không gửi nơi khác
- [x] Agent chỉ thấy opaque ref + tên biến, không thấy giá trị
- [x] Secret chỉ resolve trong trusted AI Router gateway và response được
  redaction trước khi quay về agent/model
- [x] Vault mã hóa AES-256-CBC + HMAC-SHA256 nội bộ
- [ ] Rate limiting cho tool execution
- [x] Không expose Bash/host shell cho model
- [x] File system sandboxing ở `VUA_AGENT_WORKSPACE`
- [ ] Audit log: ghi lại mọi tool call & API request
- [~] Egress lockdown: credentialed request đã bind đúng origin trong Vault;
  request không credential vẫn cần policy allowlist riêng
  `[REF: NanoClaw/src/egress-lockdown.ts]`
- [ ] Command gate (chặn dangerous commands)
  `[REF: NanoClaw/src/command-gate.ts]`
- [ ] Circuit breaker (ngắt khi provider lỗi liên tục)
  `[REF: NanoClaw/src/circuit-breaker.ts]`
- [ ] Inbox safety (validate inbound messages)
  `[REF: NanoClaw/src/inbox-safety.ts]`
- [ ] Attachment safety (validate file uploads)
  `[REF: NanoClaw/src/attachment-safety.ts]`

---

### Audit remediation (2026-07-14)

### Provider live verification (2026-07-15)

- [x] OpenRouter: real `/chat/completions` smoke request returned HTTP 200
      after capping completion output at 4096 tokens.
- [x] Gemini Antigravity: real `loadCodeAssist` and streaming request returned
      HTTP 200 using the account's assigned project and `gemini-3.1-pro-low`.
- [ ] ChatGPT/Codex: current Vault credential is an OpenRouter key and the
      real Codex endpoint returned HTTP 401. Implement Codex OAuth and rerun
      a real chat smoke test before calling it connected.
- [ ] Claude: current OAuth credential returned HTTP 401 from Anthropic.
      Reconnect with a valid subscription token and rerun a real chat smoke
      test before calling it connected.

### Agent Runner verification (2026-07-15)

- [x] Automated `inbound.db -> poll loop -> provider/tool loop -> outbound.db`
      tests pass locally, including session isolation and restart persistence.
- [~] Real Tauri host-process smoke: 2026-07-29 native `/Applications/VuaAssistant.app`
      confirmed bundled AI Router + Agent Runner launch and remain alive; `runner.log`
      confirmed poll loop, scheduler and Telegram channel start. A manual native chat
      + outbound delivery turn remains required; web preview cannot prove it.

- [x] Replace XOR Vault format with AES-256-CBC + HMAC-SHA256 and local
      64-byte key; migrate existing `vault.db` entries to v2 on read/startup.
- [x] Bind every Vault credential request to its saved origin before resolving
      variables; connector gateway redacts all resolved values from output.
- [ ] Add tool rate limiting, unauthenticated egress policy, and audit trail
      before enabling broader host capabilities for general users.
- [x] Bundle the Agent Runner and Node runtime in Tauri resources; production
      does not depend on the checkout, `npx`, or a developer-installed Node
      runtime. Native smoke on 2026-07-29 confirmed AI Router and Runner launch
      from `VuaAssistant.app/Contents/Resources/_up_/runtime/node/node`.
- [x] Move Telegram, scheduled jobs, and RAG execution behind the host/Runner
      IPC path; keep the webview engine as a fallback only.
      `agent-runner/src/index.ts` calls `startScheduler()` and
      `startTelegramChannel()`; RAG retrieval reads `knowledge.db` directly
      in `agent-runner/src/knowledge/index.ts`. The webview copies
      (`src/runtime/knowledge.ts`) are the documented fallback path only —
      see comments there and in `src/pages/Chat.tsx`.
- [x] Add bounded retry with exponential backoff and `Retry-After` support for
      transient 429/529 responses from Claude, ChatGPT, and Gemini in both
      webview and Runner.
- [x] On exhausted 429/529 retries, fail over this request to another configured
      vendor; OpenRouter is always the final fallback. Keep the user's selected
      provider unchanged and never switch after text has started streaming.
- [x] Route Gemini subscription login through the Antigravity OAuth profile:
      request its Code Assist scopes, resolve the assigned project with
      `loadCodeAssist`, and stream through the Antigravity endpoint. API keys
      remain an Advanced option only.
      Request-ID diagnostics remain a follow-up.
- [x] Resolve provider credentials from Vault immediately before a chat request
      as well as during startup hydration, so a message sent just after launch
      cannot silently fall back to the preview engine. Preserve the selected
      Antigravity model across restarts.
- [x] Normalize Antigravity chat history into non-empty alternating Gemini
      content turns, use a stable Cloud Code session and IDE-shaped request ID,
      and treat temporary `503 no capacity` as eligible for retry/failover.
- [x] Surface OpenRouter privacy guardrail blocks as an actionable fallback
      error with the exact account settings page, rather than a generic 404.
- [x] Continue a rate-limit/capacity fallback chain when an intermediate
      vendor has expired credentials or rejects the request before streaming;
      return only after every configured vendor has been attempted.
- [x] Keep Gemini OAuth refresh tokens in Vault only and refresh its access
      token before expiry or once after a 401; legacy sessions without a
      refresh token explicitly require one reconnect.
- [x] Show only directly connected, currently valid providers in the Chat
      picker; remove expired credentials after 401/403 and do not label an
      OpenRouter-routed credential as a direct vendor connection.
- [x] Keep an already validated legacy OpenRouter connection available after
      the provider-status migration; only Claude exposes the manual callback
      UI, while OpenRouter completes PKCE through the app callback itself.
- [x] Remove the dev-host/Vault hydration race so provider metadata arriving
      after first render still rehydrates its stored credential before Settings
      decides whether the provider is connected.

---

## 14. Testing & CI/CD

### 14.1 Test hiện có
- [x] `scripts/tool-loop-check.mjs` — Agent tool calling
- [x] `scripts/telegram-check.mjs` — Telegram 2 chiều
- [x] `scripts/schedule-check.mjs` — Scheduled tasks
- [x] `scripts/login-check.mjs` — Luồng đăng nhập
      + Claude, ChatGPT, Gemini 429 retry regressions
- [x] `scripts/isolation-check.mjs` — Cô lập vai trò
- [x] `scripts/self-improve-check.mjs` — Self-improving memory
- [x] `scripts/connector-check.mjs` — Connectors
- [x] `scripts/rag-check.mjs` — Knowledge RAG
- [x] `scripts/models-availability-check.mjs` — đăng nhập xong là có model để
      chat (`Pending test` vẫn phục vụ, chỉ `Failed` bị ẩn) — #19/#16
- [x] `scripts/provider-error-check.mjs` — lỗi nhà cung cấp ra câu người dùng
      hiểu, không phải JSON thô — #13
- [x] `scripts/onboarding-connection-check.mjs` — không lối đăng nhập nào nuốt
      lỗi ghi kết nối — #18
- [x] `npm run check` — chạy toàn bộ test
- [x] **CI chạy đủ 8 contract check** (desktop-bundle, desktop-oauth,
      pack-rebind, host-process, ai-router, multi-account, credential-boundary,
      connector-capability). Trước đây chỉ chạy tay nên hồi quy lọt lưới tới khi
      người dùng báo lỗi.
- [x] **Job `rust` dựng đủ resource Tauri trước `cargo check`**. Trước đây job
      này đỏ suốt nhiều bản phát hành (thiếu `agent-runner/dist`), khiến hai
      test Rust phía sau bị *skipped* — hợp đồng đăng nhập desktop và WASM
      sandbox thực tế không được kiểm chứng ở bản nào.

> **Nguyên tắc khi thêm test:** thử **nghịch đảo** (cố tình khôi phục lỗi cũ) để
> chắc test bắt được. Test `desktop-oauth-check` từng chỉ so chuỗi `redirectUri`
> nên luôn xanh dù hành vi thật sai — so chuỗi không thay được kiểm chứng hành vi.

### 14.2 Test cần thêm
- [ ] Test Universal LLM Client (mock server mỗi provider)
  `[REF: NanoClaw/container/agent-runner/src/providers/mock.ts — mock provider]`
- [x] Test Agent Loop Executor (end-to-end) — `agent-runner/scripts/e2e-check.mjs`
      (inbound.db → poll loop → mock provider → outbound.db, chạy trong CI)
- [x] Test Poll Loop — phủ bởi `e2e-check.mjs` (poll → format → query → write)
- [x] Test SQLite IPC — phủ bởi `e2e-check.mjs` (Two-DB inbound/outbound)
- [x] Test Native Tools (Bash denied; FileRead/Write/Edit/Grep/Glob confined) —
      `agent-runner/scripts/native-tools-check.mjs`
- [x] Test credential boundary + capability gateway —
      `scripts/credential-boundary-check.mjs` +
      `scripts/connector-capability-check.mjs`
- [x] Test provider transient retries —
      `agent-runner/scripts/anthropic-retry-check.mjs` +
      `agent-runner/scripts/openai-gemini-retry-check.mjs`
- [x] Test MCP client handshake/discovery/tool call (chạy native)
  `agent-runner/scripts/mcp-client-check.mjs`
  `[REF: NanoClaw/container/agent-runner/src/mcp-tools/core.test.ts]`
- [ ] Test Vault encryption/decryption
- [ ] Test Formatter
  `[REF: NanoClaw/container/agent-runner/src/formatter.test.ts — 7670 bytes]`

### 14.3 CI/CD & Đóng gói
- [x] **Kiểm BẢN ĐÃ ĐÓNG GÓI trên cả ba nền tảng**
      (`.github/workflows/packaged-smoke.yml` + `scripts/packaged-smoke-check.mjs`):
      build bản cài thật rồi chạy nó, không chạy binary `debug`.

      > **Vì sao phải có, dù đã có smoke test desktop:** binary `debug` nạp giao
      > diện từ `devUrl` (do chính bài test dựng lên) và phân giải thư viện qua
      > `node_modules` gốc của repo. Bản cài khác ở **cả hai** điểm. Chính khác
      > biệt đó đã giấu lỗi `Cannot find package 'undici'` — cài xong AI Router
      > không lên, mà mọi bài kiểm tra trong repo vẫn xanh. Bài mới **không**
      > dựng server ở 1420: giao diện không tự nạp được từ gói là phải trượt.
      >
      > Không chạy mỗi push vì `tauri build` rất lâu — chạy khi phát hành và
      > bấm tay được bất cứ lúc nào.
- [x] **Kiểm thư viện của AI Router** (`scripts/ai-router-deps-check.mjs`): copy
      `ai-router` ra ngoài repo — nơi không có `node_modules` cha nào — rồi mới
      nạp. Mọi bài chạy trong repo đều không bắt được lớp lỗi này.
- [x] GitHub Actions workflow (build installer)
- [x] Bản phát hành v0.1.0
- [x] Đã xoá Docker live-dev cũ; dev/test dùng Tauri Host Process native
- [x] **Smoke test bản desktop** (`scripts/desktop-smoke-check.mjs`): mở app
      thật rồi kiểm nó tự dựng AI Router, Agent Runner, IPC và Vault. Trước đây
      tưởng phải có máy thật mới kiểm được nên #7/#8/#9 không có cách tái hiện.
      Nay chạy mỗi lần push trên **cả ba nền tảng**: Linux (job `rust`, dùng
      `xvfb-run`), Windows và macOS (job `desktop-smoke`, runner có sẵn phiên đồ
      hoạ). Đo runner sống bằng nhịp tim `.heartbeat` còn mới thay vì chỉ kiểm
      có tiến trình — runner treo vẫn còn tiến trình nhưng ngừng đập.
- [x] **#8 — Windows 11 cài xong không mở được: đã tìm ra và sửa.** App panic
      ngay ở `tauri::Builder` vì đăng ký phím tắt toàn cục bằng
      `with_shortcuts([...]).unwrap()`: trên Windows "Cmd" là phím Windows, mà
      Win+Shift+R là tổ hợp quay màn hình Windows 11 giữ sẵn ⇒
      `HotKey already registered` ⇒ thoát mã 101 trước khi cửa sổ hiện.
      Nay máy không phải macOS dùng `Ctrl+Alt`, và việc đăng ký chuyển xuống
      `setup` theo từng tổ hợp — tổ hợp bị chiếm thì bỏ qua, app vẫn chạy.
      Test: `scripts/hotkey-conflict-check.mjs` (mở hai bản app cùng một màn
      hình để ép xung đột; đã thử nghịch đảo trên mã cũ và bài test đỏ đúng).

> **Bài học — đừng lặp lại.**
> - Lỗi "cài xong không mở được" **không nằm ở tầng logic**: nó ở đoạn dựng app,
>   trước dòng giao diện đầu tiên. Không bài kiểm tra TypeScript nào chạm tới.
>   Chỉ có mở app thật mới bắt được.
> - **Tuyệt đối không `unwrap()` trên tài nguyên hệ điều hành có thể bị chiếm**
>   (phím tắt toàn cục, cổng mạng, tệp khoá). Tiện ích hỏng thì bỏ tiện ích,
>   không được kéo cả app chết theo.
> - Mỗi bài test mới phải được **chạy ngược trên mã lỗi cũ** trước khi tin. Test
>   xanh mà không chứng minh được nó bắt lỗi thì chỉ là xanh giả.
> - Trên Linux, hai bản app phải **dùng chung một màn hình** mới tranh nhau tài
>   nguyên toàn cục; bọc mỗi bản trong `xvfb-run -a` riêng là xanh giả.
> - Trên Windows, dọn tiến trình bằng `taskkill /PID <pid> /T /F`, **không** dùng
>   `/IM node.exe` — nó giết chính tiến trình đang chạy test và nuốt mất log
>   chẩn đoán.
- [x] Bundle Agent Runner + Node runtime vào Tauri resources. Build local tự
      nạp Node theo kiến trúc macOS; CI nạp runtime đúng target.
- [ ] Auto-detect runtime: Bun có sẵn → dùng Bun; fallback Node
- [x] Code signing & notarize macOS
- [ ] Auto-update mechanism (Tauri updater plugin)

---

## 13. Tính năng Điều khiển Máy tính & Advanced Capabilities (Claude Desktop Style)

### 13.1 Native Computer Use & OS Control
- [x] **Desktop App Execution**: Chạy ứng dụng desktop native bằng Tauri 2 (Rust) + React UI
- [x] **Auto Launch (Run on Startup)**: Khởi động ngầm VuaAssistant cùng hệ thống macOS/Windows (`set_autostart`)
- [ ] **Mouse & Keyboard Control (`computer_action`)**: Cho phép Agent thực hiện di chuyển chuột, click, double click, gõ phím, drag & drop trực tiếp trên màn hình host OS
- [ ] **Screen Capture & Visual Inspection (`screen_capture`)**: Chụp ảnh màn hình toàn cảnh hoặc theo cửa sổ ứng dụng để Agent phân tích hình ảnh UI bằng Vision Model
- [ ] **App Focus & Window Management**: Tự động mở, chuyển đổi focus giữa các ứng dụng trên hệ thống (VS Code, Chrome, Terminal, Finder, Finder...)

### 13.2 Browser Tools & Automation
- [ ] **Browser Automation (Playwright)**: Cho phép Agent tự động hóa các thao tác trên trình duyệt (click, điền form, cào dữ liệu) mà không cần popup
- [ ] **Vault Connection**: Đăng nhập tự động các website bằng tài khoản/cookie được lưu trong Vault bảo mật

---

## 15. Năng lực Tự chủ & Vòng lặp Thực thi (Autonomy & Harness Loop)

- [x] **Cơ chế Lập kế hoạch (Planning Mechanism):** Khi nhận nhiệm vụ trên 2 bước/tool call, Agent tự động phân rã tác vụ thành một Plan chi tiết (dạng Markdown checklist), xác định Done criteria để theo dõi và cập nhật tiến trình trong prompt hệ thống của `src/runtime/engine.ts`.
- [x] **Tự sửa lỗi & Phục hồi (Self-Correction & Self-Healing):** Khi tool call trả về `is_error: true` hoặc lỗi hệ thống, Agent tự động phân tích nguyên nhân và thử các phương án tự sửa sai (quét thư mục, sửa cú pháp lệnh) thay vì dừng lại.
- [x] **Chủ động hoàn tất tác vụ (Task Completion):** Tự động chuyển tiếp sang bước tiếp theo trong kế hoạch mà không cần người dùng ra lệnh cho từng bước nhỏ, luôn đánh giá Done criteria để chốt kết quả cuối cùng.
- [ ] **Theo dõi trạng thái Task qua UI:** Tích hợp kế hoạch Markdown checklist của Agent hiển thị trực tiếp lên Task Workspace / Kanban view trên UI của VuaAssistant để người dùng theo dõi trực quan.
- [ ] **Multi-task Scheduler & Task Tree:** Chuẩn hóa task cha/con với `parentTaskId`, `subtaskId`, trạng thái, timeout, retry và hiển thị cây task trong Task Workspace; giữ Scheduler hiện tại tương thích ngược.
- [ ] **Multi-sub-agent Delegation:** Thêm capability `delegate_task` để Agent cha phân rã việc cho Agent con có role/instruction/memory riêng; Agent con trả kết quả về Agent cha qua IPC, không chia sẻ transcript hoặc credential ngoài boundary.
- [ ] **Sub-agent Queue & Concurrency:** Xây queue riêng cho sub-agent, giới hạn số agent chạy đồng thời, backpressure, cancellation và graceful shutdown; không dùng `Promise.all()` không giới hạn trong `poll-loop.ts`.
- [ ] **Result Aggregation & Review:** Agent cha gom, đối chiếu và tổng hợp kết quả từ nhiều Agent con; hỗ trợ trạng thái partial/failed và retry từng subtask.
- [ ] **Multi-sub-agent Observability:** Ghi log/metrics cho task tree, agent identity, thời lượng, token/cost, lỗi và kết quả; không ghi secret hoặc credential raw vào log.
- [ ] **Cải tiến Memory để tự học (Self-learning Memory):** Tinh chỉnh cấu trúc memories của Agent để ghi nhớ các lỗi tool đã sửa thành công, tự áp dụng giải pháp đã tối ưu cho các phiên làm việc sau.

### 15.1 Điều khiển vòng lặp — học từ Loop Engineering

> Phân tích đầy đủ và lý do chọn/bỏ nằm ở `idea.md` §5. Hiện `poll-loop.ts` chỉ
> có đúng một cái phanh là `MAX_TOOL_ITERATIONS = 25` — phanh cùn: agent gọi
> một tool hỏng rồi lặp lại y hệt 25 lần, người dùng trả tiền 25 lượt gọi model
> để nhận về một thông báo lỗi.

- [x] **Circuit breaker cho vòng lặp agentic** (`agent-runner/src/loop-guard.ts`):
      ngoài trần số vòng, đã có phát hiện giậm chân (cùng một lỗi 3 lần liên
      tiếp), không tiến triển (5 tool call hỏng liên tiếp) và trần token tuỳ
      chọn. Tất định, không gọi model. So lỗi bằng **dấu vân tay** (bỏ số cổng,
      id request, thời điểm) — so nguyên văn thì không bao giờ thấy "cùng một
      lỗi" và phanh thành vô dụng.
      Test: `agent-runner/scripts/loop-guard-check.mjs` (đã thử nghịch đảo — gỡ
      hai phanh là 9 mục đỏ ngay).
- [x] **Sổ lần thử + cắt tỉa ngữ cảnh tất định** (`agent-runner/src/context-prune.ts`):
      gộp lỗi lặp, cắt stack trace còn 8 khung đầu, rút gọn kết quả tool giữ cả
      đầu lẫn đuôi, và bỏ cụm công cụ quá cũ khi lượt đã dài. Không gọi model.
      Đo được: gộp lỗi lặp ~2420 → ~627 token, kết quả dài ~6826 → ~1593 token.
      Test: `agent-runner/scripts/context-prune-check.mjs`.

      > **Hai cái bẫy đã vấp và đã khoá lại bằng test:**
      > 1. Dấu vân tay lỗi bỏ hết chữ số, nên nếu đem gộp **mọi** kết quả tool
      >    thì "Chi nhánh 1: 120000000đ" và "Chi nhánh 2: 340000000đ" thành
      >    trùng nhau — xoá mất số liệu thật. Chỉ được gộp thứ **trông như lỗi**.
      > 2. Bỏ tin lệch một nhịp sẽ để lại một `tool` **mồ côi** không có
      >    `assistant` đứng trước ⇒ Gemini từ chối nguyên request. Phải bỏ trọn
      >    cụm, và test phải kiểm **cả hai chiều** (assistant có đủ tool, và
      >    tool nào cũng có assistant) — chỉ kiểm một chiều là lọt.
- [x] **Dừng sớm phải nói cho người dùng biết:** `stopMessage()` trả câu tiếng
      Việt nói rõ đã thử gì, hỏng vì sao, đề nghị bước tiếp. Test khoá luôn ba
      điều: không lộ tên lý do nội bộ (`stagnation`…), có kèm lỗi thật, và không
      đổ JSON thô — cùng chuẩn với #13.
- [x] **Vai kiểm độc lập (maker/checker)** (`agent-runner/src/verifier.ts`):
      chạy trước mỗi capability có `side_effect`, trong **phiên riêng**,
      **không cầm công cụ nào**, mặc định **TỪ CHỐI**. Bật trong Cài đặt →
      "Giới hạn cho Agent" (mặc định tắt vì tốn thêm một lượt gọi model cho mỗi
      hành động). Test: `agent-runner/scripts/verifier-check.mjs`.

      > **Ba cách biến vai kiểm thành con dấu đóng sẵn, đã khoá lại bằng test:**
      > 1. Dùng **chung phiên** với vai làm ⇒ nó đọc lại lý lẽ của chính mình
      >    rồi gật đầu. Không kiểm gì cả, chỉ tự khen.
      > 2. **Đưa công cụ** cho vai kiểm ⇒ mở thêm một đường chạy side effect
      >    không ai canh. Vai kiểm xem xét rồi phán, không hành động.
      > 3. Lỗi mạng / trả lời rỗng / sai định dạng mà **cho qua** ⇒ mọi cách
      >    hỏng đều thành "duyệt". Phải nghiêng hết về phía **không chạy**.
      >
      > Một lỗ hổng thật do test bắt: model trả JSON **mảng**
      > (`[{"verdict":"DUYET"}]`) thì regex vẫn moi được object bên trong và
      > duyệt. Nay câu trả lời bắt đầu bằng `[` là từ chối luôn.
- [x] **Màn hình chính sách trong Settings** (`PolicySettingsSection.tsx` →
      `policy.json` → `agent-runner/src/policy.ts` → capability rail): người
      dùng đặt đường dẫn cấm, công cụ luôn phải hỏi, và số lần gửi ra ngoài mỗi
      giờ. Luật được thi hành ở **rail** — nơi mọi capability bắt buộc đi qua
      trước khi chạy — chứ không nhét vào system prompt.
      Test: `agent-runner/scripts/policy-check.mjs`.

      > **Ba cách làm luật thành đồ trang trí, đã khoá lại bằng test:**
      > 1. So đường dẫn bằng `includes` trên chuỗi thô: vừa **lọt** (`..%2f`,
      >    gạch ngược Windows) vừa **chặn oan** (`/home/an/duan-env/ghi-chu.txt`
      >    dính luật `.env`). Phải so theo **từng đoạn** đường dẫn.
      > 2. Tệp chính sách hỏng mà bỏ qua cả tệp ⇒ một dấu phẩy thừa âm thầm gỡ
      >    sạch mọi giới hạn. Phải quay về mặc định **chặt hơn**, theo từng
      >    trường.
      > 3. Hạn mức reset theo **giờ tròn** ⇒ gửi hết hạn mức lúc 8:59 rồi gửi
      >    tiếp cả hạn mức mới lúc 9:01, người dùng nhận gấp đôi trong hai phút.
      >    Phải dùng **cửa sổ trượt** một giờ.
- [x] **Ngân sách token theo ngày cho tác vụ lịch** (`agent-runner/src/daily-budget.ts`):
      <80% chạy im lặng; >=80% cảnh báo **một lần** rồi vẫn chạy; >=100% dừng
      tác vụ lịch tới hết ngày và báo **một lần**. Sổ nằm chung `session_state`
      với `lastRun` nên sống sót qua mọi lần bật/tắt app — cần thiết vì một
      vòng chạy hoang qua đêm vắt qua nhiều lần khởi động. Trần mặc định
      1.000.000 token/ngày, đổi bằng `VUA_DAILY_TOKEN_BUDGET` (đặt `0` để tắt).
      Test: `agent-runner/scripts/daily-budget-check.mjs`.

      > **Ba điều đã khoá lại bằng test:**
      > 1. Cảnh báo chỉ kêu **một lần** mỗi ngày. Kêu lại mỗi 30 giây tới nửa
      >    đêm thì người dùng tắt app, và ta mất luôn cái cảnh báo.
      > 2. Ngày tính theo **giờ máy người dùng**, không phải UTC. Ở Việt Nam
      >    dùng UTC thì ngân sách reset lúc 7 giờ sáng — vừa khó hiểu vừa cho
      >    vòng chạy hoang thêm một suất giữa buổi. Máy CI chạy giờ UTC nên
      >    mục test này phải chạy trong tiến trình con đặt `TZ=Asia/Ho_Chi_Minh`
      >    mới kiểm được thật; để nguyên là mục test **rỗng nghĩa**.
      > 3. Con số là **ước lượng** (~4 ký tự/token) vì nhà cung cấp không trả
      >    usage. Mọi câu hiện ra cho người dùng phải nói rõ, đừng để họ tưởng
      >    là hoá đơn.

- [x] **Web Search & HTTP Fetch**: Tìm kiếm thông tin web công khai và đọc trang HTML/Markdown (`web_search`, `http_request`)
- [ ] **Interactive Browser Automation (Playwright / Puppeteer MCP)**: Tự động tương tác với website phức tạp đòi hỏi JavaScript (click nút, điền form, chụp ảnh màn hình web, xử lý captcha)
- [ ] **Chrome DevTools Protocol (CDP) Bridge**: Kết nối trực tiếp vào trình duyệt Google Chrome đang mở của người dùng qua Remote Debugging Port để đọc cookies/session và điều khiển tab
- [ ] **Session & Cookie Persistence**: Lưu trạng thái đăng nhập trên các website mục tiêu để Agent thực hiện tác vụ tự động không bị ngắt quãng

### 13.3 Interactive Visual Artifacts & Live Preview
- [x] **Rich Markdown Blocks**: Hiển thị Code block hỗ trợ syntax highlighting + Nút Copy 1-click, Tables, Blockquotes, HRs, Lists
- [ ] **Live Artifacts Sandbox Previewer**: Khung xem trước trực tiếp các tệp HTML, SVG, React, Mermaid Diagrams, Chart.js tương tự Claude Artifacts
- [ ] **Interactive Component State**: Cho phép người dùng chỉnh sửa trực tiếp hoặc gửi phản hồi trực quan trên giao diện Artifacts để Agent cập nhật tức thì

### 13.4 Isolated Code Execution & File Generation
- [x] **Native File Operations**: Đọc/ghi tệp tin thông minh, tự động parse tệp Excel (.xlsx/.xls) thành Markdown table (`file_read`, `file_write`, `file_edit`)
- [x] **Mandatory Workspace Storage Policy**: Ép buộc Agent lưu toàn bộ tệp kế hoạch/mã nguồn vào Workspace active, tuyệt đối không ghi tràn ra Desktop/tmp
- [ ] **Sandboxed Code Executor (`code_execution_engine`)**: Môi trường chạy thử mã nguồn TypeScript/Node.js/Python an toàn (V8/WASM sandbox) trước khi áp dụng vào dự án
- [ ] **Multi-file Project Generator**: Tự động sinh cấu trúc toàn bộ dự án từ spec và đóng gói tệp ZIP / Git repository cho người dùng

---

## Tổng kết Số liệu

| Phân loại | ✅ Xong | 🔄 Update | ⬜ Chưa làm |
|-----------|:---:|:---:|:---:|
| Tài liệu | 11 | 0 | 0 |
| Giao diện UI | 55 | 0 | 5 |
| Authentication | 6 | 2 | 3 |
| AI Providers & AI Router | 24 | 2 | 9 |
| **Agent Runner (Core)** | **51** | **0** | **3** |
| Tauri Shell (Host-side) | 7 | 0 | 8 |
| Vault | 23 | 0 | 1 |
| Channels | 4 | 0 | 10 |
| Integrations | 2 | 0 | 7 |
| Skills & MCP | 8 | 0 | 5 |
| Memory | 4 | 0 | 2 |
| Scheduled | 6 | 0 | 2 |
| Bảo mật | 24 | 2 | 9 |
| Computer Use & Advanced | 2 | 0 | 5 |
| Testing & CI/CD | 30 | 0 | 5 |
| Autonomy & Harness Loop | 13 | 0 | 14 |
| **TỔNG** | **270** | **6** | **88** |

> **270 tính năng đã hoàn thành**, **6 cần cập nhật**, **88 chưa triển khai**.
