# Bàn giao — Di trú 4 hệ con sang Host Process

> Cập nhật: 2026-07-27 · Nhánh `dev`
> Mục tiêu (idea.md §1.3, §C): bộ não chạy ở **Host Process**, không phải webview.
> Đóng app vẫn phải chạy lịch và Telegram. **Chốt một công nghệ, build 1 chạy 3.**

---

## Backup trước khi refactor

| Loại | Tên |
|---|---|
| Git tag | `backup-pre-hostprocess-20260727-0945` |
| Git branch | `backup/pre-hostprocess-20260727-0945` |
| File | `~/vuaassistant-backup-20260727-0945.tar.gz` (2.6M) |

---

## Tiến độ 4 hệ con

| # | Hệ con | Trạng thái | Ghi chú |
|---|---|---|---|
| 1 | **Scheduler** | ✅ **XONG** | `agent-runner/src/scheduler/` · 18 test · bản webview đã gỡ |
| 2 | **Telegram** | ✅ **XONG** | Router giữ token + Runner long-poll · 16 test · bản webview đã gỡ |
| 3 | **selfImprove** | ✅ **XONG** | `agent-runner/src/memory/self-improve.ts` · 22 test · bản webview đã gỡ |
| 4 | **Knowledge/RAG** | ✅ **XONG** | `knowledge.db` (app ghi, runner đọc) · 14 test · IndexedDB đã gỡ |

**Cả 4 hệ con đã nằm trong Host Process.** Webview chỉ còn hiển thị.
Đã xoá: `src/runtime/telegram.ts`, `scheduler.ts`, `schedule.ts`, `nanoclawSessions.ts`,
`selfImprove.ts` và 3 script test tương ứng ở root.

**RAG trước đây chết hẳn trên đường runner** — webview truy xuất excerpt rồi nhét vào
`options.knowledgeExcerpts`, nhưng `nanoclawEngine.chat` chỉ gửi text sang runner nên
excerpt bị bỏ. Giờ runner tự truy xuất trong `executeAgentLoop`, nên chat + Telegram +
lịch đều được grounding.

---

## Telegram chạy thế nào (đã xong)

Telegram nhét bot token **trong URL path** (`/bot<token>/getUpdates`), mà connector
gateway cấm credential trong URL. → **Router giữ token, Runner chỉ điều khiển.**

**Router** — `ai-router/src/sidecar.mjs`, đều cần `Authorization: Bearer <AI_ROUTER_CONNECTOR_TOKEN>`:

| Endpoint | Method | Tác dụng |
|---|---|---|
| `/v1/channels/telegram/status` | GET | Có token chưa (không lộ giá trị) |
| `/v1/channels/telegram/updates` | POST `{offset,timeout}` | Long-poll |
| `/v1/channels/telegram/send` | POST `{chatId?,text}` | Gửi tin (thiếu `chatId` → dùng chat id trong Vault) |

**Runner** — `agent-runner/src/channels/telegram.ts`: long-poll → `executeAgentLoop`
→ `/send`. Bỏ qua backlog lần đầu, transcript theo `sessionId` của từng chat.
Mỗi lượt ghi thêm vào `messages_out` (`channel_type='telegram'`) để UI thấy hội thoại.

**Hàng đợi outbound dùng chung 3 kênh** — mỗi dòng phải gắn `channel_type`:

| `channel_type` | Ai ghi | Ai đọc |
|---|---|---|
| `chat` | poll-loop | cửa sổ chat (`nanoclaw.ts`) |
| `telegram` | channel Telegram | poller nền trong `store.tsx` |
| `scheduled` | scheduler | poller nền trong `store.tsx` |

Thiếu tag này thì câu trả lời Telegram sẽ nhảy vào ô chat như thể là câu trả lời
của người dùng. Đừng ghi `channel_type = null`.

---

## Việc tồn đọng

### 🔴 Push bị chặn — cần `workflow` scope
Commit `2950b10` sửa `.github/workflows/release.yml`. Không tách được vì
`scripts/desktop-bundle-contract-check.mjs` kiểm chứng chính nội dung workflow đó.
```bash
git push origin dev
```

### ⬜ Kiểm chứng vòng cuối Telegram
Runner báo `[telegram] Connected — listening for messages`. Cần PO nhắn thử bot từ
điện thoại để xác nhận đầu-cuối (phần này không tự test được).

---

## Nền tảng đã chốt (đừng làm lại)

- **`node:sqlite`** thay `better-sqlite3` → runner **0 runtime dependency**, một
  `dist/index.js` chạy cả 3 nền tảng. Bundle contract **fail nếu native addon quay lại**.
- **Sandbox có 2 gốc**: `workspace/` và `agents/<tên>/` (memory của chính agent).
  Trước đó chỉ có workspace nên agent bị chặn đọc memory mà system prompt bảo nó đọc.
- **`runner.pid`**: app giết runner mồ côi trước khi spawn cái mới. Runner giờ ôm
  scheduler + Telegram, để sót 2 tiến trình là trả lời trùng.
- **File chia sẻ với runner phải nằm ở `runtime_status().dir`**, không phải
  `~/.vuaassistant/data`. Hai chỗ này khác nhau.
- **`knowledge.db`**: app ghi (nó giữ File + pdfjs để trích text), runner mở
  read-only để truy xuất. Cùng mô hình sở hữu với `inbound.db`.
- **Chỉ ghi đè file dữ liệu sống sau khi đã đọc nó ít nhất một lần** —
  `tasksLoadedRef` trong `store.tsx` là mẫu tham chiếu.
- Quy trình test: **không Docker**. `npm run tauri dev`, rồi thao tác thật trên UI.
- Đọc `skills/vuaassistant-dev-guidelines/SKILL.md` trước khi sửa — **Luật số 1: bám idea.md**.
