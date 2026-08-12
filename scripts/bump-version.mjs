// Set the app version everywhere it's declared, so cutting a release is one
// command. Usage: node scripts/bump-version.mjs 0.1.1
//
// Updates package.json, src-tauri/tauri.conf.json, src-tauri/Cargo.toml and
// the vuaassistant entry in src-tauri/Cargo.lock. After this, commit and tag
// `vX.Y.Z` — the Release workflow builds the installers.

import { readFileSync, writeFileSync } from "node:fs";

const version = process.argv[2];
if (!version || !/^\d+\.\d+\.\d+$/.test(version)) {
  console.error("Usage: node scripts/bump-version.mjs <major.minor.patch>");
  process.exit(1);
}

const edits = [
  {
    file: "package.json",
    fn: (s) => s.replace(/("version":\s*)"[^"]+"/, `$1"${version}"`),
  },
  {
    file: "src-tauri/tauri.conf.json",
    fn: (s) => s.replace(/("version":\s*)"[^"]+"/, `$1"${version}"`),
  },
  {
    file: "package-lock.json",
    fn: (s) => s
      .replace(/("version":\s*)"[^"]+"/, `$1"${version}"`)
      .replace(/("packages":\s*\{\s*"":\s*\{[\s\S]*?"version":\s*)"[^"]+"/, `$1"${version}"`),
  },
  {
    file: "src-tauri/Cargo.toml",
    // Only the [package] version (the first `version = "..."` in the file).
    fn: (s) => s.replace(/(\nversion\s*=\s*)"[^"]+"/, `$1"${version}"`),
  },
  {
    file: "src-tauri/Cargo.lock",
    // The version line that follows `name = "vuaassistant"`.
    fn: (s) =>
      s.replace(
        /(name = "vuaassistant"\nversion = )"[^"]+"/,
        `$1"${version}"`,
      ),
  },
];

for (const { file, fn } of edits) {
  const before = readFileSync(file, "utf8");
  const after = fn(before);
  if (after === before) {
    console.warn(`• ${file}: no version field changed`);
  } else {
    writeFileSync(file, after);
    console.log(`✓ ${file} → ${version}`);
  }
}

console.log(
  `\nVersion set to ${version}. Next:\n` +
    `  1. Update CHANGELOG.md (move Unreleased → [${version}])\n` +
    `  2. npm run check   # everything green before committing\n` +
    `  3. git commit -am "release: v${version}" && git tag v${version} && git push --tags\n` +
    `  → the Release workflow builds macOS/Windows/Linux installers.`,
);
