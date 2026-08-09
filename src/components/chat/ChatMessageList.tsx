import { Bot, RotateCcw, User } from "lucide-react";
import { type ChatMessage } from "@/runtime/engine";
import { MessageContent } from "@/components/MessageContent";
import { InlineAttachmentPreview } from "@/components/chat/InlineAttachmentPreview";
import { cn } from "@/lib/utils";

interface ChatMessageListProps {
  messages: ChatMessage[];
  streaming: boolean;
  streamingContent?: string;
  onApprovePermission: (path: string) => Promise<void>;
  onApproveCapability?: (capabilityName: string) => Promise<void>;
  onRetry: () => void;
  onOpenPreview: (att: { id: string; name: string; dataUrl?: string }) => void;
}

export function ChatMessageList({
  messages,
  streaming,
  streamingContent,
  onApprovePermission,
  onApproveCapability,
  onRetry,
  onOpenPreview,
}: ChatMessageListProps) {
  return (
    <div className="flex-1 space-y-4 overflow-y-auto p-4">
      {messages.map((m, idx) => {
        const isUser = m.role === "user";
        return (
          <div
            key={m.id || idx}
            className={cn(
              "flex gap-3 text-sm",
              isUser ? "flex-row-reverse" : "flex-row"
            )}
          >
            {/* Avatar */}
            <div
              className={cn(
                "flex size-8 shrink-0 select-none items-center justify-center rounded-xl font-semibold shadow-xs",
                isUser
                  ? "bg-gold-500 text-neutral-950 font-bold"
                  : "bg-neutral-800 text-gold-400 border border-gold-500/20"
              )}
            >
              {isUser ? <User className="size-4" /> : <Bot className="size-4" />}
            </div>

            {/* Bubble Container */}
            <div
              className={cn(
                "relative max-w-[85%] rounded-2xl p-4 shadow-sm transition-all",
                isUser
                  ? "bg-gold-500/10 border border-gold-500/30 text-neutral-100 rounded-tr-xs"
                  : "bg-neutral-900/90 border border-neutral-800/80 text-neutral-200 rounded-tl-xs"
              )}
            >
              {/* Message Content */}
              <MessageContent
                content={m.content}
                assistant={!isUser}
                onApprovePermission={onApprovePermission}
                onApproveCapability={onApproveCapability}
              />

              {/* Attachments preview */}
              {m.attachments && m.attachments.length > 0 && (
                <div className="mt-3 flex flex-wrap gap-2 pt-2 border-t border-neutral-800/60">
                  {m.attachments.map((att) => (
                    <InlineAttachmentPreview
                      key={att.id}
                      att={att}
                      onOpenPreview={() => onOpenPreview(att)}
                    />
                  ))}
                </div>
              )}

              {/* Error fallback with 1-Click Retry button */}
              {!isUser && !m.content && !streaming && (
                <div className="flex flex-wrap items-center justify-between gap-2 py-1 text-xs text-amber-400/90 font-medium select-none">
                  <div className="flex items-center gap-2">
                    <span className="size-2 rounded-full bg-amber-400 shrink-0" />
                    <span>⚠️ Chưa nhận được dữ liệu phản hồi (Vui lòng chọn mô hình AI khả dụng hoặc thử lại)</span>
                  </div>
                  <button
                    type="button"
                    onClick={onRetry}
                    className="flex cursor-pointer items-center gap-1 rounded bg-amber-500/20 border border-amber-500/40 px-2 py-1 text-[11px] text-amber-300 hover:bg-amber-500/30 transition-colors"
                  >
                    <RotateCcw className="size-3" /> Thử lại (Retry)
                  </button>
                </div>
              )}
            </div>
          </div>
        );
      })}

      {/* Live Streaming Assistant Response Indicator */}
      {streaming && (
        <div className="flex gap-3 text-sm">
          <div className="flex size-8 shrink-0 items-center justify-center rounded-xl bg-neutral-800 text-gold-400 border border-gold-500/20">
            <Bot className="size-4 animate-spin" />
          </div>
          <div className="max-w-[85%] rounded-2xl rounded-tl-xs bg-neutral-900/90 border border-neutral-800/80 p-4 text-neutral-200">
            <div className="flex items-center gap-2 text-xs text-gold-400 font-medium animate-pulse">
              <span>⚡ AI Agent đang thực thi tác vụ...</span>
            </div>
            {streamingContent && (
              <div className="mt-2">
                <MessageContent
                  content={streamingContent}
                  assistant={true}
                  onApprovePermission={onApprovePermission}
                  onApproveCapability={onApproveCapability}
                />
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
