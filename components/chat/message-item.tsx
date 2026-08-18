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
  SmilePlus,
  Pencil,
} from "lucide-react";
import { useState, useEffect, useRef, memo } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { MessageSendPayload, ReplyPreview, sendMessageIdempotently } from "@/lib/chat/client";

const REACTION_OPTIONS = ["👍", "❤️", "😂", "😮", "😢"] as const;

interface User {
  _id: string;
  username: string;
  isAdmin: boolean;
}

interface Reaction {
  userId: string;
  emoji: string;
  createdAt?: string;
}

interface Message {
  _id: string;
  clientMessageId?: string;
  userId: string;
  username?: string;
  text?: string;
  imageUrl?: string | null;
  media?: { publicId?: string; deliveryType?: "upload" | "authenticated" } | null;
  imageMode?: "normal" | "once";
  onceViewedBy?: string[];
  onceAvailable?: boolean;
  onceViewed?: boolean;
  replyPreview?: ReplyPreview | null;
  reactions?: Reaction[];
  editedAt?: string | null;
  deleted?: boolean;
  seenBy?: string[];
  createdAt: string;
  deliveryState?: "sending" | "sent" | "failed";
  receiptState?: "sent" | "delivered" | "seen";
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
  const [reacting, setReacting] = useState(false);
  const [showReactionPicker, setShowReactionPicker] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editText, setEditText] = useState(message.text || "");
  const [savingEdit, setSavingEdit] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);
  const [openingOnce, setOpeningOnce] = useState(false);
  const [showFullImage, setShowFullImage] = useState(false);
  const [resolvedOnceUrl, setResolvedOnceUrl] = useState<string | null>(null);
  const [timeLeft, setTimeLeft] = useState<number | null>(null);

  const timerRef = useRef<NodeJS.Timeout | null>(null);
  const intervalRef = useRef<NodeJS.Timeout | null>(null);

  const isOnceImage = message.imageMode === "once";
  const isLocalMessage = message._id.startsWith("local-");
  const deliveryFailed = message.deliveryState === "failed";
  const deliveryPending = message.deliveryState === "sending" || retrying;
  const receiptState = message.receiptState || ((message.seenBy?.length ?? 0) > 0 ? "seen" : "sent");
  const hasBeenSeen = !message.deleted && receiptState === "seen";
  const hasBeenDelivered = hasBeenSeen || receiptState === "delivered";
  const canDelete = isMe && !currentUser.isAdmin && !isLocalMessage && !deliveryFailed;
  const canEdit = isMe && !currentUser.isAdmin && !message.deleted && !isLocalMessage && !deliveryFailed;
  const canReply = Boolean(onReply && !currentUser.isAdmin && !message.deleted && !isLocalMessage && !deliveryFailed);
  const canReact = !currentUser.isAdmin && !message.deleted && !isLocalMessage && !deliveryFailed;
  const canViewDirectly = isMe || currentUser.isAdmin;
  const alreadyViewed =
    !canViewDirectly &&
    (message.onceViewed === true ||
      (message.onceViewedBy?.includes(currentUser._id) ?? false) ||
      message.onceAvailable === false);
  const displayImageUrl = resolvedOnceUrl || message.imageUrl || null;

  const reactionGroups = (message.reactions || []).reduce<Record<string, { count: number; reactedByMe: boolean }>>(
    (groups, reaction) => {
      const current = groups[reaction.emoji] || { count: 0, reactedByMe: false };
      current.count += 1;
      if (reaction.userId?.toString() === currentUser._id) current.reactedByMe = true;
      groups[reaction.emoji] = current;
      return groups;
    },
    {},
  );

  const clearTimers = () => {
    if (timerRef.current) clearTimeout(timerRef.current);
    if (intervalRef.current) clearInterval(intervalRef.current);
    timerRef.current = null;
    intervalRef.current = null;
  };

  const markOnceExpiredLocally = () => {
    setResolvedOnceUrl(null);
    if (canViewDirectly) return;

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

  const makeReplyTarget = (): ReplyPreview => {
    const hasImage = isOnceImage || Boolean(message.imageUrl || message.media?.publicId);
    return {
      messageId: message._id,
      senderId: message.userId,
      senderName: message.username || (isMe ? "Bạn" : "Spackie user"),
      type: hasImage ? "image" : "text",
      content: isOnceImage
        ? "Ảnh xem một lần"
        : hasImage
          ? message.text?.trim() || "Ảnh"
          : message.text?.trim() || "Tin nhắn",
    };
  };

  useEffect(() => {
    if (!editing) setEditText(message.text || "");
  }, [message.text, editing]);

  useEffect(() => {
    return () => clearTimers();
  }, []);

  const handleSaveEdit = async () => {
    if (!canEdit || savingEdit) return;
    const nextText = editText.trim();
    const hasMedia = Boolean(message.imageUrl || message.media?.publicId || isOnceImage);
    if (!nextText && !hasMedia) {
      setEditError("Tin nhắn không thể để trống");
      return;
    }

    setSavingEdit(true);
    setEditError(null);
    try {
      const response = await fetch(`/api/messages/${message._id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: nextText }),
      });
      const data = await response.json().catch(() => null);
      if (!response.ok) throw new Error(data?.error || "Không thể chỉnh sửa tin nhắn");

      setMessages((previous) =>
        previous.map((item) => {
          const next = item._id === message._id ? { ...item, text: data.text, editedAt: data.editedAt } : { ...item };
          if (next.replyPreview?.messageId === message._id) {
            next.replyPreview = { ...next.replyPreview, content: data.replyContent };
          }
          return next;
        }),
      );
      setEditing(false);
    } catch (error) {
      setEditError(error instanceof Error ? error.message : "Không thể chỉnh sửa tin nhắn");
    } finally {
      setSavingEdit(false);
    }
  };

  const handleReaction = async (emoji: (typeof REACTION_OPTIONS)[number]) => {
    if (!canReact || reacting) return;
    setReacting(true);
    setShowReactionPicker(false);

    try {
      const response = await fetch(`/api/messages/${message._id}/reactions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ emoji }),
      });
      const data = await response.json().catch(() => null);
      if (!response.ok) throw new Error(data?.error || "Không thể reaction");

      setMessages((previous) =>
        previous.map((item) => (item._id === message._id ? { ...item, reactions: data.reactions || [] } : item)),
      );
    } catch (error) {
      console.error(error);
    } finally {
      setReacting(false);
    }
  };

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
            ? {
                ...serverMessage,
                deliveryState: "sent",
                receiptState: serverMessage.receiptState || "sent",
                retryPayload: undefined,
                deliveryError: undefined,
              }
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
      const response = await fetch(`/api/messages/${message._id}/once-viewed`, { method: "POST", cache: "no-store" });
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
      setTimeLeft(canViewDirectly ? null : 5);

      if (!canViewDirectly) {
        intervalRef.current = setInterval(() => {
          setTimeLeft((previous) => (previous && previous > 1 ? previous - 1 : 0));
        }, 1000);

        timerRef.current = setTimeout(() => {
          clearTimers();
          setShowFullImage(false);
          setTimeLeft(null);
          markOnceExpiredLocally();
        }, 5000);
      }
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
    } else if (canViewDirectly) {
      setResolvedOnceUrl(null);
    }
  };

  const handleDelete = async () => {
    if (!canDelete) return;
    setDeleting(true);
    try {
      const response = await fetch(`/api/messages/${message._id}`, { method: "DELETE" });
      if (!response.ok) throw new Error();
      setMessages((prev) =>
        prev.map((item) =>
          item._id === message._id ? { ...item, deleted: true, imageUrl: null, onceAvailable: false } : item,
        ),
      );
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

  const RenderText = () => {
    if (!editing) {
      return message.text ? <p className="text-[14px] leading-relaxed whitespace-pre-wrap tracking-normal">{message.text}</p> : null;
    }

    return (
      <div className="space-y-2 min-w-[220px]">
        <textarea
          value={editText}
          maxLength={160}
          autoFocus
          onChange={(event) => setEditText(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              setEditing(false);
              setEditError(null);
            }
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              void handleSaveEdit();
            }
          }}
          className="w-full min-h-16 resize-none rounded-lg border border-primary-foreground/20 bg-background/10 px-2.5 py-2 text-sm text-inherit outline-none focus:ring-2 focus:ring-primary-foreground/20"
        />
        {editError && <p className="text-[10px] text-destructive-foreground">{editError}</p>}
        <div className="flex justify-end gap-1.5">
          <button
            type="button"
            onClick={() => {
              setEditing(false);
              setEditText(message.text || "");
              setEditError(null);
            }}
            className="px-2 py-1 text-[10px] font-semibold opacity-70 hover:opacity-100">
            Hủy
          </button>
          <button
            type="button"
            onClick={() => void handleSaveEdit()}
            disabled={savingEdit}
            className="inline-flex items-center gap-1 px-2 py-1 text-[10px] font-semibold rounded-md bg-primary-foreground/15 disabled:opacity-50">
            {savingEdit && <Loader2 className="h-3 w-3 animate-spin" />}
            Lưu
          </button>
        </div>
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
            {message.imageUrl ? (
              <div className="relative w-24 h-16 rounded-md border border-destructive/20 grayscale opacity-40 overflow-hidden">
                <Image src={message.imageUrl} alt="Deleted" fill className="object-cover" unoptimized />
                <div className="absolute inset-0 flex items-center justify-center bg-background/20">
                  <Lock className="w-3 h-3 text-muted-foreground" />
                </div>
              </div>
            ) : isOnceImage && message.media ? (
              <Button variant="outline" size="sm" onClick={handleViewOnceImage} disabled={openingOnce} className="h-7 text-[10px] gap-1.5">
                {openingOnce ? <Loader2 className="h-3 w-3 animate-spin" /> : <Lock className="h-3 w-3" />}
                Kiểm tra media nội bộ
              </Button>
            ) : null}
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
        <RenderText />

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
        <div className="relative max-w-[85%] sm:max-w-[70%]">
          <div
            className={cn(
              "relative p-3.5 px-4 transition-all",
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
              {message.editedAt && !message.deleted && <span className="text-[9px]">đã sửa</span>}
              {isMe && !message.deleted && (
                <div className="flex items-center" aria-label={`Trạng thái: ${receiptState}`}>
                  {deliveryPending ? (
                    <Loader2 className="w-3 h-3 animate-spin" />
                  ) : deliveryFailed ? null : hasBeenSeen ? (
                    <CheckCheck className="w-3 h-3 stroke-[2.5px] opacity-100" aria-label="Đã xem" />
                  ) : hasBeenDelivered ? (
                    <CheckCheck className="w-3 h-3 stroke-[2.5px] opacity-70" aria-label="Đã nhận" />
                  ) : (
                    <Check className="w-3 h-3 stroke-[2.5px]" aria-label="Đã gửi" />
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

          {Object.keys(reactionGroups).length > 0 && !message.deleted && (
            <div className={cn("mt-1 flex flex-wrap gap-1", isMe ? "justify-end" : "justify-start")}>
              {Object.entries(reactionGroups).map(([emoji, group]) => (
                <button
                  key={emoji}
                  type="button"
                  disabled={!canReact || reacting}
                  onClick={() => handleReaction(emoji as (typeof REACTION_OPTIONS)[number])}
                  className={cn(
                    "h-6 min-w-7 px-1.5 rounded-full border bg-background text-[11px] shadow-sm transition-colors",
                    group.reactedByMe ? "border-primary/50 bg-primary/10" : "border-border/60",
                  )}>
                  {emoji}
                  {group.count > 1 ? <span className="ml-1 text-[9px] text-muted-foreground">{group.count}</span> : null}
                </button>
              ))}
            </div>
          )}
        </div>

        {(canReply || canDelete || canReact || canEdit) && (
          <div className="relative flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
            {canReact && (
              <Button
                variant="ghost"
                size="icon"
                onClick={() => setShowReactionPicker((value) => !value)}
                aria-label="Reaction"
                className="h-8 w-8 rounded-full text-muted-foreground hover:text-foreground hover:bg-muted">
                {reacting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <SmilePlus className="w-3.5 h-3.5" />}
              </Button>
            )}
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
            {canEdit && (
              <Button
                variant="ghost"
                size="icon"
                onClick={() => {
                  setEditing(true);
                  setShowReactionPicker(false);
                  setEditError(null);
                }}
                aria-label="Chỉnh sửa tin nhắn"
                className="h-8 w-8 rounded-full text-muted-foreground hover:text-foreground hover:bg-muted">
                <Pencil className="w-3.5 h-3.5" />
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

            {showReactionPicker && canReact && (
              <div
                className={cn(
                  "absolute bottom-10 z-20 flex items-center gap-1 rounded-full border border-border bg-background p-1.5 shadow-lg",
                  isMe ? "right-0" : "left-0",
                )}>
                {REACTION_OPTIONS.map((emoji) => (
                  <button
                    key={emoji}
                    type="button"
                    disabled={reacting}
                    onClick={() => handleReaction(emoji)}
                    className="h-8 w-8 rounded-full text-base hover:bg-muted transition-transform hover:scale-110 disabled:opacity-50">
                    {emoji}
                  </button>
                ))}
              </div>
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
