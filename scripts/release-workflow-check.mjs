import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const workflow = readFileSync(new URL("../.github/workflows/release.yml", import.meta.url), "utf8");

assert(!workflow.includes("build -- --ci"), "Tauri --ci must be passed to Tauri, not Cargo.");
assert(!workflow.includes("--no-sign"), "Public release must never disable macOS signing.");
assert(workflow.includes("timeout-minutes: 60"), "macOS build/sign step must have a bounded timeout.");
assert(workflow.includes("CI: true"), "macOS build must run in CI mode.");
assert(workflow.includes("build --ci ${{ matrix.args }} --bundles app,dmg"), "Tauri build must keep --ci before target args.");
assert(workflow.includes("Developer ID Application: W360S JOINT STOCK COMPANY (ZC3H8887XS)"), "Release workflow must pin the Developer ID identity.");
assert(workflow.includes("TeamIdentifier=ZC3H8887XS"), "Release workflow must verify the Apple Team ID.");
assert(workflow.includes("! grep -F \"Signature=adhoc\""), "Release workflow must reject ad-hoc signatures.");
assert(workflow.includes("codesign --verify --deep --strict"), "Release workflow must verify codesign before upload.");
assert(workflow.includes("spctl -a -vv -t exec"), "Release workflow must pass Gatekeeper before upload.");
assert(workflow.includes("security set-key-partition-list"), "Release workflow must grant non-interactive codesign key access.");

console.log("release workflow contract ok");
