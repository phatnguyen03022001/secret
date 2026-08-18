"use client";

import Image from "next/image";
import {
  Trash2,
  X,
  ImageIcon,
  Clock,
  Check,
  CheckCheck,
  ShieldAlert,
  EyeOff,
  Loader2,
  Info,
  Lock,
  RotateCcw,
  Reply,
} from "lucide-react";
import { useState, useEffect, useRef, memo } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { MessageSendPayload, ReplyPreview, sendMessageIdempotently } from "@/lib/chat/client";

interface User {
  _id: string;
  username: string;
  isAdmin: boolean;
}

interface Message {
  _id: string;
  clientMessageId?: string;
  userId: string;
  username?: string;
  text?: string;
  imageUrl?: string | null;
  imageMode?: "normal" | "once";
  onceViewedBy?: string[];
  onceAvailable?: boolean;
  onceViewed?: boolean;
  replyPreview?: ReplyPreview | null;
  deleted?: boolean;
  seenBy?: string[];
  createdAt: string;
  deliveryState?: "sending" | "sent" | "failed";
  deliveryError?: string;
  retryPayload?: MessageSendPayload;
}

interface Props {
  message: Message;
  isMe: boolean;
  currentUser: User;
  setMessages: React.Dispatch<React.SetStateAction<any[]>>;
  onReply?: (target: ReplyPreview) => void;
}

