#!/usr/bin/env node
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync("src/components/settings/AppUpdateSection.tsx", "utf8");

assert(source.includes("const [checkStatus, setCheckStatus] = useState"), "Check update must keep explicit popup state.");
assert(source.includes("setCheckStatus({") && source.includes("Đang kiểm tra cập nhật"), "Clicking check update must show an in-progress popup.");
assert(source.includes("Đang dùng bản mới nhất") && source.includes("Có bản cập nhật v${info.latestVersion}"), "Check update must show both latest and update-available results.");
assert(source.includes('role="dialog"') && source.includes('aria-modal="true"'), "Update status popup must be exposed as an accessible dialog.");
assert(source.includes("disabled={checking}") && source.includes("Đã hiểu"), "Update status popup must stay visible while checking and be dismissible after.");

console.log("update status popup contract passed");
