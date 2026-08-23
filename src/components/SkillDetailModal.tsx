import { useState, useEffect } from "react";
import { X, Save, Eye, Edit3, Wand2, Terminal } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { smartParseSkill, type SkillTemplate } from "@/lib/skills";

interface SkillDetailModalProps {
  isOpen: boolean;
  onClose: () => void;
  skill: SkillTemplate | null;
  rawContent?: string;
  source?: string;
  isCustom?: boolean;
  onSave?: (source: string, newRaw: string) => void;
  onUse?: (prompt: string, skillData: { name: string; tools?: string[]; instructions: string }) => void;
}

export function SkillDetailModal({
  isOpen,
  onClose,
  skill,
  rawContent,
  source,
  isCustom = false,
  onSave,
  onUse,
}: SkillDetailModalProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [editedRaw, setEditedRaw] = useState("");
  const [saveError, setSaveError] = useState<string | null>(null);

  useEffect(() => {
    if (skill) {
      if (rawContent) {
        setEditedRaw(rawContent);
      } else {
        // Generate raw format for viewing built-in skills
        const toolsYaml = skill.tools && skill.tools.length > 0
          ? `tools:\n${skill.tools.map((t) => `  - ${t}`).join("\n")}\n`
          : "";
        setEditedRaw(
          `---\nname: ${skill.id}\ndescription: ${skill.description}\nmetadata:\n  vua-title: "${skill.name}"\n  vua-emoji: "${skill.emoji}"\n  vua-category: "${skill.category}"\n${toolsYaml}---\n\n${skill.instructions}`,
        );
      }
      setIsEditing(false);
      setSaveError(null);
    }
  }, [skill, rawContent]);

  if (!isOpen || !skill) return null;

  const handleSave = () => {
    setSaveError(null);
    try {
      smartParseSkill(editedRaw, skill.id);
      if (onSave && source) {
        onSave(source, editedRaw);
      }
      setIsEditing(false);
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : "Định dạng YAML frontmatter hoặc cú pháp Skill không hợp lệ.");
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="flex h-[85vh] w-full max-w-3xl flex-col rounded-2xl border border-neutral-800 bg-neutral-900 shadow-2xl overflow-hidden">

        {/* Header */}
        <div className="flex items-center justify-between border-b border-neutral-800 px-6 py-4">
          <div className="flex items-center gap-3">
            <span className="text-3xl">{skill.emoji}</span>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-lg font-bold text-neutral-100">{skill.name}</h2>
                <Badge tone={isCustom ? "gold" : "neutral"}>
                  {isCustom ? "Custom Skill" : "Built-in"}
                </Badge>
                {skill.version && <span className="text-xs text-neutral-500">v{skill.version}</span>}
              </div>
              <p className="text-xs font-mono text-neutral-400 mt-0.5">{skill.id}</p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {isCustom && (
              <Button
                size="sm"
                variant={isEditing ? "outline" : "secondary"}
                onClick={() => setIsEditing(!isEditing)}
                className="text-xs cursor-pointer"
              >
                {isEditing ? (
                  <>
                    <Eye className="size-3.5 mr-1" /> Chế độ xem
                  </>
                ) : (
                  <>
                    <Edit3 className="size-3.5 mr-1" /> Chỉnh sửa SKILL.md
                  </>
                )}
              </Button>
            )}
            <button
              onClick={onClose}
              className="rounded-lg p-1.5 text-neutral-400 hover:bg-neutral-800 hover:text-neutral-200 transition-colors"
            >
              <X className="size-5" />
            </button>
          </div>
        </div>

        {/* Content Body */}
        <div className="flex-1 overflow-y-auto p-6 space-y-5">
          {saveError && (
            <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-3 text-xs text-red-400">
              ⚠️ {saveError}
            </div>
          )}

          {isEditing ? (
            <div className="h-full flex flex-col space-y-2">
              <div className="flex items-center justify-between text-xs text-neutral-400">
                <span>Nội dung file vật lý <code>SKILL.md</code> (hỗ trợ YAML Frontmatter + Markdown instructions):</span>
                <span className="text-[11px] text-gold-400">Tự động cập nhật vào Kernel &amp; AI Runner</span>
              </div>
              <textarea
                value={editedRaw}
                onChange={(e) => setEditedRaw(e.target.value)}
                className="flex-1 min-h-[400px] w-full font-mono text-xs text-neutral-200 bg-neutral-950 p-4 rounded-xl border border-neutral-700 outline-none focus:border-gold-500 resize-none leading-relaxed"
                spellCheck={false}
              />
            </div>
          ) : (
            <div className="space-y-5">
              {/* Description */}
              <div>
                <h4 className="text-xs font-semibold uppercase tracking-wider text-neutral-400 mb-1.5">Mô tả</h4>
                <p className="text-sm text-neutral-200 bg-neutral-950/60 p-3.5 rounded-xl border border-neutral-800/80">
                  {skill.description}
                </p>
              </div>

              {/* Tools declaration */}
              {skill.tools && skill.tools.length > 0 && (
                <div>
                  <h4 className="text-xs font-semibold uppercase tracking-wider text-neutral-400 mb-1.5 flex items-center gap-1.5">
                    <Terminal className="size-3.5 text-gold-400" /> Công cụ / Plugins liên kết (Executable Tools)
                  </h4>
                  <div className="flex flex-wrap gap-1.5">
                    {skill.tools.map((tool) => (
                      <span key={tool} className="rounded-lg bg-neutral-800/90 border border-neutral-700 px-2.5 py-1 text-xs font-mono text-gold-300">
                        ⚡ {tool}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {/* Instructions */}
              <div>
                <h4 className="text-xs font-semibold uppercase tracking-wider text-neutral-400 mb-1.5">Hướng dẫn vận hành (Instructions Body)</h4>
                <div className="rounded-xl border border-neutral-800/80 bg-neutral-950/80 p-4 font-mono text-xs text-neutral-300 whitespace-pre-wrap leading-relaxed max-h-[320px] overflow-y-auto">
                  {skill.instructions || "(Không có hướng dẫn bổ sung)"}
                </div>
              </div>

              {/* Provenance */}
              <div className="pt-2 border-t border-neutral-800/60 flex items-center justify-between text-[11px] text-neutral-500">
                <span>Nguồn: {skill.provenance}</span>
                <span>Phân loại: {skill.category}</span>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between border-t border-neutral-800 bg-neutral-950/40 px-6 py-3.5">
          <div className="text-xs text-neutral-500">
            {isCustom ? "Skill tùy chỉnh lưu tại ~/vuaassistant/skills/" : "Kỹ năng chuẩn tích hợp sẵn"}
          </div>

          <div className="flex items-center gap-2">
            {isEditing ? (
              <>
                <Button size="sm" variant="ghost" onClick={() => setIsEditing(false)}>
                  Hủy
                </Button>
                <Button size="sm" variant="primary" onClick={handleSave} className="bg-gold-500 text-neutral-950 font-semibold hover:bg-gold-400">
                  <Save className="size-3.5 mr-1.5" /> Lưu thay đổi
                </Button>
              </>
            ) : (
              <>
                <Button size="sm" variant="ghost" onClick={onClose}>
                  Đóng
                </Button>
                {onUse && (
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => {
                      onUse(skill.prompt || skill.description, {
                        name: skill.name,
                        tools: skill.tools,
                        instructions: skill.instructions,
                      });
                      onClose();
                    }}
                    className="bg-gold-400/20 text-gold-300 hover:bg-gold-400/30 border border-gold-400/40"
                  >
                    <Wand2 className="size-3.5 mr-1.5" /> Dùng ngay trong Chat
                  </Button>
                )}
              </>
            )}
          </div>
        </div>

      </div>
    </div>
  );
}
