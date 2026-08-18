"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Send, Paperclip, X, Loader2, Eye } from "lucide-react";
import Image from "next/image";
import { compressImage, cn } from "@/lib/utils";
import { useAuth } from "@/context/AuthContext";
import { MessageSendPayload, sendMessageIdempotently } from "@/lib/chat/client";
import { toast } from "sonner";

const MAX_MESSAGE_LENGTH = 160;
const TYPING_IDLE_MS = 1300;

const uploadImageViaApi = async (file: File): Promise<string> => {
  const formData = new FormData();
  formData.append("file", file);
  const response = await fetch("/api/upload", { method: "POST", body: formData });
  const data = await response.json().catch(() => null);
  if (!response.ok) throw new Error(data?.error || "Upload thất bại");
  return data.url;
};

export default function ChatInput({
  roomId,
  setMessages,
}: {
  roomId: string;
  setMessages: React.Dispatch<React.SetStateAction<any[]>>;
}) {
  const { user } = useAuth();
  const [text, setText] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
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
      let fileToPreview = selectedFile;
      if (selectedFile.size > 1 * 1024 * 1024) fileToPreview = await compressImage(selectedFile);

      setFile(fileToPreview);
      replacePreview(URL.createObjectURL(fileToPreview));
    } catch {
      toast.error("Không thể xử lý ảnh này");
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const removeFile = () => {
    setFile(null);
    replacePreview(null);
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
    let optimisticAdded = false;

    try {
      const imageUrl = outgoingFile ? await uploadImageViaApi(outgoingFile) : null;
      const payload: MessageSendPayload = {
        text: outgoingText,
        roomId,
        imageUrl,
        imageMode: outgoingMode,
        clientMessageId,
      };

      const optimisticMessage = {
        _id: `local-${clientMessageId}`,
        clientMessageId,
        userId: user._id,
        username: user.displayName || user.username,
        text: outgoingText,
        imageUrl,
        imageMode: outgoingMode,
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
    }
  };

  if (user?.isAdmin) return null;

  return (
    <div className="w-full">
      <div className="relative bg-background border border-border/60 rounded-3xl transition-all focus-within:border-primary/50 focus-within:ring-4 focus-within:ring-primary/5">
        {preview && (
          <div className="p-3 border-b border-border/40 flex items-center gap-4 bg-muted/20 rounded-t-3xl animate-in fade-in slide-in-from-bottom-2">
            <div className="relative h-14 w-14 rounded-xl overflow-hidden border border-border">
              <Image src={preview} alt="preview" fill className="object-cover" />
              <button
                type="button"
                onClick={removeFile}
                className="absolute inset-0 bg-background/80 flex items-center justify-center opacity-0 hover:opacity-100 transition-opacity">
                <X className="w-4 h-4 text-foreground" />
              </button>
            </div>
            <div className="flex gap-2">
              <Button
                type="button"
                variant={imageMode === "once" ? "secondary" : "outline"}
                size="sm"
                onClick={() => setImageMode("normal")}
                className="h-7 text-[10px] uppercase font-bold rounded-lg gap-1.5">
                Mặc định
              </Button>
              <Button
                type="button"
                variant={imageMode === "once" ? "default" : "outline"}
                size="sm"
                onClick={() => setImageMode("once")}
                className="h-7 text-[10px] uppercase font-bold rounded-lg gap-1.5">
                <Eye className="w-3 h-3" />
                Một lần
              </Button>
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
            onChange={(event) => handleTextChange(event.target.value)}
            placeholder={file ? "Thêm ghi chú..." : "Nhập tin nhắn..."}
            className="flex-1 bg-transparent border-none outline-none focus:ring-0 py-2 text-base placeholder:text-muted-foreground/40"
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
