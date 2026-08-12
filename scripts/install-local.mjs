import { execSync } from "child_process";
import fs from "fs";
import path from "path";

const sourceApp = "/Volumes/DATA/DEV/vuaassistant/src-tauri/target/release/bundle/macos/VuaAssistant.app";
const targetApp = "/Applications/VuaAssistant.app";

if (!fs.existsSync(sourceApp)) {
  console.error(`❌ Source app not found at: ${sourceApp}`);
  process.exit(1);
}

console.log(`📦 Copying local build to Applications: ${sourceApp} → ${targetApp}...`);

try {
  // Kill running instance if open
  try {
    execSync('pkill -f "VuaAssistant"', { stdio: "ignore" });
  } catch {
    // Ignore error if app is not currently running
  }

  // Copy app bundle
  execSync(`rsync -a --delete "${sourceApp}/" "${targetApp}/"`);
  console.log(`✅ Successfully updated ${targetApp} with the latest build!`);
} catch (error) {
  console.error("❌ Failed to install app to /Applications:", error);
  process.exit(1);
}
