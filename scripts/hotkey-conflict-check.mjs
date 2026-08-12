#!/usr/bin/env node
/**
 * App phải mở được cả khi phím tắt toàn cục đã bị thứ khác chiếm.
 *
 * Đây là nguyên nhân thật của #8 (Windows 11 cài xong không mở được). App đăng
 * ký "Cmd+Shift+R", mà trên Windows "Cmd" là phím Windows — Win+Shift+R chính
 * là tổ hợp quay màn hình do Windows 11 giữ. `with_shortcuts(...).unwrap()`
 * panic ngay lúc dựng app:
 *
 *   PluginInitialization("global-shortcut", "HotKey already registered: ...")
 *   thread 'main' panicked at src/lib.rs
 *
 * và tiến trình chết với mã 101 trước khi cửa sổ kịp hiện. Người dùng chỉ thấy
 * "bấm vào không lên gì".
 *
 * Cách tái hiện trên mọi nền tảng: mở hai bản app cùng lúc. Bản thứ nhất giữ
 * hết phím tắt, nên bản thứ hai gặp đúng lỗi "HotKey already registered" mà
 * Windows gây ra. Bản thứ hai vẫn phải sống — phím tắt là tiện ích, không phải
 * điều kiện để chạy.
 *
 * Thiếu binary thì bỏ qua với mã 0 để máy dev chưa build không bị đỏ.
 */
import { spawn, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const isWindows = process.platform === "win32";
const isMac = process.platform === "darwin";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const binary =
  process.env.VUA_DESKTOP_BINARY ||
  path.join(repoRoot, "src-tauri/target/debug", isWindows ? "vuaassistant.exe" : "vuaassistant");

if (!existsSync(binary)) {
  console.log(`⊘ bỏ qua kiểm phím tắt: chưa có binary (${binary})`);
  process.exit(0);
}

// Hai bản app phải dùng CHUNG một màn hình thì mới tranh nhau phím tắt. Bọc
// từng bản trong `xvfb-run -a` riêng sẽ cho mỗi bản một màn hình khác nhau và
// xung đột không bao giờ xảy ra — nên ở đây tự chạy lại chính mình một lần
// dưới một màn hình ảo duy nhất, rồi cả hai bản con cùng thừa kế DISPLAY đó.
if (!isWindows && !isMac && !process.env.DISPLAY) {
  if (spawnSync("which", ["xvfb-run"]).status !== 0) {
    console.log("⊘ bỏ qua kiểm phím tắt: Linux không có DISPLAY và thiếu xvfb-run");
    process.exit(0);
  }
  const nested = spawnSync(
    "xvfb-run",
    ["-a", "--server-args=-screen 0 1400x900x24", process.execPath, fileURLToPath(import.meta.url)],
    { stdio: "inherit", cwd: repoRoot },
  );
  process.exit(nested.status ?? 1);
}

/** Mở một bản app, thu lại output và mã thoát. */
function launch() {
  const child = spawn(binary, [], {
    cwd: repoRoot,
    detached: !isWindows,
    stdio: ["ignore", "pipe", "pipe"],
  });
  const state = { child, output: "", exit: null };
  child.stdout.on("data", (c) => { state.output += String(c); });
  child.stderr.on("data", (c) => { state.output += String(c); });
  child.on("exit", (code, signal) => { state.exit = { code, signal }; });
  return state;
}

function stop(state) {
  try {
    if (isWindows) {
      spawnSync("taskkill", ["/PID", String(state.child.pid), "/T", "/F"], { stdio: "ignore" });
    } else {
      process.kill(-state.child.pid, "SIGKILL");
    }
  } catch { /* đã thoát */ }
}

// Bản thứ nhất chiếm phím tắt trước.
const first = launch();
await sleep(8000);

// Bản thứ hai gặp đúng tình huống Windows: tổ hợp đã có chủ.
const second = launch();
await sleep(12000);

const alive = second.exit === null;
const sawConflict = /already registered/i.test(second.output);
const panicked = /panicked at/.test(second.output);

stop(second);
stop(first);
if (!isWindows) {
  for (const pattern of ["ai-router/src/sidecar.mjs", "agent-runner/dist/index.js"]) {
    spawnSync("pkill", ["-9", "-f", pattern], { stdio: "ignore" });
  }
}

let pass = true;
const check = (name, cond) => {
  console.log(`${cond ? "✓" : "✗"} ${name}`);
  if (!cond) pass = false;
};

check("app thứ hai vẫn mở được khi phím tắt đã bị chiếm", alive);
check("không panic vì phím tắt trùng", !panicked);
if (!sawConflict) {
  // Không phải lỗi: có nền tảng cho đăng ký trùng. Chỉ ghi lại để biết lần chạy
  // này chưa thật sự chạm vào đường xung đột.
  console.log("ℹ nền tảng này cho đăng ký trùng, không tái hiện được xung đột");
}

if (!pass) {
  console.log("\n--- chẩn đoán (bản thứ hai) ---");
  console.log(`nền tảng : ${process.platform} ${process.arch}`);
  if (second.exit) console.log(`thoát    : code=${second.exit.code} signal=${second.exit.signal}`);
  console.log(second.output.trim() ? second.output.slice(-2000) : "(app không in ra gì)");
}

console.log(
  pass
    ? `\n✓ phím tắt trùng không làm chết app (${process.platform})`
    : `\n✗ FAILED trên ${process.platform}`,
);
process.exit(pass ? 0 : 1);
