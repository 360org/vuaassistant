# Quy trình phát triển

Chạy live → test → commit → cắt phiên bản. Không có gì được phát hành khi chưa xanh.

## 1. Chạy live

**Web preview (nhanh nhất, hot reload):**

```bash
npm install     # lần đầu
npm run dev      # → http://localhost:1420
```

"Continue with OpenRouter" là đăng nhập thật trên localhost; các vendor khác định
tuyến qua model của OpenRouter. Ở đây credential nằm trong trình duyệt.

**Không dùng Docker/Colima cho dev/test nữa:** app chạy bằng Tauri Host Process native để test đúng Vault, sidecar, filesystem và IPC thật.

**App desktop (bản thật, hot reload):**

```bash
npm run tauri dev
```

Mở đúng cửa sổ VuaAssistant thật. Cần Rust toolchain và thư viện webview của OS
(WebKitGTK trên Linux, WebView2 trên Windows, có sẵn trên macOS). Credential nằm
trong OS keychain (Vault). (Cửa sổ desktop là GUI native nên không chạy trong
Docker được — dùng trực tiếp trên máy.)

## 2. Test trước khi commit

Một lệnh chạy cả build production **và** toàn bộ kiểm thử đầu-cuối (agent tools,
Telegram, scheduler, đăng nhập, cô lập vai trò, self-improve, connectors, RAG):

```bash
npm run check
```

Phía Agent Runner (backend độc lập):

```bash
cd agent-runner
npm install
npm run check    # typecheck + e2e (poll loop + SQLite IPC) + native tools
```

Smoke test bản desktop (mở app thật, không cần màn hình):

```bash
sudo apt-get install -y xvfb libwebkit2gtk-4.1-dev libgtk-3-dev   # Linux, một lần
npm run build && (cd src-tauri && cargo build)
node scripts/desktop-smoke-check.mjs
```

Test này mở app dưới `xvfb-run` rồi kiểm nó **tự** dựng AI Router, Agent Runner,
hàng đợi IPC và Vault — đúng thứ người dùng báo hỏng ở #7/#8/#9. Máy không có
`xvfb-run` hoặc chưa build binary thì test tự bỏ qua, không làm đỏ.

Phía Rust (vỏ desktop + sandbox):

```bash
cd src-tauri
cargo check
cargo run --example oauth_loopback_check
cargo run --features sandbox --example sandbox_check
```

Chỉ commit khi `npm run check` xanh. CI chạy đúng các kiểm thử này mỗi lần push,
nên một bản đỏ không bao giờ được merge.

## 3. Commit

```bash
git add -A && git commit -m "…"
git push
```

## 4. Cắt một phiên bản phát hành

```bash
npm run version:set 0.1.1        # đổi version ở package.json, tauri.conf.json, Cargo.*
# chuyển mục "Chưa phát hành" trong CHANGELOG.md → "[0.1.1]"
npm run check                    # xanh
git commit -am "release: v0.1.1"
git tag v0.1.1 && git push --tags
```

Đẩy tag `vX.Y.Z` sẽ kích hoạt workflow **Release** — nó build installer cho macOS
(Apple Silicon + Intel), Windows và Linux rồi đăng lên một GitHub Release. Anh cũng
có thể chạy workflow đó bằng tay từ tab Actions.
