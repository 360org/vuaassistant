# VuaAssistant

**AI cho mọi người — cài trong 2 phút, dùng được ngay.**

> Tải → Cài → Đăng nhập → Kết nối → Bắt đầu

VuaAssistant là trợ lý AI để bàn cho người dùng phổ thông. Không cấu hình, không
terminal, không Docker, không API key (khi provider hỗ trợ OAuth). Người dùng chỉ
thấy: **Chat, Agents, Knowledge, Integrations** — mọi thứ khác chạy ẩn phía sau.

## Tính năng

- **Onboarding 2 phút** — đăng nhập bằng tài khoản AI sẵn có (ChatGPT, Claude,
  Gemini, OpenRouter hoặc Local AI), tùy chọn kết nối một ứng dụng, rồi chat ngay.
- **Chat** — giao diện chat quen thuộc, trả lời streaming. Đổi provider 1-click bất kỳ lúc nào.
- **Agent Store** — các chuyên gia dựng sẵn (ERP, Sales, Marketing, SEO, CSKH, HR,
  Kế toán, Pháp lý, …). Cài 1 click, chat ngay. Mỗi vai trò có **bộ nhớ & kiến thức
  riêng, không lẫn**.
- **Knowledge** — kéo-thả PDF, Word, Excel, PowerPoint. Trích xuất và lập chỉ mục
  tự động (RAG cục bộ theo vai trò); người dùng không thấy embedding hay vector store.
- **Vault** — kho credential; agent tự lấy ra dùng nhưng chỉ thấy *tên*, không thấy
  giá trị bí mật.
- **Integrations** — mỗi dịch vụ một nút **Connect**: Telegram, GitHub, Google Drive,
  Outlook, Slack, Discord, Notion, Google Calendar.
- **Scheduled** — hẹn giờ để agent tự chạy và trả kết quả. **Self-improving** — agent
  tự học và ghi nhớ theo thời gian.

## Công nghệ

| Tầng | Lựa chọn |
| ---- | -------- |
| Desktop | [Tauri 2](https://v2.tauri.app) (Windows/macOS/Linux) |
| Giao diện | React + TailwindCSS + component kiểu shadcn + Framer Motion |
| Engine nhúng | AI Runtime Service (`src/runtime/*`) — chạy trong webview |
| Agent Runner | Host process độc lập SDK (`agent-runner/`, Node/Bun) — SQLite IPC |
| Vỏ desktop | Rust (`src-tauri/`) — OAuth loopback, Vault, quản lý runtime |

### Kiến trúc

```
+-----------------------------------------------+
|              VuaAssistant Desktop              |
|-----------------------------------------------|
| React UI  ──  Engine nhúng (src/runtime/*)    |  chạy tức thì, không Docker
| Vỏ Tauri (Rust)                               |
+-----------------------+-----------------------+
                        |  SQLite IPC (inbound.db / outbound.db)
                        v
        Universal Agent Runner (agent-runner/)     host process, độc lập SDK
        ├─ poll loop · providers trực tiếp          (Gemini/OpenAI/Anthropic)
        ├─ native tools (bash/file/grep/glob/http)
        ├─ MCP client · memory scaffold · vault
```

Có **hai tầng engine**: engine **nhúng** (webview) chạy sẵn tức thì cho chat/tools/
Telegram/scheduler/RAG; **Universal Agent Runner** là bộ não độc lập SDK (như NanoClaw
nhưng không Docker) mà app đang chuyển tiếp sang, giao tiếp qua hai hàng đợi SQLite.
Tên NanoClaw không bao giờ hiện ra UI.

## Đăng nhập & Vault

Mỗi nút "Continue with …":

- **OpenRouter** — đăng nhập 1-click thật qua router (PKCE OAuth); một lần login là
  chạm được GPT/Claude/Gemini và hàng trăm model, không cần API key.
- **ChatGPT / Claude / Gemini** — nối thẳng vendor: mở trang key của vendor → dán key
  → kết nối trực tiếp API vendor (không qua OpenRouter).
- Lần đăng nhập đầu tự tạo user local từ tài khoản vendor.

Redirect xử lý tùy nơi chạy:

- **Desktop (Tauri)** — OAuth thật qua **loopback** `http://127.0.0.1:<port>` +
  trình duyệt hệ thống; đây là luồng đăng nhập production.
- **Web (https)** — OAuth thật qua redirect toàn trang.

**Vault.** Key không bao giờ nằm dạng plaintext hay trên UI. Trên desktop lưu trong
kho bí mật của OS (macOS Keychain / Windows Credential Manager / Linux Secret Service)
qua `src-tauri/src/vault.rs`; app chỉ lưu metadata không nhạy cảm. Trên web fallback về
`localStorage` có namespace. API key vẫn có sẵn trong **Advanced options**.

## Phát triển

Yêu cầu: [Node.js 20+](https://nodejs.org) và, cho vỏ desktop, các
[yêu cầu Tauri 2](https://v2.tauri.app/start/prerequisites/) (Rust + toolchain nền tảng).

```bash
npm install

# Web preview (chỉ UI, chạy trong trình duyệt)
npm run dev

# App desktop với login + Vault thật (cửa sổ Tauri)
npm run tauri dev

# Build desktop production — installer từng nền tảng (.exe/.dmg/.deb)
npm run tauri build
```

Kiểm thử (xem [`DEVELOPMENT.md`](./DEVELOPMENT.md) để biết quy trình đầy đủ):

```bash
npm run check                     # build + toàn bộ test frontend
cd agent-runner && npm run check  # typecheck + e2e (poll loop + IPC) + native tools
cd src-tauri && cargo run --example oauth_loopback_check
```

## Cấu trúc dự án

```
src/                  Giao diện React
  pages/              Home, Chat, Agents, Skills, Knowledge, Vault, Scheduled, Integrations, Settings
  components/         Sidebar + UI primitive kiểu shadcn
  lib/                App store (lưu bền), catalog, skills loader, utils
  runtime/            Engine nhúng: engine, providers, tools, connectors, telegram,
                      scheduler, knowledge (RAG), selfImprove, vault, oauth
skills/               Agent Skills (mỗi skill một thư mục)
agent-runner/         Universal Agent Runner (host độc lập SDK): poll loop, SQLite IPC,
                      providers, native-tools, mcp-client, memory, vault
src-tauri/            Vỏ Tauri 2 (Rust): auth, vault, runtime, sandbox (WASM tùy chọn)
```

## Skills

Mỗi skill là một thư mục [Agent Skills](https://agentskills.io) chuẩn tại
`skills/<tên>/SKILL.md`: frontmatter YAML với `name` và `description` theo chuẩn, các
field hiển thị dưới `metadata` (khóa tiền tố `vua-`), và phần body markdown chứa hướng
dẫn engine chạy khi skill hoạt động. Thêm skill = thêm một thư mục, không cần sửa code.

```bash
npm run validate:skills   # kiểm tra mọi skill theo chuẩn Agent Skills
```

Kiểm tra này cũng tự chạy trong `npm run build`.

## Nguyên tắc sản phẩm

> Nếu một người chưa từng dùng AI có thể tải, cài và bắt đầu dùng trong dưới 2 phút mà
> không cần đọc tài liệu nào, thì ta đã đạt chuẩn.

## Tác giả

**360org** · [vuaai.net](https://vuaai.net) · [support@vuaai.net](mailto:support@vuaai.net)
