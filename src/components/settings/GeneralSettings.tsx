import { useState } from "react";
import { cn } from "@/lib/utils";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useApp } from "@/lib/store";
import { t } from "@/lib/i18n";

export function GeneralSettings() {
  const {
    selfImprove,
    setSelfImprove,
    language,
    setLanguage,
    theme,
    setTheme,
    resetApp,
  } = useApp();

  const [runOnStartup, setRunOnStartup] = useState<boolean>(() => {
    return localStorage.getItem("v-assistant-autostart") === "true";
  });

  const handleToggleAutostart = async (enable: boolean) => {
    setRunOnStartup(enable);
    localStorage.setItem("v-assistant-autostart", enable ? "true" : "false");
    try {
      if (typeof window !== "undefined" && "__TAURI_INTERNALS__" in window) {
        const { invoke } = await import("@tauri-apps/api/core");
        await invoke("set_autostart", { enable });
      }
    } catch {
      /* ignore desktop fallback */
    }
  };

  return (
    <div className="space-y-8">
      {/* Run on Startup & Self-improving Memory */}
      <section className="mt-8 space-y-4">
        <h2 className="text-sm font-semibold text-neutral-300">
          {language === "en" ? "System Startup & Memory Settings" : "Khởi động cùng Hệ thống & Bộ nhớ"}
        </h2>
        <Card className="flex items-center justify-between gap-3 p-4">
          <div className="min-w-0">
            <div className="text-sm font-medium text-neutral-100">
              {language === "en" ? "Run on Startup" : "Tự động chạy cùng hệ thống (Run on Startup)"}
            </div>
            <div className="text-xs text-neutral-400">
              {language === "en"
                ? "Automatically launch V-Assistant when your computer starts up."
                : "Khởi động V-Assistant chạy ngầm sẵn sàng phục vụ ngay khi bật máy tính."}
            </div>
          </div>
          <button
            role="switch"
            aria-checked={runOnStartup}
            aria-label="Run on startup"
            onClick={() => handleToggleAutostart(!runOnStartup)}
            className={cn(
              "relative h-6 w-11 shrink-0 cursor-pointer rounded-full transition-colors",
              runOnStartup ? "bg-emerald-500" : "bg-neutral-700",
            )}
          >
            <span
              className={cn(
                "absolute top-0.5 size-5 rounded-full bg-neutral-950 transition-all",
                runOnStartup ? "left-[22px]" : "left-0.5",
              )}
            />
          </button>
        </Card>

        <Card className="flex items-center justify-between gap-3 p-4">
          <div className="min-w-0">
            <div className="text-sm font-medium text-neutral-100">{t("self_improve_label", language)}</div>
            <div className="text-xs text-neutral-400">
              {t("self_improve_desc", language)}
            </div>
          </div>
          <button
            role="switch"
            aria-checked={selfImprove}
            aria-label="Self-improving memory"
            onClick={() => setSelfImprove(!selfImprove)}
            className={cn(
              "relative h-6 w-11 shrink-0 cursor-pointer rounded-full transition-colors",
              selfImprove ? "bg-gold-400" : "bg-neutral-700",
            )}
          >
            <span
              className={cn(
                "absolute top-0.5 size-5 rounded-full bg-neutral-950 transition-all",
                selfImprove ? "left-[22px]" : "left-0.5",
              )}
            />
          </button>
        </Card>
      </section>

      {/* Language & Theme Settings */}
      <section className="mt-8">
        <h2 className="text-sm font-semibold text-neutral-300">{t("appearance_language_title", language)}</h2>
        <Card className="mt-3 space-y-5 p-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <div className="text-sm font-medium text-neutral-100">{t("language", language)}</div>
              <div className="text-xs text-neutral-400">{t("language_desc", language)}</div>
            </div>
            <div className="inline-flex rounded-xl border border-neutral-800 bg-neutral-950 p-1 shadow-xs">
              <button
                type="button"
                onClick={() => setLanguage("vi")}
                className={cn(
                  "flex items-center gap-1.5 rounded-lg px-3.5 py-1.5 text-xs font-semibold transition-all cursor-pointer",
                  language === "vi"
                    ? "bg-blue-600 text-white shadow-sm"
                    : "text-neutral-400 hover:text-neutral-200 hover:bg-neutral-800/40",
                )}
              >
                <span>🇻🇳</span>
                <span>Tiếng Việt</span>
              </button>
              <button
                type="button"
                onClick={() => setLanguage("en")}
                className={cn(
                  "flex items-center gap-1.5 rounded-lg px-3.5 py-1.5 text-xs font-semibold transition-all cursor-pointer",
                  language === "en"
                    ? "bg-blue-600 text-white shadow-sm"
                    : "text-neutral-400 hover:text-neutral-200 hover:bg-neutral-800/40",
                )}
              >
                <span>🇺🇸</span>
                <span>English</span>
              </button>
            </div>
          </div>

          <div className="flex flex-col sm:flex-row sm:items-center justify-between border-t border-neutral-800/80 pt-4 gap-3">
            <div>
              <div className="text-sm font-medium text-neutral-100">{t("theme", language)}</div>
              <div className="text-xs text-neutral-400">{t("theme_desc", language)}</div>
            </div>
            <div className="inline-flex flex-wrap rounded-xl border border-neutral-800 bg-neutral-950 p-1 gap-1 shadow-xs">
              {[
                { id: "system", name: t("theme_system", language), icon: "💻" },
                { id: "light", name: t("theme_light", language), icon: "☀️" },
                { id: "dark", name: t("theme_dark", language), icon: "🌙" },
                { id: "gold", name: t("theme_gold", language), icon: "✨" },
                { id: "midnight", name: t("theme_midnight", language), icon: "🌌" },
              ].map((tItem) => {
                const active = theme === tItem.id;
                return (
                  <button
                    key={tItem.id}
                    type="button"
                    onClick={() => setTheme(tItem.id as any)}
                    className={cn(
                      "flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition-all cursor-pointer",
                      active
                        ? "bg-blue-600 text-white shadow-sm"
                        : "text-neutral-400 hover:text-neutral-200 hover:bg-neutral-800/40",
                    )}
                  >
                    <span>{tItem.icon}</span>
                    <span>{tItem.name}</span>
                  </button>
                );
              })}
            </div>
          </div>
        </Card>
      </section>

      {/* Danger Zone */}
      <section className="mt-8">
        <h2 className="text-sm font-semibold text-red-400">{t("danger_zone", language)}</h2>
        <Card className="mt-3 flex items-center justify-between p-4 border-red-900/40 bg-red-950/10">
          <div>
            <div className="text-sm font-medium text-neutral-100">{t("reset_app_title", language)}</div>
            <div className="text-xs text-neutral-400">
              {t("reset_app_desc", language)}
            </div>
          </div>
          <Button variant="danger" size="sm" onClick={resetApp} className="cursor-pointer">
            {t("reset_now", language)}
          </Button>
        </Card>
      </section>
    </div>
  );
}
