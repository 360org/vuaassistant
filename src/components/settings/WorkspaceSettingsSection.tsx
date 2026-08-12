import { useState, useRef, useEffect } from "react";
import { Check, Copy, FolderOpen, HardDrive, RotateCcw, Save } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useApp } from "@/lib/store";
import { t } from "@/lib/i18n";

export function WorkspaceSettingsSection() {
  const {
    customDataPath,
    setCustomDataPath,
    exportFullBackupData,
    importFullBackupData,
    language,
  } = useApp();

  const [dataPathInput, setDataPathInput] = useState(customDataPath || "~/vuaassistant");
  const [savedPathMsg, setSavedPathMsg] = useState<string | null>(null);
  const [copiedPath, setCopiedPath] = useState(false);
  const [backupMsg, setBackupMsg] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const backupFileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setDataPathInput(customDataPath || "~/vuaassistant");
  }, [customDataPath]);

  const handleCopyDataPath = async () => {
    const p = customDataPath || "~/vuaassistant";
    try {
      await navigator.clipboard.writeText(p);
      setCopiedPath(true);
      setTimeout(() => setCopiedPath(false), 2000);
    } catch {
      // Ignore copy error
    }
  };

  const handleSelectFolder = async () => {
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      const selected = await invoke<string | null>("pick_directory");
      if (selected && typeof selected === "string") {
        setDataPathInput(selected);
        return;
      }
    } catch (err) {
      console.warn("Desktop pick_directory command failed, falling back to web file input:", err);
    }
    fileInputRef.current?.click();
  };

  const handleFileInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (files && files.length > 0) {
      const firstFile = files[0];
      // @ts-expect-error path is present in Desktop webview File objects
      const fullPath: string | undefined = firstFile.path;
      if (fullPath) {
        const lastSlash = Math.max(fullPath.lastIndexOf("/"), fullPath.lastIndexOf("\\"));
        if (lastSlash > 0) {
          setDataPathInput(fullPath.substring(0, lastSlash));
          return;
        }
      }
      const relPath = firstFile.webkitRelativePath || firstFile.name;
      const folderName = relPath.split("/")[0] || relPath.split("\\")[0];
      if (folderName) {
        setDataPathInput(`~/vuaassistant/${folderName}`);
      }
    }
  };

  const handleSaveDataPath = async () => {
    const cleanPath = dataPathInput.trim();
    if (!cleanPath) return;
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      await invoke("set_workspace_path", { customDir: cleanPath });
      await invoke("save_custom_data_text", {
        customDir: cleanPath,
        relativePath: "README.txt",
        content: "Thư mục lưu trữ dữ liệu Vua AI Assistant.\nCác tệp tải lên (uploads/), nhật ký trò chuyện (chats/) và bản sao lưu tự động (vuaassistant_backup.json) được lưu trữ tại đây.",
      });
      setCustomDataPath(cleanPath);
      setSavedPathMsg("✅ Đã lưu vị trí & workspace/output-data đã được áp dụng!");
    } catch {
      setSavedPathMsg("❌ Không thể áp dụng vị trí lưu trữ.");
    }
    setTimeout(() => setSavedPathMsg(null), 4000);
  };

  const handleResetDefaultDataPath = async () => {
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      await invoke("set_workspace_path", { customDir: "~/vuaassistant" });
      setCustomDataPath("");
      setDataPathInput("~/vuaassistant");
      setSavedPathMsg("✅ Đã đặt lại đường dẫn dữ liệu mặc định!");
    } catch {
      setSavedPathMsg("❌ Không thể đặt lại vị trí lưu trữ.");
    }
    setTimeout(() => setSavedPathMsg(null), 4000);
  };

  const handleExportBackup = async () => {
    try {
      const jsonStr = exportFullBackupData();
      const now = new Date();
      const pad = (n: number) => n.toString().padStart(2, "0");
      const dateStr = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}_${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
      const filename = `vuaassistant-backup-${dateStr}.json`;
      const timeFormatted = `${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())} ngày ${pad(now.getDate())}/${pad(now.getMonth() + 1)}/${now.getFullYear()}`;

      if (typeof window !== "undefined" && "__TAURI_INTERNALS__" in window) {
        const { invoke } = await import("@tauri-apps/api/core");
        const customDir = customDataPath || localStorage.getItem("vua:custom-data-path") || "~/vuaassistant";
        const savedPath = await invoke<string>("save_custom_data_text", {
          customDir,
          relativePath: `backup/${filename}`,
          content: jsonStr,
        });
        setBackupMsg(language === "en"
          ? `✅ Backup success! Saved to [${savedPath}] at ${timeFormatted}.`
          : `✅ Backup success! Tệp đã được lưu tại [${savedPath}] lúc ${timeFormatted}.`
        );
      } else {
        const blob = new Blob([jsonStr], { type: "application/json" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = filename;
        a.click();
        URL.revokeObjectURL(url);
        setBackupMsg(language === "en"
          ? `✅ Backup success! File [${filename}] created and downloaded successfully at ${timeFormatted}.`
          : `✅ Backup success! Tệp [${filename}] đã được tạo và tải xuống thành công lúc ${timeFormatted}.`
        );
      }
      setTimeout(() => setBackupMsg(null), 8000);
    } catch (e) {
      console.error(e);
      setBackupMsg(language === "en" ? "❌ Failed to export backup." : "❌ Lỗi xuất dữ liệu sao lưu.");
    }
  };

  const handleImportBackupFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    const file = files[0];
    const reader = new FileReader();
    reader.onload = () => {
      const content = reader.result as string;
      if (content) {
        const ok = importFullBackupData(content);
        if (ok) {
          setBackupMsg("✅ Đã khôi phục dữ liệu thành công!");
          setTimeout(() => setBackupMsg(null), 4000);
        } else {
          setBackupMsg("❌ Tệp sao lưu không đúng định dạng.");
        }
      }
    };
    reader.readAsText(file);
    e.target.value = "";
  };

  return (
    <>
      {/* Data Storage Location Section */}
      <section className="mt-8">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-neutral-300">
            {t("workspace_title", language)}
          </h2>
          <Badge tone={customDataPath ? "gold" : "neutral"}>
            {customDataPath ? (language === "en" ? "Customized" : "Đã tùy chỉnh") : (language === "en" ? "System Default" : "Mặc định hệ thống")}
          </Badge>
        </div>

        <Card className="mt-3 flex flex-col gap-4 p-5">
          <div>
            <div className="flex items-center gap-2 text-sm font-semibold text-neutral-100">
              <HardDrive className="size-4 text-gold-400" />
              {t("workspace_label", language)}
            </div>
            <div className="mt-1.5 flex items-center gap-2 rounded-xl border border-neutral-800 bg-neutral-950/80 px-3 py-2">
              <code className="flex-1 truncate font-mono text-xs text-gold-300">
                {customDataPath || "~/vuaassistant"}
              </code>
              <button
                onClick={handleCopyDataPath}
                title="Copy path"
                className="flex items-center gap-1 text-xs text-neutral-400 hover:text-neutral-200 transition-colors cursor-pointer"
              >
                {copiedPath ? (
                  <>
                    <Check className="size-3.5 text-emerald-400" />
                    <span className="text-emerald-400 font-medium">{language === "en" ? "Copied" : "Đã chép"}</span>
                  </>
                ) : (
                  <>
                    <Copy className="size-3.5" />
                    <span>Copy</span>
                  </>
                )}
              </button>
            </div>
          </div>

          <div className="flex flex-col gap-2">
            <label className="text-xs font-medium text-neutral-400">
              {t("workspace_desc", language)}
            </label>
            <div className="flex flex-col sm:flex-row gap-2">
              <input
                type="text"
                value={dataPathInput}
                onChange={(e) => setDataPathInput(e.target.value)}
                placeholder={language === "en" ? "Example: /Volumes/DATA/vuaassistant-storage or D:\\VuaAssistant-Data" : "Ví dụ: /Volumes/DATA/vuaassistant-storage hoặc D:\\VuaAssistant-Data"}
                className="flex-1 rounded-xl border border-neutral-800 bg-neutral-950 px-3 py-2 font-mono text-xs text-neutral-200 focus:border-gold-500/50 focus:outline-hidden"
              />
              <input
                type="file"
                ref={fileInputRef}
                onChange={handleFileInputChange}
                // @ts-expect-error webkitdirectory is standard prop supported by browsers
                webkitdirectory=""
                directory=""
                className="hidden"
              />
              <div className="flex items-center gap-2">
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={handleSelectFolder}
                  className="gap-1.5 whitespace-nowrap cursor-pointer"
                >
                  <FolderOpen className="size-3.5 text-gold-400" />
                  {t("choose_folder", language)}
                </Button>
                <Button
                  variant="primary"
                  size="sm"
                  onClick={handleSaveDataPath}
                  className="gap-1.5 whitespace-nowrap cursor-pointer"
                >
                  <Save className="size-3.5" />
                  {t("save_location", language)}
                </Button>
              </div>
            </div>

            {savedPathMsg && (
              <div className="mt-1 text-xs font-medium text-emerald-400 transition-all">
                {savedPathMsg}
              </div>
            )}
          </div>

          <div className="flex items-center justify-between border-t border-neutral-800/80 pt-3">
            <span className="text-xs text-neutral-500">
              {language === "en" ? "Reset app data storage path back to default" : "Khôi phục lại đường dẫn lưu trữ thư mục mặc định của ứng dụng"}
            </span>
            <Button
              variant="ghost"
              size="sm"
              onClick={handleResetDefaultDataPath}
              className="gap-1.5 text-xs text-neutral-400 hover:text-neutral-200 cursor-pointer"
            >
              <RotateCcw className="size-3.5" />
              {t("set_default", language)}
            </Button>
          </div>

          <div className="rounded-xl border border-gold-500/20 bg-gold-500/5 p-3 text-xs leading-relaxed text-neutral-300">
            <span className="font-bold text-gold-400">💡 {language === "en" ? "Auto-backup Tip:" : "Gợi ý sao lưu tự động:"}</span> {language === "en" ? "You can point your data directory to cloud folders like iCloud Drive, Google Drive or an external SSD so chat data and knowledge are always backed up safely!" : "Bạn có thể trỏ thư mục lưu trữ sang các thư mục đám mây như iCloud Drive, Google Drive hoặc ổ cứng gắn ngoài SSD để dữ liệu hội thoại và kiến thức luôn được tự động backup an toàn!"}
          </div>
        </Card>
      </section>

      {/* Backup & Restore Section */}
      <section className="mt-10">
        <h2 className="text-sm font-semibold text-neutral-300">
          📦 {t("backup_restore_title", language)}
        </h2>
        <Card className="mt-3 space-y-4">
          <input
            type="file"
            ref={backupFileInputRef}
            accept=".json"
            className="hidden"
            onChange={handleImportBackupFile}
          />
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <div className="text-sm font-medium text-neutral-100">{t("export_backup", language)}</div>
              <div className="text-xs text-neutral-400">{t("export_backup_desc", language)}</div>
            </div>
            <Button
              variant="secondary"
              size="sm"
              onClick={handleExportBackup}
              className="gap-1.5 whitespace-nowrap cursor-pointer hover:border-gold-400"
            >
              <HardDrive className="size-3.5 text-gold-400" />
              {t("export_backup", language)}
            </Button>
          </div>

          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-t border-neutral-800/80 pt-3">
            <div>
              <div className="text-sm font-medium text-neutral-100">{t("import_backup", language)}</div>
              <div className="text-xs text-neutral-400">{t("import_backup_desc", language)}</div>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => backupFileInputRef.current?.click()}
              className="gap-1.5 whitespace-nowrap cursor-pointer hover:border-gold-400"
            >
              <FolderOpen className="size-3.5 text-gold-400" />
              {t("choose_backup_file", language)}
            </Button>
          </div>

          {backupMsg && (
            <div className="mt-2 text-xs font-semibold text-emerald-400 transition-all">
              {backupMsg}
            </div>
          )}
        </Card>
      </section>
    </>
  );
}
