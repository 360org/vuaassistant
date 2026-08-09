// Kết nối tốt không được báo hỏng chỉ vì gói dịch vụ thiếu đúng một model.
//
// Bài "Kiểm tra API" trước đây dò đúng MỘT model tĩnh cứng lấy từ registry:
// `gemini-2.5-flash` cho Gemini, `gemini-3.6-flash-high` cho Antigravity. Tài
// khoản nào không có quyền dùng đúng model đó là bị đánh `Failed` cả kết nối,
// dù 13 model còn lại vẫn chạy tốt.
//
// Tệ hơn cái đánh sai đó là câu báo: mọi lỗi 403 đều bị gộp thành "đăng nhập
// hết hạn hoặc bị thu hồi", nên người dùng có tài khoản hoàn toàn tốt vẫn được
// bảo đi tạo khoá mới rồi dán lại. Họ làm mãi cũng không hết lỗi, vì đang sửa
// nhầm chỗ.
//
// Test khoá ba điều: phân biệt lỗi tài khoản với lỗi model, ưu tiên danh sách
// model THẬT của tài khoản, và không dò thêm vô ích khi khoá đã hỏng.

import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const sidecar = fs.readFileSync(path.join(root, "ai-router", "src", "sidecar.mjs"), "utf8");

let pass = true;
const check = (name, cond) => {
  console.log(`${cond ? "✓" : "✗"} ${name}`);
  if (!cond) pass = false;
};

/**
 * Cắt một đoạn mã ra khỏi sidecar, và HỎNG TO nếu không tìm thấy.
 *
 * `indexOf` trả -1 khi mất mốc, `slice(-1, …)` cho ra rác, rồi `new Function`
 * ném lỗi và cả test chết giữa chừng — không in dòng ✗ nào. Nhìn từ ngoài
 * giống hệt "không có lỗi". Đây chính là cái bẫy đã làm lần thử nghịch đảo đầu
 * tiên của bài test này báo 0 đỏ trên mã CŨ.
 */
function extract(from, to) {
  const start = sidecar.indexOf(from);
  const end = sidecar.indexOf(to);
  if (start < 0 || end < 0 || end <= start) {
    console.log(`✗ không tìm thấy đoạn mã cần kiểm ("${from}") — sidecar đã đổi hoặc bị gỡ`);
    console.log("\n✗ FAILED");
    process.exit(1);
  }
  return sidecar.slice(start, end);
}

// Nhấc hai hàm phân loại lỗi ra chạy độc lập — chúng thuần tuý, nên không cần
// dựng cả sidecar.
const classifiers = extract("function isModelAccessError", "/**\n * Danh sách model để dò");
const { isModelAccessError, isAccountAuthError } = new Function(
  `${classifiers}; return { isModelAccessError, isAccountAuthError };`,
)();

// --- 1. Lỗi MODEL không được đọc thành lỗi TÀI KHOẢN ------------------------
const modelErrors = [
  [403, "Permission denied: your plan does not include model gemini-3.6-flash-high"],
  [403, "The model is not supported for your account tier"],
  [404, "model not found"],
  [400, "invalid model: gemini-2.5-flash"],
  [429, "quota exceeded for model gemini-3.6-flash-high"],
];
for (const [status, detail] of modelErrors) {
  check(
    `lỗi model (${status}) nhận đúng là lỗi model: "${detail.slice(0, 45)}…"`,
    isModelAccessError(status, detail),
  );
  check(
    `lỗi model (${status}) KHÔNG bị gọi là đăng nhập hỏng`,
    !isAccountAuthError(status, detail),
  );
}

// --- 2. Lỗi TÀI KHOẢN thật thì vẫn phải nhận ra ------------------------------
const authErrors = [
  [401, "invalid_api_key: API key not valid"],
  [401, ""],
  [403, "access token has been revoked"],
  [0, "authentication_error"],
  [0, "PermissionDenied: caller does not have permission"],
];
for (const [status, detail] of authErrors) {
  check(
    `lỗi tài khoản (${status}) nhận đúng: "${(detail || "(rỗng)").slice(0, 40)}"`,
    isAccountAuthError(status, detail),
  );
}
check("lỗi máy chủ 500 không bị gọi là đăng nhập hỏng", !isAccountAuthError(500, "internal error"));
check("mạng hỏng không bị gọi là đăng nhập hỏng", !isAccountAuthError(0, "fetch failed"));

// --- 3. Bài kiểm tra phải dò model THẬT của tài khoản ------------------------
// Đây là gốc rễ: `dynamicModelsForConnection` đọc quota thật từ nhà cung cấp,
// nhưng trước đây chỉ được gọi khi registry tĩnh RỖNG — mà registry luôn có
// model, nên nhánh đó không bao giờ chạy.
const testable = extract("async function testableModels", "async function testConnection");
check(
  "danh sách động được lấy cho nhà cung cấp passthrough",
  /passthroughModels[\s\S]{0,200}dynamicModelsForConnection/.test(testable),
);
check(
  "KHÔNG còn điều kiện 'chỉ lấy động khi tĩnh rỗng'",
  !/!model\s*&&\s*provider\.passthroughModels/.test(sidecar),
);
check(
  "model rẻ được thử trước để bài kiểm tra không tốn tiền",
  /free\|flash\|mini\|lite\|small/.test(testable),
);
check("vẫn còn model tĩnh làm đường lui", /provider\?\.models \|\| \[\]/.test(testable));

// --- 4. Dò nhiều model, nhưng dừng ngay khi khoá hỏng -----------------------
const testFn = extract("async function testConnection", "function sendJson");
// Phải đòi NHIỀU HƠN MỘT: `slice(0, 1)` vẫn khớp "một con số", nên kiểm kiểu đó
// không khẳng định được gì — đúng lỗ hổng đã để lọt lần thử nghịch đảo trước.
const probeCount = Number(testFn.match(/candidates\.slice\(0,\s*(\d+)\)/)?.[1] ?? 0);
check(`thử nhiều model chứ không chỉ một (đang thử tối đa ${probeCount})`, probeCount > 1);
check("có vòng lặp qua các model", /for \(const model of attempts\)/.test(testFn));
check(
  "khoá hỏng thì dừng ngay, không dò vô ích",
  /if \(isAccountAuthError\(lastStatus, lastDetail\)\) break;/.test(testFn),
);
check(
  "chỉ cần MỘT model chạy được là kết nối Verified",
  /if \(upstream\.ok\)[\s\S]{0,400}testStatus: "Verified"/.test(testFn),
);

// --- 5. Câu báo phải chỉ đúng chỗ hỏng --------------------------------------
check(
  "lỗi model báo đúng là lỗi model, không bảo đi tạo khoá mới",
  /isModelAccessError\(lastStatus, lastDetail\)[\s\S]{0,200}không dùng được model/.test(testFn),
);
check("câu báo nêu rõ model nào đã thử", /\$\{lastModel\}/.test(testFn));
check(
  "trạng thái HTTP thật được truyền vào câu báo, không còn bị vứt đi",
  /connectionErrorSummary\(connection, lastStatus, lastDetail\)/.test(testFn) &&
    !/connectionErrorSummary\(connection, 0, detail\)/.test(sidecar),
);

console.log(
  pass
    ? "\n✓ kiểm tra kết nối phân biệt được lỗi tài khoản với lỗi model"
    : "\n✗ FAILED",
);
process.exit(pass ? 0 : 1);
