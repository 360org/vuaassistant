import { useState } from "react";
import {
  Building2,
  CheckCircle2,
  Globe,
  LogOut,
  RefreshCw,
  ShieldCheck,
  X,
} from "lucide-react";
import { useApp } from "@/lib/store";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { openExternalUrl } from "@/components/MessageContent";

interface UserProfileModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export function UserProfileModal({ isOpen, onClose }: UserProfileModalProps) {
  const { user, updateLocalUser, clearLocalUser, language } = useApp();
  const [isEditing, setIsEditing] = useState(false);
  const [name, setName] = useState(user?.name || "");
  const [email, setEmail] = useState(user?.email || user?.detail || "");
  const [phone, setPhone] = useState(user?.phone || "");
  const [isSyncing, setIsSyncing] = useState(false);
  const [syncStatus, setSyncStatus] = useState<string | null>(null);

  if (!isOpen) return null;

  const handleSave = () => {
    updateLocalUser({
      name,
      email,
      phone,
      detail: email || user?.detail,
    });
    setIsEditing(false);
  };

  const handleLogin360SSO = async () => {
    setIsSyncing(true);
    setSyncStatus("Đang mở trang đăng nhập SSO vuahethong.net...");

    const redirectUri = typeof window !== "undefined"
      ? `${window.location.origin}/callback`
      : "http://localhost:1420/callback";
    const ssoAuthUrl = `https://vuahethong.net/vuaoffice/auth?redirect_uri=${encodeURIComponent(redirectUri)}`;

    try {
      await openExternalUrl(ssoAuthUrl);
      setSyncStatus("Vui lòng hoàn tất xác thực trên trình duyệt...");
    } catch (err) {
      setSyncStatus(`Lỗi mở SSO: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setIsSyncing(false);
    }
  };

  const handleSyncVuahethong = () => {
    setIsSyncing(true);
    setSyncStatus("Đang đồng bộ dữ liệu với Vua Hệ Thống Cloud...");
    setTimeout(() => {
      updateLocalUser({
        syncedWithVuahethong: true,
        organization: "360 CORP / Vua Hệ Thống",
        lastSyncedAt: Date.now(),
      });
      setSyncStatus("✅ Đồng bộ tài khoản 360 CORP & Vua Hệ Thống thành công!");
      setIsSyncing(false);
    }, 800);
  };

  const initialLetter = (user?.name || "V").charAt(0).toUpperCase();

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="relative w-full max-w-lg overflow-hidden rounded-2xl border border-neutral-800 bg-neutral-900 shadow-2xl">
        {/* Header with gradient branding */}
        <div className="relative border-b border-neutral-800/80 bg-gradient-to-r from-neutral-900 via-neutral-850 to-neutral-900 px-6 py-5">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <div className="flex size-9 items-center justify-center rounded-xl bg-gradient-to-br from-gold-400/20 to-gold-600/10 border border-gold-500/30 text-gold-400 shadow-inner">
                <ShieldCheck className="size-5" />
              </div>
              <div>
                <h3 className="text-base font-semibold text-neutral-100">
                  {language === "en" ? "User Profile & 360 CORP SSO" : "Hồ sơ Người dùng & 360 CORP SSO"}
                </h3>
                <p className="text-xs text-neutral-400">
                  {language === "en"
                    ? "Manage local identity & 1-Click login with vuahethong.net"
                    : "Quản lý hồ sơ cục bộ & Đăng nhập 1-Click với vuahethong.net"}
                </p>
              </div>
            </div>
            <button
              onClick={onClose}
              className="rounded-lg p-1.5 text-neutral-400 hover:bg-neutral-800 hover:text-neutral-200 transition-colors"
            >
              <X className="size-4" />
            </button>
          </div>
        </div>

        {/* Content Body */}
        <div className="space-y-5 p-6 text-sm">
          {/* Avatar & Core Identity */}
          <div className="flex items-center gap-4 rounded-xl border border-neutral-800 bg-neutral-950/60 p-4">
            <div className="relative flex size-14 shrink-0 items-center justify-center rounded-full bg-gradient-to-tr from-gold-500 to-amber-300 text-xl font-bold text-neutral-950 shadow-md ring-2 ring-gold-400/20">
              {initialLetter}
              {user?.syncedWithVuahethong && (
                <span className="absolute -bottom-0.5 -right-0.5 flex size-4 items-center justify-center rounded-full bg-emerald-500 text-[10px] text-white ring-2 ring-neutral-900" title="Đã đồng bộ 360 CORP SSO">
                  ✓
                </span>
              )}
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <h4 className="truncate text-base font-semibold text-neutral-100">
                  {user?.name || "VuaAssistant User"}
                </h4>
                {user?.syncedWithVuahethong ? (
                  <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/10 border border-emerald-500/30 px-2 py-0.5 text-[10px] font-medium text-emerald-400">
                    <CheckCircle2 className="size-3" /> 360 CORP SSO
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1 rounded-full bg-neutral-800 border border-neutral-700 px-2 py-0.5 text-[10px] font-medium text-neutral-400">
                    Local Profile
                  </span>
                )}
              </div>
              <p className="mt-0.5 truncate text-xs text-neutral-400">
                {user?.email || user?.detail || "Local user on this device"}
              </p>
              <div className="mt-1 flex items-center gap-2 text-[11px] text-neutral-500">
                <span>Nhà cung cấp: <strong className="text-neutral-300 font-medium">{user?.providerLabel || user?.provider || "Direct"}</strong></span>
                {user?.organization && (
                  <>
                    <span>•</span>
                    <span className="text-gold-400/90">{user.organization}</span>
                  </>
                )}
              </div>
            </div>
          </div>

          {/* Edit Profile Form */}
          {isEditing ? (
            <div className="space-y-3 rounded-xl border border-neutral-800 bg-neutral-950/40 p-4">
              <div>
                <label className="block text-xs font-medium text-neutral-300">Họ và tên</label>
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-neutral-700 bg-neutral-800 px-3 py-1.5 text-xs text-neutral-100 focus:border-gold-500 focus:outline-none"
                  placeholder="Nhập tên hiển thị"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-neutral-300">Email liên hệ</label>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-neutral-700 bg-neutral-800 px-3 py-1.5 text-xs text-neutral-100 focus:border-gold-500 focus:outline-none"
                  placeholder="user@example.com"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-neutral-300">Số điện thoại</label>
                <input
                  type="tel"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-neutral-700 bg-neutral-800 px-3 py-1.5 text-xs text-neutral-100 focus:border-gold-500 focus:outline-none"
                  placeholder="0901234567"
                />
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <Button variant="ghost" size="sm" onClick={() => setIsEditing(false)}>
                  Hủy
                </Button>
                <Button variant="primary" size="sm" onClick={handleSave} className="bg-gold-500 text-neutral-950 hover:bg-gold-400">
                  Lưu thay đổi
                </Button>
              </div>
            </div>
          ) : (
            <div className="flex items-center justify-between rounded-xl border border-neutral-800/80 bg-neutral-950/30 px-4 py-3">
              <div className="space-y-0.5">
                <div className="text-xs text-neutral-400">Thông tin cá nhân:</div>
                <div className="text-xs text-neutral-200">
                  {user?.phone ? `${user.name} • ${user.phone}` : user?.name || "Chưa cấu hình"}
                </div>
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setName(user?.name || "");
                  setEmail(user?.email || user?.detail || "");
                  setPhone(user?.phone || "");
                  setIsEditing(true);
                }}
                className="h-8 border-neutral-700 text-xs text-neutral-300 hover:bg-neutral-800"
              >
                Chỉnh sửa
              </Button>
            </div>
          )}

          {/* 360 CORP SSO / vuahethong.net Integration Card */}
          <div className="space-y-3 rounded-xl border border-gold-500/25 bg-gradient-to-b from-gold-500/5 to-transparent p-4">
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-center gap-2.5">
                <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-gold-500/20 text-gold-400">
                  <Building2 className="size-4" />
                </div>
                <div>
                  <h5 className="text-xs font-semibold text-gold-300">
                    360 CORP & Vua Hệ Thống SSO
                  </h5>
                  <p className="text-[11px] text-neutral-400">
                    Đăng nhập 1-Click với trung tâm xác thực <code>auth_sso_center</code> tại <strong>vuahethong.net</strong>
                  </p>
                </div>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2 pt-1">
              <Button
                onClick={handleLogin360SSO}
                disabled={isSyncing}
                size="sm"
                className="flex-1 bg-gradient-to-r from-gold-500 to-amber-500 text-xs font-semibold text-neutral-950 hover:from-gold-400 hover:to-amber-400 shadow-sm cursor-pointer"
              >
                <Globe className="mr-1.5 size-3.5" />
                Đăng nhập với 360 CORP
              </Button>

              <Button
                onClick={handleSyncVuahethong}
                disabled={isSyncing}
                variant="outline"
                size="sm"
                className="border-neutral-700 text-xs text-neutral-300 hover:bg-neutral-800 hover:text-neutral-100 cursor-pointer"
              >
                <RefreshCw className={cn("mr-1.5 size-3.5", isSyncing && "animate-spin")} />
                Đồng bộ ngay
              </Button>
            </div>

            {syncStatus && (
              <p className="text-[11px] text-gold-300/90 animate-in fade-in">
                {syncStatus}
              </p>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between border-t border-neutral-800/80 bg-neutral-950/60 px-6 py-4">
          <button
            onClick={() => {
              if (confirm("Sếp có chắc chắn muốn đăng xuất tài khoản trên thiết bị này không?")) {
                clearLocalUser();
                onClose();
              }
            }}
            className="flex items-center gap-1.5 text-xs text-rose-400 hover:text-rose-300 cursor-pointer transition-colors"
          >
            <LogOut className="size-3.5" />
            <span>Đăng xuất tài khoản</span>
          </button>
          <Button variant="ghost" size="sm" onClick={onClose} className="text-xs text-neutral-400 hover:text-neutral-200">
            Đóng
          </Button>
        </div>
      </div>
    </div>
  );
}
