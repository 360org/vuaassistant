# ARCHITECTURE GUIDE: Kiến trúc VuaAssistant (Universal Agent Runner — Zero-Docker)

Tài liệu này mô tả chi tiết sơ đồ thiết kế kiến trúc, cấu trúc các thành phần và cách thức hoạt động của hệ thống trợ lý cá nhân VuaAssistant chạy trực tiếp trên MacOS, Windows và Linux.

---

## 1. Sơ đồ Kiến trúc Tổng thể

```text
+-------------------------------------------------------------+
|               USER INTERFACE & TAURI CORE                    |
|  +------------------+                   +----------------+   |
|  |     React UI     |                   |Telegram/Channel|   |
|  +--------+---------+                   +-------+--------+   |
|           | (Tauri IPC)                         | (fetch)    |
|  +--------v---------+                           |            |
|  | Tauri Rust Core  |                           |            |
|  +---+----------+---+                           |            |
|      |          |                               |            |
|      |          | (Secure Storage)              |            |
|      |    +-----v---------------+               |            |
|      |    | VuaAssistant Vault   |               |            |
|      |    | (Built-in Encrypted)|               |            |
|      |    +---------------------+               |            |
|      | (SQLite IPC)                             |            |
|  +---v------------------------------------------v--------+   |
|  |              SQLITE IPC DATABASES                     |   |
|  |  +-----------------------+   +---------------------+  |   |
|  |  |      inbound.db       |   |     outbound.db     |  |   |
|  |  +-----------+-----------+   +-----------^---------+  |   |
+--+--------------|---------------------------|------------+---+
                  | (Reads)                   | (Writes)
+-----------------|---------------------------|---------------+
|          UNIVERSAL AGENT HOST PROCESS (BUN/NODE)            |
|                                                             |
|  +-------------------+  +---------------------+             |
|  | Agent Config      |  | Agent Memory        |             |
|  | (Instructions.md  |  | (per-agent .md)     |             |
|  |  Soul.md)         |  +---------------------+             |
|  +-------------------+                                      |
|                                                             |
|  +------------------------------------------------------+   |
|  |              Universal Agent Runner                   |   |
|  +---------------------------+---------------------------+   |
|                              |                               |
|              +---------------+---------------+               |
|              | (Query / Execute)             |               |
|     +--------v--------+            +--------v--------+      |
|     |  Universal LLM  |            |  Native Tools   |      |
|     |     Client      |            | (Scoped FS, HTTP|      |
|     |                 |            |  Grep, Glob)    |      |
|     +--------+--------+            +--------+--------+      |
+--------------|-------------------------------|---------------+
               |                               |
      +--------v--------+            +--------v--------+
      |   AI Providers  |            | External APIs   |
      | (ChatGPT, Claude|            | (Notion, Github |
      |  Gemini, OR,    |            |  Slack, Discord)|
      |  LocalAI)       |            +-----------------+
      +-----------------+
```

---

## 2. Các Thành phần Hệ thống Cốt lõi

### 2.1. Tauri Rust Core (Shell quản lý hệ thống)

**Chức năng:** Đóng gói giao diện React, quản lý bảo mật Vault, và điều phối vòng đời của Agent Runner process.

**Vai trò cụ thể:**
*   Khởi chạy & giám sát tiến trình ngầm Universal Agent Runner (Bun/Node) trên máy host (`CONTAINER_RUNTIME_BIN=process`).
*   Quản lý Vault bảo mật nội bộ (mã hóa AES-256, không phụ thuộc OS Keychain).
*   Xử lý luồng Loopback OAuth (desktop authentication).
*   Health check & auto-restart Agent Runner nếu crash.
*   Graceful shutdown khi thoát app.

### 2.2. SQLite IPC (Kênh giao tiếp liên tiến trình)

Cơ chế giao tiếp giữa React UI / Channel Adapters với Agent Runner:

*   **inbound.db:** Hàng đợi tin nhắn từ người dùng (React UI, Telegram, CLI, Slack...) ghi vào → Agent Runner đọc và xử lý.
*   **outbound.db:** Kết quả phản hồi của Agent (streaming chunks hoặc message hoàn chỉnh) → UI đọc và hiển thị.

