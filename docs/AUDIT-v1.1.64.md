# 📋 Audit — VuaAssistant v1.1.64

> **Ngày:** 2026-08-26 · **Nhánh:** `main` @ `6c58850` · **Phiên bản:** `v1.1.64`
> **Cách làm:** chạy thật `npm run check`, `cd agent-runner && npm run check`, `tsc`,
> `cargo check`, `npm run build`; dò trạng thái cây plugin đang chạy bằng lệnh; quét bí mật
> và mã chết. Không chép lại từ tài liệu — mọi con số dưới đây đều đo bằng lệnh.

---

## 🎯 Kết luận 30 giây

| Câu hỏi | Trả lời |
|---|---|
| Sức khoẻ build & test? | 🟢 **Sạch cả bốn mặt.** root check XANH (exit 0) · runner check XANH (exit 0) · tsc XANH · build XANH · cargo **0 lỗi, 0 cảnh báo**. |
| Rò rỉ bí mật? | 🟢 **Không.** Không khoá API nào trong mã, **0** tệp `.env` bị git theo dõi. |
| Có lỗ hổng kiến trúc nào không? | 🟡 **Một, đã vá** ở `6c58850`. `providers` là plugin duy nhất có thể âm thầm mất invariant. |
| Nợ còn lại? | 🟡 `store.tsx` **1.817** dòng và **53** dòng mã chết. Không mục nào chặn phát hành. |

---

## 🔴 Đã vá trong lần audit này

### `providers` có thể âm thầm mất invariant

Bốn plugin đăng ký invariant, nhưng chỉ ba khai phụ thuộc:

```
skills.ts:44          dependencies: ['invariants', 'tools']     ✓
model-visible.ts:86   dependencies: ['invariants', ...]         ✓
invariants.ts:101     dependencies: ['invariants', ...]         ✓
providers-plugin.ts   (không khai)  +  ctx.invariants?.register  ✗
```

Dấu `?.` biến một lỗi thứ tự nạp thành **im lặng bỏ qua**. Chứng minh bằng lệnh:

```
A · invariants nạp TRƯỚC : providers → chạy 1
B · providers nạp TRƯỚC : (rỗng)   → chạy 0
    cấu hình gọi nhà cung cấp KHÔNG TỒN TẠI mà vẫn dựng trót lọt
```

Chốt "sổ rỗng" trong `composeRunner` cũng không cứu được, vì các invariant khác vẫn chạy nên
`verify()` trả số dương. Đây đúng là lớp lỗi mà kiến trúc sinh ra để chặn — *sai cấu hình phải nổ
to, không im lặng bỏ qua* — và nó nằm trong mã em viết.

**Đã sửa:** khai `dependencies: ['invariants']` và bỏ `?.`
(`agent-runner/src/kernel/providers-plugin.ts:57`, `:100`).
**Đảo ngược:** nạp `providers` trước `invariants` nay **nổ** kèm tên plugin còn thiếu; đối chứng
đúng thứ tự vẫn chạy bình thường.

Lưu ý trung thực: trong thứ tự nạp hiện tại của `compose.ts`, `invariants` nạp đầu tiên nên lỗ này
**chưa từng kích hoạt**. Nó là bẫy cho lần sửa `compose.ts` sau, không phải lỗi đang cắn người dùng.

---

## 🟢 Những chỗ đã lành

| Điểm | Trạng thái đo được |
|---|---|
| Cảnh báo Rust | **0** (từng là 13) |
| Mã chết frontend | 3/5 tệp đã xoá |
| Gộp `getDataDir()` | **Xong trọn vẹn** — đúng **1** chỗ đọc `process.env.VUA_DATA_DIR` |
| Sổ skill | Trùng tên **nổ**; có invariant `skills` riêng |
| CI | v1.1.64 xanh; chuỗi 3 bản đỏ đã chấm dứt |
| `TODO` / `FIXME` / `HACK` | **0** trong cả ba phần (src, agent-runner, src-tauri) |
| `: any` / `@ts-ignore` | **6** trên ~30.000 dòng |
| `console.log` frontend | 3 |

### 📌 Đính chính báo cáo trước

Bản `TOI-UU-v1.1.64` ghi *"4 chỗ còn đọc `VUA_DATA_DIR` trực tiếp"* — **sai**. Bốn chỗ đó là
**chú thích và docstring**, không phải mã. Đếm đúng bằng `process.env.VUA_DATA_DIR` thì chỉ có
**một** chỗ, nằm trong `agent-runner/src/util/data-dir.ts`. Mục đó coi như đã xong.

---

## 🟡 Còn lại

| # | Điểm | Số liệu | Ghi chú |
|---|---|---|---|
| 1 | `src/lib/store.tsx` | **1.817** dòng | Tệp lớn nhất dự án, chưa ai đụng qua 5 bản phát hành |
| 2 | Mã chết còn sót | **53** dòng | `src/lib/store/VaultContext.tsx` (28) và `src/lib/store/KnowledgeContext.tsx` (25) — **0** chỗ dùng; đợt dọn trước xoá 3/5 tệp |
| 3 | Bundle | 4,1 MB | Đã lazy-load & tách chunk; app đọc từ đĩa nên chưa cấp bách |
| 4 | `npm run check` | ~30 giây | Theo dõi: quá một phút thì người ta bắt đầu bỏ qua nó |

**Mặt được đáng ghi nhận:** `agent-runner/src/poll-loop.ts` vẫn **606 dòng** sau khi runner thêm 4
plugin và 12 tool; `Chat.tsx` giảm 104 dòng. Mối quan tâm mới đang **cắm vào** chứ không đổ dồn vào
vòng lặp — đúng điều kiến trúc plugin sinh ra để làm.

---

## ✅ Đề nghị

1. **Xoá 53 dòng mã chết** — 5 phút, dọn nốt phần đợt trước bỏ sót.
2. **Quyết `store.tsx`** — làm nốt phần phân rã bỏ dở, hay bỏ hẳn ý định tách. Đây là thứ duy nhất
   đang xấu đi thay vì đứng yên.
3. Giữ thói quen **xem CI trước khi phát hành**.

---
*Audit v1.1.64 · đo bằng lệnh chạy thật, có đối chứng và đảo ngược cho mọi khẳng định về lỗi.*
