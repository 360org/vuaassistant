# Đặc Tả & Cấu Trúc Trang Landing Page VuaAssistant

> **URL mục tiêu**: `https://vuahethong.net/free-vuaassistant-agentic`  
> **Source XML Odoo**: [`/Volumes/DATA/DEV/vuaassistant/docs/landing_page_free_vuaassistant_agentic.xml`](/Volumes/DATA/DEV/vuaassistant/docs/landing_page_free_vuaassistant_agentic.xml)  
> **Chuẩn thiết kế**: Odoo 17 Website Builder Snippets (`s_cover`, `s_features`, `s_three_columns`, `s_comparisons`, `s_numbers`, `s_faq_collapse`, `s_call_to_action`).

---

## 1. Thông Điệp Cốt Lõi & Định Vị

- **Headline**: Trợ Lý AI Để Bàn Dành Cho Mọi Người (VuaAssistant v1.1.62).
- **Giá trị cốt lõi**:
  1. **Cài 2 phút — Dùng tức thì**: Không Docker, không Python, không gõ lệnh Terminal.
  2. **Bảo mật tuyệt đối (On-Device)**: Phân tích file Word, Excel, PDF và lưu trữ Vault AES-256 ngay trên máy cá nhân, không gửi dữ liệu mật lên đám mây.
  3. **Kho 230+ Chuyên Gia (Agent Store)**: Sẵn sàng phục vụ Kế toán, Pháp chế, Marketing, Bán hàng, Lập trình.
  4. **Tiết kiệm chi phí**: Đăng nhập 1 chạm bằng tài khoản ChatGPT/Claude/Gemini sẵn có hoặc dùng thử miễn phí, không bắt buộc mua API Key.

---

## 2. Cấu Trúc Các Block Snippet

| Thứ tự | Block Snippet | Nội dung chính |
|---|---|---|
| **1. Hero** | `s_cover` | Tiêu đề lớn, nút tải trực tiếp macOS/Windows, 4 huy hiệu an toàn (On-Device, 1-Click login, Native app). |
| **2. Nỗi đau vs Giải pháp** | `s_features` | 3 cột so sánh: Web AI rời rạc ➔ Tool AI dev phức tạp ➔ **VuaAssistant tối giản, bảo mật**. |
| **3. Lợi thế vượt trội** | `s_three_columns` | 6 tính năng đắt giá: Cài nhanh, 230+ Agent, Kéo thả RAG, App Vault, Hẹn giờ tự động, Dạy Skill trong chat. |
| **4. Bảng đối đầu** | `s_comparisons` | Ma trận so sánh chi tiết giữa ChatGPT Web, Tool mã nguồn mở và VuaAssistant. |
| **5. Hướng dẫn 3 bước** | `s_numbers` | Bước 1: Tải app ➔ Bước 2: Chọn AI ➔ Bước 3: Giao việc & Thảnh thơi. |
| **6. FAQ** | `s_faq_collapse` | Giải đáp 4 băn khoăn lớn của người dùng phổ thông (Kỹ năng tin học, Bảo mật dữ liệu, Chi phí, Ứng dụng thực tế). |
| **7. CTA** | `s_call_to_action` | Nút bấm chuyển đổi tải bản cài mới nhất trên GitHub Releases. |

---

## 3. Quy Trình Nạp Lên Odoo SaaS `vuahethong.net`

1. Copy file XML [`/Volumes/DATA/DEV/vuaassistant/docs/landing_page_free_vuaassistant_agentic.xml`](/Volumes/DATA/DEV/vuaassistant/docs/landing_page_free_vuaassistant_agentic.xml) vào module giao diện Odoo tương ứng trên server `vuahethong`.
2. Khai báo file trong `__manifest__.py` phần `'data': [...]`.
3. Chạy cập nhật module trên cluster SaaS theo quy trình 9 bước chuẩn.