**Luồng dữ liệu:**
```text
User/Channel → ghi vào inbound.db → Agent Runner poll & xử lý
                                          ↓
                                    Gọi LLM API
                                          ↓
                                    Thực thi Tools
                                          ↓
Agent Runner ghi vào outbound.db → UI poll & hiển thị ← User
```

### 2.3. Universal Agent Runner (Trình thực thi Agentic đa nhà cung cấp)

Tiến trình nền chạy độc lập trên máy host (Bun hoặc Node.js), **hoàn toàn loại bỏ sự phụ thuộc vào Anthropic Claude SDK**.

**Vòng lặp Agentic (Agent Loop):**
1.  Poll `inbound.db` để đọc tin nhắn mới.
2.  Nạp ngữ cảnh Agent:
    *   **Instructions** (file `.md`): Quy trình & bước thực thi công việc.
    *   **Soul** (file `.md`): Tính cách, giọng điệu phản hồi.
    *   **Memory** (file `.md` per-agent): Bộ nhớ lâu dài, tự cập nhật sau mỗi cuộc hội thoại.
    *   **Knowledge** (RAG per-role): Trích xuất tài liệu → chunks → truy vấn TF-IDF.
    *   **Skills** (`SKILL.md`): Kỹ năng đang kích hoạt.
3.  Gửi yêu cầu tới AI provider qua **Universal LLM Client**.
4.  Nếu AI yêu cầu tool call:
    *   Không expose `Bash`/host shell cho model.
    *   `FileRead`/`FileWrite`/`FileEdit`: Chỉ thao tác trong workspace được cấp.
    *   `Grep`/`Glob`: Tìm kiếm file & nội dung.
    *   `http_request`: Chỉ gọi request không credential.
    *   `vault_list`: Query App Vault, chỉ trả opaque ref + tên biến.
    *   `connector_request`: Gọi trusted AI Router gateway bằng ref và `{{credential:field}}`.
    *   Gửi kết quả tool quay lại LLM, tiếp tục vòng lặp.
5.  Ghi câu trả lời cuối cùng vào `outbound.db`.

### 2.4. Universal LLM Client + AI Router

Agent Runner chỉ gọi API nội bộ `http://127.0.0.1:36360/v1`. AI Router dùng Provider Core đã copy để kết nối các endpoint vendor:

| Provider | Endpoint | Giao thức |
|----------|----------|-----------|
| OpenAI (ChatGPT) | `api.openai.com/v1/chat/completions` | OpenAI-compatible |
| Anthropic (Claude) | `api.anthropic.com/v1/messages` | Anthropic Messages |
| Google (Gemini) | `generativelanguage.googleapis.com/v1beta/...` | Gemini Stream |
| OpenRouter | `openrouter.ai/api/v1/chat/completions` | OpenAI-compatible |
| LocalAI / Ollama | `localhost:11434/v1` (tuỳ chỉnh) | OpenAI-compatible |

Tất cả adapters đều hỗ trợ **streaming** và **tool calling / function calling** chuẩn hóa chung.

### 2.5. Vault bảo mật (Tính năng cốt lõi)

**Vault là tính năng cốt lõi của VuaAssistant**, chạy mặc định và tích hợp trực thuộc hệ thống (không phải connector, không phụ thuộc OS Keychain).

*   Mã hóa AES-256-CBC, xác thực ciphertext bằng HMAC-SHA256.
*   Lưu trữ: API Keys, Access Tokens, tài khoản liên kết, cấu hình tích hợp.
*   Agent chỉ thấy opaque ref + tên biến. Không có agent-side Vault resolver hoặc metadata cache ngoài Vault.

### 2.6. Integrations & Connectors

**AI Router Connector Gateway** là boundary duy nhất được resolve Vault:
*   Tauri cấp process capability riêng cho Runner; capability không nằm trong prompt/tool result.
*   Gateway bind `credential_ref` vào origin, resolve biến trong memory và áp auth.
*   Response được redaction trước khi quay về Agent; secret không vào model/log/`runner.json`.
*   Định nghĩa sẵn: GitHub, Notion, Slack, Discord, Telegram.
*   Mở rộng qua cơ chế plugin connector.

