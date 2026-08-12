import type { DownloadEvent, Update } from "@tauri-apps/plugin-updater";

const REPO = "360org/vuaassistant";
const API_URL = `https://api.github.com/repos/${REPO}/releases/latest`;
const RELEASES_URL = `https://github.com/${REPO}/releases`;
const LATEST_RELEASE_URL = `https://github.com/${REPO}/releases/latest`;

let pendingNativeUpdate: Update | null = null;

export interface AppUpdateInfo {
  hasUpdate: boolean;
  currentVersion: string;
  latestVersion: string;
  releaseTitle: string;
  releaseNotes: string;
  releaseUrl: string;
  downloadUrl: string | null;
  publishedAt: string;
  canInstallInApp: boolean;
  source: "tauri" | "github" | "none";
}

export type InstallUpdateResult = "native" | "manual";

function currentAppVersion(): string {
  return typeof __V_ASSISTANT_VERSION__ !== "undefined" ? __V_ASSISTANT_VERSION__ : "1.1.3";
}

function parseSemver(version: string): number[] {
  return version.trim().replace(/^v/i, "").split(".").map((part) => parseInt(part, 10) || 0);
}

export function isNewerVersion(current: string, candidate: string): boolean {
  const left = parseSemver(current);
  const right = parseSemver(candidate);
  const length = Math.max(left.length, right.length);
  for (let index = 0; index < length; index += 1) {
    const currentPart = left[index] ?? 0;
    const candidatePart = right[index] ?? 0;
    if (candidatePart > currentPart) return true;
    if (candidatePart < currentPart) return false;
  }
  return false;
}

function noUpdate(): AppUpdateInfo {
  const currentVersion = currentAppVersion();
  return {
    hasUpdate: false,
    currentVersion,
    latestVersion: currentVersion,
    releaseTitle: "",
    releaseNotes: "",
    releaseUrl: RELEASES_URL,
    downloadUrl: null,
    publishedAt: "",
    canInstallInApp: false,
    source: "none",
  };
}

async function checkNativeUpdate(): Promise<AppUpdateInfo | null> {
  if (typeof window === "undefined" || !("__TAURI_INTERNALS__" in window)) return null;

  try {
    const { check } = await import("@tauri-apps/plugin-updater");
    const update = await check({ timeout: 10_000 });
    pendingNativeUpdate = update;
    if (!update) return null;

    return {
      hasUpdate: true,
      currentVersion: update.currentVersion || currentAppVersion(),
      latestVersion: update.version,
      releaseTitle: `VuaAssistant v${update.version}`,
      releaseNotes: update.body || "",
      releaseUrl: LATEST_RELEASE_URL,
      downloadUrl: null,
      publishedAt: update.date || "",
      canInstallInApp: true,
      source: "tauri",
    };
  } catch (error) {
    // Bản dev/browser hoặc release cũ chưa có manifest hợp lệ thì rơi về GitHub Release page.
    console.warn("Không kiểm tra được Tauri updater, dùng GitHub Releases:", error);
    pendingNativeUpdate = null;
    return null;
  }
}

async function checkGitHubRelease(): Promise<AppUpdateInfo> {
  const currentVersion = currentAppVersion();

  try {
    const res = await fetch(API_URL, { headers: { Accept: "application/vnd.github.v3+json" } });
    if (!res.ok) throw new Error(`GitHub API returned status ${res.status}`);

    const data = await res.json();
    const tag = String(data.tag_name || "").trim();
    const latestVersion = tag.replace(/^v/i, "");

    return {
      hasUpdate: Boolean(latestVersion) && isNewerVersion(currentVersion, latestVersion),
      currentVersion,
      latestVersion: latestVersion || currentVersion,
      releaseTitle: data.name || tag || "VuaAssistant Release",
      releaseNotes: data.body || "",
      releaseUrl: data.html_url || LATEST_RELEASE_URL,
      downloadUrl: data.html_url || LATEST_RELEASE_URL,
      publishedAt: data.published_at || "",
      canInstallInApp: false,
      source: "github",
    };
  } catch (error) {
    console.warn("Không kiểm tra được GitHub Releases:", error);
    return noUpdate();
  }
}

export async function checkAppUpdate(): Promise<AppUpdateInfo> {
  const nativeUpdate = await checkNativeUpdate();
  if (nativeUpdate) return nativeUpdate;
  return checkGitHubRelease();
}

async function openManualUpdate(info: AppUpdateInfo): Promise<void> {
  const url = info.downloadUrl || info.releaseUrl || LATEST_RELEASE_URL;
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    await invoke("open_external", { url });
  } catch {
    window.open(url, "_blank", "noopener,noreferrer");
  }
}

export async function installAppUpdate(
  info: AppUpdateInfo,
  onProgress?: (progress: { downloaded: number; total?: number }) => void,
): Promise<InstallUpdateResult> {
  if (info.canInstallInApp && pendingNativeUpdate) {
    let downloaded = 0;
    let total: number | undefined;
    await pendingNativeUpdate.downloadAndInstall((event: DownloadEvent) => {
      if (event.event === "Started") {
        downloaded = 0;
        total = event.data.contentLength;
      } else if (event.event === "Progress") {
        downloaded += event.data.chunkLength;
      }
      onProgress?.({ downloaded, total });
    });
    const { relaunch } = await import("@tauri-apps/plugin-process");
    await relaunch();
    return "native";
  }

  await openManualUpdate(info);
  return "manual";
}
