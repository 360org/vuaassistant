import { GeneralSettings } from "@/components/settings/GeneralSettings";
import { ModelSettings } from "@/components/settings/ModelSettings";
import { VaultSettings } from "@/components/settings/VaultSettings";
import { WorkspaceSettingsSection } from "@/components/settings/WorkspaceSettingsSection";
import { AppUpdateSection } from "@/components/settings/AppUpdateSection";
import { McpSettingsSection } from "@/components/settings/McpSettingsSection";
import { PolicySettingsSection } from "@/components/settings/PolicySettingsSection";
import { DiagnosticsSection } from "@/components/settings/DiagnosticsSection";
import { useApp } from "@/lib/store";
import { t } from "@/lib/i18n";

export function Settings() {
  const { language } = useApp();

  return (
    <div className="mx-auto max-w-4xl space-y-10 p-6">
      <div>
        <h1 className="text-xl font-bold text-neutral-100">{t("settings", language)}</h1>
        <p className="mt-1 text-xs text-neutral-400">
          {t("settings_subtitle", language)}
        </p>
      </div>

      {/* Software Auto-Updater Section */}
      <AppUpdateSection />

      {/* Model & AI Providers Section */}
      <ModelSettings />

      {/* Vault & Credentials Section */}
      <VaultSettings />

      {/* Workspace & Data Storage Location Section */}
      <WorkspaceSettingsSection />

      {/* Model capabilities run only through user-approved MCP servers. */}
      <McpSettingsSection />

      {/* Giới hạn người dùng đặt, được capability rail thi hành. */}
      <PolicySettingsSection />

      {/* Redacted health/support bundle for local-first debugging. */}
      <DiagnosticsSection />

      {/* General Settings (Theme, Language, Memory, Reset) */}
      <GeneralSettings />
    </div>
  );
}
