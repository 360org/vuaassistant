// Sidecar phải chạy được khi ĐỨNG MỘT MÌNH, không có node_modules của dự án.
//
// Đây là lớp lỗi "chạy từ mã nguồn thì tốt, cài xong thì chết". Khi chạy trong
// repo, Node đi ngược lên thư mục cha và tìm thấy `undici` ở `node_modules`
// gốc. Bản cài đặt `ai-router/` ở `/usr/lib/VuaAssistant/_up_/ai-router/` —
// không có thư mục cha nào như vậy — nên sidecar chết ngay khi khởi động và
// người dùng thấy "không có model, không chat được".
//
// Mọi bài kiểm tra chạy trong repo đều KHÔNG bắt được lỗi này, vì repo luôn có
// node_modules gốc. Nên test này dựng lại đúng cảnh cô lập: copy ai-router ra
// một thư mục không có cha nào chứa node_modules, rồi mới thử nạp.

import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const aiRouter = path.join(root, "ai-router");

let pass = true;
const check = (name, cond) => {
  console.log(`${cond ? "✓" : "✗"} ${name}`);
  if (!cond) pass = false;
};

// --- 1. Cấu hình đóng gói phải mang ai-router theo --------------------------
const tauriConf = JSON.parse(readFileSync(path.join(root, "src-tauri/tauri.conf.json"), "utf8"));
const resources = tauriConf.bundle?.resources || [];
check(
  "tauri đóng gói mã ai-router",
  resources.some((entry) => entry.includes("ai-router")),
);

// --- 2. Thư viện phải nằm TRONG ai-router, không phải ở gốc dự án -----------
const manifest = JSON.parse(readFileSync(path.join(aiRouter, "package.json"), "utf8"));
const deps = Object.keys(manifest.dependencies || {});
check(`ai-router khai báo dependency (${deps.length})`, deps.length > 0);
for (const dep of deps) {
  check(
    `${dep} nằm trong ai-router/node_modules, không mượn của dự án`,
    existsSync(path.join(aiRouter, "node_modules", dep)),
  );
}

// --- 3. Thử THẬT trong cảnh cô lập ------------------------------------------
// Chỉ kiểm "thư mục có tồn tại" là chưa đủ: gói có thể thiếu file, sai phiên
// bản, hoặc mã nạp thêm thư viện không khai báo trong package.json. Nên copy
// hẳn ra ngoài repo rồi bảo Node nạp thật.
const sandbox = mkdtempSync(path.join(os.tmpdir(), "vua-airouter-iso-"));
try {
  cpSync(aiRouter, path.join(sandbox, "ai-router"), { recursive: true });
  const sidecarUrl = path.join(sandbox, "ai-router/src/sidecar.mjs");

  const run = spawnSync(process.execPath, ["-e", `
    let done = false;
    const finish = (code, note) => { if (done) return; done = true; console.log(note); process.exit(code); };
    // Sidecar mở cổng rồi chạy mãi, nên coi "nạp được 12 giây không nổ" là đạt.
    setTimeout(() => finish(0, "OK"), 12000);
    import(${JSON.stringify("file://" + sidecarUrl)}).catch((error) => {
      finish(3, "ERR " + (error?.code || "") + " :: " + String(error?.message || "").split("\\n")[0]);
    });
  `], { encoding: "utf8", cwd: sandbox, timeout: 40_000, env: { ...process.env, AI_ROUTER_PORT: "36421" } });

  const output = `${run.stdout || ""}${run.stderr || ""}`.trim();
  const loaded = run.status === 0;
  check(
    `sidecar nạp được khi đứng một mình${loaded ? "" : ` — ${output.split("\n")[0].slice(0, 160)}`}`,
    loaded,
  );
  check(
    "không có lỗi thiếu package khi cô lập",
    !/ERR_MODULE_NOT_FOUND|Cannot find package/.test(output),
  );
} finally {
  rmSync(sandbox, { recursive: true, force: true });
  spawnSync("pkill", ["-9", "-f", "vua-airouter-iso-"], { stdio: "ignore" });
}

console.log(
  pass
    ? "\n✓ AI Router mang đủ thư viện, chạy được trong bản cài chứ không chỉ trong repo"
    : "\n✗ FAILED",
);
process.exit(pass ? 0 : 1);
