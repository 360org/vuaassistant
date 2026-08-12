---
name: skill-creator
description: Công cụ tự động thiết kế, xây dựng và đóng gói Skill mới cho AI Agent theo chuẩn Agent Skills (như Claude).
metadata:
  vua-title: "Skill Creator (Tự tạo Skill mới)"
  vua-emoji: "🛠️"
  vua-category: "Development"
  vua-tagline: "Tạo và đóng gói Skill mới cho AI Agent theo chuẩn Agent Skills"
  vua-prompt: "Hãy giúp tôi tạo một Skill mới để xử lý công việc: [mô tả yêu cầu skill tại đây]"
  vua-order: "1"
---

# Skill Creator — Hướng dẫn Tạo Kỹ năng cho AI Agent

Công cụ này giúp bạn thiết kế, viết hướng dẫn chỉ dẫn và tự động đóng gói một Kỹ năng (Skill) mới cho AI Agent trong VuaAssistant theo đúng quy chuẩn Agent Skills.

## Trình tự tạo Skill:
1. **Phân tích Yêu cầu**: Xác định tên skill (dạng `kebab-case`), mục đích sử dụng và các bước xử lý logic.
2. **Xây dựng Frontmatter YAML**:
   - `name`: Tên định danh skill ngắn gọn (ví dụ: `odoo-blog-writer`, `excel-report-builder`).
   - `description`: Mô tả 1-2 câu về nhiệm vụ của skill.
   - `metadata`: `vua-title`, `vua-emoji`, `vua-category`, `vua-tagline`, `vua-prompt`.
3. **Viết Nội dung Chỉ dẫn (Instructions)**:
   - Các bước thực hiện chi tiết (Step 1, Step 2, Step 3...).
   - Quy tắc định dạng đầu ra và các trường hợp đặc biệt.
4. **Gọi công cụ `create_skill`**:
   - Sử dụng tool `create_skill({ name, description, title, emoji, category, prompt, instructions })` để lưu và đóng gói trực tiếp vào thư viện Skills của ứng dụng!
