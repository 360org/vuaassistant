import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Check, ChevronDown, ChevronUp, CornerUpLeft, Eraser, FileText, FolderOpen, Layers3, Loader2, Maximize2, Minimize2, Paperclip, Pencil, Plus, RotateCcw, Search, SendHorizonal, Square, Trash2, UploadCloud, Wand2, X, ClipboardList, CheckCircle2, Bot } from "lucide-react";
import { useApp, fileObjectURLs } from "@/lib/store";
import { SKILLS, parseSkillMd, toTemplate, type SkillTemplate } from "@/lib/skills";
import { getKnowledgeFileRecord } from "@/runtime/knowledge";
import {
  type ProviderConfig,
} from "@/runtime/providers";
import { createEngine, newMessageId, type ChatMessage } from "@/runtime/engine";
import {
  AI_ROUTER_BASE_URL,
  deleteAiRouterPack,
  getAiRouterModels,
  saveAiRouterPack,
  type AiRouterModel,
} from "@/runtime/aiRouter";
import { Logo } from "@/components/Logo";
import { ChatSessionMenu } from "@/components/ChatSessionMenu";
import { MessageContent, visibleAssistantText } from "@/components/MessageContent";
import { cn } from "@/lib/utils";

const engine = createEngine();

function PortalWhen({ enabled, children }: { enabled: boolean; children: ReactNode }) {
  return enabled ? createPortal(children, document.body) : <>{children}</>;
}

import { InlineAttachmentPreview } from "@/components/chat/InlineAttachmentPreview";
import { KnowledgeManagerDrawer } from "@/components/chat/KnowledgeManagerDrawer";
import { FilePreviewModal } from "@/components/chat/modals/FilePreviewModal";

