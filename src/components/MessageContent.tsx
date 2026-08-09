import { Fragment, type ReactNode, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { ShieldAlert, CheckCircle2, XCircle, Copy, Check, HelpCircle, Send, FileText, ExternalLink, FolderOpen } from "lucide-react";

/**
 * Provider reasoning is transport metadata, not chat content. Keeping an
 * unfinished block hidden also prevents streamed reasoning from flashing
 * briefly before its closing tag arrives.
 */
export function visibleAssistantText(content: string): string {
  if (!content) return "";
  const thinkMatch = content.match(/<think(?:ing)?\b[^>]*>([\s\S]*?)(?:<\/think(?:ing)?>|$)/i);
  const reasoning = thinkMatch ? thinkMatch[1].trim() : "";
  const cleaned = content
    .replace(/<think(?:ing)?\b[^>]*>[\s\S]*?(?:<\/think(?:ing)?>|$)/gi, "")
    .replace(/<\/?think(?:ing)?\b[^>]*>/gi, "")
    .trim();

  if (cleaned) return cleaned;
  if (reasoning) return `💭 Suy luận Agent:\n${reasoning}`;
  return content.trim();
}

export async function openExternalUrl(url: string) {
  try {
    await invoke("open_external", { url: url.trim() });
  } catch (err) {
    console.warn("Tauri open_external invoke failed, fallback to window.open:", err);
    window.open(url, "_blank", "noopener,noreferrer");
  }
}

const openLink = (e: React.MouseEvent<HTMLAnchorElement>, url: string) => {
  e.preventDefault();
  e.stopPropagation();
  void openExternalUrl(url);
};

function inlineMarkdown(value: string): ReactNode[] {
  // Regex matches: Markdown images, inline code, bold, italic, strikethrough, markdown links, bare URLs
  const regex = /(!\[[^\]]*\]\([^)]+\)|`[^`]+`|\*\*[^*]+\*\*|\*[^*]+\*|~~[^~]+~~|\[[^\]]+\]\(https?:\/\/[^\s)]+\)|https?:\/\/[^\s<]+[^<.,:;"')\s])/g;
  const parts = value.split(regex);

  return parts.map((part, index) => {
    if (!part) return null;

    // Image: ![alt](url)
    const imgMatch = part.match(/^!\[([^\]]*)\]\(([^)]+)\)$/);
    if (imgMatch) {
      const alt = imgMatch[1];
      const src = imgMatch[2];
      return (
        <img
          key={index}
          src={src}
          alt={alt || "Image"}
          className="my-2 max-h-96 rounded-xl border border-neutral-800 object-contain shadow-md"
        />
      );
    }

    // Bold: **text**
    if (part.startsWith("**") && part.endsWith("**") && part.length > 4) {
      return <strong key={index} className="font-bold text-neutral-100">{part.slice(2, -2)}</strong>;
    }

    // Italic: *text*
    if (part.startsWith("*") && part.endsWith("*") && part.length > 2) {
      return <em key={index} className="italic text-neutral-300">{part.slice(1, -1)}</em>;
    }

    // Strikethrough: ~~text~~
    if (part.startsWith("~~") && part.endsWith("~~") && part.length > 4) {
      return <del key={index} className="line-through text-neutral-500">{part.slice(2, -2)}</del>;
    }

    // Code: `code`
    if (part.startsWith("`") && part.endsWith("`") && part.length > 2) {
      return (
        <code
          key={index}
          className="rounded bg-neutral-950/90 px-1.5 py-0.5 font-mono text-[0.85em] text-gold-300 border border-gold-500/20"
        >
          {part.slice(1, -1)}
        </code>
      );
    }

    // Markdown Link: [text](url)
    const mdLinkMatch = part.match(/^\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)$/);
    if (mdLinkMatch) {
      const text = mdLinkMatch[1];
      const url = mdLinkMatch[2];
      return (
        <a
          key={index}
          href={url}
          onClick={(e) => void openLink(e, url)}
          className="text-gold-400 hover:text-gold-300 underline cursor-pointer font-medium transition-colors"
        >
          {text}
        </a>
      );
    }

    // Bare URL: https://...
    if (/^https?:\/\//.test(part)) {
      return (
        <a
          key={index}
          href={part}
          onClick={(e) => void openLink(e, part)}
          className="text-gold-400 hover:text-gold-300 underline cursor-pointer font-medium transition-colors break-all"
        >
          {part}
        </a>
      );
    }

    return <Fragment key={index}>{part}</Fragment>;
  });
}

function CodeBlock({ code, language }: { code: string; language: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    void navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="group relative my-3 overflow-hidden rounded-xl border border-neutral-800 bg-neutral-950/95 shadow-md">
      <div className="flex items-center justify-between border-b border-neutral-800/80 bg-neutral-900/60 px-3.5 py-1.5 text-xs text-neutral-400">
        <span className="font-mono text-[11px] uppercase tracking-wider text-gold-400">{language || "text"}</span>
        <button
          onClick={handleCopy}
          className="flex cursor-pointer items-center gap-1.5 rounded px-2 py-0.5 text-[11px] text-neutral-400 hover:bg-neutral-800 hover:text-neutral-200 transition-colors"
        >
          {copied ? <Check className="size-3.5 text-emerald-400" /> : <Copy className="size-3.5" />}
          <span>{copied ? "Đã chép" : "Sao chép"}</span>
        </button>
      </div>
      <pre className="overflow-x-auto p-3.5 font-mono text-xs text-neutral-200 leading-relaxed">
        <code>{code}</code>
      </pre>
    </div>
  );
}

interface MarkdownBlock {
  type: "code" | "heading" | "bullet" | "ordered" | "hr" | "blockquote" | "table" | "paragraph";
  level?: number;
  content?: string;
  language?: string;
  items?: string[];
  headers?: string[];
  rows?: string[][];
}

function parseMarkdownBlocks(text: string): MarkdownBlock[] {
  const lines = text.split("\n");
  const blocks: MarkdownBlock[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    // 1. Code Block (```lang)
    if (line.trim().startsWith("```")) {
      const language = line.trim().slice(3).trim();
      const codeLines: string[] = [];
      i++;
      while (i < lines.length && !lines[i].trim().startsWith("```")) {
        codeLines.push(lines[i]);
        i++;
      }
      blocks.push({
        type: "code",
        language,
        content: codeLines.join("\n"),
      });
      i++;
      continue;
    }

    // 2. Horizontal Rule (---, ***, ___)
    if (/^(---|[*]{3}|_{3})$/.test(line.trim())) {
      blocks.push({ type: "hr" });
      i++;
      continue;
    }

    // 3. Headings (# H1 to ###### H6)
    const headingMatch = line.match(/^(#{1,6})\s+(.+)$/);
    if (headingMatch) {
      blocks.push({
        type: "heading",
        level: headingMatch[1].length,
        content: headingMatch[2],
      });
      i++;
      continue;
    }

    // 4. Blockquote (> quote)
    if (line.startsWith("> ")) {
      blocks.push({
        type: "blockquote",
        content: line.slice(2),
      });
      i++;
      continue;
    }

    // 5. Table (| Col 1 | Col 2 |)
    if (line.trim().startsWith("|") && line.trim().endsWith("|")) {
      const tableLines: string[] = [];
      while (i < lines.length && lines[i].trim().startsWith("|") && lines[i].trim().endsWith("|")) {
        tableLines.push(lines[i]);
        i++;
      }
      if (tableLines.length >= 2) {
        const parseRow = (rowStr: string) =>
          rowStr
            .split("|")
            .slice(1, -1)
            .map((c) => c.trim());

        const headers = parseRow(tableLines[0]);
        // line 1 is divider |---|---|
        const rows = tableLines.slice(2).map(parseRow);
        blocks.push({
          type: "table",
          headers,
          rows,
        });
        continue;
      }
    }

    // 6. Bullet List (- item, * item)
    const bulletMatch = line.match(/^\s*[-*]\s+(.+)$/);
    if (bulletMatch) {
      blocks.push({
        type: "bullet",
        content: bulletMatch[1],
      });
      i++;
      continue;
    }

    // 7. Numbered List (1. item)
    const orderedMatch = line.match(/^\s*(\d+)\.\s+(.+)$/);
    if (orderedMatch) {
      blocks.push({
        type: "ordered",
        level: parseInt(orderedMatch[1], 10),
        content: orderedMatch[2],
      });
      i++;
      continue;
    }

    // 8. Paragraph
    blocks.push({
      type: "paragraph",
      content: line,
    });
    i++;
  }

  return blocks;
}

