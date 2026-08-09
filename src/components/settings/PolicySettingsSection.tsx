/**
 * Giới hạn do người dùng đặt cho Agent.
 *
 * Luật viết ở đây được ghi ra `policy.json` trong thư mục dữ liệu, và Agent
 * Runner đọc nó ở **capability rail** — nơi mọi công cụ bắt buộc đi qua trước
 * khi chạy. Nghĩa là luật được máy thi hành, không phải nhét vào lời nhắc rồi
 * mong model nghe theo.
 */
import { useEffect, useState } from "react";
import { Check, Save, ShieldCheck } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useApp } from "@/lib/store";
import { inDesktopShell } from "@/runtime/proxy";

interface Policy {
  deniedPaths: string[];
  alwaysAsk: string[];
  maxOutboundPerHour: number;
  verifySideEffects: boolean;
}

/** Giống `DEFAULT_POLICY` của runner: mặc định phải an toàn, không mở toang. */
const DEFAULT_POLICY: Policy = {
  deniedPaths: [".env", ".ssh", ".aws", ".gnupg", "id_rsa", "credentials", "wallet"],
  alwaysAsk: [],
  maxOutboundPerHour: 0,
  verifySideEffects: false,
};

const toLines = (list: string[]) => list.join("\n");
const fromLines = (text: string) =>
  text.split("\n").map((line) => line.trim()).filter(Boolean);

export function PolicySettingsSection() {
  const { customDataPath } = useApp();
  const dataDir = customDataPath || "~/vuaai-data";
  const policyPath = `${dataDir.replace(/\/+$/, "")}/policy.json`;

  const [deniedPaths, setDeniedPaths] = useState(toLines(DEFAULT_POLICY.deniedPaths));
  const [alwaysAsk, setAlwaysAsk] = useState("");
  const [maxOutbound, setMaxOutbound] = useState("0");
  const [verify, setVerify] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!inDesktopShell()) return;
    void (async () => {
      try {
        const { invoke } = await import("@tauri-apps/api/core");
        const raw = await invoke<string>("read_host_file", { path: policyPath });
        const parsed = JSON.parse(raw) as Partial<Policy>;
        if (Array.isArray(parsed.deniedPaths)) setDeniedPaths(toLines(parsed.deniedPaths));
        if (Array.isArray(parsed.alwaysAsk)) setAlwaysAsk(toLines(parsed.alwaysAsk));
        if (typeof parsed.maxOutboundPerHour === "number") {
          setMaxOutbound(String(parsed.maxOutboundPerHour));
        }
        if (typeof parsed.verifySideEffects === "boolean") setVerify(parsed.verifySideEffects);
      } catch {
        // Chưa có tệp là chuyện bình thường — giữ nguyên giá trị mặc định.
      }
    })();
  }, [policyPath]);

  const save = async () => {
    setError(null);
    const limit = Number(maxOutbound);
    if (!Number.isFinite(limit) || limit < 0) {
      setError("Số lần gửi mỗi giờ phải là số không âm. Đặt 0 để không giới hạn.");
      return;
    }
    const policy: Policy = {
      deniedPaths: fromLines(deniedPaths),
      alwaysAsk: fromLines(alwaysAsk),
      maxOutboundPerHour: Math.floor(limit),
      verifySideEffects: verify,
    };
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      await invoke("write_host_file", {
        path: policyPath,
        content: JSON.stringify(policy, null, 2),
      });
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    } catch (err) {
      setError(
        `Chưa lưu được luật (${err instanceof Error ? err.message : String(err)}). ` +
          `Hãy kiểm tra quyền ghi vào ${dataDir}.`,
      );
    }
  };

  return (
    <Card className="p-5">
      <div className="flex items-center gap-2">
        <ShieldCheck className="size-4 text-neutral-400" />
        <h2 className="text-sm font-semibold text-neutral-100">Giới hạn cho Agent</h2>
      </div>
      <p className="mt-1 text-xs text-neutral-400">
        Luật ở đây được <strong>thi hành ở tầng công cụ</strong>, không phải chỉ nhắc
        Agent nghe lời — mọi công cụ đều phải đi qua cửa này trước khi chạy.
      </p>

      <div className="mt-5 space-y-5">
        <div>
          <label className="text-xs font-medium text-neutral-300">
            Không được đụng tới{" "}
            <span className="font-normal text-neutral-500">(mỗi dòng một mục)</span>
          </label>
          <textarea
            value={deniedPaths}
            onChange={(e) => setDeniedPaths(e.target.value)}
            rows={6}
            spellCheck={false}
            className="mt-2 w-full rounded border border-neutral-800 bg-neutral-950 p-2 font-mono text-xs text-neutral-200"
          />
          <p className="mt-1 text-[11px] text-neutral-500">
            Khớp theo từng đoạn đường dẫn, nên <code>.env</code> chặn đúng tệp{" "}
            <code>.env</code> mà không chặn oan thư mục <code>duan-env/</code>.
          </p>
        </div>

        <div>
          <label className="text-xs font-medium text-neutral-300">
            Luôn hỏi trước khi dùng{" "}
            <span className="font-normal text-neutral-500">(tên công cụ, mỗi dòng một)</span>
          </label>
          <textarea
            value={alwaysAsk}
            onChange={(e) => setAlwaysAsk(e.target.value)}
            rows={3}
            spellCheck={false}
            placeholder="send_email"
            className="mt-2 w-full rounded border border-neutral-800 bg-neutral-950 p-2 font-mono text-xs text-neutral-200"
          />
        </div>

        <div>
          <label className="text-xs font-medium text-neutral-300">
            Số lần gửi ra ngoài tối đa mỗi giờ
          </label>
          <input
            value={maxOutbound}
            onChange={(e) => setMaxOutbound(e.target.value)}
            inputMode="numeric"
            className="mt-2 w-32 rounded border border-neutral-800 bg-neutral-950 p-2 text-xs text-neutral-200"
          />
          <p className="mt-1 text-[11px] text-neutral-500">
            Đặt <code>0</code> để không giới hạn. Tính theo cửa sổ trượt một giờ, nên
            không thể gửi dồn quanh mốc giao giờ.
          </p>
        </div>

        <div>
          <label className="flex items-start gap-2">
            <input
              type="checkbox"
              checked={verify}
              onChange={(e) => setVerify(e.target.checked)}
              className="mt-0.5"
            />
            <span>
              <span className="text-xs font-medium text-neutral-300">
                Bắt một Agent thứ hai kiểm lại trước khi hành động
              </span>
              <span className="mt-1 block text-[11px] text-neutral-500">
                Agent kiểm chạy trong phiên riêng, không cầm công cụ nào, và mặc định
                là <strong>từ chối</strong> cho tới khi thấy đủ căn cứ. Bật cái này khi
                giao cho Agent việc tiêu tiền hoặc gửi ra ngoài. Đổi lại, mỗi hành động
                tốn thêm một lượt gọi model.
              </span>
            </span>
          </label>
        </div>
      </div>

      {error && <p className="mt-4 text-xs text-red-400">{error}</p>}

      <div className="mt-5 flex items-center gap-3">
        <Button onClick={save} size="sm">
          {saved ? <Check className="size-4" /> : <Save className="size-4" />}
          {saved ? "Đã lưu" : "Lưu giới hạn"}
        </Button>
        <span className="font-mono text-[11px] text-neutral-500">{policyPath}</span>
      </div>
    </Card>
  );
}
