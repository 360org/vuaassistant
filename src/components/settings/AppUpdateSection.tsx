import { useState } from "react";
import { CheckCircle2, Download, Loader2, RefreshCw, Sparkles, X } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { installAppUpdate } from "@/runtime/updater";
import { cn } from "@/lib/utils";
import { useApp } from "@/lib/store";
import { t } from "@/lib/i18n";

export function AppUpdateSection() {
  const { language, appUpdate, checkForAppUpdate } = useApp();
  const [checking, setChecking] = useState(false);
  const [installing, setInstalling] = useState(false);
  const [progress, setProgress] = useState(0);
  const [checkStatus, setCheckStatus] = useState<{ title: string; message: string; tone: "gold" | "green" | "red" } | null>(null);

  const handleCheckUpdate = async () => {
    setChecking(true);
    setCheckStatus({
      title: "Đang kiểm tra cập nhật",
      message: "VuaAssistant đang kết nối máy chủ release để kiểm tra bản mới nhất.",
      tone: "gold",
    });
    try {
      const info = await checkForAppUpdate();
      setCheckStatus(info.hasUpdate ? {
        title: `Có bản cập nhật v${info.latestVersion}`,
        message: info.canInstallInApp ? "Sếp có thể cài trực tiếp trong app rồi khởi động lại." : "Sếp có thể mở trang tải để cài bản mới.",
        tone: "gold",
      } : {
        title: "Đang dùng bản mới nhất",
        message: `VuaAssistant v${info.currentVersion} đã là bản mới nhất hiện tại.`,
        tone: "green",
      });
    } catch (err) {
      setCheckStatus({
        title: "Không kiểm tra được cập nhật",
        message: err instanceof Error ? err.message : String(err),
        tone: "red",
      });
    } finally {
      setChecking(false);
    }
  };

  const handleInstall = async () => {
    if (!appUpdate?.hasUpdate) return;
    setInstalling(true);
    try {
      await installAppUpdate(appUpdate, ({ downloaded, total }) => {
        if (total) setProgress(Math.min(100, Math.round((downloaded / total) * 100)));
      });
    } finally {
      setInstalling(false);
    }
  };

  return (
    <section>
      <h2 className="text-sm font-semibold text-neutral-300">
        🔄 {t("software_update_title", language)}
      </h2>
      <Card
        className={cn(
          "mt-3 transition-all",
          appUpdate?.hasUpdate
            ? "border-gold-400/50 bg-gradient-to-br from-gold-950/20 via-neutral-900 to-neutral-900"
            : "border-neutral-800 bg-neutral-900/40",
        )}
      >
        <div className="flex flex-col justify-between gap-4 md:flex-row md:items-center">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm font-semibold text-neutral-100">
                {t("current_version", language)}: v{__V_ASSISTANT_VERSION__}
              </span>
              {appUpdate?.hasUpdate ? (
                <Badge tone="gold" className="animate-pulse gap-1">
                  <Sparkles className="size-3 text-gold-300" />
                  {t("has_update", language)} v{appUpdate.latestVersion}
                </Badge>
              ) : (
                <Badge tone="green" className="gap-1">
                  <CheckCircle2 className="size-3 text-emerald-400" />
                  {t("latest", language)}
                </Badge>
              )}
            </div>

            <p className="mt-1 text-xs text-neutral-400">
              {appUpdate?.hasUpdate
                ? `Phát hiện bản mới v${appUpdate.latestVersion}. ${appUpdate.canInstallInApp ? "Có thể cài trong app." : "Mở trang tải để cài bản mới."}`
                : t("checking_for_updates", language)}
            </p>

            {appUpdate?.releaseNotes && appUpdate.hasUpdate && (
              <div className="mt-3 max-h-32 overflow-y-auto rounded-lg border border-neutral-800 bg-neutral-950 p-2.5 text-xs text-neutral-300">
                <div className="mb-1 font-medium text-gold-300">📝 {t("release_notes", language)}</div>
                <div className="whitespace-pre-wrap text-[11px] text-neutral-400">
                  {appUpdate.releaseNotes}
                </div>
              </div>
            )}

            {installing && progress > 0 && (
              <div className="mt-3 h-2 overflow-hidden rounded-full bg-neutral-800">
                <div className="h-full bg-gold-400 transition-all" style={{ width: `${progress}%` }} />
              </div>
            )}
          </div>

          <div className="flex shrink-0 items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={handleCheckUpdate}
              disabled={checking || installing}
              className="gap-1.5 whitespace-nowrap hover:border-gold-400"
            >
              <RefreshCw className={cn("size-3.5 text-gold-400", checking && "animate-spin")} />
              {checking ? t("checking", language) : t("check_for_update", language)}
            </Button>

            {appUpdate?.hasUpdate && (
              <Button
                variant="primary"
                size="sm"
                onClick={handleInstall}
                disabled={installing}
                className="gap-1.5 whitespace-nowrap shadow-lg shadow-gold-500/10"
              >
                {installing ? <Loader2 className="size-3.5 animate-spin" /> : <Download className="size-3.5" />}
                {appUpdate.canInstallInApp ? "Cài đặt" : t("auto_update_download", language)}
              </Button>
            )}
          </div>
        </div>
      </Card>

      {checkStatus && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm" role="dialog" aria-modal="true" aria-labelledby="update-check-title">
          <div className="w-full max-w-sm rounded-2xl border border-neutral-800 bg-neutral-950 p-5 text-neutral-100 shadow-2xl">
            <div className="flex items-start gap-3">
              <div className={cn(
                "flex size-10 shrink-0 items-center justify-center rounded-xl border",
                checkStatus.tone === "green"
                  ? "border-emerald-500/30 bg-emerald-500/15 text-emerald-300"
                  : checkStatus.tone === "red"
                    ? "border-red-500/30 bg-red-500/15 text-red-300"
                    : "border-gold-500/30 bg-gold-500/15 text-gold-300",
              )}>
                {checking ? <Loader2 className="size-5 animate-spin" /> : checkStatus.tone === "green" ? <CheckCircle2 className="size-5" /> : <Sparkles className="size-5" />}
              </div>
              <div className="min-w-0 flex-1">
                <h3 id="update-check-title" className="text-base font-semibold">{checkStatus.title}</h3>
                <p className="mt-1 text-sm text-neutral-400">{checkStatus.message}</p>
              </div>
              <button
                onClick={() => setCheckStatus(null)}
                disabled={checking}
                aria-label="Đóng trạng thái cập nhật"
                className="rounded-lg p-1 text-neutral-500 transition-colors hover:bg-neutral-900 hover:text-neutral-200 disabled:opacity-40"
              >
                <X className="size-4" />
              </button>
            </div>
            {!checking && (
              <div className="mt-5 flex justify-end">
                <Button size="sm" onClick={() => setCheckStatus(null)}>Đã hiểu</Button>
              </div>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
