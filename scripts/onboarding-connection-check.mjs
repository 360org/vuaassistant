#!/usr/bin/env node
/**
 * Luồng chuẩn: tải → cài → đăng nhập bằng tài khoản AI → chat.
 *
 * Onboarding phải đăng ký kết nối vừa đăng nhập với AI Router *trước khi* đưa
 * người dùng vào ứng dụng. Trước đây bước ghi này bị nuốt lỗi
 * (`.catch(console.error)`) rồi onboarding vẫn hoàn tất, nên khi ghi hỏng người
 * dùng vào thẳng ứng dụng mà không có kết nối nào và bị bắt vào Settings thêm
 * AI provider một lần nữa — sai luồng chuẩn (issue #18).
 *
 * Test này khoá hai điều: mọi lối đăng nhập trong Onboarding đều ghi kết nối,
 * và không lối nào âm thầm bỏ qua lỗi ghi.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const onboarding = fs.readFileSync(path.join(root, "src", "pages", "Onboarding.tsx"), "utf8");
const settings = fs.readFileSync(path.join(root, "src", "components", "settings", "ModelSettings.tsx"), "utf8");

let pass = true;
const check = (name, cond) => {
  console.log(`${cond ? "✓" : "✗"} ${name}`);
  if (!cond) pass = false;
};

// 1. Không lối nào được bỏ qua lỗi ghi kết nối bằng cách chỉ log ra console.
//    Soi cả hàm ghi trực tiếp lẫn hàm bọc, vì nuốt lỗi ở bất kỳ lớp nào cũng
//    đưa người dùng vào ứng dụng không có kết nối.
const writers = ["saveConnectionAndCleanupDuplicates", "registerConnection"];
const swallowed = writers.flatMap((writer) =>
  [...onboarding.matchAll(new RegExp(`${writer}\\([\\s\\S]{0,900}?\\)\\s*\\.catch\\(([\\s\\S]{0,200}?)\\)\\s*[;,)]`, "g"))]
    .filter((match) => /console\.(error|warn|log)/.test(match[1]))
    .map(() => writer),
);
check(
  `không lối đăng nhập nào nuốt lỗi ghi kết nối${swallowed.length ? ` (thấy ở: ${[...new Set(swallowed)].join(", ")})` : ""}`,
  swallowed.length === 0,
);

// 2. Lối đăng nhập một chạm dùng hàm ghi có thử lại.
check(
  "có bước đăng ký kết nối dùng lại được (registerConnection)",
  /const registerConnection = async/.test(onboarding),
);
check(
  "đăng ký kết nối được chờ xong trước khi vào ứng dụng",
  /await registerConnection\([\s\S]{0,120}?\);\s*\n\s*completeOnboarding\(/.test(onboarding),
);

// 3. Ghi hỏng phải nói cho người dùng biết, không im lặng.
const registerBody = onboarding.slice(
  onboarding.indexOf("const registerConnection = async"),
  onboarding.indexOf("const choose = async"),
);
check(
  "ghi hỏng thì báo lỗi thay vì đi tiếp",
  /throw new Error\(/.test(registerBody),
);
check(
  "có thử lại sau khi khởi động lại AI Router",
  /runtime_restart_ai_router/.test(registerBody),
);

// 4. Lối nhập khoá thủ công cũng phải chờ ghi và báo lỗi.
check(
  "lối nhập khoá cũng báo lỗi khi chưa đăng ký được",
  /chưa đăng ký được với AI Router/.test(onboarding),
);

// 5. Settings cũng là lối đăng nhập AI; không được báo thành công nếu AI Router
//    chưa lưu được provider, vì sau đó màn Models sẽ rỗng.
check(
  "settings không nuốt lỗi ghi kết nối AI Router",
  !/saveConnectionAndCleanupDuplicates\([\s\S]{0,900}?\)\.catch\(\(\) => \{\}\)/.test(settings),
);

assert.ok(pass, "onboarding connection contract failed");
console.log("\n✓ đăng nhập xong là kết nối đã đăng ký — không phải thêm provider lần nữa");
