import { useEffect, useState } from "react";
import { ArrowRight, Download, Loader2, Sparkles, X } from "lucide-react";
import { installAppUpdate } from "@/runtime/updater";
import { useApp } from "@/lib/store";

export function UpdateNotificationBanner() {
  const [dismissed, setDismissed] = useState(false);
  const [installing, setInstalling] = useState(false);
  const [progress, setProgress] = useState(0);
  const { appUpdate, checkForAppUpdate, setView } = useApp();

  useEffect(() => {
    if (sessionStorage.getItem("vua:update-banner-dismissed") === "true") setDismissed(true);
    void checkForAppUpdate();
  }, [checkForAppUpdate]);

  if (!appUpdate?.hasUpdate || dismissed) return null;

  const dismiss = () => {
    setDismissed(true);
    sessionStorage.setItem("vua:update-banner-dismissed", "true");
  };

  const install = async () => {
    setInstalling(true);
    try {
      await installAppUpdate(appUpdate, ({ downloaded, total }) => {
        if (total) setProgress(Math.min(100, Math.round((downloaded / total) * 100)));
      });
      dismiss();
    } catch {
      // Fallback tải thủ công đã mở trong installAppUpdate
      dismiss();
    } finally {
      setInstalling(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm">
      <div className="w-full max-w-lg rounded-2xl border border-emerald-500/30 bg-neutral-950 p-5 text-neutral-100 shadow-2xl shadow-emerald-950/40">
        <div className="flex items-start gap-3">
          <div className="flex size-10 shrink-0 items-center justify-center rounded-xl border border-emerald-500/30 bg-emerald-500/15 text-emerald-300">
            <Sparkles className="size-5 animate-pulse" />
          </div>
          <div className="min-w-0 flex-1">
            <h2 className="text-base font-semibold text-emerald-200">
              Có bản cập nhật mới v{appUpdate.latestVersion}
            </h2>
            <p className="mt-1 text-sm text-neutral-400">
              Cài ngay để nhận tính năng mới nhất, hoặc để sau — icon cập nhật vẫn nằm cạnh số phiên bản.
            </p>
          </div>
          <button
            onClick={dismiss}
            aria-label="Để sau"
            className="rounded-lg p-1 text-neutral-500 transition-colors hover:bg-neutral-900 hover:text-neutral-200"
          >
            <X className="size-4" />
          </button>
        </div>

        {appUpdate.releaseNotes && (
          <div className="mt-4 max-h-36 overflow-y-auto rounded-xl border border-neutral-800 bg-neutral-900/70 p-3 text-xs text-neutral-300">
            <div className="mb-1 font-medium text-emerald-300">Có gì mới</div>
            <div className="whitespace-pre-wrap text-neutral-400">{appUpdate.releaseNotes}</div>
          </div>
        )}

        {installing && progress > 0 && (
          <div className="mt-4 h-2 overflow-hidden rounded-full bg-neutral-800">
            <div className="h-full bg-emerald-400 transition-all" style={{ width: `${progress}%` }} />
          </div>
        )}

        <div className="mt-5 flex flex-col gap-2 sm:flex-row sm:justify-end">
          <button
            onClick={() => {
              setView("settings");
              dismiss();
            }}
            className="inline-flex items-center justify-center gap-1.5 rounded-xl border border-neutral-700 px-4 py-2 text-sm font-medium text-neutral-200 transition-colors hover:bg-neutral-900"
          >
            Chi tiết
            <ArrowRight className="size-3.5" />
          </button>
          <button
            onClick={install}
            disabled={installing}
            className="inline-flex items-center justify-center gap-1.5 rounded-xl bg-emerald-400 px-4 py-2 text-sm font-semibold text-neutral-950 transition-colors hover:bg-emerald-300 disabled:opacity-60"
          >
            {installing ? <Loader2 className="size-4 animate-spin" /> : <Download className="size-4" />}
            {appUpdate.canInstallInApp ? "Cài đặt & khởi động lại" : "Tải bản cập nhật"}
          </button>
        </div>
      </div>
    </div>
  );
}
