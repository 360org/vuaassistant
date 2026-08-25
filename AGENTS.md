# AGENTS.md — Quy chuẩn Điều phối Multi-Agent (VuaAssistant)

> **Mô hình Vận hành**: Hệ thống VuaAssistant vận hành theo kiến trúc Multi-Agent & Universal Agent Runner độc lập (Zero-Docker).
> Tài liệu này định nghĩa trách nhiệm của các roles AI và cách thức cộng tác theo chuẩn AIaC 360org.

---

## 1. Phân bổ Vai trò (Agent Roles & Model Assignment)

| Role | Trách nhiệm chính | Model ưu tiên | Giai đoạn phụ trách |
|---|---|---|---|
| **Architect / PO Agent** | Phân tích bài toán, thiết kế kiến trúc hệ thống, duyệt FR/NFR, bảo vệ boundary an toàn. | `Claude Opus / Sonnet` | `/idea`, `/req`, `/spec`, `/plan` |
| **Harness / Engine Builder** | Lập trình nhân Kernel, Native Tools, IPC, SQLite IPC, Capability Rail, Policy. | `Claude Sonnet / Codex` | `/build`, `/refactor` |
| **Contract & Verification Agent** | Viết & chạy hợp đồng kiểm chứng tự động (Invariants, Contract checks, Live test). | `Gemini Flash / Pro` | `/test`, `/verifier` |
| **Release & Deployment Agent** | Đóng gói bản cài đa nền tảng (macOS/Windows/Linux), kiểm tra chữ ký số, đồng bộ version. | `Gemini / Claude` | `/review`, `/ship` |

---

## 2. Nguyên tắc Cộng tác Đa Agent (Core Multi-Agent Protocols)

1. **Everything is a Plugin (Kernel First)**:
   - Mọi tính năng mở rộng của Agent Runner (MCP, Scheduler, Telegram, Skills, Verifier, Policy) đều là một plugin cắm qua `kernel.use()`.
   - Vòng lặp chính (`poll-loop`) giữ nguyên sự tối giản, không code cứng logic nghiệp vụ vào thân vòng lặp.

2. **Cô lập Ngữ cảnh Tuyệt đối (Role Isolation)**:
   - Mỗi vai trò Agent có thư mục `agents/<roleName>/` riêng biệt chứa:
     * `instructions.md`: Kim chỉ nam công việc.
     * `soul.md`: Tính cách, văn phong giao tiếp.
     * `memory/`: Bộ nhớ lâu dài (`learned.md`), tri thức và dữ liệu hoạt động.
   - Tuyệt đối không để rò rỉ (bleed) dữ liệu hoặc bộ nhớ giữa các vai trò khác nhau.

3. **Cửa Phân Quyền & Vai Kiểm Độc Lập (Capability Rail & Maker/Checker)**:
   - Mọi công cụ có tác dụng phụ (`sideEffect: true` hoặc `requiresApproval: true`) đều phải đi qua hàng rào chính sách (`policyPlugin`).
   - Vai kiểm (`verifierPlugin`) chạy trong một phiên độc lập, không có công cụ, mặc định nghiêng về từ chối để bảo vệ máy người dùng.

---

## 3. Bản đồ Tài liệu Tham chiếu (`docs/*`)

Mọi thông tin chi tiết và lịch sử phát triển được phân bổ có hệ thống trong thư mục `docs/`:

- [`docs/IDEA.md`](/Volumes/DATA/DEV/vuaassistant/docs/IDEA.md) — Ý tưởng, triết lý Zero-Docker và bài toán cốt lõi.
- [`docs/SPEC.md`](/Volumes/DATA/DEV/vuaassistant/docs/SPEC.md) — Đặc tả kỹ thuật và yêu cầu tính năng chi tiết.
- [`docs/ARCH.md`](/Volumes/DATA/DEV/vuaassistant/docs/ARCH.md) — Kiến trúc hệ thống 3 tầng (Tauri Webview, Host Runner, AI Router).
- [`docs/DEPLOY_GUIDE.md`](/Volumes/DATA/DEV/vuaassistant/docs/DEPLOY_GUIDE.md) — Hướng dẫn cài đặt, phát triển cục bộ và đóng gói release.
- [`docs/CHANGELOGS.md`](/Volumes/DATA/DEV/vuaassistant/docs/CHANGELOGS.md) — Nhật ký chi tiết mọi thay đổi và tái cấu trúc qua các phiên bản.
- [`docs/CHECKLIST.md`](/Volumes/DATA/DEV/vuaassistant/docs/CHECKLIST.md) — Danh mục kiểm chứng tính năng đạt chuẩn Production (100% Verified).
- [`docs/HARNESS-PLAN.md`](/Volumes/DATA/DEV/vuaassistant/docs/HARNESS-PLAN.md) — Kế hoạch & lộ trình kiến trúc DeepSeek Harness / Kernel Plugin.
- [`docs/AUDIT.md`](/Volumes/DATA/DEV/vuaassistant/docs/AUDIT.md) — Báo cáo audit định kỳ và kiểm chứng sức khỏe CI/CD.