function MessageItem({ message, isMe, currentUser, setMessages, onReply }: Props) {
  const [deleting, setDeleting] = useState(false);
  const [retrying, setRetrying] = useState(false);
  const [openingOnce, setOpeningOnce] = useState(false);
  const [showFullImage, setShowFullImage] = useState(false);
  const [resolvedOnceUrl, setResolvedOnceUrl] = useState<string | null>(null);
  const [timeLeft, setTimeLeft] = useState<number | null>(null);

  const timerRef = useRef<NodeJS.Timeout | null>(null);
  const intervalRef = useRef<NodeJS.Timeout | null>(null);

  const isOnceImage = message.imageMode === "once";
  const hasBeenSeen = !message.deleted && (message.seenBy?.length ?? 0) > 0;
  const isLocalMessage = message._id.startsWith("local-");
  const deliveryFailed = message.deliveryState === "failed";
  const deliveryPending = message.deliveryState === "sending" || retrying;
  const canDelete = isMe && !currentUser.isAdmin && !isLocalMessage && !deliveryFailed;
  const canReply = Boolean(onReply && !currentUser.isAdmin && !message.deleted && !isLocalMessage && !deliveryFailed);
  const canViewDirectly = isMe || currentUser.isAdmin;
  const alreadyViewed =
    message.onceViewed === true ||
    (!canViewDirectly && (message.onceViewedBy?.includes(currentUser._id) ?? false)) ||
    (!canViewDirectly && message.onceAvailable === false);
  const displayImageUrl = resolvedOnceUrl || message.imageUrl || null;

  const clearTimers = () => {
    if (timerRef.current) clearTimeout(timerRef.current);
    if (intervalRef.current) clearInterval(intervalRef.current);
    timerRef.current = null;
    intervalRef.current = null;
  };

  const markOnceExpiredLocally = () => {
    setResolvedOnceUrl(null);
    setMessages((prev) =>
      prev.map((item) =>
        item._id === message._id
          ? {
              ...item,
              imageUrl: null,
              onceAvailable: false,
              onceViewed: true,
              onceViewedBy: [...new Set([...(item.onceViewedBy || []), currentUser._id])],
            }
          : item,
      ),
    );
  };

  const makeReplyTarget = (): ReplyPreview => ({
    messageId: message._id,
    senderId: message.userId,
    senderName: message.username || (isMe ? "Bạn" : "Spackie user"),
    type: isOnceImage || message.imageUrl ? "image" : "text",
    content: isOnceImage ? "Ảnh xem một lần" : message.imageUrl ? message.text?.trim() || "Ảnh" : message.text?.trim() || "Tin nhắn",
  });

  useEffect(() => {
    return () => clearTimers();
  }, []);

  const handleRetry = async () => {
    if (!message.retryPayload || !message.clientMessageId || retrying) return;

    setRetrying(true);
    setMessages((previous) =>
      previous.map((item) =>
        item.clientMessageId === message.clientMessageId
          ? { ...item, deliveryState: "sending", deliveryError: undefined }
          : item,
      ),
    );

    try {
      const serverMessage = await sendMessageIdempotently(message.retryPayload);
      setMessages((previous) =>
        previous.map((item) =>
          item.clientMessageId === message.clientMessageId
            ? { ...serverMessage, deliveryState: "sent", retryPayload: undefined, deliveryError: undefined }
            : item,
        ),
      );
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Gửi tin nhắn thất bại";
      setMessages((previous) =>
        previous.map((item) =>
          item.clientMessageId === message.clientMessageId
            ? { ...item, deliveryState: "failed", deliveryError: errorMessage }
            : item,
        ),
      );
    } finally {
      setRetrying(false);
    }
  };

  const handleViewOnceImage = async () => {
    if (!isOnceImage || alreadyViewed || openingOnce || deliveryFailed || isLocalMessage) return;

    if (canViewDirectly && message.imageUrl) {
      setShowFullImage(true);
      return;
    }

    setOpeningOnce(true);
    try {
      const response = await fetch(`/api/messages/${message._id}/once-viewed`, { method: "POST" });
      if (!response.ok) {
        markOnceExpiredLocally();
        return;
      }

      const data = await response.json();
      if (!data.imageUrl) {
        markOnceExpiredLocally();
        return;
      }

      setResolvedOnceUrl(data.imageUrl);
      setShowFullImage(true);
      setTimeLeft(5);

      intervalRef.current = setInterval(() => {
        setTimeLeft((previous) => (previous && previous > 1 ? previous - 1 : 0));
      }, 1000);

      timerRef.current = setTimeout(() => {
        clearTimers();
        setShowFullImage(false);
        setTimeLeft(null);
        markOnceExpiredLocally();
      }, 5000);
    } catch {
      markOnceExpiredLocally();
    } finally {
      setOpeningOnce(false);
    }
  };

  const handleCloseModal = () => {
    clearTimers();
    setShowFullImage(false);
    setTimeLeft(null);

    if (isOnceImage && !canViewDirectly && resolvedOnceUrl) {
      markOnceExpiredLocally();
    }
  };

  const handleDelete = async () => {
    if (!canDelete) return;
    setDeleting(true);
    try {
      const response = await fetch(`/api/messages/${message._id}`, { method: "DELETE" });
      if (!response.ok) throw new Error();
      setMessages((prev) => prev.map((item) => (item._id === message._id ? { ...item, deleted: true } : item)));
    } catch {
      console.error("Failed to revoke message");
    } finally {
      setDeleting(false);
    }
  };

  const RenderReplyQuote = () => {
    if (!message.replyPreview) return null;

    return (
      <div
        className={cn(
          "mb-2.5 rounded-lg border-l-2 px-2.5 py-2 text-left min-w-0",
          isMe
            ? "border-primary-foreground/60 bg-primary-foreground/10"
            : "border-primary/50 bg-background/60",
        )}>
        <p className={cn("text-[10px] font-semibold truncate", isMe ? "text-primary-foreground/80" : "text-primary")}>
          {message.replyPreview.senderName}
        </p>
        <p className={cn("text-[11px] truncate", isMe ? "text-primary-foreground/70" : "text-muted-foreground")}>
          {message.replyPreview.content}
        </p>
      </div>
    );
  };

  const RenderContent = () => {
    if (message.deleted) {
      if (currentUser.isAdmin) {
        return (
          <div className="space-y-2 border-l-2 border-destructive/50 pl-3 py-1 bg-destructive/5 rounded-sm">
            <div className="flex items-center gap-2 text-[10px] font-medium text-destructive uppercase tracking-wider">
              <ShieldAlert className="w-3.5 h-3.5" /> Log: Revoked
            </div>
            {message.text && <p className="text-sm text-muted-foreground italic leading-relaxed">{message.text}</p>}
            {message.imageUrl && (
              <div className="relative w-24 h-16 rounded-md border border-destructive/20 grayscale opacity-40 overflow-hidden">
                <Image src={message.imageUrl} alt="Deleted" fill className="object-cover" />
                <div className="absolute inset-0 flex items-center justify-center bg-background/20">
                  <Lock className="w-3 h-3 text-muted-foreground" />
                </div>
              </div>
            )}
          </div>
        );
      }

      return (
        <div className="flex items-center gap-2 text-muted-foreground/60 py-0.5 select-none">
          <EyeOff className="w-3.5 h-3.5" />
          <p className="text-xs font-medium tracking-wide">Tin nhắn đã thu hồi</p>
        </div>
      );
    }

    return (
      <div className="space-y-2.5">
        <RenderReplyQuote />
        {message.text && <p className="text-[14px] leading-relaxed whitespace-pre-wrap tracking-normal">{message.text}</p>}

        {(message.imageUrl || isOnceImage) && (
          <div className="pt-0.5">
            {!isOnceImage && message.imageUrl ? (
              <div
                className={cn(
                  "relative overflow-hidden cursor-pointer group/img transition-all hover:ring-2 hover:ring-primary/20",
                  "rounded-lg border border-border bg-muted",
                  "w-full max-w-[200px] aspect-[4/3] sm:max-w-[240px]",
                )}
                onClick={() => setShowFullImage(true)}>
                <Image
                  src={message.imageUrl}
                  alt="Chat media"
                  fill
                  className="object-cover transition-transform duration-500 group-hover/img:scale-105"
                  unoptimized
                />
                <div className="absolute inset-0 bg-black/0 group-hover/img:bg-black/10 transition-colors flex items-center justify-center">
                  <ImageIcon className="w-5 h-5 text-white opacity-0 group-hover/img:opacity-100 transition-opacity" />
                </div>
              </div>
            ) : canViewDirectly && message.imageUrl ? (
              <div
                className="relative overflow-hidden cursor-pointer rounded-lg border border-border bg-muted w-full max-w-[200px] aspect-[4/3] sm:max-w-[240px]"
                onClick={() => setShowFullImage(true)}>
                <Image src={message.imageUrl} alt="View once media" fill className="object-cover" unoptimized />
                <div className="absolute top-1.5 left-1.5 bg-background/90 backdrop-blur-sm text-[8px] font-bold px-1.5 py-0.5 rounded border border-border uppercase">
                  Xem một lần
                </div>
              </div>
            ) : isMe ? (
              <div className="inline-flex items-center gap-2 px-3 py-2 rounded-lg border border-primary-foreground/20 bg-primary-foreground/10">
                <ImageIcon className="w-4 h-4" />
                <span className="text-xs font-semibold">Đã gửi ảnh xem một lần</span>
              </div>
            ) : alreadyViewed ? (
              <div className="inline-flex items-center gap-2 px-3 py-1.5 bg-muted/50 rounded-md border border-border">
                <Info className="w-3.5 h-3.5 text-muted-foreground" />
                <span className="text-xs font-medium text-muted-foreground">Ảnh đã hết hạn</span>
              </div>
            ) : (
              <Button
                variant="secondary"
                onClick={handleViewOnceImage}
                disabled={openingOnce}
                className="h-10 w-full max-w-[200px] rounded-lg gap-2 border border-primary/10 transition-all hover:bg-primary/5 active:scale-95">
                {openingOnce ? <Loader2 className="w-4 h-4 animate-spin" /> : <ImageIcon className="w-4 h-4 text-primary" />}
                <span className="text-xs font-semibold">{openingOnce ? "Đang mở..." : "Xem ảnh một lần"}</span>
              </Button>
            )}
          </div>
        )}
      </div>
    );
  };

  return (
    <>
      <div className={cn("flex group relative w-full mb-3 items-end gap-2", isMe ? "flex-row-reverse" : "flex-row")}>
        <div
          className={cn(
            "relative p-3.5 px-4 transition-all max-w-[85%] sm:max-w-[70%]",
            isMe
              ? "bg-primary text-primary-foreground rounded-2xl rounded-br-none shadow-sm"
              : "bg-muted text-foreground rounded-2xl rounded-bl-none border border-border shadow-sm",
            message.deleted && "bg-transparent border-dashed border-border/50 shadow-none",
            deliveryPending && "opacity-70",
            deliveryFailed && "ring-1 ring-destructive/50 opacity-80",
          )}>
          <RenderContent />

          <div className={cn("mt-1.5 flex items-center gap-1.5 opacity-60", isMe ? "justify-end" : "justify-start")}>
            <span className="text-[10px] font-medium tracking-tight">
              {new Date(message.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
            </span>
            {isMe && !message.deleted && (
              <div className="flex items-center">
                {deliveryPending ? (
                  <Loader2 className="w-3 h-3 animate-spin" />
                ) : deliveryFailed ? null : hasBeenSeen ? (
                  <CheckCheck className="w-3 h-3 stroke-[2.5px]" />
                ) : (
                  <Check className="w-3 h-3 stroke-[2.5px]" />
                )}
              </div>
            )}
          </div>

          {isMe && deliveryFailed && message.retryPayload && (
            <button
              type="button"
              onClick={handleRetry}
              disabled={retrying}
              className="mt-2 inline-flex items-center gap-1.5 text-[11px] font-semibold text-primary-foreground underline underline-offset-2 disabled:opacity-50">
              <RotateCcw className="h-3 w-3" />
              {retrying ? "Đang thử lại..." : "Không gửi được · Thử lại"}
            </button>
          )}
        </div>

        {(canReply || canDelete) && (
          <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
            {canReply && onReply && (
              <Button
                variant="ghost"
                size="icon"
                onClick={() => onReply(makeReplyTarget())}
                aria-label="Trả lời tin nhắn"
                className="h-8 w-8 rounded-full text-muted-foreground hover:text-foreground hover:bg-muted">
                <Reply className="w-3.5 h-3.5" />
              </Button>
            )}
            {canDelete && (
              <Button
                variant="ghost"
                size="icon"
                onClick={handleDelete}
                disabled={deleting}
                aria-label="Thu hồi tin nhắn"
                className="h-8 w-8 rounded-full text-muted-foreground hover:text-destructive hover:bg-destructive/10">
                {deleting ? <Loader2 className="w-3 h-3 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
              </Button>
            )}
          </div>
        )}
      </div>

      {showFullImage && displayImageUrl && (
        <div
          className="fixed inset-0 z-100 bg-background/95 backdrop-blur-sm flex flex-col animate-in fade-in duration-200"
          onClick={handleCloseModal}>
          <div className="p-4 flex justify-end">
            <Button variant="ghost" size="icon" onClick={handleCloseModal} className="h-10 w-10 rounded-full hover:bg-muted">
              <X className="w-5 h-5" />
            </Button>
          </div>

          <div className="flex-1 flex flex-col items-center justify-center p-4 gap-6" onClick={(event) => event.stopPropagation()}>
            <div className="relative max-w-4xl w-full bg-card rounded-xl overflow-hidden shadow-2xl border border-border">
              <Image
                src={displayImageUrl}
                alt="Fullscreen"
                width={1200}
                height={1200}
                className={cn(
                  "object-contain max-h-[70vh] w-full transition-all duration-500",
                  timeLeft === 0 ? "blur-2xl opacity-0 scale-105" : "blur-0 opacity-100 scale-100",
                )}
                unoptimized
              />
            </div>

            <div className="flex flex-col items-center gap-3">
              {!canViewDirectly && isOnceImage && timeLeft !== null && (
                <div
                  className={cn(
                    "flex items-center gap-2 px-4 py-2 rounded-full border shadow-sm font-semibold text-xs transition-colors",
                    timeLeft <= 2
                      ? "bg-destructive text-destructive-foreground border-destructive"
                      : "bg-muted text-foreground",
                  )}>
                  <Clock className={cn("w-3.5 h-3.5", timeLeft <= 2 && "animate-pulse")} />
                  Ảnh tự đóng sau: {timeLeft}s
                </div>
              )}

              {currentUser.isAdmin && (
                <div className="flex items-center gap-2 bg-secondary/80 px-4 py-2 rounded-full border border-border shadow-sm">
                  <ShieldAlert className="w-3.5 h-3.5 text-primary" />
                  <span className="text-[11px] font-bold uppercase tracking-wider">Chế độ giám sát (Admin)</span>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}

export default memo(MessageItem);
