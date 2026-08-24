import { useEffect, useState } from "react";
import { FileText, Loader2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { getKnowledgeFileRecord } from "@/runtime/knowledge";
import { fileObjectURLs } from "@/lib/store";

export interface FilePreviewModalProps {
  fileId: string;
  fileName: string;
  onClose: () => void;
}

export function FilePreviewModal({
  fileId,
  fileName,
  onClose,
}: FilePreviewModalProps) {
  const [loading, setLoading] = useState(true);
  const [content, setContent] = useState<string | null>(null);
  const [imageSrc, setImageSrc] = useState<string | null>(fileObjectURLs.get(fileId) ?? null);

  const ext = fileName.toLowerCase().split(".").pop() ?? "";
  const isImage = ["png", "jpg", "jpeg", "gif", "webp", "svg", "bmp", "tiff", "heic", "heif"].includes(ext);

  useEffect(() => {
    getKnowledgeFileRecord(fileId)
      .then((rec) => {
        if (rec) {
          if (rec.dataUrl) {
            setImageSrc(rec.dataUrl);
          }
          if (rec.chunks && rec.chunks.length > 0) {
            setContent(rec.chunks.join("\n\n"));
          }
        }
        setLoading(false);
      })
      .catch((e) => {
        console.error("Failed to load preview record:", e);
        setLoading(false);
      });
  }, [fileId]);

  return (
    <div
      className="fixed inset-0 z-[10000] flex items-center justify-center bg-black/80 p-4 backdrop-blur-xs animate-fadeIn"
      onClick={onClose}
    >
      <div
        className="w-full max-w-4xl rounded-2xl border border-neutral-800 bg-neutral-900 p-5 flex flex-col max-h-[90vh] shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between shrink-0 border-b border-neutral-800 pb-3">
          <div className="min-w-0 flex-1 pr-4">
            <h3 className="font-semibold text-neutral-200 truncate text-base">{fileName}</h3>
            <p className="text-[11px] text-neutral-400 mt-0.5">Xem trước tài liệu tri thức của Agent</p>
          </div>
          <button
            onClick={onClose}
            className="cursor-pointer rounded-lg p-1.5 text-neutral-400 hover:bg-neutral-800 hover:text-neutral-200 transition-colors"
            aria-label="Close"
          >
            <X className="size-5" />
          </button>
        </div>

        <div className="mt-4 flex-1 overflow-auto bg-neutral-950 rounded-xl border border-neutral-800/80 p-4 flex items-center justify-center min-h-[350px]">
          {loading ? (
            <div className="flex flex-col items-center gap-2 text-neutral-400">
              <Loader2 className="size-7 animate-spin text-gold-300" />
              <span className="text-xs">Đang tải nội dung xem trước...</span>
            </div>
          ) : isImage ? (
            imageSrc ? (
              <div className="flex items-center justify-center w-full h-full p-2">
                <img
                  src={imageSrc}
                  alt={fileName}
                  className="max-w-full max-h-[70vh] object-contain rounded-lg shadow-lg select-none"
                />
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center gap-3 text-center p-6 bg-neutral-900/60 rounded-xl border border-neutral-800 max-w-md">
                <div className="size-16 rounded-2xl bg-gold-400/10 border border-gold-400/30 flex items-center justify-center text-gold-300">
                  <FileText className="size-8" />
                </div>
                <div>
                  <h4 className="font-medium text-neutral-200 text-sm truncate max-w-xs">{fileName}</h4>
                  <p className="text-xs text-neutral-400 mt-1">Tệp hình ảnh tri thức đã được trích xuất cho Agent</p>
                </div>
                <div className="text-[11px] text-neutral-400 font-mono bg-neutral-950 px-3 py-2 rounded-lg border border-neutral-850 w-full text-left whitespace-pre-wrap">
                  {content || `[Tệp hình ảnh: ${fileName} | Định dạng: ${ext.toUpperCase()}]`}
                </div>
              </div>
            )
          ) : (
            <div className="w-full h-full text-left font-mono text-xs text-neutral-300 whitespace-pre-wrap select-text leading-relaxed p-2">
              {content || "Không có nội dung văn bản nào được trích xuất từ tệp này."}
            </div>
          )}
        </div>

        <div className="mt-4 flex justify-end gap-2 shrink-0">
          <Button size="sm" onClick={onClose} className="bg-neutral-800 hover:bg-neutral-700 text-neutral-200">
            Đóng
          </Button>
        </div>
      </div>
    </div>
  );
}
