#!/usr/bin/env node
/**
 * Smoke test bản desktop đã build, chạy được trên cả macOS, Windows và Linux.
 *
 * Đây chính là thứ người dùng báo hỏng ở #7 ("không thể khởi động AI Router và
 * Agent Runner"), #8 (Windows 11 cài xong không mở được) và #9 (Linux). Trước
 * đây không có cách tái hiện vì tưởng phải có màn hình thật; thực ra trên Linux
 * chỉ cần `xvfb-run`, còn macOS/Windows runner đã có phiên đồ hoạ sẵn.
 *
 * Test mở app thật rồi khẳng định những điều một bản cài hỏng sẽ trượt ngay:
 *   1. Tiến trình app sống, không thoát sớm.
 *   2. AI Router tự lên và trả /health.
 *   3. Agent Runner sống — đo bằng nhịp tim `.heartbeat` còn mới, không phải
 *      chỉ "có tiến trình" (một runner treo vẫn còn tiến trình nhưng đã chết).
 *   4. Hàng đợi IPC và Vault được tạo trong thư mục dữ liệu của nền tảng.
 *
 * Thiếu binary (hoặc thiếu xvfb trên Linux) thì bỏ qua với mã 0, để máy dev
 * chưa build không bị đỏ.
 */
import { spawn, spawnSync } from "node:child_process";
import { createServer } from "node:http";
import { existsSync, readFileSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import os from "node:os";
import path from "node:path";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
// Đọc thẳng từ tauri.conf.json, KHÔNG chép tay. Tauri đặt thư mục dữ liệu theo
// đúng `identifier` này; chép tay thì đổi tên app một lần là bài test đi tìm
// nhầm chỗ — chính xác chuyện đã xảy ra khi đổi `com.vuaai.assistant` thành
// `com.vuaai.vuaassistant` ở v1.1.59, làm CI đỏ trên cả ba nền tảng.
const IDENTIFIER = JSON.parse(
  readFileSync(path.join(repoRoot, "src-tauri/tauri.conf.json"), "utf8"),
).identifier;
if (!IDENTIFIER) throw new Error("tauri.conf.json thiếu `identifier`");
const isWindows = process.platform === "win32";
const isMac = process.platform === "darwin";

/** Nơi Tauri đặt dữ liệu ứng dụng trên từng nền tảng. */
function appDataDir() {
  const home = os.homedir();
  if (isWindows) {
    return path.join(process.env.APPDATA || path.join(home, "AppData/Roaming"), IDENTIFIER);
  }
  if (isMac) return path.join(home, "Library/Application Support", IDENTIFIER);
  return path.join(process.env.XDG_DATA_HOME || path.join(home, ".local/share"), IDENTIFIER);
}

/** Binary đã build, theo quy ước của từng nền tảng. */
function defaultBinary() {
  if (process.env.VUA_DESKTOP_BINARY) return process.env.VUA_DESKTOP_BINARY;
  const base = path.join(repoRoot, "src-tauri/target/debug");
  if (isWindows) return path.join(base, "vuaassistant.exe");
  return path.join(base, "vuaassistant");
}

function skip(reason) {
  console.log(`⊘ bỏ qua smoke desktop: ${reason}`);
  process.exit(0);
}

const binary = defaultBinary();
if (!existsSync(binary)) skip(`chưa có binary (${binary}); chạy \`cargo build\` trong src-tauri`);

// Linux CI không có phiên đồ hoạ nên cần màn hình ảo; macOS/Windows đã có sẵn.
const needsXvfb = !isWindows && !isMac && !process.env.DISPLAY;
if (needsXvfb && spawnSync("which", ["xvfb-run"]).status !== 0) skip("Linux không có DISPLAY và thiếu xvfb-run");

let pass = true;
const check = (name, cond) => {
  console.log(`${cond ? "✓" : "✗"} ${name}`);
  if (!cond) pass = false;
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Phục vụ bản dựng giao diện và ghi lại những gì WebView thật sự tải.
 *
 * Binary debug nạp giao diện từ `devUrl` (http://localhost:1420), không phải từ
 * `dist` nhúng sẵn như bản release. Không có gì ở cổng đó thì cửa sổ chỉ hiện
 * "Could not connect to localhost: Connection refused" — mà mọi kiểm tra phía
 * backend vẫn xanh. Đó chính là lỗ hổng khiến "app mở lên nhưng trắng trơn"
 * lọt lưới (#8/#19). Nên ở đây vừa phục vụ dist vừa đếm request: WebView có
 * tải `index.html` và ít nhất một bundle JS thì mới coi là giao diện đã nạp.
 */
const distDir = path.join(repoRoot, "dist");
if (!existsSync(path.join(distDir, "index.html"))) {
  skip("chưa có dist/index.html; chạy `npm run build`");
}
const loaded = { html: false, script: false };
const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript",
  ".css": "text/css",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".json": "application/json",
  ".woff2": "font/woff2",
};
const ui = createServer((request, response) => {
  const requested = decodeURIComponent((request.url || "/").split("?")[0]);
  let file = path.join(distDir, requested === "/" ? "index.html" : requested);
  // SPA: đường dẫn không phải file tĩnh thì trả index.html.
  if (!existsSync(file) || statSync(file).isDirectory()) file = path.join(distDir, "index.html");
  if (!file.startsWith(distDir)) { response.writeHead(403).end(); return; }
  const extension = path.extname(file);
  if (extension === ".html") loaded.html = true;
  if (extension === ".js") loaded.script = true;
  response.writeHead(200, { "Content-Type": MIME[extension] || "application/octet-stream" });
  response.end(readFileSync(file));
});
await new Promise((resolve, reject) => {
  ui.once("error", reject);
  ui.listen(1420, "127.0.0.1", resolve);
});

const [command, args] = needsXvfb
  ? ["xvfb-run", ["-a", "--server-args=-screen 0 1400x900x24", binary]]
  : [binary, []];

console.log(`▸ mở ${command} ${args.join(" ")}`);
// Mốc thời gian để phân biệt nhịp tim mới với nhịp còn sót của lần chạy trước.
// Lùi 1s cho lệch đồng hồ giữa tiến trình và hệ thống tệp.
const launchedAt = Date.now() - 1000;
const app = spawn(command, args, {
  cwd: repoRoot,
  detached: !isWindows,
  stdio: ["ignore", "pipe", "pipe"],
});
let output = "";
let spawnError = null;
let exitInfo = null;
app.stdout.on("data", (c) => { output += String(c); });
app.stderr.on("data", (c) => { output += String(c); });
app.on("error", (error) => { spawnError = error; });
// Ghi lại mã thoát ngay lúc nó xảy ra: một bản cài hỏng thoát trong tích tắc và
// nếu không bắt ở đây thì chỉ thấy "app không sống" mà không biết vì sao.
app.on("exit", (code, signal) => { exitInfo = { code, signal }; });

function stopAll() {
  try {
    // `/T` hạ cả cây tiến trình, nên AI Router và Agent Runner do app sinh ra
    // cũng dừng theo. Tuyệt đối không dọn theo tên ảnh trên Windows: chính
    // tiến trình chạy test này cũng là node.exe, nên `taskkill /IM node.exe`
    // giết luôn nó — đó là lý do phần chẩn đoán không bao giờ được in ra.
    if (isWindows) spawnSync("taskkill", ["/PID", String(app.pid), "/T", "/F"], { stdio: "ignore" });
    else process.kill(-app.pid, "SIGKILL");
  } catch { /* đã thoát */ }
  if (!isWindows) {
    for (const pattern of ["ai-router/src/sidecar.mjs", "agent-runner/dist/index.js"]) {
      spawnSync("pkill", ["-9", "-f", pattern], { stdio: "ignore" });
    }
  }
}
process.on("exit", stopAll);

// --- 1 & 2. App sống và AI Router tự lên -----------------------------------
let routerUp = false;
for (let i = 0; i < 60; i++) {
  await sleep(1000);
  if (app.exitCode !== null) break;
  try {
    const response = await fetch("http://127.0.0.1:36360/health", {
      signal: AbortSignal.timeout(1500),
    });
    if (response.ok) { routerUp = true; break; }
  } catch { /* chưa lên */ }
}
check("app desktop chạy được, không thoát sớm", app.exitCode === null);
check("AI Router tự khởi động và trả /health", routerUp);

// --- 3 & 4. Agent Runner sống, hạ tầng được tạo ----------------------------
const dataDir = path.join(appDataDir(), "runtime");
const heartbeat = path.join(dataDir, "ipc/.heartbeat");

// Chờ nhịp tim MỚI HƠN lúc mở app. Chỉ kiểm "file tồn tại" là chưa đủ: lần
// chạy trước có thể để lại một nhịp cũ, khiến test tưởng runner đang sống.
let beat = false;
for (let i = 0; i < 60; i++) {
  if (existsSync(heartbeat) && statSync(heartbeat).mtimeMs >= launchedAt) { beat = true; break; }
  await sleep(1000);
}
check(`thư mục dữ liệu được tạo (${dataDir})`, existsSync(dataDir));
check("Agent Runner đập nhịp sau khi app mở", beat);

for (const relative of ["ipc/inbound.db", "ipc/outbound.db", "vault.db"]) {
  check(`tạo ${relative}`, existsSync(path.join(dataDir, relative)));
}

// --- 5. Giao diện thật sự nạp được -----------------------------------------
// Chờ thêm một nhịp cho WebView kịp tải, rồi kiểm dấu vết request.
for (let i = 0; i < 20 && !(loaded.html && loaded.script); i++) await sleep(1000);
check("WebView tải được trang giao diện", loaded.html);
check("WebView chạy bundle ứng dụng (không phải cửa sổ trắng)", loaded.script);

ui.close();
stopAll();
if (!pass) {
  console.log("\n--- chẩn đoán ---");
  console.log(`binary   : ${binary}`);
  console.log(`nền tảng : ${process.platform} ${process.arch}`);
  if (spawnError) console.log(`spawn lỗi: ${spawnError.message}`);
  if (exitInfo) console.log(`thoát    : code=${exitInfo.code} signal=${exitInfo.signal}`);
  console.log(`UI đã tải: html=${loaded.html} script=${loaded.script}`);
  console.log("--- log app (2000 ký tự cuối) ---");
  console.log(output.trim() ? output.slice(-2000) : "(app không in ra gì)");
}
console.log(
  pass
    ? `\n✓ bản desktop (${process.platform}) tự dựng đủ AI Router, Agent Runner, IPC và Vault`
    : `\n✗ FAILED trên ${process.platform}`,
);
process.exit(pass ? 0 : 1);
