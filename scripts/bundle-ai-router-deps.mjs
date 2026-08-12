// AI Router phải mang theo thư viện của chính nó vào bản cài.
//
// `tauri.conf.json` đóng gói `../ai-router/**/*`, nhưng `ai-router/` không có
// `node_modules` riêng: khi chạy từ mã nguồn, Node đi ngược lên thư mục cha và
// tìm thấy `undici` ở `node_modules` gốc của dự án. Bản cài thì không có thư
// mục cha nào như vậy — `/usr/lib/VuaAssistant/_up_/ai-router/` đứng một mình —
// nên sidecar chết ngay khi khởi động:
//
//   Cannot find package 'undici' imported from
//     …/ai-router/core/open-sse/translator/concerns/image.js
//
// Hệ quả với người dùng: cài xong, AI Router không bao giờ lên, không có model,
// không chat được. Chạy từ mã nguồn thì mọi thứ vẫn tốt, nên lỗi này sống sót
// qua mọi lần kiểm tra cho tới khi có người cài thật.
//
// Bước này cài dependency production của ai-router vào chính nó, trước khi
// Tauri gom resource.

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const aiRouter = path.join(root, "ai-router");
const manifest = JSON.parse(readFileSync(path.join(aiRouter, "package.json"), "utf8"));
const deps = Object.keys(manifest.dependencies || {});

if (deps.length === 0) {
  console.log("⊘ ai-router không khai báo dependency nào, bỏ qua");
  process.exit(0);
}

console.log(`▸ cài dependency của ai-router vào chính nó: ${deps.join(", ")}`);
// Trên Windows `npm` là `npm.cmd`, không phải file thực thi — `spawnSync("npm")`
// hỏng ngay với ENOENT nếu không qua shell. Bước này từng làm đỏ job Windows
// trong CI, mà thông báo lúc đó chỉ nói "không cài được" nên nhìn log không
// biết vì sao.
const install = spawnSync(
  "npm",
  ["install", "--omit=dev", "--no-audit", "--no-fund", "--prefix", aiRouter],
  { stdio: "inherit", cwd: root, shell: process.platform === "win32" },
);
if (install.error || install.status !== 0) {
  // In ra nguyên nhân thật, không nuốt: một thông báo chung chung biến lỗi
  // hai phút thành lỗi hai tiếng.
  console.error(
    `✗ không cài được dependency cho ai-router\n` +
      `  nền tảng : ${process.platform}\n` +
      `  mã thoát : ${install.status}${install.signal ? ` (tín hiệu ${install.signal})` : ""}\n` +
      (install.error ? `  lỗi spawn: ${install.error.message}\n` : ""),
  );
  process.exit(1);
}

// Kiểm lại thật sự có trên đĩa. `npm install` báo thành công vẫn có thể không
// đặt gói đúng chỗ ta cần (workspace hoisting), mà đó chính là cái làm hỏng bản
// cài — nên phải kiểm chỗ đặt, không tin mã thoát.
const missing = deps.filter((dep) => !existsSync(path.join(aiRouter, "node_modules", dep)));
if (missing.length > 0) {
  console.error(
    `✗ thiếu trong ai-router/node_modules: ${missing.join(", ")}\n` +
      `  Bản cài sẽ không khởi động được AI Router.`,
  );
  process.exit(1);
}

console.log(`✓ ai-router mang đủ ${deps.length} thư viện vào bản cài`);
