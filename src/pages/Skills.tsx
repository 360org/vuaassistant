import { useMemo, useState } from "react";
import { Download, Trash2, Wand2 } from "lucide-react";
import { SKILLS, smartParseSkill, normalizeGithubSkillUrls, toTemplate } from "@/lib/skills";
import { useApp } from "@/lib/store";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

export function Skills() {
  const {
    useSkill,
    customSkills,
    addCustomSkill,
    removeCustomSkill,
    installedEngineSkills,
    toggleEngineSkill,
    activeAgentId,
    agentConfigs,
    agents,
    setView,
  } = useApp();
  const [url, setUrl] = useState("");
  const [installing, setInstalling] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const activeAgent = useMemo(() => {
    return agents.find((a) => a.id === activeAgentId) ?? null;
  }, [agents, activeAgentId]);

  const isSkillEnabled = (skillId: string) => {
    if (!activeAgentId) return true;
    const config = agentConfigs[activeAgentId];
    if (!config || !config.skills) return true;
    return config.skills.includes(skillId);
  };

  const custom = useMemo(
    () =>
      customSkills.flatMap((c) => {
        try {
          return [{ template: toTemplate(smartParseSkill(c.raw), c.source), source: c.source }];
        } catch {
          return [];
        }
      }),
    [customSkills],
  );

  const filteredCustom = useMemo(() => {
    return custom.filter(({ template }) => isSkillEnabled(template.id));
  }, [custom, activeAgentId, agentConfigs]);

  const filteredSkills = useMemo(() => {
    return SKILLS.filter((skill) => isSkillEnabled(skill.id));
  }, [activeAgentId, agentConfigs]);

  const installFromUrl = async () => {
    const target = url.trim();
    if (!target) return;
    setInstalling(true);
    setError(null);
    try {
      // 1. Check if the URL points to a GitHub folder/directory tree
      const ghDirMatch = target.match(/^https?:\/\/github\.com\/([^/]+)\/([^/]+)\/tree\/([^/]+)\/(.+)$/);
      if (ghDirMatch) {
        const [, owner, repo, branch, folderPath] = ghDirMatch;
        const apiUrl = `https://api.github.com/repos/${owner}/${repo}/contents/${folderPath.replace(/\/$/, "")}?ref=${branch}`;
        try {
          const apiRes = await fetch(apiUrl);
          if (apiRes.ok) {
            const items = await apiRes.json();
            if (Array.isArray(items)) {
              let installedCount = 0;
              for (const item of items) {
                if (item.type === "dir" || item.type === "file") {
                  const subPath = item.path;
                  const candidateRawUrls = [
                    `https://raw.githubusercontent.com/${owner}/${repo}/${branch}/${subPath}/SKILL.md`,
                    `https://raw.githubusercontent.com/${owner}/${repo}/${branch}/${subPath}/skill.md`,
                    `https://raw.githubusercontent.com/${owner}/${repo}/${branch}/${subPath}`,
                  ];
                  for (const rawUrl of candidateRawUrls) {
                    try {
                      const res = await fetch(rawUrl);
                      if (res.ok) {
                        const text = await res.text();
                        smartParseSkill(text, item.name);
                        addCustomSkill({ raw: text, source: rawUrl });
                        installedCount++;
                        break;
                      }
                    } catch {
                      // try next
                    }
                  }
                }
              }
              if (installedCount > 0) {
                setUrl("");
                return;
              }
            }
          }
        } catch {
          // fallback to single URL candidate fetching
        }
      }

      // 2. Fetch single skill from candidate URLs
      const candidates = normalizeGithubSkillUrls(target);
      let fetchedText: string | null = null;
      let usedSource = target;

      for (const candidate of candidates) {
        try {
          const response = await fetch(candidate);
          if (response.ok) {
            fetchedText = await response.text();
            usedSource = candidate;
            break;
          }
        } catch {
          // try next candidate
        }
      }

      if (!fetchedText) {
        throw new Error("Không thể nạp nội dung Skill từ URL này (vui lòng kiểm tra lại kết nối mạng hoặc đường dẫn GitHub).");
      }

      smartParseSkill(fetchedText, "imported-skill");
      addCustomSkill({ raw: fetchedText, source: usedSource });
      setUrl("");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setInstalling(false);
    }
  };

  return (
    <div className="mx-auto max-w-4xl px-4 py-6 sm:px-8 sm:py-10">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">Skills</h1>
          <p className="mt-1 text-neutral-400">
            Kỹ năng làm việc tự động cho AI Agent. Bật/Tắt từng Skill bên dưới để cho phép sử dụng trong Chat.
          </p>
        </div>
        <Button
          onClick={() => {
            useSkill("Hãy giúp tôi thiết kế và đóng gói một Skill mới cho AI Agent để: ", {
              name: "Skill Creator (Tự tạo Skill mới)",
              instructions: "Hãy phân tích yêu cầu của người dùng, soạn thảo quy chuẩn SKILL.md và tự động gọi công cụ `create_skill` để đóng gói và lưu Skill mới vào ứng dụng.",
            });
            setView("chat");
          }}
          className="shrink-0 font-bold bg-gradient-to-r from-gold-500 to-gold-600 text-neutral-950 hover:from-gold-400 hover:to-gold-500"
        >
          <Wand2 className="size-4 mr-1.5" /> ✨ Tạo Skill mới bằng AI
        </Button>
      </div>

      {activeAgent && (
        <div className="mt-4 flex items-center justify-between rounded-xl bg-gold-400/10 border border-gold-400/20 px-4 py-2.5 text-xs text-gold-300">
          <div className="flex items-center gap-2">
            <span className="text-sm">{activeAgent.emoji}</span>
            <span>
              Đang hiển thị kỹ năng cho vai trò <strong>{activeAgent.name}</strong>. Chỉ những kỹ năng được bật trong cấu hình vai trò mới xuất hiện tại đây.
            </span>
          </div>
          <button
            onClick={() => setView("agents")}
            className="font-medium underline hover:text-gold-200"
          >
            Cấu hình vai trò
          </button>
        </div>
      )}

      {/* Install any standard Agent Skill (SKILL.md) from a URL. */}
      <div className="mt-6 flex flex-col gap-2 sm:flex-row">
        <input
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && void installFromUrl()}
          placeholder="Install from URL — paste a link to a SKILL.md"
          className="flex-1 rounded-xl border border-neutral-700 bg-neutral-900 px-3 py-2 text-sm outline-none placeholder:text-neutral-600 focus:border-gold-400/60"
        />
        <Button
          variant="secondary"
          disabled={!url.trim() || installing}
          onClick={() => void installFromUrl()}
        >
          <Download className="size-4" />
          {installing ? "Installing…" : "Install"}
        </Button>
      </div>
      {error && <p className="mt-2 text-xs text-red-400">⚠️ {error}</p>}

      <h2 className="mt-8 text-lg font-semibold">Task skills</h2>
      {(filteredCustom.length > 0 || filteredSkills.length > 0) ? (
        <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
          {filteredCustom.map(({ template, source }) => {
            const isInstalled = installedEngineSkills.includes(template.id);
            return (
              <Card key={source} className="flex flex-col border-neutral-800 bg-neutral-900/60 p-4">
                <div className="flex items-start justify-between">
                  <span className="text-3xl">{template.emoji}</span>
                  <div className="flex items-center gap-1.5">
                    <Badge tone={isInstalled ? "gold" : "neutral"}>
                      {isInstalled ? "✅ Đã bật" : "⚪ Chưa bật"}
                    </Badge>
                    <Badge tone="gold">Custom</Badge>
                  </div>
                </div>
                <h3 className="mt-3 font-semibold text-neutral-100">{template.name}</h3>
                <p className="mt-1 flex-1 text-sm text-neutral-400">
                  {template.description}
                </p>
                <p className="mt-2 line-clamp-2 break-all text-[11px] text-neutral-600">
                  Nguồn: {template.provenance}{template.version ? ` · v${template.version}` : ""}
                </p>
                <div className="mt-4 flex items-center justify-between gap-2 border-t border-neutral-800/80 pt-3">
                  <Button
                    size="sm"
                    variant={isInstalled ? "outline" : "primary"}
                    onClick={() => toggleEngineSkill(template.id)}
                    className={
                      isInstalled
                        ? "text-xs text-rose-400 hover:bg-rose-500/10 hover:border-rose-500/40 cursor-pointer"
                        : "bg-gold-500 text-neutral-950 font-semibold hover:bg-gold-400 cursor-pointer"
                    }
                  >
                    {isInstalled ? "Tắt Skill" : "⚡ Bật Skill"}
                  </Button>

                  <div className="flex items-center gap-1.5">
                    {isInstalled && (
                      <Button
                        size="sm"
                        variant="secondary"
                        onClick={() => {
                          useSkill(template.prompt || template.description, {
                            name: template.name,
                            tools: template.tools,
                            instructions: template.instructions,
                          });
                          setView("chat");
                        }}
                        className="bg-gold-400/15 text-gold-300 hover:bg-gold-400/25 border border-gold-400/30 cursor-pointer"
                      >
                        <Wand2 className="size-3.5 mr-1" /> Dùng ngay
                      </Button>
                    )}
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => removeCustomSkill(source)}
                      title="Xóa skill này"
                      className="cursor-pointer"
                    >
                      <Trash2 className="size-3.5 text-neutral-500 hover:text-red-400" />
                    </Button>
                  </div>
                </div>
              </Card>
            );
          })}
          {filteredSkills.map((skill) => {
            const isInstalled = installedEngineSkills.includes(skill.id);
            return (
              <Card key={skill.id} className="flex flex-col border-neutral-800 bg-neutral-900/60 p-4">
                <div className="flex items-start justify-between">
                  <span className="text-3xl">{skill.emoji}</span>
                  <div className="flex items-center gap-1.5">
                    <Badge tone={isInstalled ? "gold" : "neutral"}>
                      {isInstalled ? "✅ Đã bật" : "⚪ Chưa bật"}
                    </Badge>
                    <Badge>{skill.category}</Badge>
                  </div>
                </div>
                <h3 className="mt-3 font-semibold text-neutral-100">{skill.name}</h3>
                <p className="mt-1 flex-1 text-sm text-neutral-400">
                  {skill.description}
                </p>
                <p className="mt-2 text-[11px] text-neutral-600">
                  Nguồn: {skill.provenance}{skill.version ? ` · v${skill.version}` : ""}
                </p>
                <div className="mt-4 flex items-center justify-between gap-2 border-t border-neutral-800/80 pt-3">
                  <Button
                    size="sm"
                    variant={isInstalled ? "outline" : "primary"}
                    onClick={() => toggleEngineSkill(skill.id)}
                    className={
                      isInstalled
                        ? "text-xs text-rose-400 hover:bg-rose-500/10 hover:border-rose-500/40 cursor-pointer"
                        : "bg-gold-500 text-neutral-950 font-semibold hover:bg-gold-400 cursor-pointer"
                    }
                  >
                    {isInstalled ? "Tắt Skill" : "⚡ Bật Skill"}
                  </Button>

                  {isInstalled && (
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() => {
                        useSkill(skill.prompt, {
                          name: skill.name,
                          tools: skill.tools,
                          instructions: skill.instructions,
                        });
                        setView("chat");
                      }}
                      className="bg-gold-400/15 text-gold-300 hover:bg-gold-400/25 border border-gold-400/30 cursor-pointer"
                    >
                      <Wand2 className="size-3.5 mr-1" /> Dùng ngay
                    </Button>
                  )}
                </div>
              </Card>
            );
          })}
        </div>
      ) : (
        <div className="mt-4 rounded-xl border border-dashed border-neutral-800 p-8 text-center text-sm text-neutral-500">
          Không có kỹ năng nào được bật cho vai trò này. Bạn có thể bật chúng trong cấu hình vai trò.
        </div>
      )}

    </div>
  );
}
