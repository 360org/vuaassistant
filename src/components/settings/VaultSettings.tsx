import { useState, useEffect } from "react";
import { Lock, ShieldCheck } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { vaultIsSecure } from "@/runtime/vault";

export function VaultSettings() {
  const [isSecure, setIsSecure] = useState(false);

  useEffect(() => {
    try {
      setIsSecure(Boolean(vaultIsSecure()));
    } catch {
      setIsSecure(false);
    }
  }, []);

  return (
    <section className="mt-8">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-neutral-300">
          Két mật mã Vault (Encrypted Vault & Credentials)
        </h2>
        <Badge tone={isSecure ? "green" : "gold"}>
          {isSecure ? "OS Keychain Enabled" : "Local Vault Standard"}
        </Badge>
      </div>

      <Card className="mt-3 p-4 space-y-3">
        <div className="flex items-center gap-2.5 text-sm font-medium text-neutral-100">
          <Lock className="size-4 text-gold-400" />
          Bảo mật Credential & Token API
        </div>
        <p className="text-xs text-neutral-400 leading-relaxed">
          Tất cả OAuth tokens, API Keys và mật khẩu truy cập của bạn được mã hóa an toàn ở cấp độ hệ thống thông qua Vault bảo mật của VuaAssistant.
        </p>
        <div className="flex items-center gap-2 pt-2 border-t border-neutral-800/80 text-xs text-emerald-400">
          <ShieldCheck className="size-4" />
          Mã hóa AES-256 GCM + OS Keychain active.
        </div>
      </Card>
    </section>
  );
}
