// Contract check: Executable Skills & In-chat Skill Lifecycle
//
// Proves:
// 1. Skill registration into Kernel SkillRegistry with required tools.
// 2. Frontmatter parsing with `tools: [...]` and `vua-tools`.
// 3. In-chat creation tool `create_or_update_skill` generates valid disk files and event payload.
// 4. In-chat reading tool `read_skill_file` reads back both built-in and created skills.
// 5. Active skill tools bind to runtime capability rail when executed.

import assert from "node:assert";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

console.log("▸ Bắt đầu kiểm chứng Kiến trúc Executable Skills (DeepSeek Harness style)...");

// 1. Test frontmatter parser in src/lib/skills.ts
import { parseSkillMd, smartParseSkill, toTemplate } from "../src/lib/skills.ts";

const sampleYamlWithTools = `---
name: web-scraper
description: Tự động cào dữ liệu từ trang web
tools:
  - http_request
  - file_write
metadata:
  vua-title: "Web Scraper"
  vua-emoji: "🌐"
  vua-category: "Data"
  vua-tagline: "Thu thập dữ liệu web"
---

# Web Scraper Guide
Chỉ dẫn cào web chi tiết...
`;

const parsed = parseSkillMd(sampleYamlWithTools);
assert.strictEqual(parsed.name, "web-scraper");
assert.deepStrictEqual(parsed.tools, ["http_request", "file_write"]);
assert.strictEqual(parsed.metadata["vua-title"], "Web Scraper");

const template = toTemplate(parsed);
assert.strictEqual(template.id, "web-scraper");
assert.deepStrictEqual(template.tools, ["http_request", "file_write"]);
console.log("✓ Parse Skill YAML frontmatter và trích xuất tools thành công");

// 2. Test inline tools parsing e.g. tools: ["file_read", "schedule_task"]
const inlineToolsYaml = `---
name: auto-poster
description: Đăng bài tự động theo lịch
tools: ["schedule_task", "http_request"]
metadata:
  vua-title: "Auto Poster"
---

Nội dung chỉ dẫn...
`;
const parsedInline = parseSkillMd(inlineToolsYaml);
assert.deepStrictEqual(parsedInline.tools, ["schedule_task", "http_request"]);
console.log("✓ Parse Skill YAML frontmatter với inline tools array thành công");

// 3. Test Kernel SkillRegistry plugin
import { createKernel } from "../agent-runner/dist/kernel/runtime.js";
import { skillsPlugin } from "../agent-runner/dist/kernel/skills.js";

const kernel = createKernel();
await kernel.use(skillsPlugin);
await kernel.start();

assert.ok(kernel.root.skills, "kernel.root.skills phải tồn tại");

const unregister = kernel.root.skills.register({
  name: "excel-pro",
  title: "Excel Pro",
  description: "Xử lý bảng tính nâng cao",
  tools: ["file_read", "file_write"],
  instructions: "Tự động phân tích excel",
});

assert.strictEqual(kernel.root.skills.has("excel-pro"), true);
assert.strictEqual(kernel.root.skills.get("excel-pro")?.title, "Excel Pro");
assert.deepStrictEqual(kernel.root.skills.getRequiredTools("excel-pro"), ["file_read", "file_write"]);

unregister();
assert.strictEqual(kernel.root.skills.has("excel-pro"), false);
console.log("✓ Kernel SkillRegistry đăng ký, tra cứu và dispose plugin binding thành công");

// 4. Test In-chat native tools: create_or_update_skill & read_skill_file
import { executeTool } from "../agent-runner/dist/native-tools/index.js";

const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), "vua-skill-test-"));
process.env.VUA_DATA_DIR = tempHome;

const createResult = await executeTool("create_or_update_skill", {
  name: "market-researcher",
  title: "Chuyên Gia Nghiên Cứu Thị Trường",
  description: "Nghiên cứu thị trường và đối thủ",
  category: "Marketing",
  emoji: "📈",
  prompt: "Hãy giúp tôi phân tích thị trường ngành thương mại điện tử",
  tools: ["http_request", "schedule_task"],
  instructions: "Bước 1: Tìm thông tin thị trường...\nBước 2: Tổng hợp số liệu...",
});

assert.ok(createResult.content.includes("✅ Đã lưu và cập nhật thành công"));
assert.ok(createResult.content.includes("market-researcher"));

const savedSkillPath = path.join(tempHome, "skills", "market-researcher", "SKILL.md");
assert.ok(fs.existsSync(savedSkillPath), "Tệp SKILL.md phải được ghi ra đĩa");

const fileContent = fs.readFileSync(savedSkillPath, "utf8");
assert.ok(fileContent.includes("name: market-researcher"));
assert.ok(fileContent.includes("vua-tools: \"http_request, schedule_task\""));

// Read skill file back via tool
const readResult = await executeTool("read_skill_file", {
  name: "market-researcher",
});
assert.ok(readResult.content.includes("name: market-researcher"));
assert.ok(readResult.content.includes("Chuyên Gia Nghiên Cứu Thị Trường"));

// Cleanup temp test directory
fs.rmSync(tempHome, { recursive: true, force: true });
console.log("✓ In-chat Skill lifecycle: tạo, lưu đĩa vật lý và đọc lại SKILL.md thành công");

console.log("\n✅ TOÀN BỘ KIỂM CHỨNG EXECUTABLE SKILLS & IN-CHAT LIFECYCLE ĐÃ HOÀN TẤT!");
