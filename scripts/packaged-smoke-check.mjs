#!/usr/bin/env node
/**
 * Chạy BẢN ĐÃ ĐÓNG GÓI — đúng thứ người dùng cài — trên cả ba nền tảng.
 *
 * `desktop-smoke-check.mjs` chạy binary `debug`, mà binary debug nạp giao diện
 * từ `devUrl` (localhost:1420, do chính bài test dựng lên) và phân giải thư
 * viện qua `node_modules` gốc của repo. Bản cài thật khác hẳn ở cả hai điểm:
 * giao diện nằm sẵn trong gói, và mỗi resource đứng một mình dưới thư mục cài.
 *
 * Khác biệt đó từng giấu một lỗi chết người: `ai-router` được đóng gói mà
 * không mang `node_modules` riêng, nên sidecar chết ngay khi khởi động với
 * `Cannot find package 'undici'`. Người dùng cài xong thấy "không có model,
 * không chat được" (#5/#7/#9), còn mọi bài kiểm tra trong repo vẫn xanh.
 *
 * Vì vậy bài này KHÔNG dựng server ở 1420: nếu giao diện không tự nạp được từ
 * gói thì phải trượt, chứ không được bài test cứu.
 */
import { spawn, spawnSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import os from "node:os";
import path from "node:path";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
// Xem ghi chú ở `desktop-smoke-check.mjs`: identifier phải lấy từ nguồn duy
// nhất là tauri.conf.json, vì thư mục dữ liệu của bản cài đi theo nó.
const IDENTIFIER = JSON.parse(
  readFileSync(path.join(repoRoot, "src-tauri/tauri.conf.json"), "utf8"),
).identifier;
if (!IDENTIFIER) throw new Error("tauri.conf.json thiếu `identifier`");
const isWindows = process.platform === "win32";
const isMac = process.platform === "darwin";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function appDataDir() {
  const home = os.homedir();
  if (isWindows) return path.join(process.env.APPDATA || path.join(home, "AppData/Roaming"), IDENTIFIER);
  if (isMac) return path.join(home, "Library/Application Support", IDENTIFIER);
  return path.join(process.env.XDG_DATA_HOME || path.join(home, ".local/share"), IDENTIFIER);
}

/** Tìm binary bên trong bản vừa đóng gói, theo quy ước từng nền tảng. */
function packagedBinary() {
  if (process.env.VUA_PACKAGED_BINARY) return process.env.VUA_PACKAGED_BINARY;
  const release = path.join(repoRoot, "src-tauri/target/release");
  if (isMac) {
    const bundles = path.join(release, "bundle/macos");
    if (existsSync(bundles)) {
      const app = readdirSync(bundles).find((name) => name.endsWith(".app"));
      if (app) return path.join(bundles, app, "Contents/MacOS/vuaassistant");
    }
  }
  // Trên Windows và Linux, binary release đứng cạnh gói cài và mang đúng
  // resource đã đóng gói, nên chạy thẳng nó là đủ để kiểm khâu này.
  const direct = path.join(release, isWindows ? "vuaassistant.exe" : "vuaassistant");
  return direct;
}

const binary = packagedBinary();
if (!existsSync(binary)) {
  console.log(`⊘ bỏ qua: chưa có bản đóng gói (${binary}); chạy \`npx tauri build\` trước`);
  process.exit(0);
}

let pass = true;
const check = (name, cond) => {
  console.log(`${cond ? "✓" : "✗"} ${name}`);
  if (!cond) pass = false;
};

console.log(`▸ mở bản đã đóng gói: ${binary}`);
const launchedAt = Date.now() - 1000;
const app = spawn(binary, [], { cwd: repoRoot, detached: !isWindows, stdio: ["ignore", "pipe", "pipe"] });
let output = "";
let exitInfo = null;
app.stdout.on("data", (c) => { output += String(c); });
app.stderr.on("data", (c) => { output += String(c); });
app.on("exit", (code, signal) => { exitInfo = { code, signal }; });

function stopAll() {
  try {
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

// --- AI Router phải tự lên từ resource đóng gói -----------------------------
// Đây chính là chỗ hỏng khi thiếu thư viện: sidecar chết trước khi mở cổng.
let routerUp = false;
for (let i = 0; i < 60; i++) {
  await sleep(1000);
  if (app.exitCode !== null) break;
  try {
    const response = await fetch("http://127.0.0.1:36360/health", { signal: AbortSignal.timeout(1500) });
    if (response.ok) { routerUp = true; break; }
  } catch { /* chưa lên */ }
}
check("bản cài chạy được, không thoát sớm", app.exitCode === null);
check("AI Router tự lên từ resource đóng gói", routerUp);

// --- Hạ tầng ----------------------------------------------------------------
const dataDir = path.join(appDataDir(), "runtime");
const heartbeat = path.join(dataDir, "ipc/.heartbeat");
// Runner đập nhịp mỗi ~30 giây, nên phải chờ quá một chu kỳ. Chờ hụt là báo
// hỏng oan — đã suýt kết luận nhầm vì chỉ chờ 25 giây.
let beat = false;
for (let i = 0; i < 90; i++) {
  if (existsSync(heartbeat) && statSync(heartbeat).mtimeMs >= launchedAt) { beat = true; break; }
  await sleep(1000);
}
check(`thư mục dữ liệu được tạo (${dataDir})`, existsSync(dataDir));
check("Agent Runner đập nhịp trong bản cài", beat);
for (const relative of ["ipc/inbound.db", "ipc/outbound.db", "vault.db"]) {
  check(`tạo ${relative}`, existsSync(path.join(dataDir, relative)));
}

// --- Không được có lỗi thiếu thư viện ---------------------------------------
check(
  "không có lỗi thiếu package trong bản cài",
  !/ERR_MODULE_NOT_FOUND|Cannot find package/.test(output),
);

stopAll();
if (!pass) {
  console.log("\n--- chẩn đoán ---");
  console.log(`binary   : ${binary}`);
  console.log(`nền tảng : ${process.platform} ${process.arch}`);
  if (exitInfo) console.log(`thoát    : code=${exitInfo.code} signal=${exitInfo.signal}`);
  console.log("--- log app (3000 ký tự cuối) ---");
  console.log(output.trim() ? output.slice(-3000) : "(app không in ra gì)");
}
console.log(
  pass
    ? `\n✓ bản đóng gói (${process.platform}) tự dựng đủ AI Router, Agent Runner, IPC và Vault`
    : `\n✗ FAILED trên ${process.platform}`,
);
process.exit(pass ? 0 : 1);
