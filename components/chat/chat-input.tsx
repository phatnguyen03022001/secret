"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Send, Paperclip, X, Loader2, Eye, Reply } from "lucide-react";
import Image from "next/image";
import { compressImage, cn } from "@/lib/utils";
import { useAuth } from "@/context/AuthContext";
import { MessageSendPayload, ReplyPreview, sendMessageIdempotently } from "@/lib/chat/client";
import { toMediaPayload, uploadChatImageDirect } from "@/lib/media/client";
import { toast } from "sonner";

const MAX_MESSAGE_LENGTH = 160;
const MAX_UPLOAD_BYTES = 8 * 1024 * 1024;
const TYPING_IDLE_MS = 1300;
const ALLOWED_IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);

export default function ChatInput({
  roomId,
  setMessages,
  replyTo,
  onCancelReply,
}: {
  roomId: string;
  setMessages: React.Dispatch<React.SetStateAction<any[]>>;
  replyTo?: ReplyPreview | null;
  onCancelReply?: () => void;
}) {
  const { user } = useAuth();
  const [text, setText] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<number | null>(null);
  const [imageMode, setImageMode] = useState<"normal" | "once">("normal");
  const fileInputRef = useRef<HTMLInputElement>(null);
  const typingRef = useRef(false);
  const typingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const canSend = useMemo(() => Boolean(user && !user.isAdmin), [user]);

  const publishTyping = (typing: boolean) => {
    void fetch("/api/realtime/typing", {
      method: "POST",
      keepalive: true,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ roomId, typing }),
    }).catch(() => undefined);
  };

  const stopTyping = () => {
    if (typingTimerRef.current) {
      clearTimeout(typingTimerRef.current);
      typingTimerRef.current = null;
    }

    if (typingRef.current) {
      typingRef.current = false;
      publishTyping(false);
    }
  };

  const handleTextChange = (value: string) => {
    setText(value);

    if (!value.trim()) {
      stopTyping();
      return;
    }

    if (!typingRef.current) {
      typingRef.current = true;
      publishTyping(true);
    }

    if (typingTimerRef.current) clearTimeout(typingTimerRef.current);
    typingTimerRef.current = setTimeout(stopTyping, TYPING_IDLE_MS);
  };

  useEffect(() => {
    return () => {
      if (typingTimerRef.current) clearTimeout(typingTimerRef.current);
      if (typingRef.current) {
        typingRef.current = false;
        publishTyping(false);
      }
    };
  }, [roomId]);

  const replacePreview = (nextPreview: string | null) => {
    setPreview((current) => {
      if (current) URL.revokeObjectURL(current);
      return nextPreview;
    });
  };

  const handleFileChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = event.target.files?.[0];
    if (!selectedFile) return;

    try {
      if (!ALLOWED_IMAGE_TYPES.has(selectedFile.type)) throw new Error("Chỉ hỗ trợ JPEG, PNG, WebP hoặc GIF");

      let fileToPreview = selectedFile;
      if (selectedFile.size > 1 * 1024 * 1024) fileToPreview = await compressImage(selectedFile);
      if (!ALLOWED_IMAGE_TYPES.has(fileToPreview.type)) throw new Error("Định dạng ảnh không được hỗ trợ");
      if (fileToPreview.size <= 0 || fileToPreview.size > MAX_UPLOAD_BYTES) throw new Error("Ảnh phải nhỏ hơn 8 MB");

      setFile(fileToPreview);
      replacePreview(URL.createObjectURL(fileToPreview));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Không thể xử lý ảnh này");
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const removeFile = () => {
    setFile(null);
    replacePreview(null);
    setUploadProgress(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const send = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!user || !canSend || (!text.trim() && !file) || sending) return;

    stopTyping();
    setSending(true);
    const clientMessageId = crypto.randomUUID();
    const outgoingText = text.trim();
    const outgoingFile = file;
    const outgoingMode = outgoingFile ? imageMode : "normal";
    const outgoingReply = replyTo ?? null;
    let optimisticAdded = false;

    try {
      const uploaded = outgoingFile
        ? await uploadChatImageDirect(outgoingFile, outgoingMode, (progress) => setUploadProgress(progress))
        : null;
      const media = uploaded ? toMediaPayload(uploaded) : null;
      const payload: MessageSendPayload = {
        text: outgoingText,
        roomId,
        media,
        imageMode: outgoingMode,
        clientMessageId,
        replyToId: outgoingReply?.messageId ?? null,
      };

      const optimisticMessage = {
        _id: `local-${clientMessageId}`,
        clientMessageId,
        userId: user._id,
        username: user.displayName || user.username,
        text: outgoingText,
        media,
        imageUrl: outgoingMode === "normal" ? uploaded?.previewUrl || null : null,
        imageMode: outgoingMode,
        replyTo: outgoingReply?.messageId ?? null,
        replyPreview: outgoingReply,
        createdAt: new Date().toISOString(),
        seenBy: [],
        deliveryState: "sending",
        retryPayload: payload,
      };

      setMessages((previous) => [...previous, optimisticMessage]);
      optimisticAdded = true;
      setText("");
      removeFile();
      setImageMode("normal");
      onCancelReply?.();

      const serverMessage = await sendMessageIdempotently(payload);
      setMessages((previous) =>
        previous.map((message) =>
          message.clientMessageId === clientMessageId
            ? { ...serverMessage, deliveryState: "sent", retryPayload: undefined }
            : message,
        ),
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : "Gửi tin nhắn thất bại";

      if (optimisticAdded) {
        setMessages((previous) =>
          previous.map((item) =>
            item.clientMessageId === clientMessageId
              ? { ...item, deliveryState: "failed", deliveryError: message }
              : item,
          ),
        );
      } else {
        toast.error(message);
      }
    } finally {
      setSending(false);
      setUploadProgress(null);
    }
  };

  if (user?.isAdmin) return null;

  return (
    <div className="w-full">
      <div className="relative bg-background border border-border/60 rounded-3xl transition-all focus-within:border-primary/50 focus-within:ring-4 focus-within:ring-primary/5 overflow-hidden">
        {replyTo && (
          <div className="px-4 py-2.5 border-b border-border/40 bg-muted/20 flex items-center gap-3">
            <Reply className="h-4 w-4 shrink-0 text-primary" />
            <div className="min-w-0 flex-1 border-l-2 border-primary/50 pl-2.5">
              <p className="text-[10px] font-semibold text-primary truncate">Trả lời {replyTo.senderName}</p>
              <p className="text-[11px] text-muted-foreground truncate">{replyTo.content}</p>
            </div>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              onClick={onCancelReply}
              aria-label="Hủy trả lời"
              className="h-7 w-7 rounded-full shrink-0">
              <X className="h-3.5 w-3.5" />
            </Button>
          </div>
        )}

        {preview && (
          <div className="p-3 border-b border-border/40 flex items-center gap-4 bg-muted/20 animate-in fade-in slide-in-from-bottom-2">
            <div className="relative h-14 w-14 rounded-xl overflow-hidden border border-border">
              <Image src={preview} alt="preview" fill className="object-cover" />
              {!sending && (
                <button
                  type="button"
                  onClick={removeFile}
                  className="absolute inset-0 bg-background/80 flex items-center justify-center opacity-0 hover:opacity-100 transition-opacity">
                  <X className="w-4 h-4 text-foreground" />
                </button>
              )}
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex gap-2">
                <Button
                  type="button"
                  variant={imageMode === "once" ? "secondary" : "outline"}
                  size="sm"
                  disabled={sending}
                  onClick={() => setImageMode("normal")}
                  className="h-7 text-[10px] uppercase font-bold rounded-lg gap-1.5">
                  Mặc định
                </Button>
                <Button
                  type="button"
                  variant={imageMode === "once" ? "default" : "outline"}
                  size="sm"
                  disabled={sending}
                  onClick={() => setImageMode("once")}
                  className="h-7 text-[10px] uppercase font-bold rounded-lg gap-1.5">
                  <Eye className="w-3 h-3" />
                  Một lần
                </Button>
              </div>
              {uploadProgress !== null && (
                <div className="mt-2 flex items-center gap-2">
                  <div className="h-1 flex-1 overflow-hidden rounded-full bg-muted">
                    <div className="h-full bg-primary transition-[width] duration-150" style={{ width: `${uploadProgress}%` }} />
                  </div>
                  <span className="text-[9px] tabular-nums text-muted-foreground">{uploadProgress}%</span>
                </div>
              )}
            </div>
          </div>
        )}

        <form onSubmit={send} className="flex items-center gap-2 p-2">
          <input
            type="file"
            hidden
            ref={fileInputRef}
            onChange={handleFileChange}
            accept="image/jpeg,image/png,image/webp,image/gif"
          />

          <Button
            type="button"
            variant="ghost"
            size="icon"
            disabled={sending}
            onClick={() => fileInputRef.current?.click()}
            className="h-10 w-10 shrink-0 rounded-2xl text-muted-foreground hover:bg-muted">
            <Paperclip className="w-5 h-5" />
          </Button>

          <input
            value={text}
            maxLength={MAX_MESSAGE_LENGTH}
            disabled={sending}
            onChange={(event) => handleTextChange(event.target.value)}
            placeholder={file ? "Thêm ghi chú..." : replyTo ? "Nhập câu trả lời..." : "Nhập tin nhắn..."}
            className="flex-1 bg-transparent border-none outline-none focus:ring-0 py-2 text-base placeholder:text-muted-foreground/40 disabled:opacity-60"
          />

          <Button
            type="submit"
            disabled={sending || (!text.trim() && !file)}
            className={cn(
              "h-10 w-10 shrink-0 rounded-2xl transition-all",
              text.trim() || file ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground opacity-50",
            )}>
            {sending ? <Loader2 className="w-5 h-5 animate-spin" /> : <Send className="w-5 h-5" />}
          </Button>
        </form>
      </div>
    </div>
  );
}
