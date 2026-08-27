import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";

const ROUTER_SRC = process.env.VUA_9ROUTER_SRC || "/Volumes/DATA/DEV/9router";
const ROUTER_DEST = path.resolve(import.meta.dirname, "../ai-router/core");

// Release bundles use the already-vendored Provider Core. The source checkout
// only exists on the maintainer's machine and must never be required in CI.
if (!fs.existsSync(ROUTER_SRC)) {
  console.log("✓ Using vendored AI Router Provider Core.");
  process.exit(0);
}

console.log("🔄 Pulling latest code from 9router...");
try {
  execSync("git pull", { cwd: ROUTER_SRC, stdio: "inherit" });
} catch (error) {
  console.warn("⚠️ Failed to git pull 9router. Using local 9router files.", error.message);
}

const srcOpenSse = path.join(ROUTER_SRC, "open-sse");
const destOpenSse = path.join(ROUTER_DEST, "open-sse");

console.log(`📦 Syncing ${srcOpenSse} -> ${destOpenSse}...`);

function copyRecursive(src, dest, exclude = []) {
  if (exclude.includes(path.basename(src))) return;

  const stats = fs.statSync(src);
  if (stats.isDirectory()) {
    if (!fs.existsSync(dest)) fs.mkdirSync(dest, { recursive: true });
    for (const file of fs.readdirSync(src)) copyRecursive(path.join(src, file), path.join(dest, file), exclude);
    return;
  }

  let shouldCopy = true;
  let newContent = null;
  const isCode = src.endsWith(".js") || src.endsWith(".mjs");

  if (isCode) {
    let content = fs.readFileSync(src, "utf8");
    const relativeToNative = path.relative(path.dirname(dest), path.join(destOpenSse, "native"));
    content = content.replace(/@\/lib\//g, `${relativeToNative}/`);
    newContent = content.replace(
      /import\s+\{\s*machineIdSync\s*\}\s+from\s+["']node-machine-id["'];/g,
      'import pkgNodeMachineId from "node-machine-id";\nconst machineIdSync = pkgNodeMachineId.machineIdSync || pkgNodeMachineId;',
    );
    if (path.basename(src) === "codex.js") {
      newContent = newContent.replace(
        'scope: "openid profile email offline_access",',
        'scope: "openid profile email offline_access api.connectors.read api.connectors.invoke",',
      );
    }
  }

  if (fs.existsSync(dest)) {
    const destContent = isCode ? fs.readFileSync(dest, "utf8") : fs.readFileSync(dest);
    shouldCopy = isCode ? destContent !== newContent : !fs.readFileSync(src).equals(destContent);
  }

  if (shouldCopy) {
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    if (isCode) fs.writeFileSync(dest, newContent, "utf8");
    else fs.copyFileSync(src, dest);
  }
}

const LOCAL_ONLY = ["native", "kimi-coding.js"];
copyRecursive(srcOpenSse, destOpenSse, LOCAL_ONLY);

function pruneOrphans(destDir, srcDir) {
  if (!fs.existsSync(destDir)) return;
  for (const file of fs.readdirSync(destDir)) {
    if (LOCAL_ONLY.includes(file)) continue;
    const destPath = path.join(destDir, file);
    const srcPath = path.join(srcDir, file);
    if (!fs.existsSync(srcPath)) {
      fs.rmSync(destPath, { recursive: true, force: true });
    } else if (fs.statSync(destPath).isDirectory()) {
      pruneOrphans(destPath, srcPath);
    }
  }
}

pruneOrphans(destOpenSse, srcOpenSse);
console.log("✅ 9router synchronization completed successfully!");
