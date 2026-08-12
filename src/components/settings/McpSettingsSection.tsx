import { useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { type McpServerConfig, useApp } from "@/lib/store";

const NAME_PATTERN = /^[a-zA-Z0-9_-]+$/;

export function McpSettingsSection() {
  const { mcpServers, setMcpServers } = useApp();
  const [name, setName] = useState("");
  const [command, setCommand] = useState("");
  const [args, setArgs] = useState("[]");
  const [remoteUrl, setRemoteUrl] = useState("");
  const [error, setError] = useState<string | null>(null);

  const addServerConfig = (serverName: string, server: McpServerConfig) => {
    setMcpServers({ ...mcpServers, [serverName]: server });
    setName("");
    setCommand("");
    setArgs("[]");
    setRemoteUrl("");
    setError(null);
  };

  const addServer = () => {
    const cleanName = name.trim();
    const cleanCommand = command.trim();
    if (!NAME_PATTERN.test(cleanName)) {
      setError("Tên chỉ dùng chữ, số, gạch nối hoặc gạch dưới.");
      return;
    }
    if (!cleanCommand) {
      setError("Cần khai báo lệnh khởi động MCP server.");
      return;
    }

    let parsedArgs: unknown;
    try {
      parsedArgs = JSON.parse(args);
    } catch {
      setError("Arguments phải là mảng JSON, ví dụ: [\"-y\", \"@modelcontextprotocol/server-github\"].");
      return;
    }
    if (!Array.isArray(parsedArgs) || parsedArgs.some((value) => typeof value !== "string")) {
      setError("Arguments phải là mảng các chuỗi JSON.");
      return;
    }

    addServerConfig(cleanName, { command: cleanCommand, args: parsedArgs });
  };

  const addRemoteServer = () => {
    let url: URL;
    try {
      url = new URL(remoteUrl.trim());
    } catch {
      setError("Remote MCP URL không hợp lệ.");
      return;
    }
    if (!/^https?:$/.test(url.protocol)) {
      setError("Remote MCP chỉ hỗ trợ http/https.");
      return;
    }
    const cleanName = (name.trim() || url.hostname.replace(/[^a-zA-Z0-9_-]+/g, "-").replace(/^-|-$/g, "") || "remote-mcp").slice(0, 40);
    if (!NAME_PATTERN.test(cleanName)) {
      setError("Tên chỉ dùng chữ, số, gạch nối hoặc gạch dưới.");
      return;
    }
    addServerConfig(cleanName, { command: "npx", args: ["-y", "mcp-remote", url.toString()] });
  };

  const removeServer = (serverName: string) => {
    const { [serverName]: _removed, ...remaining } = mcpServers;
    setMcpServers(remaining);
  };

  return (
    <section>
      <h2 className="text-sm font-semibold text-neutral-300">Công cụ MCP</h2>
      <p className="mt-1 text-xs leading-relaxed text-neutral-500">
        Chỉ thêm MCP server anh tin cậy. Agent chỉ nhìn thấy tools mà server đã khai báo; không có quyền chạy Bash/Terminal tổng quát.
      </p>

      <Card className="mt-3 space-y-3 p-5">
        {Object.entries(mcpServers).map(([serverName, server]) => (
          <div key={serverName} className="flex items-center justify-between gap-3 rounded-lg border border-neutral-800 bg-neutral-950/60 px-3 py-2">
            <div className="min-w-0 text-xs">
              <strong className="text-gold-300">{serverName}</strong>
              <code className="ml-2 break-all text-neutral-400">{server.command} {server.args.join(" ")}</code>
            </div>
            <Button size="sm" variant="ghost" onClick={() => removeServer(serverName)} title={`Gỡ ${serverName}`}>
              <Trash2 className="size-3.5 text-rose-400" />
            </Button>
          </div>
        ))}

        <div className="grid gap-2 border-t border-neutral-800 pt-3 sm:grid-cols-2">
          <input
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="Tên server, ví dụ github"
            className="rounded-lg border border-neutral-800 bg-neutral-950 px-3 py-2 text-sm outline-none placeholder:text-neutral-600 focus:border-gold-400"
          />
          <input
            value={remoteUrl}
            onChange={(event) => setRemoteUrl(event.target.value)}
            placeholder="Remote MCP URL, ví dụ https://api.example.com/mcp"
            className="rounded-lg border border-neutral-800 bg-neutral-950 px-3 py-2 font-mono text-sm outline-none placeholder:text-neutral-600 focus:border-gold-400"
          />
          <Button size="sm" variant="secondary" onClick={addRemoteServer} className="sm:col-span-2 justify-center">
            <Plus className="size-3.5" /> Thêm remote MCP bằng URL
          </Button>
          <div className="sm:col-span-2 rounded-lg border border-neutral-800 bg-neutral-950/70 p-3 text-[11px] leading-relaxed text-neutral-500">
            Remote MCP dùng bridge <code>mcp-remote</code>. Nếu server yêu cầu OAuth, bridge tự mở trình duyệt và quản lý phiên riêng; VuaAssistant không đưa token hoặc secret vào prompt của agent.
          </div>
          <input
            value={command}
            onChange={(event) => setCommand(event.target.value)}
            placeholder="Lệnh cố định, ví dụ npx"
            className="rounded-lg border border-neutral-800 bg-neutral-950 px-3 py-2 font-mono text-sm outline-none placeholder:text-neutral-600 focus:border-gold-400"
          />
          <input
            value={args}
            onChange={(event) => setArgs(event.target.value)}
            placeholder='Arguments JSON, ví dụ ["-y", "@scope/server"]'
            className="rounded-lg border border-neutral-800 bg-neutral-950 px-3 py-2 font-mono text-sm outline-none placeholder:text-neutral-600 focus:border-gold-400"
          />
        </div>
        {error && <p className="text-xs text-rose-400">{error}</p>}
        <div className="flex items-center justify-between gap-3">
          <span className="text-xs text-neutral-500">Lưu sẽ khởi động lại Runner để nạp tools của server.</span>
          <Button size="sm" variant="secondary" onClick={addServer}>
            <Plus className="size-3.5" /> Thêm MCP server
          </Button>
        </div>
      </Card>
    </section>
  );
}