### 2.7. Channel Adapters (Đa kênh kết nối)

Kế thừa kiến trúc NanoClaw, hỗ trợ đa kênh:

*   **CLI**: Kênh dòng lệnh cục bộ (mặc định).
*   **Telegram Bot**: Long-polling 2 chiều.
*   **Chat SDK Bridge**: Cơ chế tự đăng ký adapter → mở rộng sang Slack, Discord, WhatsApp.
*   **Luồng chung**: Message từ kênh → Adapter → `inbound.db` → Agent xử lý → `outbound.db` → Adapter → trả phản hồi đúng kênh.

---

## 3. Cấu trúc Thư mục Dự án

```text
vuaassistant/
├── src/                        # React UI (frontend)
│   ├── pages/                  # 10 trang: Home, Chat, Agents, Skills...
│   ├── components/             # Shared UI components
│   ├── lib/                    # State management, catalog, utils
│   └── runtime/                # Engine nhúng (fallback / legacy)
│       ├── engine.ts           # Engine selector
│       ├── providers.ts        # Multi-provider streaming
│       ├── tools.ts            # Agent tools + opaque connector client qua Tauri
│       ├── vault.ts            # Vault client
│       ├── knowledge.ts        # RAG per-role
│       ├── telegram.ts         # Telegram channel
│       ├── scheduler.ts        # Scheduled tasks
│       ├── selfImprove.ts      # Hermes-style memory
│       ├── oauth.ts            # OAuth handling
│       └── nanoclaw.ts         # NanoClaw IPC bridge
├── src-tauri/                  # Tauri Rust backend
│   └── src/
│       ├── lib.rs              # Tauri app setup
│       ├── runtime.rs          # Engine process manager
│       ├── vault.rs            # Vault Tauri commands
│       ├── auth.rs             # Loopback OAuth
│       └── sandbox.rs          # WASM sandbox (optional)
├── agent-runner/               # Universal Agent Runner (Bun/Node)
│   └── src/
│       ├── index.ts            # Entry point / daemon
│       ├── universal-llm-client.ts  # Multi-provider API client
│       ├── universal-executor.ts    # Agent loop
│       ├── native-tools/       # Scoped FS, HTTP, connector gateway
│       ├── db/                 # SQLite IPC schemas
│       └── providers/          # Per-provider adapters
├── skills/                     # Built-in Agent Skills
├── scripts/                    # Test & build scripts
├── idea.md                     # Ý tưởng sản phẩm
├── SPEC.md                     # Đặc tả kỹ thuật
├── ARCH.md                     # Tài liệu kiến trúc (file này)
├── CHECKLIST.md                # Checklist tính năng tổng thể
└── ...
```

---

## 4. Quyết định Kiến trúc Quan trọng

1.  **Bỏ Docker cho người dùng cuối.** Engine chạy nhúng hoặc Host Process. Docker chỉ là đường nâng cao tùy chọn qua `VUA_ENGINE_DIR`.
2.  **Đa vai trò, không đa tiến trình.** Chuyển vai trò Agent = chuyển state cô lập (memory/knowledge riêng), khởi động tức thì, 0 thời gian chờ.
3.  **Universal Agent Loop thay Claude SDK.** Vòng lặp agentic gọi AI Router nội bộ; Provider Core đã copy xử lý vendor/OAuth/normalization.
4.  **Vault nội bộ, không phụ thuộc OS.** App Vault là nguồn duy nhất. Agent chỉ thấy opaque ref; trusted gateway mới được resolve secret.
5.  **Sandbox = WASM (Wasmtime), tùy chọn.** Feature flag `--features sandbox`, off mặc định. Guest không có host import, trần bộ nhớ + fuel.
6.  **AI Router là provider boundary.** Production không inject raw vendor credential vào Agent Runner; engine nhúng chỉ là compatibility/demo path và dùng cùng connector gateway cho tác vụ có credential.