export function Chat() {
  const [sentFileIds, setSentFileIds] = useState<Set<string>>(new Set());
  const [previewFile, setPreviewFile] = useState<{ id: string; name: string } | null>(null);
  const [showSearch, setShowSearch] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [showSharedMedia, setShowSharedMedia] = useState(false);
  const [showTasksPanel, setShowTasksPanel] = useState(true);
  const [mediaTab, setMediaTab] = useState<"media" | "link" | "docs">("media");

  const {
    user,
    messages,
    setMessages,
    clearChat,
    chatSessions,
    activeSessionId,
    createChatSession,
    switchChatSession,
    renameChatSession,
    deleteChatSession,
    installedAgents,
    activeAgentId,
    setActiveAgent,
    chatDraft,
    consumeChatDraft,
    activeSkill,
    clearActiveSkill,
    useSkill,
    customSkills,
    installedEngineSkills,
    agentConfigs,
    knowledgeFiles,
    addKnowledgeFiles,
    removeKnowledgeFile,
    agents,
    activeBackgroundTasks,
    stopBackgroundTask,
    activeSessionTasks,
  } = useApp();
  const [input, setInput] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [streaming, setStreaming] = useState(false);
  const [agentPickerOpen, setAgentPickerOpen] = useState(false);
  const [skillPickerOpen, setSkillPickerOpen] = useState(false);
  const skillPickerRef = useRef<HTMLDivElement>(null);
  const [showSlashMenu, setShowSlashMenu] = useState(false);
  const [slashQuery, setSlashQuery] = useState("");

  const availableSkillTemplates = useMemo<SkillTemplate[]>(() => {
    const custom = customSkills.flatMap((c) => {
      try {
        return [toTemplate(parseSkillMd(c.raw))];
      } catch {
        return [];
      }
    });

    const all = [...SKILLS, ...custom];

    // Rule: ONLY skills that are explicitly installed/enabled by the user
    const enabledOnly = all.filter((s) => installedEngineSkills.includes(s.id));

    if (!activeAgentId) return enabledOnly;
    const config = agentConfigs[activeAgentId];
    if (!config || !config.skills) return enabledOnly;
    return enabledOnly.filter((s) => config.skills!.includes(s.id));
  }, [customSkills, installedEngineSkills, activeAgentId, agentConfigs]);

  const filteredSlashSkills = useMemo(() => {
    if (!slashQuery) return availableSkillTemplates;
    const q = slashQuery.toLowerCase();
    return availableSkillTemplates.filter(
      (s) =>
        s.name.toLowerCase().includes(q) ||
        s.id.toLowerCase().includes(q) ||
        s.description.toLowerCase().includes(q)
    );
  }, [availableSkillTemplates, slashQuery]);

  const activateSkillTemplate = (sk: SkillTemplate) => {
    useSkill(sk.prompt || `Hãy sử dụng kỹ năng "${sk.name}" để hỗ trợ tôi: `, {
      name: sk.name,
      tools: sk.tools,
      instructions: sk.instructions,
    });
    if (sk.prompt) setInput(sk.prompt);
    else setInput("");
    setShowSlashMenu(false);
    setSkillPickerOpen(false);
  };
  const [modelPickerOpen, setModelPickerOpen] = useState(false);
  const [routerModels, setRouterModels] = useState<AiRouterModel[]>([]);
  const [modelLoadError, setModelLoadError] = useState<string | null>(null);
  const [activeModel, setActiveModel] = useState(() => localStorage.getItem("vua:ai-router-model") ?? "");
  const [packEditorOpen, setPackEditorOpen] = useState(false);
  const [packExpanded, setPackExpanded] = useState(false);
  const [editingPackId, setEditingPackId] = useState<string | null>(null);
  const [packName, setPackName] = useState("");
  const [packModels, setPackModels] = useState<string[]>([]);
  const [packStrategy, setPackStrategy] = useState<"fallback" | "round-robin">("fallback");
  const [packAccountFilters, setPackAccountFilters] = useState<string[]>([]);
  const [packError, setPackError] = useState<string | null>(null);
  const selectedModel = routerModels.find((model) => model.id === activeModel);
  const modelLabel = selectedModel
    ? `${selectedModel.name}${selectedModel.accountLabel ? ` · ${selectedModel.accountLabel}` : ""}`
    : activeModel;
  const packOptions = routerModels.filter((model) => model.kind === "pack");
  const individualModels = routerModels.filter((model) => model.kind !== "pack");
  const connectedModelAccounts = useMemo(() => {
    const accounts = new Map<string, { id: string; provider: string; label: string; count: number }>();
    for (const model of individualModels) {
      if (!model.connectionId) continue;
      const current = accounts.get(model.connectionId);
      accounts.set(model.connectionId, {
        id: model.connectionId,
        provider: model.provider || "AI",
        label: model.accountLabel || "Account",
        count: (current?.count || 0) + 1,
      });
    }
    return [...accounts.values()];
  }, [individualModels]);
  const filteredPackModels = individualModels.filter((model) =>
    !packExpanded || !model.connectionId || packAccountFilters.includes(model.connectionId)
  );
  const routerConfig: ProviderConfig = {
    baseUrl: AI_ROUTER_BASE_URL,
    model: activeModel,
    router: true,
    connectionStatus: "connected",
  };
  const bottomRef = useRef<HTMLDivElement>(null);
  const composerRef = useRef<HTMLTextAreaElement>(null);
  const agentPickerRef = useRef<HTMLDivElement>(null);
  const [taskExpanded, setTaskExpanded] = useState(true);
  const [isComposerExpanded, setIsComposerExpanded] = useState(false);
  const chatAbortControllerRef = useRef<AbortController | null>(null);
  const [isDraggingOver, setIsDraggingOver] = useState(false);

  const processDroppedPaths = useCallback((paths: string[], files: File[]) => {
    const folderPaths: string[] = [];
    const regularFiles: File[] = [];

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const p = (file as any).path || (file as any).webkitRelativePath || file.name;
      if (!file.type && (file.size === 0 || file.size % 4096 === 0)) {
        folderPaths.push(p);
      } else {
        regularFiles.push(file);
      }
    }

    for (const p of paths) {
      if (!folderPaths.includes(p)) {
        folderPaths.push(p);
      }
    }

    if (regularFiles.length > 0) {
      addKnowledgeFiles(regularFiles);
    }

    if (folderPaths.length > 0) {
      const pathText = folderPaths.map((p) => `📁 ${p}`).join("\n");
      setInput((prev) => {
        const prefix = prev.trim() ? prev + "\n\n" : "";
        return `${prefix}Thư mục/File làm việc:\n${pathText}\n\nYêu cầu công việc: `;
      });
      setTimeout(() => composerRef.current?.focus(), 100);
    }
  }, [addKnowledgeFiles]);

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (!isDraggingOver) setIsDraggingOver(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.currentTarget.contains(e.relatedTarget as Node)) return;
    setIsDraggingOver(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDraggingOver(false);

    const files = Array.from(e.dataTransfer.files || []);
    const items = Array.from(e.dataTransfer.items || []);
    const extractedPaths: string[] = [];

    for (const item of items) {
      const entry = item.webkitGetAsEntry ? item.webkitGetAsEntry() : null;
      const file = item.getAsFile();
      const p = (file as any)?.path;
      if (entry?.isDirectory && p) {
        extractedPaths.push(p);
      }
    }

    processDroppedPaths(extractedPaths, files);
  };

  useEffect(() => {
    if (typeof window === "undefined" || !("__TAURI_INTERNALS__" in window)) return;
    let unlistenDrop: (() => void) | undefined;
    let unlistenOver: (() => void) | undefined;
    let unlistenLeave: (() => void) | undefined;

    void import("@tauri-apps/api/event").then(({ listen }) => {
      listen<{ paths: string[] }>("tauri://drag-drop", (e) => {
        setIsDraggingOver(false);
        const paths = e.payload?.paths || [];
        if (paths.length > 0) {
          processDroppedPaths(paths, []);
        }
      }).then((un) => { unlistenDrop = un; });

      listen("tauri://drag-over", () => setIsDraggingOver(true)).then((un) => { unlistenOver = un; });
      listen("tauri://drag-leave", () => setIsDraggingOver(false)).then((un) => { unlistenLeave = un; });
    }).catch(() => {});

    return () => {
      unlistenDrop?.();
      unlistenOver?.();
      unlistenLeave?.();
    };
  }, [processDroppedPaths]);

  const activeAgent = useMemo(
    () => agents.find((a) => a.id === activeAgentId) ?? null,
    [agents, activeAgentId],
  );
  const installedAgentList = useMemo(
    () => agents.filter((a) => installedAgents.includes(a.id)),
    [agents, installedAgents],
  );
  const refreshRouterModels = useCallback(() => {
    const controller = new AbortController();
    void getAiRouterModels(controller.signal)
      .then((models) => {
        setRouterModels(models);
        setModelLoadError(null);
        setActiveModel((current) => current && models.some((model) => model.id === current)
          ? current
          : models[0]?.id ?? "");
      })
      .catch((error) => {
        if (controller.signal.aborted) return;
        setModelLoadError(error instanceof Error ? error.message : String(error));
      });
    return controller;
  }, []);

  useEffect(() => {
    let activeController = refreshRouterModels();
    const refresh = () => {
      activeController.abort();
      activeController = refreshRouterModels();
    };
    const interval = window.setInterval(refresh, 15_000);
    window.addEventListener("focus", refresh);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener("focus", refresh);
      activeController.abort();
    };
  }, [refreshRouterModels]);

  useEffect(() => {
    if (activeModel) localStorage.setItem("vua:ai-router-model", activeModel);
  }, [activeModel]);

  const openPackEditor = (pack?: AiRouterModel) => {
    setEditingPackId(pack?.id.startsWith("pack:") ? pack.id.slice(5) : null);
    setPackName(pack?.name ?? "");
    // Only keep ids a checkbox can represent. A pack saved against an account
    // that has since gone away would otherwise load ids with no matching row:
    // they stayed in the selection invisibly, no amount of clicking removed
    // them, and every save was refused for "a model without a Verified
    // connection". The router re-binds stale pins, so anything still unmatched
    // here is genuinely gone.
    const selectable = new Set(individualModels.map((model) => model.id));
    setPackModels((pack?.models ?? []).filter((id) => selectable.has(id)));
    setPackStrategy(pack?.strategy ?? "fallback");
    setPackAccountFilters(connectedModelAccounts.map((account) => account.id));
    setPackError(null);
    setPackExpanded(false);
    setPackEditorOpen(true);
  };

  const savePack = async () => {
    setPackError(null);
    try {
      await saveAiRouterPack({
        id: editingPackId ?? undefined,
        name: packName.trim(),
        models: packModels,
        strategy: packStrategy,
        stickyLimit: 1,
        autoSwitch: true,
      });
      setPackEditorOpen(false);
      refreshRouterModels();
    } catch (error) {
      setPackError(error instanceof Error ? error.message : String(error));
    }
  };

  const removePack = async (pack: AiRouterModel) => {
    if (!pack.id.startsWith("pack:")) return;
    try {
      await deleteAiRouterPack(pack.id.slice(5));
      refreshRouterModels();
    } catch (error) {
      setModelLoadError(error instanceof Error ? error.message : String(error));
    }
  };

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.length, streaming]);

  useEffect(() => {
    if (!agentPickerOpen) return;
    const closeOnOutsidePointer = (event: PointerEvent) => {
      if (!agentPickerRef.current?.contains(event.target as Node)) {
        setAgentPickerOpen(false);
      }
    };
    window.addEventListener("pointerdown", closeOnOutsidePointer);
    return () => window.removeEventListener("pointerdown", closeOnOutsidePointer);
  }, [agentPickerOpen]);

  useEffect(() => {
    if (!skillPickerOpen) return;
    const closeOnOutsidePointer = (event: PointerEvent) => {
      if (!skillPickerRef.current?.contains(event.target as Node)) {
        setSkillPickerOpen(false);
      }
    };
    window.addEventListener("pointerdown", closeOnOutsidePointer);
    return () => window.removeEventListener("pointerdown", closeOnOutsidePointer);
  }, [skillPickerOpen]);

  // A skill was used: pre-fill the composer and put the cursor at the end.
  useEffect(() => {
    if (chatDraft === null) return;
    setInput(chatDraft);
    consumeChatDraft();
    const el = composerRef.current;
    if (el) {
      el.focus();
      el.setSelectionRange(chatDraft.length, chatDraft.length);
    }
  }, [chatDraft, consumeChatDraft]);

  const sharedMediaItems = useMemo(() => {
    const mediaList: { id: string; name: string; date: string; dataUrl?: string }[] = [];
    const linkList: { url: string; date: string }[] = [];
    const docList: { id: string; name: string; date: string }[] = [];

    const imgExtensions = ["png", "jpg", "jpeg", "gif", "webp", "svg", "bmp", "tiff", "heic", "heif"];
    const urlRegex = /(https?:\/\/[^\s<">]+)/g;

    messages.forEach((m) => {
      const dateStr = new Date(m.createdAt).toLocaleDateString("vi-VN", {
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
      });

      const matches = m.content.match(urlRegex);
      if (matches) {
        matches.forEach((u) => {
          if (!linkList.some((l) => l.url === u)) {
            linkList.push({ url: u, date: dateStr });
          }
        });
      }

      if (m.attachments) {
        m.attachments.forEach((att) => {
          const ext = att.name.toLowerCase().split(".").pop() ?? "";
          if (imgExtensions.includes(ext)) {
            if (!mediaList.some((item) => item.id === att.id)) {
              mediaList.push({
                id: att.id,
                name: att.name,
                date: dateStr,
                dataUrl: att.dataUrl || fileObjectURLs.get(att.id),
              });
            }
          } else {
            if (!docList.some((item) => item.id === att.id)) {
              docList.push({ id: att.id, name: att.name, date: dateStr });
            }
          }
        });
      }
    });

    knowledgeFiles.forEach((f) => {
      if (f.status === "ready") {
        const ext = f.name.toLowerCase().split(".").pop() ?? "";
        const dateStr = new Date().toLocaleDateString("vi-VN");
        if (imgExtensions.includes(ext)) {
          if (!mediaList.some((item) => item.id === f.id)) {
            mediaList.push({
              id: f.id,
              name: f.name,
              date: dateStr,
              dataUrl: fileObjectURLs.get(f.id),
            });
          }
        } else {
          if (!docList.some((item) => item.id === f.id)) {
            docList.push({ id: f.id, name: f.name, date: dateStr });
          }
        }
      }
    });

    return { media: mediaList, links: linkList, docs: docList };
  }, [messages, knowledgeFiles]);

  const filteredMessages = useMemo(() => {
    if (!searchQuery.trim()) return messages;
    const q = searchQuery.toLowerCase();
    return messages.filter(
      (m) =>
        m.content.toLowerCase().includes(q) ||
        m.attachments?.some((att) => att.name.toLowerCase().includes(q))
    );
  }, [messages, searchQuery]);

  const approveReadPath = async (path: string) => {
    const { invoke } = await import("@tauri-apps/api/core");
    await invoke<string>("grant_agent_read_path", { path });
    const request = [...messages].reverse().find(
      (message) => message.role === "user" && message.content.includes(path),
    );
    await send(request?.content ?? `Đã duyệt quyền đọc thư mục: 📁 ${path}. Hãy tiếp tục yêu cầu trước đó.`, true);
  };

  const approveCapability = async (capabilityName: string) => {
    await send(`Đã phê duyệt thực thi hành động ${capabilityName}. Hãy tiếp tục và gọi lại execute_capability với approved=true.`, true);
  };

  const answerQuestion = async (answer: string) => {
    await send(answer, true);
  };

  const send = async (customText?: string, resend = false) => {
    if (!user) {
      alert("Bạn chưa đăng nhập người dùng local. Vui lòng đăng nhập tài khoản để Chat!");
      return;
    }
    const readyFiles = knowledgeFiles.filter((f) => !sentFileIds.has(f.id) && f.status === "ready");
    const textContent = typeof customText === "string" ? customText.trim() : input.trim();
    if ((!textContent && readyFiles.length === 0) || streaming || !activeModel) return;

    setInput("");

    // 1. Trích xuất bản ghi (b64 dataUrl cho ảnh & text chunks cho PDF/văn bản) TRƯỚC KHI dọn dẹp readyFiles
    const fileRecords = await Promise.all(
      readyFiles.map(async (f) => {
        let b64 = "";
        let chunks: string[] = [];
        try {
          const rec = await getKnowledgeFileRecord(f.id);
          if (rec) {
            b64 = rec.dataUrl || "";
            chunks = rec.chunks || [];
          }
        } catch {
          /* ignore */
        }

        // Nếu fileObjectURLs đã lưu sẵn base64 data:image
        const storedUrl = fileObjectURLs.get(f.id);
        if (!b64 && storedUrl && storedUrl.startsWith("data:")) {
          b64 = storedUrl;
        }

        return { file: f, b64, chunks };
      }),
    );

    // 2. Xây dựng nội dung văn bản kèm nội dung trích xuất từ PDF / tệp văn bản (loại trừ tệp ảnh)
    const imgExtensions = ["png", "jpg", "jpeg", "gif", "webp", "svg", "bmp"];
    const attachedTexts: string[] = [];
    fileRecords.forEach(({ file, chunks }) => {
      const ext = file.name.toLowerCase().split(".").pop() ?? "";
      if (!imgExtensions.includes(ext) && chunks && chunks.length > 0) {
        const fullText = chunks.join("\n").trim();
        if (fullText) {
          attachedTexts.push(`--- [Nội dung tệp: ${file.name}] ---\n${fullText}`);
        }
      }
    });

    let content = textContent;
    if (readyFiles.length > 0) {
      const fileNames = readyFiles.map((f) => f.name).join(", ");
      const header = textContent ? `${textContent}\n\n📎 Đã gửi tệp: ${fileNames}` : `📎 Đã gửi tệp: ${fileNames}`;
      if (attachedTexts.length > 0) {
        content = `${header}\n\n${attachedTexts.join("\n\n")}`;
      } else {
        content = header;
      }
    }

    // 3. Đính kèm danh sách tệp với Base64 Data URL hợp lệ (chỉ chấp nhận data:, loại bỏ hoàn toàn blob:)
    const resolvedAttachments = fileRecords.map(({ file, b64 }) => ({
      id: file.id,
      name: file.name,
      dataUrl: b64.startsWith("data:") ? b64 : undefined,
    }));

    // 4. Sau khi trích xuất dữ liệu xong mới đánh dấu đã gửi & dọn dẹp state
    if (readyFiles.length > 0) {
      setSentFileIds((prev) => new Set([...prev, ...readyFiles.map((f) => f.id)]));
      readyFiles.forEach((f) => removeKnowledgeFile(f.id));
    }

    const userMessage: ChatMessage = {
      id: newMessageId(),
      role: "user",
      content,
      createdAt: Date.now(),
      attachments: resolvedAttachments,
    };
    const assistantId = newMessageId();
    const history = resend
      ? [...messages, { id: assistantId, role: "assistant" as const, content: "", createdAt: Date.now() }]
      : [...messages, userMessage, { id: assistantId, role: "assistant" as const, content: "", createdAt: Date.now() }];
    setMessages(history);

    setStreaming(true);
    const controller = new AbortController();
    chatAbortControllerRef.current = controller;
    let rawReplyText = "";
    try {
      for await (const chunk of engine.chat(history, {
        provider: "openrouter",
        config: routerConfig,
        agentName: activeAgent?.name,
        agentDescription: activeAgent?.description,
        agentInstructions: activeAgent
          ? agentConfigs[activeAgent.id]?.instructions
          : undefined,
        agentSoul: activeAgent
          ? agentConfigs[activeAgent.id]?.soul
          : undefined,
        agentMemory: activeAgent
          ? agentConfigs[activeAgent.id]?.memory
          : undefined,
        agentKnowledge: knowledgeFiles
          .filter((f) => f.status === "ready")
          .map((f) => f.name),
        agentId: activeAgent?.id,
        sessionId: activeSessionId ?? undefined,
        skillName: activeSkill?.name,
        skillTools: activeSkill?.tools,
        skillInstructions: activeSkill?.instructions,
      })) {
        if (controller.signal.aborted) break;
        rawReplyText += chunk;
        setMessages((prev) =>
          prev.map((m) =>
            m.id === assistantId
              ? { ...m, content: visibleAssistantText(rawReplyText) }
              : m,
          ),
        );
      }
      // Reflection now runs in the Host Process (agent-runner/src/memory/
      // self-improve.ts) so a Telegram conversation teaches the role too, and
      // so closing the window does not stop it.
    } catch (error) {
      if (!controller.signal.aborted) {
        const note = `⚠️ ${error instanceof Error ? error.message : String(error)}`;
        setMessages((prev) =>
          prev.map((m) =>
            m.id === assistantId
              ? { ...m, content: m.content ? `${m.content}\n\n${note}` : note }
              : m,
          ),
        );
      }
    } finally {
      chatAbortControllerRef.current = null;
      setStreaming(false);
    }
  };

  return (
    <div className="flex h-full flex-col">

      {/* Header: agent context + model catalog supplied by AI Router. */}
      <header className="flex items-center justify-between gap-2 border-b border-neutral-800 px-3 py-3 sm:px-6">
        <div className="flex min-w-0 items-center gap-2">
          <span className="truncate text-sm font-semibold">
            {activeAgent ? `${activeAgent.emoji} ${activeAgent.name}` : "Chat"}
          </span>
          <ChatSessionMenu
            sessions={chatSessions}
            activeSessionId={activeSessionId}
            disabled={streaming}
            onCreate={createChatSession}
            onSwitch={switchChatSession}
            onRename={renameChatSession}
            onDelete={deleteChatSession}
          />
          {installedAgentList.length > 0 && (
            <div ref={agentPickerRef} className="relative shrink-0">
              <button
                type="button"
                aria-haspopup="menu"
                aria-expanded={agentPickerOpen}
                onClick={() => setAgentPickerOpen((open) => !open)}
                className="flex h-8 max-w-44 cursor-pointer items-center gap-1.5 rounded-lg border border-neutral-800 bg-neutral-900 px-2.5 text-xs text-neutral-200 transition-colors hover:border-neutral-700 hover:bg-neutral-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-gold-400/70"
                title="Switch assistant role"
              >
                <span className="truncate">{activeAgent ? activeAgent.name : "General assistant"}</span>
                <ChevronDown className={`size-3.5 shrink-0 text-neutral-400 transition-transform ${agentPickerOpen ? "rotate-180" : ""}`} />
              </button>
              {agentPickerOpen && (
                <div
                  role="menu"
                  className="absolute left-0 top-10 z-50 w-72 overflow-hidden rounded-lg border border-neutral-800 bg-neutral-950 p-1 shadow-2xl shadow-black/50"
                >
                  <button
                    role="menuitem"
                    type="button"
                    onClick={() => {
                      setActiveAgent(null);
                      setAgentPickerOpen(false);
                    }}
                    className="flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-sm text-neutral-300 transition-colors hover:bg-neutral-900"
                  >
                    <span className="flex size-7 items-center justify-center rounded-md bg-neutral-800 text-xs">AI</span>
                    <span className="min-w-0 flex-1">
                      <span className="block font-medium">General assistant</span>
                      <span className="block truncate text-xs text-neutral-500">No specialized role</span>
                    </span>
                    {!activeAgent && <Check className="size-4 text-gold-300" />}
                  </button>
                  <div className="my-1 border-t border-neutral-800" />
                  {installedAgentList.map((agent) => {
                    const selected = agent.id === activeAgentId;
                    return (
                      <button
                        key={agent.id}
                        role="menuitem"
                        type="button"
                        onClick={() => {
                          setActiveAgent(agent.id);
                          setAgentPickerOpen(false);
                        }}
                        className={`flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left transition-colors hover:bg-neutral-900 ${selected ? "bg-gold-400/10" : ""}`}
                      >
                        <span className="flex size-7 shrink-0 items-center justify-center rounded-md bg-neutral-800 text-base">{agent.emoji}</span>
                        <span className="min-w-0 flex-1">
                          <span className={`block truncate text-sm font-medium ${selected ? "text-gold-200" : "text-neutral-200"}`}>{agent.name}</span>
                          <span className="block truncate text-xs text-neutral-500">{agent.description}</span>
                        </span>
                        {selected && <Check className="size-4 shrink-0 text-gold-300" />}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          )}
          
          {/* Skill Picker dropdown in Header */}
          <div ref={skillPickerRef} className="relative shrink-0">
            <button
              type="button"
              aria-haspopup="menu"
              aria-expanded={skillPickerOpen}
              onClick={() => setSkillPickerOpen((open) => !open)}
              className={cn(
                "flex h-8 max-w-44 cursor-pointer items-center gap-1.5 rounded-lg border px-2.5 text-xs transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-gold-400/70",
                activeSkill
                  ? "border-gold-400/50 bg-gold-400/15 text-gold-300 font-medium hover:border-gold-400"
                  : "border-neutral-800 bg-neutral-900 text-neutral-300 hover:border-neutral-700 hover:bg-neutral-800"
              )}
              title="Chọn hoặc kích hoạt Kỹ năng (Skill)"
            >
              <Wand2 className="size-3.5 text-gold-400 shrink-0" />
              <span className="truncate">{activeSkill ? activeSkill.name : "Kỹ năng..."}</span>
              <ChevronDown className={cn("size-3.5 shrink-0 text-neutral-400 transition-transform", skillPickerOpen && "rotate-180")} />
            </button>
            {skillPickerOpen && (
              <div
                role="menu"
                className="absolute left-0 top-10 z-50 w-72 max-h-80 overflow-y-auto rounded-xl border border-neutral-800 bg-neutral-950 p-1 shadow-2xl shadow-black/50"
              >
                <div className="px-2.5 py-1.5 text-[11px] font-semibold text-neutral-500 uppercase tracking-wider">
                  Kỹ năng khả dụng ({availableSkillTemplates.length})
                </div>
                {activeSkill && (
                  <button
                    type="button"
                    onClick={() => {
                      clearActiveSkill();
                      setSkillPickerOpen(false);
                    }}
                    className="flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-xs font-medium text-rose-400 hover:bg-rose-500/10 mb-1 cursor-pointer"
                  >
                    <X className="size-3.5" />
                    <span>Tắt kỹ năng hiện tại</span>
                  </button>
                )}
                {availableSkillTemplates.map((sk) => {
                  const isSelected = activeSkill?.name === sk.name;
                  return (
                    <button
                      key={sk.id}
                      type="button"
                      onClick={() => activateSkillTemplate(sk)}
                      className={cn(
                        "flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-xs transition-colors hover:bg-neutral-900 cursor-pointer",
                        isSelected && "bg-gold-400/10 text-gold-300 font-medium"
                      )}
                    >
                      <span className="text-base shrink-0">{sk.emoji}</span>
                      <span className="min-w-0 flex-1">
                        <span className="block font-medium truncate text-neutral-200">{sk.name}</span>
                        <span className="block truncate text-[11px] text-neutral-500">{sk.description}</span>
                      </span>
                      {isSelected && <Check className="size-3.5 text-gold-400 shrink-0" />}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-1">
          {routerModels.length > 0 && (
            <div className="relative">
              <button
                onClick={() => {
                  setModelPickerOpen((o) => !o);
                }}
                className="flex max-w-[10rem] cursor-pointer items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs text-neutral-400 hover:bg-neutral-800"
                title={activeModel}
              >
                <span className="truncate">{modelLabel}</span>
                <ChevronDown className="size-3.5 shrink-0" />
              </button>
              {modelPickerOpen && (
                <div className="absolute right-0 top-full z-10 mt-1 max-h-[70vh] w-64 overflow-y-auto rounded-xl border border-neutral-800 bg-neutral-900 p-1 shadow-xl">
                  <div className="flex items-center justify-between px-3 pb-1 pt-2">
                    <span className="text-[10px] font-semibold uppercase text-gold-300">Packs</span>
                    <button
                      onClick={() => openPackEditor()}
                      title="Add pack"
                      className="cursor-pointer rounded p-1 text-neutral-500 hover:bg-neutral-800 hover:text-gold-300"
                    >
                      <Plus className="size-3.5" />
                    </button>
                  </div>
                  {packOptions.map((m) => (
                    <button
                      key={m.id}
                      onClick={() => {
                        setActiveModel(m.id);
                        setModelPickerOpen(false);
                      }}
                      className={cn(
                        "block w-full cursor-pointer rounded-lg px-3 py-2 text-left text-xs hover:bg-neutral-800",
                        activeModel === m.id ? "text-gold-300" : "text-neutral-300",
                      )}
                    >
                      <span className="flex items-center gap-2 font-medium">
                        <Layers3 className="size-3.5" />
                        <span className="min-w-0 flex-1 truncate">{m.name}</span>
                        <span
                          role="button"
                          tabIndex={0}
                          title="Edit pack"
                          onClick={(event) => { event.stopPropagation(); openPackEditor(m); }}
                          className="rounded p-1 text-neutral-500 hover:bg-neutral-700 hover:text-neutral-200"
                        ><Pencil className="size-3" /></span>
                        <span
                          role="button"
                          tabIndex={0}
                          title="Delete pack"
                          onClick={(event) => { event.stopPropagation(); void removePack(m); }}
                          className="rounded p-1 text-neutral-500 hover:bg-neutral-700 hover:text-red-400"
                        ><Trash2 className="size-3" /></span>
                      </span>
                      <span className="block font-mono text-[10px] text-neutral-500">
                        {m.models?.length || 0} models · {m.strategy || "fallback"}
                      </span>
                    </button>
                  ))}
                  {packEditorOpen && (
                    <PortalWhen enabled={packExpanded}>
                      <div
                        className={cn(
                          packExpanded
                            ? "fixed inset-0 z-[9999] flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm"
                            : "m-1",
                        )}
                        onClick={() => {
                          if (packExpanded) setPackExpanded(false);
                        }}
                      >
                      <div
                        className={cn(
                          "border border-neutral-700 bg-neutral-950 shadow-2xl",
                          packExpanded
                            ? "flex h-[min(48rem,calc(100vh-2rem))] w-[min(72rem,calc(100vw-2rem))] flex-col p-4"
                            : "p-3",
                        )}
                        onClick={(event) => event.stopPropagation()}
                      >
                      <div className="flex items-center justify-between gap-3">
                        <span className="text-xs font-medium">{editingPackId ? "Edit pack" : "New pack"}</span>
                        <div className="flex items-center gap-1">
                          <button
                            onClick={() => setPackExpanded((expanded) => !expanded)}
                            title={packExpanded ? "Collapse pack editor" : "Expand pack editor"}
                            className="cursor-pointer rounded p-1 text-neutral-500 hover:bg-neutral-800 hover:text-neutral-200"
                          >
                            {packExpanded ? <Minimize2 className="size-3.5" /> : <Maximize2 className="size-3.5" />}
                          </button>
                          <button onClick={() => setPackEditorOpen(false)} className="cursor-pointer rounded p-1 text-neutral-500 hover:bg-neutral-800"><X className="size-3.5" /></button>
                        </div>
                      </div>
                      <input
                        value={packName}
                        onChange={(event) => setPackName(event.target.value)}
                        placeholder="Pack name"
                        className="mt-2 w-full border border-neutral-700 bg-neutral-900 px-2 py-1.5 text-xs outline-none focus:border-gold-400/60"
                      />
                      <div className="mt-2 grid grid-cols-2 border border-neutral-700 bg-neutral-900 p-1" role="radiogroup" aria-label="Pack routing strategy">
                        <button
                          type="button"
                          role="radio"
                          aria-checked={packStrategy === "fallback"}
                          onClick={() => setPackStrategy("fallback")}
                          className={cn(
                            "cursor-pointer px-3 py-2 text-left text-xs transition-colors",
                            packStrategy === "fallback" ? "bg-gold-400 text-neutral-950" : "text-neutral-400 hover:bg-neutral-800 hover:text-neutral-200",
                          )}
                        >
                          Fallback
                        </button>
                        <button
                          type="button"
                          role="radio"
                          aria-checked={packStrategy === "round-robin"}
                          onClick={() => setPackStrategy("round-robin")}
                          className={cn(
                            "cursor-pointer px-3 py-2 text-left text-xs transition-colors",
                            packStrategy === "round-robin" ? "bg-gold-400 text-neutral-950" : "text-neutral-400 hover:bg-neutral-800 hover:text-neutral-200",
                          )}
                        >
                          Round robin
                        </button>
                      </div>
                      {packExpanded && <details className="relative mt-2">
                        <summary className="flex cursor-pointer list-none items-center justify-between border border-neutral-700 bg-neutral-900 px-3 py-2 text-xs text-neutral-300 hover:border-neutral-600">
                          <span>Accounts</span>
                          <span className="text-neutral-500">
                            {packAccountFilters.length}/{connectedModelAccounts.length} selected
                          </span>
                        </summary>
                        <div className="absolute left-0 top-full z-20 mt-1 max-h-72 w-full overflow-y-auto border border-neutral-700 bg-neutral-900 p-2 shadow-2xl sm:w-[28rem]">
                          <div className="mb-2 flex items-center justify-between gap-3 border-b border-neutral-800 pb-2">
                            <span className="text-[10px] font-semibold uppercase text-neutral-500">Connected accounts</span>
                            <button
                              onClick={() => setPackAccountFilters(
                                packAccountFilters.length === connectedModelAccounts.length
                                  ? []
                                  : connectedModelAccounts.map((account) => account.id),
                              )}
                              className="cursor-pointer text-[10px] text-gold-300 hover:text-gold-200"
                            >
                              {packAccountFilters.length === connectedModelAccounts.length ? "Clear all" : "Select all"}
                            </button>
                          </div>
                          <div className="flex flex-col gap-1">
                            {connectedModelAccounts.map((account) => (
                              <label key={account.id} className="flex cursor-pointer items-center gap-2 px-1 py-1.5 text-xs text-neutral-300 hover:bg-neutral-800">
                                <input
                                  type="checkbox"
                                  checked={packAccountFilters.includes(account.id)}
                                  onChange={() => setPackAccountFilters((current) => current.includes(account.id)
                                    ? current.filter((id) => id !== account.id)
                                    : [...current, account.id])}
                                  className="accent-gold-400"
                                />
                                <span className="min-w-0 flex-1 truncate">{account.provider} · {account.label}</span>
                                <span className="text-[10px] text-neutral-600">{account.count}</span>
                              </label>
                            ))}
                          </div>
                        </div>
                      </details>}
                      <div className={cn(
                        "mt-2 overflow-y-auto border border-neutral-800",
                        packExpanded ? "grid min-h-0 flex-1 grid-cols-1 content-start sm:grid-cols-2" : "max-h-48",
                      )}>
                        {filteredPackModels.map((model) => (
                          <label key={model.id} className="flex cursor-pointer items-center gap-2 border-b border-neutral-800 px-2 py-1.5 text-xs last:border-0 hover:bg-neutral-900">
                            <input
                              type="checkbox"
                              checked={packModels.includes(model.id)}
                              onChange={() => setPackModels((current) => current.includes(model.id)
                                ? current.filter((id) => id !== model.id)
                                : [...current, model.id])}
                              className="accent-gold-400"
                            />
                            <span className="min-w-0 flex-1 truncate">{model.name}</span>
                            <span className="max-w-[45%] truncate text-[10px] text-neutral-500" title={model.accountLabel}>
                              {model.provider} · {model.accountLabel || "Account"}
                            </span>
                          </label>
                        ))}
                      </div>
                      <button
                        onClick={() => void savePack()}
                        disabled={!packName.trim() || packModels.length < 2}
                        className="mt-2 w-full cursor-pointer bg-gold-400 px-2 py-1.5 text-xs font-medium text-neutral-950 disabled:cursor-default disabled:opacity-40"
                      >
                        {editingPackId ? "Save pack" : "Create pack"}
                      </button>
                      {packError && <p className="mt-1 text-[10px] text-red-300">{packError}</p>}
                      </div>
                      </div>
                    </PortalWhen>
                  )}
                  <details className="mt-1 border-t border-neutral-800">
                    <summary className="cursor-pointer px-3 py-2 text-[10px] font-semibold uppercase text-neutral-500 hover:text-neutral-300">
                      Individual models ({individualModels.length})
                    </summary>
                    {individualModels.map((m) => (
                      <button
                        key={m.id}
                        onClick={() => {
                          setActiveModel(m.id);
                          setModelPickerOpen(false);
                        }}
                        className={cn(
                          "block w-full cursor-pointer rounded-lg px-3 py-2 text-left text-xs hover:bg-neutral-800",
                          activeModel === m.id ? "text-gold-300" : "text-neutral-300",
                        )}
                      >
                        {m.name}
                        <span className="block truncate text-[10px] text-neutral-500" title={m.accountLabel}>
                          {m.provider} · {m.accountLabel || "Account"}
                        </span>
                      </button>
                    ))}
                  </details>
                </div>
              )}
            </div>
          )}
          {modelLoadError && (
            <span className="max-w-[14rem] truncate px-2 text-xs text-amber-300" title={modelLoadError}>
              AI Router unavailable
            </span>
          )}
          <button
            onClick={() => setShowSearch((prev) => !prev)}
            title="Search chat history"
            className={cn(
              "cursor-pointer rounded-lg p-1.5 transition-colors",
              showSearch ? "bg-gold-400/20 text-gold-300" : "text-neutral-500 hover:bg-neutral-800 hover:text-neutral-300"
            )}
          >
            <Search className="size-4" />
          </button>
          <button
            onClick={() => setShowTasksPanel((prev) => !prev)}
            title="Nhiệm vụ Agent (Agent Plan)"
            className={cn(
              "cursor-pointer rounded-lg p-1.5 transition-colors",
              showTasksPanel ? "bg-gold-400/20 text-gold-300" : "text-neutral-500 hover:bg-neutral-800 hover:text-neutral-300"
            )}
          >
            <ClipboardList className="size-4" />
          </button>
          <button
            onClick={() => setShowSharedMedia((prev) => !prev)}
            title="Shared Media & Files"
            className={cn(
              "cursor-pointer rounded-lg p-1.5 transition-colors",
              showSharedMedia ? "bg-gold-400/20 text-gold-300" : "text-neutral-500 hover:bg-neutral-800 hover:text-neutral-300"
            )}
          >
            <FolderOpen className="size-4" />
          </button>
          <button
            onClick={clearChat}
            title="Clear conversation"
            className="cursor-pointer rounded-lg p-1.5 text-neutral-500 hover:bg-neutral-800 hover:text-neutral-300"
          >
            <Eraser className="size-4" />
          </button>
        </div>
      </header>

      {/* Search Bar */}
      {showSearch && (
        <div className="flex items-center gap-2 border-b border-neutral-800 bg-neutral-900/90 px-4 py-2 text-xs">
          <Search className="size-3.5 text-neutral-400" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Tìm kiếm nội dung đã chat..."
            className="flex-1 bg-transparent outline-none text-neutral-200 placeholder:text-neutral-500"
            autoFocus
          />
          {searchQuery && (
            <button onClick={() => setSearchQuery("")} className="text-neutral-500 hover:text-neutral-300 cursor-pointer">
              <X className="size-3.5" />
            </button>
          )}
        </div>
      )}

      {/* Main Body Area */}
      <div className="flex flex-1 overflow-hidden">
        {/* Messages */}
        <div className="flex-1 overflow-y-auto px-4 py-6 sm:px-6" data-selectable>
          {filteredMessages.length === 0 ? (
            <div className="flex h-full flex-col items-center justify-center text-center">
              <Logo className="size-14 opacity-95" />
              <h2 className="mt-4 text-lg font-semibold">
                How can I help you today?
              </h2>
              <p className="mt-1 max-w-lg text-sm text-neutral-500">
                Write an email, summarize a document, build a plan — or pick an
                installed agent above for specialist help.
              </p>
            </div>
          ) : (
            <div className="mx-auto flex max-w-4xl flex-col gap-4">
              {filteredMessages.map((m, idx) => {
              const isUser = m.role === "user";
              const formattedTime = new Date(m.createdAt).toLocaleTimeString("vi-VN", {
                hour: "2-digit",
                minute: "2-digit",
              });
              return (
                <div
                  key={m.id}
                  className={cn(
                    "flex items-start gap-2.5",
                    isUser ? "justify-end" : "justify-start",
                  )}
                >
                  {!isUser && (
                    <div
                      className="size-8 rounded-xl bg-gradient-to-br from-neutral-800 to-neutral-900 border border-neutral-750 flex items-center justify-center text-sm shrink-0 mt-0.5 shadow-md ring-1 ring-gold-500/20 select-none overflow-hidden"
                      title={activeAgent?.name || "VuaAssistant"}
                    >
                      {activeAgent?.emoji ? (
                        <span className="text-base leading-none">{activeAgent.emoji}</span>
                      ) : (
                        <div className="relative flex size-full items-center justify-center bg-gold-500/10 text-gold-400">
                          <Bot className="size-4.5" />
                          <span className="absolute -top-0.5 -right-0.5 flex size-2">
                            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-gold-400 opacity-60" />
                            <span className="relative inline-flex size-2 rounded-full bg-gold-400" />
                          </span>
                        </div>
                      )}
                    </div>
                  )}
                  <div className="flex flex-col max-w-[85%]">
                    <div
                      className={cn(
                        "whitespace-pre-wrap px-4 py-2.5 text-sm leading-relaxed shadow-md transition-all duration-200",
                        isUser
                          ? "bg-gold-500/10 border border-gold-500/25 text-neutral-100 rounded-2xl rounded-tr-xs"
                          : "bg-neutral-850 border border-neutral-800/80 text-neutral-100 rounded-2xl rounded-tl-xs",
                      )}
                    >
                      {/* Inline Image & File Previews (WhatsApp / Telegram style) */}
                      {m.attachments && m.attachments.length > 0 && (
                        <div className="mb-2 flex flex-wrap gap-2.5">
                          {m.attachments.map((att) => (
                            <InlineAttachmentPreview
                              key={att.id}
                              att={att}
                              onOpenPreview={() => setPreviewFile({ id: att.id, name: att.name })}
                            />
                          ))}
                        </div>
                      )}

                      {m.content?.trim() || (m.role === "assistant" && visibleAssistantText(m.content)) ? (
                        <>
                          <MessageContent
                            content={m.content}
                            assistant={m.role === "assistant"}
                            onApprovePermission={approveReadPath}
                            onAnswerQuestion={answerQuestion}
                            onApproveCapability={approveCapability}
                          />
                          {!isUser && m.content && (
                            <div className="mt-2 flex items-center gap-3 border-t border-neutral-800/40 pt-1.5 text-xs text-neutral-400 select-none">
                              <button
                                type="button"
                                onClick={() => {
                                  const quote = m.content
                                    .split("\n")
                                    .map((line) => `> ${line}`)
                                    .join("\n");
                                  setInput((prev) => (prev ? `${quote}\n\n${prev}` : `${quote}\n\n`));
                                  setTimeout(() => composerRef.current?.focus(), 100);
                                }}
                                className="flex cursor-pointer items-center gap-1 rounded px-1.5 py-0.5 text-neutral-400 hover:bg-neutral-800 hover:text-gold-300 transition-colors"
                                title="Trích dẫn trả lời (Reply)"
                              >
                                <CornerUpLeft className="size-3" />
                                <span>Trả lời</span>
                              </button>

                              <button
                                type="button"
                                onClick={() => {
                                  const msgIndex = messages.findIndex((msg) => msg.id === m.id);
                                  let targetPrompt = "";
                                  if (msgIndex > 0) {
                                    for (let i = msgIndex - 1; i >= 0; i--) {
                                      if (messages[i].role === "user") {
                                        targetPrompt = messages[i].content;
                                        break;
                                      }
                                    }
                                  }
                                  if (!targetPrompt) {
                                    const lastUserMsg = [...messages].reverse().find((msg) => msg.role === "user");
                                    targetPrompt = lastUserMsg ? lastUserMsg.content : "";
                                  }
                                  if (targetPrompt) {
                                    send(targetPrompt, true);
                                  }
                                }}
                                className="flex cursor-pointer items-center gap-1 rounded px-1.5 py-0.5 text-neutral-400 hover:bg-neutral-800 hover:text-amber-400 transition-colors"
                                title="Gửi lại yêu cầu trước đó (Retry)"
                              >
                                <RotateCcw className="size-3" />
                                <span>Thử lại</span>
                              </button>
                            </div>
                          )}
                        </>
                      ) : streaming && idx === filteredMessages.length - 1 ? (
                        <div className="flex items-center gap-2 py-1 text-xs text-gold-300 font-medium select-none">
                          <span className="relative flex size-2.5 shrink-0">
                            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-gold-400 opacity-75"></span>
                            <span className="relative inline-flex size-2.5 rounded-full bg-gold-400"></span>
                          </span>
                          <span className="animate-pulse">
                            ⚡ AI Agent đang xử lý... (Đang đọc dữ liệu & thực thi tác vụ)
                          </span>
                        </div>
                      ) : (
                        <div className="flex flex-wrap items-center justify-between gap-2 py-1 text-xs text-amber-400/90 font-medium select-none">
                          <div className="flex items-center gap-2">
                            <span className="size-2 rounded-full bg-amber-400 shrink-0" />
                            <span>⚠️ Chưa nhận được dữ liệu phản hồi (Vui lòng chọn mô hình AI khả dụng hoặc thử lại)</span>
                          </div>
                          <button
                            type="button"
                            onClick={() => {
                              const lastUserMsg = [...messages].reverse().find((m) => m.role === "user");
                              if (lastUserMsg) {
                                send(lastUserMsg.content);
                              }
                            }}
                            className="flex cursor-pointer items-center gap-1 rounded bg-amber-500/20 border border-amber-500/40 px-2 py-1 text-[11px] text-amber-300 hover:bg-amber-500/30 transition-colors"
                          >
                            <RotateCcw className="size-3" /> Thử lại (Retry)
                          </button>
                        </div>
                      )}
                      
                      {/* Meta/Timestamp footer inside the bubble */}
                      <div className="mt-1 flex items-center justify-end gap-1 select-none">
                        <span className={cn(
                          "text-[9px] font-normal leading-none",
                          isUser ? "text-gold-400/50" : "text-neutral-500"
                        )}>
                          {formattedTime}
                        </span>
                        {isUser && (
                          <span className="text-[10px] text-gold-400/70 font-bold leading-none select-none">✓✓</span>
                        )}
                      </div>
                    </div>
                  </div>
                  {isUser && (
                    <div
                      className="relative flex size-8 shrink-0 items-center justify-center rounded-xl bg-gradient-to-tr from-gold-500 to-amber-300 text-xs font-bold text-neutral-950 shadow-md ring-1 ring-gold-400/30 select-none mt-0.5"
                      title={user?.name || "Bạn (User)"}
                    >
                      {(user?.name || "U").charAt(0).toUpperCase()}
                      {user?.syncedWithVuahethong && (
                        <span className="absolute -bottom-0.5 -right-0.5 flex size-2.5 items-center justify-center rounded-full bg-emerald-500 ring-1.5 ring-neutral-900" title="360 CORP SSO" />
                      )}
                    </div>
                  )}
                </div>
              );
            })}
            <div ref={bottomRef} />
          </div>
        )}

        {/* Task Progress & Plan Panel (Task 7: Kanban / Plan visualization) */}
        {showTasksPanel && activeSessionTasks.length > 0 && (
          <div className="w-80 shrink-0 border-l border-neutral-850 bg-neutral-950 flex flex-col h-full animate-in slide-in-from-right duration-200">
            <div className="p-4 border-b border-neutral-850 flex items-center justify-between">
              <span className="text-xs font-semibold uppercase tracking-wider text-gold-400 flex items-center gap-2">
                <ClipboardList className="size-4" />
                Nhiệm vụ Agent (Plan)
              </span>
              <button
                onClick={() => setShowTasksPanel(false)}
                className="text-neutral-500 hover:text-neutral-350"
              >
                <X className="size-4" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-4 space-y-5">
              {/* 1. DOING (IN PROGRESS) */}
              <div className="space-y-2">
                <div className="text-[10px] font-bold uppercase tracking-wider text-gold-500/80 flex items-center justify-between">
                  <span>Đang làm (Doing)</span>
                  <span className="rounded bg-gold-500/10 px-1.5 py-0.5 text-gold-400">
                    {activeSessionTasks.filter(t => t.status === "in_progress").length}
                  </span>
                </div>
                <div className="space-y-2">
                  {activeSessionTasks.filter(t => t.status === "in_progress").map((task) => (
                    <div key={task.id} className="rounded-xl border border-gold-500/30 bg-gold-500/5 p-3 flex items-start gap-2.5 shadow-sm">
                      <Loader2 className="size-4 text-gold-400 animate-spin mt-0.5 shrink-0" />
                      <span className="text-xs font-medium text-gold-200 leading-relaxed">{task.name}</span>
                    </div>
                  ))}
                  {activeSessionTasks.filter(t => t.status === "in_progress").length === 0 && (
                    <div className="text-[11px] text-neutral-600 italic px-1 py-1">Không có task nào đang làm</div>
                  )}
                </div>
              </div>

              {/* 2. TO DO (PENDING) */}
              <div className="space-y-2">
                <div className="text-[10px] font-bold uppercase tracking-wider text-neutral-500 flex items-center justify-between">
                  <span>Đang chờ (To Do)</span>
                  <span className="rounded bg-neutral-900 px-1.5 py-0.5 text-neutral-400">
                    {activeSessionTasks.filter(t => t.status === "pending").length}
                  </span>
                </div>
                <div className="space-y-2">
                  {activeSessionTasks.filter(t => t.status === "pending").map((task) => (
                    <div key={task.id} className="rounded-xl border border-neutral-900 bg-neutral-900/40 p-3 flex items-start gap-2.5">
                      <div className="size-3.5 rounded-full border border-neutral-700 mt-0.5 shrink-0" />
                      <span className="text-xs text-neutral-400 leading-relaxed">{task.name}</span>
                    </div>
                  ))}
                  {activeSessionTasks.filter(t => t.status === "pending").length === 0 && (
                    <div className="text-[11px] text-neutral-650 italic px-1 py-1">Không có task nào đang chờ</div>
                  )}
                </div>
              </div>

              {/* 3. DONE (COMPLETED) */}
              <div className="space-y-2">
                <div className="text-[10px] font-bold uppercase tracking-wider text-emerald-500/80 flex items-center justify-between">
                  <span>Đã xong (Done)</span>
                  <span className="rounded bg-emerald-500/10 px-1.5 py-0.5 text-emerald-400">
                    {activeSessionTasks.filter(t => t.status === "completed").length}
                  </span>
                </div>
                <div className="space-y-2">
                  {activeSessionTasks.filter(t => t.status === "completed").map((task) => (
                    <div key={task.id} className="rounded-xl border border-neutral-900/60 bg-neutral-950 p-3 flex items-start gap-2.5 opacity-65">
                      <CheckCircle2 className="size-4 text-emerald-500 mt-0.5 shrink-0" />
                      <span className="text-xs text-neutral-500 line-through leading-relaxed">{task.name}</span>
                    </div>
                  ))}
                  {activeSessionTasks.filter(t => t.status === "completed").length === 0 && (
                    <div className="text-[11px] text-neutral-650 italic px-1 py-1">Chưa hoàn thành task nào</div>
                  )}
                </div>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Shared Media Side Panel (Telegram / WhatsApp Style Drawer) */}
      <KnowledgeManagerDrawer
        isOpen={showSharedMedia}
        onClose={() => setShowSharedMedia(false)}
        tab={mediaTab}
        setTab={setMediaTab}
        sharedMediaItems={sharedMediaItems}
        onPreviewFile={setPreviewFile}
      />
      </div>

      {/* Composer */}
      <div className="border-t border-neutral-800 px-3 py-3 sm:px-6 sm:py-4">
        {/* Active Running Task Widget — Chỉ hiển thị khi có tác vụ chạy ngầm đa nhiệm thực sự (như build image, async runner) */}
        {activeBackgroundTasks.length > 0 && (
          <div className="mx-auto mb-3 max-w-4xl overflow-hidden rounded-2xl border border-neutral-800 bg-neutral-900/90 shadow-xl backdrop-blur-md transition-all animate-fadeIn">
            <div
              onClick={() => setTaskExpanded((prev) => !prev)}
              className="flex cursor-pointer items-center justify-between px-4 py-2.5 hover:bg-neutral-850/50 transition-colors select-none"
            >
              <div className="flex items-center gap-2.5 text-xs font-semibold text-neutral-200">
                <span className="relative flex size-2">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-gold-400 opacity-75"></span>
                  <span className="relative inline-flex size-2 rounded-full bg-gold-400"></span>
                </span>
                <span>{activeBackgroundTasks.length} task{activeBackgroundTasks.length > 1 ? "s" : ""} running</span>
              </div>
              <div className="flex items-center gap-2">
                <button
                  className="text-neutral-400 hover:text-neutral-200 p-0.5 rounded cursor-pointer"
                  aria-label="Toggle task details"
                >
                  {taskExpanded ? <ChevronUp className="size-4" /> : <ChevronDown className="size-4" />}
                </button>
              </div>
            </div>

            {taskExpanded && (
              <div className="border-t border-neutral-800/80 px-4 py-3 bg-neutral-950/40 space-y-2.5">
                {activeBackgroundTasks.map((bgTask) => (
                  <div key={bgTask.id} className="flex items-center justify-between text-xs">
                    <div className="flex items-center gap-2.5 min-w-0">
                      <Loader2 className="size-3.5 animate-spin text-gold-400 shrink-0" />
                      <div className="truncate">
                        <span className="font-mono text-neutral-200 font-medium block truncate">
                          {bgTask.name}
                        </span>
                        {bgTask.command && (
                          <span className="font-mono text-[10px] text-neutral-500 block truncate">
                            {bgTask.command}
                          </span>
                        )}
                      </div>
                    </div>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        stopBackgroundTask(bgTask.id);
                      }}
                      className="flex items-center gap-1.5 rounded-lg border border-red-500/30 bg-red-500/10 px-2.5 py-1 text-xs font-semibold text-red-400 hover:bg-red-500/20 hover:border-red-500/50 transition-all cursor-pointer shrink-0 ml-3"
                      title="Dừng tiến trình chạy ngầm này"
                    >
                      <Square className="size-3 fill-red-400 text-red-400" />
                      Dừng task
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
        {/* Attachment files list */}
        {knowledgeFiles.filter((f) => !sentFileIds.has(f.id)).length > 0 && (
          <div className="mx-auto mb-2 flex max-w-4xl flex-wrap gap-2 px-1">
            {knowledgeFiles.filter((f) => !sentFileIds.has(f.id)).map((f) => (
              <div
                key={f.id}
                className="flex items-center gap-1.5 rounded-full border border-neutral-800 bg-neutral-950 px-3 py-1 text-xs"
              >
                <FileText className="size-3.5 text-neutral-500" />
                <span
                  onClick={() => {
                    if (f.status === "ready") {
                      setPreviewFile({ id: f.id, name: f.name });
                    }
                  }}
                  className={cn(
                    "max-w-[120px] truncate",
                    f.status === "ready" ? "cursor-pointer hover:underline hover:text-gold-300" : ""
                  )}
                  title={f.name}
                >
                  {f.name}
                </span>
                {f.status === "processing" ? (
                  <Loader2 className="size-3 animate-spin text-gold-300" />
                ) : f.status === "error" ? (
                  <span className="text-[10px] text-red-400" title={f.error}>Failed</span>
                ) : (
                  <span className="text-[10px] text-green-400">Ready</span>
                )}
                <button
                  onClick={() => removeKnowledgeFile(f.id)}
                  className="ml-1 cursor-pointer rounded-full p-0.5 text-neutral-500 hover:bg-neutral-800 hover:text-red-400"
                  title="Remove file"
                >
                  <X className="size-3" />
                </button>
              </div>
            ))}
          </div>
        )}

        {/* Slash Command / Skill Autocomplete Popup */}
        {showSlashMenu && filteredSlashSkills.length > 0 && (
          <div className="mx-auto mb-2 max-w-4xl overflow-hidden rounded-xl border border-neutral-700 bg-neutral-950 p-1 shadow-2xl shadow-black/80">
            <div className="px-2.5 py-1 text-[11px] font-semibold text-gold-400 uppercase tracking-wider flex items-center justify-between">
              <span>🪄 Chọn Kỹ năng (gõ / để tìm kiếm)</span>
              <span className="text-[10px] text-neutral-500">{filteredSlashSkills.length} kết quả</span>
            </div>
            <div className="max-h-56 overflow-y-auto">
              {filteredSlashSkills.map((sk) => (
                <button
                  key={sk.id}
                  type="button"
                  onClick={() => activateSkillTemplate(sk)}
                  className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-xs text-neutral-200 transition-colors hover:bg-neutral-850 hover:text-gold-300 cursor-pointer"
                >
                  <span className="text-base shrink-0">{sk.emoji}</span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="font-semibold text-neutral-100">{sk.name}</span>
                      <span className="rounded bg-neutral-800 px-1.5 py-0.5 text-[10px] text-neutral-400">{sk.category}</span>
                    </div>
                    <p className="truncate text-[11px] text-neutral-400 mt-0.5">{sk.description}</p>
                  </div>
                </button>
              ))}
            </div>
          </div>
        )}

        <div
          className={cn(
            "relative mx-auto transition-all duration-200",
            isComposerExpanded ? "max-w-6xl" : "max-w-4xl"
          )}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
        >
          {/* Drag & Drop Visual Overlay - Chỉ áp dụng riêng cho ô Chat Input Box */}
          {isDraggingOver && (
            <div className="absolute inset-0 z-50 flex items-center justify-center rounded-2xl border-2 border-dashed border-gold-400 bg-neutral-950/95 backdrop-blur-xs p-3 text-center shadow-xl animate-fadeIn select-none">
              <div className="flex items-center gap-3">
                <div className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-gold-400/20 text-gold-300">
                  <UploadCloud className="size-5" />
                </div>
                <div className="text-left">
                  <p className="text-xs font-bold text-neutral-100">Thả File hoặc Thư mục vào đây</p>
                  <p className="text-[11px] text-neutral-400">Tự động nhận diện đường dẫn thư mục công việc & đính kèm file</p>
                </div>
              </div>
            </div>
          )}

          {/* Expanded Composer Header Toolbar */}
          {isComposerExpanded && (
            <div className="flex items-center justify-between px-3 py-1.5 mb-1.5 rounded-xl border border-gold-400/30 bg-neutral-950/80 backdrop-blur-md text-xs text-neutral-300 animate-fadeIn">
              <div className="flex items-center gap-2 font-medium">
                <span className="flex size-2 rounded-full bg-gold-400 animate-pulse" />
                <span className="text-gold-300 font-semibold">Chế độ xem mở rộng (Multi-line Editor)</span>
                <span className="text-neutral-500 font-mono text-[11px]">
                  · {input.split("\n").length} dòng ({input.length} ký tự)
                </span>
              </div>
              <button
                type="button"
                onClick={() => setIsComposerExpanded(false)}
                className="flex items-center gap-1 text-[11px] font-semibold text-neutral-400 hover:text-gold-300 hover:bg-neutral-850 px-2 py-0.5 rounded-lg transition-colors cursor-pointer"
                title="Thu nhỏ khung chat"
              >
                <Minimize2 className="size-3.5" />
                Thu nhỏ
              </button>
            </div>
          )}

          <div
            className={cn(
              "flex items-end gap-2 rounded-2xl border bg-neutral-900 p-2 focus-within:border-gold-400/60 transition-all",
              isDraggingOver ? "border-gold-400 bg-gold-400/10" : "border-neutral-700",
              isComposerExpanded && "border-gold-400/40 bg-neutral-950 shadow-2xl shadow-black/80"
            )}
          >
            <input
              type="file"
              multiple
              ref={fileInputRef}
              className="hidden"
              onChange={(e) => {
                const files = Array.from(e.target.files ?? []);
                if (files.length) addKnowledgeFiles(files);
                e.target.value = "";
              }}
            />
            <button
              onClick={() => fileInputRef.current?.click()}
              title="Attach files (PDF, Word, Excel, Text...)"
              className="cursor-pointer rounded-xl p-2 text-neutral-500 hover:bg-neutral-800 hover:text-neutral-300 transition-colors shrink-0"
            >
              <Paperclip className="size-4" />
            </button>
            <button
              onClick={() => setSkillPickerOpen((o) => !o)}
              title="Chọn Kỹ năng (Skill) kích hoạt hoặc gõ /"
              className={cn(
                "cursor-pointer rounded-xl p-2 transition-colors shrink-0",
                activeSkill
                  ? "bg-gold-400/20 text-gold-300 border border-gold-400/40 hover:bg-gold-400/30"
                  : "text-neutral-500 hover:bg-neutral-800 hover:text-gold-300"
              )}
            >
              <Wand2 className="size-4" />
            </button>

            <textarea
              ref={composerRef}
              rows={isComposerExpanded ? 10 : 1}
              value={input}
              placeholder={
                activeSkill
                  ? `Đang dùng Skill: ${activeSkill.name}…`
                  : activeAgent
                  ? `Ask your ${activeAgent.name} (gõ / chọn Skill)…`
                  : "Message VuaAssistant (gõ / chọn Skill)…"
              }
              onChange={(e) => {
                const val = e.target.value;
                setInput(val);
                if (val.startsWith("/")) {
                  setShowSlashMenu(true);
                  setSlashQuery(val.slice(1));
                } else {
                  setShowSlashMenu(false);
                }
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey && !isComposerExpanded) {
                  e.preventDefault();
                  setShowSlashMenu(false);
                  void send();
                }
              }}
              onPaste={(e) => {
                const files = Array.from(e.clipboardData.files ?? []);
                if (files.length > 0) {
                  addKnowledgeFiles(files);
                }
              }}
              className={cn(
                "flex-1 resize-none bg-transparent px-2 py-1.5 text-sm outline-none placeholder:text-neutral-500 font-mono transition-all",
                isComposerExpanded
                  ? "h-64 sm:h-80 max-h-[500px] overflow-y-auto leading-relaxed"
                  : "max-h-40 min-h-[38px]"
              )}
            />

            {/* Toggle Expand / Maximize Button */}
            <button
              type="button"
              onClick={() => setIsComposerExpanded((prev) => !prev)}
              title={isComposerExpanded ? "Thu nhỏ khung chat" : "Mở rộng khung nhập liệu nhiều dòng"}
              className={cn(
                "cursor-pointer rounded-xl p-2 transition-colors shrink-0",
                isComposerExpanded
                  ? "bg-gold-400/20 text-gold-300 border border-gold-400/40 hover:bg-gold-400/30"
                  : "text-neutral-500 hover:bg-neutral-800 hover:text-neutral-300"
              )}
            >
              {isComposerExpanded ? <Minimize2 className="size-4" /> : <Maximize2 className="size-4" />}
            </button>

            <button
              onClick={() => void send()}
              disabled={(!input.trim() && knowledgeFiles.filter((f) => !sentFileIds.has(f.id) && f.status === "ready").length === 0) || streaming || !activeModel}
              className="cursor-pointer rounded-xl bg-gold-400 p-2 text-neutral-950 transition-colors hover:bg-gold-300 disabled:pointer-events-none disabled:opacity-40 shrink-0"
              title="Gửi câu lệnh (Enter)"
            >
              <SendHorizonal className="size-4" />
            </button>
          </div>
        </div>
        <p className="mx-auto mt-2 max-w-4xl text-center text-[11px] text-neutral-600">
          Enter to send · Shift+Enter for a new line
        </p>
      </div>

      {previewFile && (
        <FilePreviewModal
          fileId={previewFile.id}
          fileName={previewFile.name}
          onClose={() => setPreviewFile(null)}
        />
      )}
    </div>
  );
}
