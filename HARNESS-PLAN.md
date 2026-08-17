# Kế hoạch dựng lại kiến trúc Harness cho VuaAssistant

> **Ngày:** 2026-08-17 · **Nguồn tham chiếu:** [deepseek-ai/deepseek-harness](https://github.com/deepseek-ai/deepseek-harness) (MIT)
> **Trạng thái:** đang làm — hướng đã chốt (lấy ý "everything is a plugin", KHÔNG lấy Cordis).
> **Tiến độ:** 6/8 chặng xong · `main` @ `ee34459`

---

## 1. dsh thật sự là gì

| | DeepSeek Harness | VuaAssistant agent-runner |
|---|---|---|
| Quy mô | **456.490** dòng TS · 2.092 tệp · 50 nhóm package | **6.583** dòng · 38 tệp |
| Nền | Cordis (DI + plugin tree), vendored trong `vendor/` | Node thuần, import trực tiếp |
| Đóng gói | pnpm workspace, mỗi package một npm module | một thư mục `src/` |
| Giấy phép | MIT — học và mượn thoải mái | — |
| Node | `^22.19 \|\| >=24` | bundle Node 24.18 → **tương thích** |

Câu chốt của họ: **“everything is a plugin — there is no privileged core to patch.”**
Model adapter, tool registry, session log, và cả vòng lặp agent đều là plugin, thay được từ config.

**Kết luận thẳng:** dsh lớn gấp **15 lần** toàn bộ VuaAssistant. Bê nguyên Cordis + 50 package vào
là đổi một sản phẩm đang chạy lấy một công trường xây dở. Nhưng **ý tưởng** của họ thì rất đáng lấy,
và có cái vá được đúng lỗ hổng đang có thật trong máy mình.

---

## 2. Lỗ hổng có thật mà cách của DeepSeek vá được

Hiện tại `agent-runner/src/capability-rail.ts:63,70` **đoán** xem một tool có nguy hiểm không
bằng cách khớp regex vào **tên tool**:

```ts
const sideEffect = SIDE_EFFECT_NAMES.has(tool.name)
  || /(^|__)send|write|edit|delete|create|update|post|publish|message/i.test(tool.name);
requires_approval: APPROVAL_REQUIRED_NAMES.has(tool.name)
  || /(^|__)send|delete|post|publish|message/i.test(tool.name),
```

Chạy thử thật trên chính mã nguồn (`npx tsx`), kết quả sai **cả hai chiều**:

```
--- tool nguy hiểm mà rail KHÔNG bắt hỏi ---
KHÔNG | side_effect=không | wire_transfer
KHÔNG | side_effect=không | charge_card
KHÔNG | side_effect=không | transfer_money
KHÔNG | side_effect=không | deploy_production
KHÔNG | side_effect=không | drop_database
KHÔNG | side_effect=không | revoke_access
KHÔNG | side_effect=không | pay_invoice
KHÔNG | side_effect=không | execute_trade

--- tool vô hại mà rail lại bắt hỏi ---
HỎI   | side_effect=có  | read_messages
HỎI   | side_effect=có  | list_messages
HỎI   | side_effect=có  | search_message_history
```

Hai hậu quả:

1. **Bỏ lọt.** Mọi tool MCP bên thứ ba mà tên không trùng regex đều **chạy thẳng, không hỏi Sếp** —
   kể cả tool chuyển tiền. Danh sách cứng `SIDE_EFFECT_NAMES` chỉ biết 8 tên tool nội bộ của mình.
2. **Hỏi oan.** Tool chỉ đọc như `read_messages` bị bắt duyệt. Hỏi oan nhiều lần dạy người dùng
   bấm “Đồng ý” theo phản xạ — làm hỏng luôn giá trị của lần hỏi thật.

Cách dsh làm khác hẳn: **tool tự khai báo tính chất của chính nó** trong `ToolDefinition`, registry
không bao giờ đoán. Registry còn có allowlist chặn không cho các trường host-only
(`execute`, `timeoutMs`, `isConcurrencySafe`…) lọt vào request gửi model.

---

## 3. Sáu thứ đáng lấy, xếp theo giá trị thực cho VuaAssistant

### 🟢 Lấy ngay — giá trị cao, rủi ro thấp

**(1) Tool tự khai tính chất, rail thôi đoán.**
Thêm `sideEffect`, `requiresApproval`, `outputSchema` vào `ToolDefinition`; rail đọc trường đó
thay vì regex. Tool MCP không khai → **mặc định coi là nguy hiểm, phải hỏi** (an toàn thì nghiêng
về phía chặt). Vá thẳng lỗ ở mục 2. Ước tính ~150 dòng, đụng 4 tệp.

**(2) “Model-visible ⟺ logged”.**
Luật của dsh: *bất cứ thứ gì đi vào request gửi model đều phải dựng lại được từ session log*, và họ
có **invariant chạy lúc runtime** để khẳng định điều đó. Mình đang chắp vá: knowledge, memory và
context-prune đều tiêm thẳng vào prompt mà không để lại vết trong log → không tái hiện được lỗi,
không debug được khi Sếp bảo “sao nó trả lời kỳ vậy”. Đây là thứ đáng giá nhất về lâu dài.

**(3) Registry invariant có kiểm chứng máy.**
dsh bắt **mỗi package** phải có bạn đồng hành `./invariant`, và `verify-package-invariants` **tự
động đánh trượt** invariant rỗng không giải thích, invariant không dùng tới reporter, hay đăng ký
sai tên. Đây chính là bản cơ giới hoá của luật mình đã theo trong dự án: *mọi bài test phải được
kiểm chứng đảo ngược; 0 lỗi trên mã hỏng nghĩa là bài test câm*. Nên biến nó thành gate chạy được.

### 🟡 Lấy sau — cần thiết kế thêm

**(4) Capability seam ba vai.** Service Definition / Service Provider / Consumer.
Đổi provider là đổi cả sản phẩm: trỏ fs + subprocess sang sandbox từ xa thì Bash, PTY, LSP đi theo,
không phải fork. Mình đã có mầm (`providers/adapters/*`) nhưng chưa thành seam đúng nghĩa.

**(5) Tách `turn` / `step` rõ ràng + điểm mở rộng có kiểu.**
`poll-loop.ts` (563 dòng) đang trộn: nhận tin, dựng prompt, gọi model, chạy tool, prune, guard,
verify. dsh tách thành `turn/start → step/start → agent/request → tools/* → step/end → turn/end`,
mỗi mốc là một sự kiện có kiểu, cắm thêm được mà không sửa vòng lặp. Đây là đường thoát khỏi god file.

### 🔴 Không lấy

**(6) Cordis + 50 package + pnpm workspace.**
Với 6.583 dòng runner, chi phí DI framework + chia package lớn hơn lợi ích rất nhiều. Lấy **kỷ luật**
của họ (registry là effect, đăng ký trả về disposer, không hardcode tunable) mà **không** lấy framework.

---

## 4. Lộ trình 8 chặng

Mỗi chặng đẩy lên `main` riêng, và giữa hai lần đẩy app vẫn phải mở lên dùng được.

| # | Chặng | Trạng thái | Kết quả |
|---|---|---|---|
| 01 | Kernel: plugin, effect, sự kiện có kiểu | ✅ `2dad0ff` | `src/kernel/` |
| 02 | 13 tool native tự khai tính chất | ✅ `705a538` | mã cũ xếp sai 3/13 |
| 03 | Chính sách thành lớp bọc `tools/pre-execute` | ✅ `cceab54` | 0 chỗ còn đoán theo tên |
| 04 | Boot thành composition plugin | ✅ `cceab54` | `compose.ts` dùng chung test + chạy thật |
| 05 | Mốc `turn`/`step` thành sự kiện có kiểu | ✅ `0d4f39d` | quan sát trọn lượt từ ngoài |
| 06 | Prompt lắp từ sổ đăng ký | ✅ `5df58e4` | hết lệch 9/21 tool |
| 07 | Sổ phiên append-only + invariant | 🟡 một nửa `ee34459` | cơ chế invariant xong; luật "model thấy gì thì sổ phải có" **chưa** |
| 08 | Lan ra ngoài runner | ○ chưa | `ai-router/`, `src-tauri/`, `src/` |

**Chặng 07 mới xong một nửa — nói rõ để không tưởng nhầm là đã đủ.** Sổ invariant
đã chạy và đã bắt được vi phạm thật, nhưng luật đắt nhất của dsh — *bất cứ gì đi vào
request gửi model đều phải dựng lại được từ sổ phiên* — thì **chưa làm**. Knowledge,
memory và cắt-tỉa-ngữ-cảnh vẫn tiêm thẳng vào prompt không để lại vết.

**Đã đổi hành vi ở chặng 03:** `computer_use` nay hỏi trước khi điều khiển chuột và bàn
phím; `http_request` và `delegate_task` tính là có tác dụng phụ.

**Đã vá ở chặng 06:** prompt từng nói với model là có **9 tool** trong khi sổ đăng ký
**21** (13 native + 8 built-in). Mười hai tool nằm đó không bao giờ được dùng.

---

## 5. Lưu ý về thứ tự ưu tiên

Trong repo còn **một lỗi P0 chưa vá**: đổi `identifier` ở v1.1.59 làm người dùng cũ nâng cấp là
mất sạch Vault, kết nối và lịch sử chat (xem `AUDIT.md` mục 02). Việc đó chặn phát hành và chỉ tốn
một buổi; kiến trúc harness thì không chặn ai cả. Đề nghị vá P0 trước, rồi vào chặng A.

---
*Nguồn đối chiếu: `docs/architecture.md`, `AGENTS.md`, `docs/subsystems/{invariants,tools}.md` của deepseek-harness @ shallow clone 17/08/2026.*