export function MessageContent({
  content,
  assistant,
  onApprovePermission,
  onAnswerQuestion,
  onApproveCapability,
}: {
  content: string;
  assistant: boolean;
  onApprovePermission?: (path: string) => Promise<void>;
  onAnswerQuestion?: (answer: string) => Promise<void>;
  onApproveCapability?: (capabilityName: string) => Promise<void>;
}) {
  const [permissionStatus, setPermissionStatus] = useState<"pending" | "approved" | "denied">("pending");
  const [approvalStatus, setApprovalStatus] = useState<"pending" | "approved" | "denied">("pending");
  const [questionStatus, setQuestionStatus] = useState<"pending" | "answered">("pending");
  const [selectedAnswer, setSelectedAnswer] = useState("");
  const [textAnswer, setTextAnswer] = useState("");
  const visible = assistant ? visibleAssistantText(content) : content;

  // Detect interactive question payload
  const interactiveQuestionMatch = visible.match(/^INTERACTIVE_QUESTION_PENDING:\s*(\{[\s\S]+\})$/);
  let questionPayload: { questionId: string; question: string; options?: string[] } | null = null;
  try {
    if (interactiveQuestionMatch) {
      questionPayload = JSON.parse(interactiveQuestionMatch[1]);
    }
  } catch {
    // Ignore parse errors
  }

  const permissionMatch = content.match(/^\[\[VUA_PERMISSION:(.+)\]\]$/);
  const legacyPermissionMatch = content.match(/^(?:Tool error: Access denied: agent tools are restricted to the assigned workspace\. )?PERMISSION_REQUEST:\s*(.+)$/);

  let detectedPath: string | null = null;

  // 1. Ưu tiên định dạng JSON VUA_PERMISSION
  try {
    if (permissionMatch) {
      const jsonPath = JSON.parse(permissionMatch[1]).path;
      if (jsonPath) {
        detectedPath = jsonPath;
      }
    }
  } catch {
    // Các envelope quyền không hợp lệ sẽ bị ẩn đi thay vì trở thành UI có thể tương tác.
  }

  // 2. Nếu chưa tìm thấy, quay lại định dạng văn bản PERMISSION_REQUEST cũ
  if (!detectedPath && legacyPermissionMatch) {
    detectedPath = legacyPermissionMatch[1];
  }

  // Detect File Payload JSON
  let filePayload: { filePath: string; fileName: string; caption?: string } | null = null;
  try {
    if (content.trim().startsWith("{") && content.trim().endsWith("}")) {
      const parsed = JSON.parse(content);
      if (parsed && typeof parsed.filePath === "string" && typeof parsed.fileName === "string") {
        filePayload = parsed;
      }
    }
  } catch {
    // Không phải JSON file payload
  }

  // Detect APPROVAL_REQUIRED
  const approvalMatch = content.match(/(?:Tool error:\s*)?APPROVAL_REQUIRED:\s*(.+)$/);
  let approvalMsg: string | null = null;
  let approvalCapabilityName = "";
  if (approvalMatch) {
    approvalMsg = approvalMatch[1];
    const firstWordMatch = approvalMsg.match(/^([a-zA-Z0-9_-]+)/);
    if (firstWordMatch && firstWordMatch[1] !== "Sếp") {
      approvalCapabilityName = firstWordMatch[1];
    } else {
      const useMatch = approvalMsg.match(/dùng\s+([a-zA-Z0-9_-]+)/);
      if (useMatch) {
        approvalCapabilityName = useMatch[1];
      } else {
        approvalCapabilityName = "hành động";
      }
    }
  }

  // Nếu detectedPath hoặc questionPayload hoặc filePayload hoặc approvalMsg có giá trị, chúng ta đang hiển thị thẻ tương tác, không cần parse markdown cho nội dung khác.
  const blocks = parseMarkdownBlocks((detectedPath || questionPayload || filePayload || approvalMsg) ? "" : visible);

  return (
    <div className="space-y-2 leading-relaxed">
      {blocks.map((block, index) => {
        switch (block.type) {
          case "code":
            return <CodeBlock key={index} code={block.content || ""} language={block.language || ""} />;

          case "hr":
            return <hr key={index} className="my-3 border-neutral-800/80" />;

          case "heading": {
            const level = block.level || 1;
            const headingText = inlineMarkdown(block.content || "");
            if (level === 1) {
              return <h1 key={index} className="mt-4 mb-2 text-base font-bold text-neutral-100 border-b border-neutral-800 pb-1">{headingText}</h1>;
            }
            if (level === 2) {
              return <h2 key={index} className="mt-3.5 mb-1.5 text-sm font-bold text-gold-400">{headingText}</h2>;
            }
            if (level === 3) {
              return <h3 key={index} className="mt-3 mb-1 text-xs font-bold uppercase tracking-wide text-gold-300">{headingText}</h3>;
            }
            if (level === 4) {
              return <h4 key={index} className="mt-2.5 mb-1 text-xs font-bold text-gold-400">{headingText}</h4>;
            }
            return <h5 key={index} className="mt-2 mb-1 text-xs font-semibold text-neutral-300">{headingText}</h5>;
          }

          case "blockquote":
            return (
              <blockquote key={index} className="my-2 border-l-2 border-gold-400 bg-neutral-950/50 py-1.5 pl-3 pr-2 text-neutral-300 italic rounded-r">
                {inlineMarkdown(block.content || "")}
              </blockquote>
            );

          case "table":
            return (
              <div key={index} className="my-3 overflow-x-auto rounded-xl border border-neutral-800 bg-neutral-950/60 shadow-xs">
                <table className="w-full text-left text-xs border-collapse">
                  {block.headers && block.headers.length > 0 && (
                    <thead>
                      <tr className="border-b border-neutral-800 bg-neutral-900/80 font-semibold text-gold-400">
                        {block.headers.map((h, hIdx) => (
                          <th key={hIdx} className="px-3 py-2 border-r last:border-r-0 border-neutral-800">
                            {inlineMarkdown(h)}
                          </th>
                        ))}
                      </tr>
                    </thead>
                  )}
                  <tbody>
                    {block.rows?.map((row, rIdx) => (
                      <tr key={rIdx} className="border-b last:border-b-0 border-neutral-800/60 hover:bg-neutral-900/40">
                        {row.map((cell, cIdx) => (
                          <td key={cIdx} className="px-3 py-1.5 border-r last:border-r-0 border-neutral-800/60 text-neutral-300">
                            {inlineMarkdown(cell)}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            );

          case "bullet":
            return (
              <div key={index} className="flex items-start gap-2 text-neutral-200">
                <span className="text-gold-400 shrink-0 select-none">•</span>
                <div className="flex-1">{inlineMarkdown(block.content || "")}</div>
              </div>
            );

          case "ordered":
            return (
              <div key={index} className="flex items-start gap-2 text-neutral-200">
                <span className="font-semibold text-gold-400 shrink-0 select-none">{block.level}.</span>
                <div className="flex-1">{inlineMarkdown(block.content || "")}</div>
              </div>
            );

          case "paragraph":
          default: {
            if (!block.content?.trim()) {
              return <div key={index} className="h-1" />;
            }
            return <p key={index} className="text-neutral-200">{inlineMarkdown(block.content)}</p>;
          }
        }
      })}

      {assistant && detectedPath && onApprovePermission && (
        <div className="my-3 rounded-xl border border-amber-500/40 bg-neutral-950/90 p-3.5 shadow-md">
          <div className="flex items-center gap-2 text-xs font-semibold text-amber-400">
            <ShieldAlert className="size-4 text-amber-400 shrink-0" />
            <span>Yêu cầu xác nhận cấp quyền truy cập</span>
          </div>
          <div className="mt-2 rounded-lg border border-neutral-800 bg-neutral-900 px-2.5 py-1.5 font-mono text-xs text-amber-200/90 break-all">
            📁 {detectedPath}
          </div>
          {permissionStatus === "pending" && (
            <>
              <p className="mt-2 text-xs text-neutral-400">
                Cho phép Agent đọc và phân tích thư mục này. Agent chỉ bắt đầu sau khi bạn duyệt.
              </p>
              <div className="mt-3 flex items-center gap-2">
                <button
                  onClick={() => {
                    setPermissionStatus("approved");
                    void onApprovePermission(detectedPath).catch(() => setPermissionStatus("denied"));
                  }}
                  className="flex cursor-pointer items-center gap-1.5 rounded-lg bg-emerald-600 px-3.5 py-1.5 text-xs font-semibold text-white shadow-xs transition-colors hover:bg-emerald-500 active:scale-95"
                >
                  <CheckCircle2 className="size-3.5" /> Cho phép đọc
                </button>
                <button
                  onClick={() => setPermissionStatus("denied")}
                  className="flex cursor-pointer items-center gap-1.5 rounded-lg border border-neutral-700 bg-neutral-800 px-3 py-1.5 text-xs font-medium text-neutral-300 transition-colors hover:bg-neutral-700"
                >
                  <XCircle className="size-3.5" /> Từ chối (Deny)
                </button>
              </div>
            </>
          )}

          {permissionStatus === "approved" && (
            <div className="mt-2 flex items-center gap-1.5 text-xs font-medium text-emerald-400">
              <CheckCircle2 className="size-4" /> Đã cấp quyền. Agent đang đọc thư mục...
            </div>
          )}

          {permissionStatus === "denied" && (
            <div className="mt-2 flex items-center gap-1.5 text-xs font-medium text-red-400">
              <XCircle className="size-4" /> Đã từ chối quyền truy cập thư mục.
            </div>
          )}
        </div>
      )}

      {assistant && questionPayload && onAnswerQuestion && (
        <div className="my-3 rounded-xl border border-gold-500/40 bg-neutral-950/90 p-3.5 shadow-md">
          <div className="flex items-center gap-2 text-xs font-semibold text-gold-400">
            <HelpCircle className="size-4 text-gold-400 shrink-0" />
            <span>Yêu cầu xác nhận thông tin (Interactive Question)</span>
          </div>
          <div className="mt-2 text-sm text-neutral-200 font-medium">
            {questionPayload.question}
          </div>

          {questionStatus === "pending" && (
            <div className="mt-3">
              {questionPayload.options && questionPayload.options.length > 0 ? (
                // Render multiple choice options
                <div className="flex flex-wrap gap-2">
                  {questionPayload.options.map((opt, oIdx) => (
                    <button
                      key={oIdx}
                      onClick={() => {
                        setSelectedAnswer(opt);
                        setQuestionStatus("answered");
                        void onAnswerQuestion(opt);
                      }}
                      className="cursor-pointer rounded-lg border border-neutral-700 bg-neutral-900 px-3.5 py-1.5 text-xs text-neutral-200 hover:border-gold-500/50 hover:bg-gold-500/10 transition-colors active:scale-95"
                    >
                      {opt}
                    </button>
                  ))}
                </div>
              ) : (
                // Render text input field
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    if (!textAnswer.trim()) return;
                    setSelectedAnswer(textAnswer);
                    setQuestionStatus("answered");
                    void onAnswerQuestion(textAnswer);
                  }}
                  className="flex items-center gap-2"
                >
                  <input
                    type="text"
                    value={textAnswer}
                    onChange={(e) => setTextAnswer(e.target.value)}
                    placeholder="Nhập câu trả lời của bạn..."
                    className="flex-1 rounded-lg border border-neutral-800 bg-neutral-900 px-3 py-1.5 text-xs text-neutral-200 focus:border-gold-500 focus:outline-none"
                  />
                  <button
                    type="submit"
                    disabled={!textAnswer.trim()}
                    className="flex cursor-pointer items-center justify-center rounded-lg bg-gold-500 px-3 py-1.5 text-xs font-semibold text-neutral-950 shadow-xs hover:bg-gold-400 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                  >
                    <Send className="size-3.5" />
                  </button>
                </form>
              )}
            </div>
          )}

          {questionStatus === "answered" && (
            <div className="mt-3 flex items-center gap-1.5 text-xs font-medium text-gold-400 bg-gold-500/5 border border-gold-500/20 rounded-lg px-2.5 py-1.5">
              <Check className="size-4 shrink-0 text-emerald-400" />
              <span>Đã trả lời: <strong className="text-neutral-100">{selectedAnswer}</strong>. Agent đang tiếp tục xử lý...</span>
            </div>
          )}
        </div>
      )}

      {assistant && filePayload && (
        <div className="my-3 rounded-xl border border-neutral-800 bg-neutral-950/90 p-4 shadow-md max-w-md select-none">
          <div className="flex items-start gap-3">
            <div className="flex size-10 items-center justify-center rounded-xl bg-gold-500/10 text-gold-400 border border-gold-500/25 shrink-0">
              <FileText className="size-5" />
            </div>
            <div className="flex-1 min-w-0">
              <h4 className="text-sm font-semibold text-neutral-100 truncate" title={filePayload.fileName}>
                {filePayload.fileName}
              </h4>
              {filePayload.caption && (
                <p className="mt-1 text-xs text-neutral-400 leading-normal">
                  {filePayload.caption}
                </p>
              )}
              <div className="mt-1 text-[10px] text-neutral-500 truncate" title={filePayload.filePath}>
                Đường dẫn: {filePayload.filePath}
              </div>
            </div>
          </div>
          <div className="mt-4 flex items-center gap-2 border-t border-neutral-900 pt-3">
            <button
              onClick={() => {
                void openExternalUrl(filePayload!.filePath);
              }}
              className="flex cursor-pointer items-center gap-1.5 rounded-lg bg-gold-500 hover:bg-gold-400 px-3.5 py-1.5 text-xs font-semibold text-neutral-950 transition-all active:scale-95"
            >
              <ExternalLink className="size-3.5" /> Mở tệp tin
            </button>
            <button
              onClick={() => {
                const pathStr = filePayload!.filePath;
                const lastSlash = Math.max(pathStr.lastIndexOf("/"), pathStr.lastIndexOf("\\"));
                const folderPath = lastSlash > 0 ? pathStr.substring(0, lastSlash) : pathStr;
                void openExternalUrl(folderPath);
              }}
              className="flex cursor-pointer items-center gap-1.5 rounded-lg border border-neutral-700 bg-neutral-900 hover:bg-neutral-850 px-3.5 py-1.5 text-xs font-medium text-neutral-300 transition-colors"
            >
              <FolderOpen className="size-3.5" /> Mở thư mục
            </button>
          </div>
        </div>
      )}

      {assistant && approvalMsg && onApproveCapability && (
        <div className="my-3 rounded-xl border border-amber-500/40 bg-neutral-950/90 p-3.5 shadow-md select-none">
          <div className="flex items-center gap-2 text-xs font-semibold text-amber-400">
            <ShieldAlert className="size-4 text-amber-400 shrink-0" />
            <span>Yêu cầu duyệt hành động bảo mật</span>
          </div>
          <div className="mt-2 rounded-lg border border-neutral-800 bg-neutral-900/60 px-3 py-2 text-xs text-neutral-200 leading-relaxed">
            {approvalMsg}
          </div>
          {approvalStatus === "pending" && (
            <>
              <p className="mt-2 text-xs text-neutral-400">
                Hãy xác nhận duyệt để Agent tiếp tục thực thi hành động này.
              </p>
              <div className="mt-3 flex items-center gap-2">
                <button
                  onClick={() => {
                    setApprovalStatus("approved");
                    void onApproveCapability(approvalCapabilityName).catch(() => setApprovalStatus("denied"));
                  }}
                  className="flex cursor-pointer items-center gap-1.5 rounded-lg bg-emerald-600 px-3.5 py-1.5 text-xs font-semibold text-white shadow-xs transition-colors hover:bg-emerald-500 active:scale-95"
                >
                  <CheckCircle2 className="size-3.5" /> Đồng ý thực thi
                </button>
                <button
                  onClick={() => setApprovalStatus("denied")}
                  className="flex cursor-pointer items-center gap-1.5 rounded-lg border border-neutral-700 bg-neutral-800 px-3 py-1.5 text-xs font-medium text-neutral-300 transition-colors hover:bg-neutral-700"
                >
                  <XCircle className="size-3.5" /> Từ chối
                </button>
              </div>
            </>
          )}

          {approvalStatus === "approved" && (
            <div className="mt-2 flex items-center gap-1.5 text-xs font-medium text-emerald-400">
              <CheckCircle2 className="size-4" /> Đã duyệt hành động. Agent đang chạy tiếp...
            </div>
          )}

          {approvalStatus === "denied" && (
            <div className="mt-2 flex items-center gap-1.5 text-xs font-medium text-red-400">
              <XCircle className="size-4" /> Đã từ chối thực thi hành động này.
            </div>
          )}
        </div>
      )}
    </div>
  );
}
