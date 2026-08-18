"use client";

import { useEffect, useRef, useCallback, useState } from "react";
import { formatDistanceToNow } from "date-fns";
import { vi } from "date-fns/locale";
import { toast } from "sonner";
import MessageItem from "./message-item";
import ChatInput from "./chat-input";
import {
  Ban,
  Clock3,
  Flame,
  Loader2,
  ChevronDown,
  ChevronLeft,
  History,
  UserRoundPen,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useConversationPresence } from "@/hooks/use-presence";
import type { ReplyPreview } from "@/lib/chat/client";
import type { ConversationMeta } from "@/hooks/use-chat";

interface ChatContainerProps {
  currentUser: {
    _id: string;
    username: string;
    displayName?: string;
    accountType?: "registered" | "guest";
    isAdmin: boolean;
  };
  targetUser: {
    _id: string;
    username: string;
    displayName?: string;
    profileDisplayName?: string;
    accountType?: "registered" | "guest";
    lastActive?: string | null;
  };
  roomId: string;
  readOnly?: boolean;
  messages: any[];
  setMessages: React.Dispatch<React.SetStateAction<any[]>>;
  loadMoreOlder: () => Promise<void>;
  hasMore: boolean;
  loading?: boolean;
  loadingMore?: boolean;
  peerTyping?: { userId: string; displayName: string } | null;
  conversationMeta?: ConversationMeta | null;
  setConversationMeta?: React.Dispatch<React.SetStateAction<ConversationMeta | null>>;
  onBack?: () => void;
}

function formatLastSeen(value?: string | null) {
  if (!value) return "Ngoại tuyến";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Ngoại tuyến";
  return `Hoạt động ${formatDistanceToNow(date, { addSuffix: true, locale: vi })}`;
}

function getLifecycleLabel(meta?: ConversationMeta | null) {
  if (!meta || meta.lifecycle === "persistent") return null;
  if (!meta.expiresAt) return meta.lifecycle === "quick" ? "Quick · 24 giờ" : "Temporary · 7 ngày";

  const expiresAt = new Date(meta.expiresAt);
  if (Number.isNaN(expiresAt.getTime())) return meta.lifecycle === "quick" ? "Quick · 24 giờ" : "Temporary · 7 ngày";
  return `Tự xoá trong ${formatDistanceToNow(expiresAt, { locale: vi })}`;
}

export default function ChatContainer({
  currentUser,
  targetUser,
  roomId,
  readOnly = false,
  messages,
  setMessages,
  loadMoreOlder,
  hasMore,
  loading = false,
  loadingMore = false,
  peerTyping = null,
  conversationMeta = null,
  setConversationMeta,
  onBack,
}: ChatContainerProps) {
  const scrollViewportRef = useRef<HTMLDivElement>(null);
  const [showScrollButton, setShowScrollButton] = useState(false);
  const [replyTarget, setReplyTarget] = useState<ReplyPreview | null>(null);
  const [burnBusy, setBurnBusy] = useState(false);
  const [blockBusy, setBlockBusy] = useState(false);
  const [identityOpen, setIdentityOpen] = useState(false);
  const [identityBusy, setIdentityBusy] = useState(false);
  const [aliasDraft, setAliasDraft] = useState("");
  const isUserAtBottomRef = useRef(true);
  const prevMessagesLengthRef = useRef(0);
  const lastMessageIdRef = useRef<string | null>(null);
  const hasMarkedSeenRef = useRef<string | null>(null);
  const observedUserId = currentUser.isAdmin ? targetUser._id : currentUser._id;
  const lastMessageId = messages[messages.length - 1]?._id;
  const profileTargetName = targetUser.profileDisplayName || targetUser.displayName || targetUser.username;
  const targetDisplayName = conversationMeta?.identity?.peerAlias || targetUser.displayName || targetUser.username;
  const targetIsTyping = peerTyping?.userId === targetUser._id;
  const { peerOnline } = useConversationPresence(roomId, targetUser._id);
  const lifecycleLabel = getLifecycleLabel(conversationMeta);
  const burn = conversationMeta?.burn;
  const access = conversationMeta?.access;
  const messagingBlocked = Boolean(access?.blockedByMe || access?.blockedMe);
  const canEditIdentity =
    !readOnly && !currentUser.isAdmin && currentUser.accountType !== "guest" && Boolean(conversationMeta);

  const presenceLabel = targetIsTyping
    ? "đang nhập..."
    : peerOnline
      ? "Đang hoạt động"
      : formatLastSeen(targetUser.lastActive);

  useEffect(() => {
    setReplyTarget(null);
    setBurnBusy(false);
    setBlockBusy(false);
    setIdentityOpen(false);
    setIdentityBusy(false);
    setAliasDraft("");
  }, [roomId]);

  useEffect(() => {
    if (!identityOpen) return;
    setAliasDraft(conversationMeta?.identity?.myAlias || "");
  }, [identityOpen, conversationMeta?.identity?.myAlias]);

  useEffect(() => {
    if (!lastMessageId) return;
    const lastMsg = messages[messages.length - 1];
    if (!lastMsg) return;

    const isFromOther = lastMsg.userId !== currentUser._id;
    const alreadySeen = lastMsg.seenBy?.includes(currentUser._id);
    const shouldMark = isFromOther && !alreadySeen && !currentUser.isAdmin;

    if (!shouldMark || hasMarkedSeenRef.current === lastMsg._id) return;
    hasMarkedSeenRef.current = lastMsg._id;

    const markAsSeen = async () => {
      try {
        const response = await fetch("/api/messages/seen", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ roomId, messageId: lastMsg._id }),
        });
        if (!response.ok) return;

        setMessages((prev) =>
          prev.map((msg) =>
            msg._id === lastMsg._id ? { ...msg, seenBy: [...new Set([...(msg.seenBy || []), currentUser._id])] } : msg,
          ),
        );
      } catch (error) {
        console.error("Failed to mark as seen", error);
      }
    };

    markAsSeen();
  }, [lastMessageId, currentUser._id, currentUser.isAdmin, roomId, setMessages, messages]);

  const updateBurnState = (requestedBy: string[]) => {
    setConversationMeta?.((previous) =>
      previous
        ? {
            ...previous,
            burn: {
              requestedBy,
              requestedByMe: requestedBy.includes(currentUser._id),
              requestedByPeer: requestedBy.some((id) => id !== currentUser._id),
            },
          }
        : previous,
    );
  };

  const updateAccessState = (nextAccess: { blockedByMe: boolean; blockedMe: boolean }) => {
    setConversationMeta?.((previous) => (previous ? { ...previous, access: nextAccess } : previous));
  };

  const saveIdentity = async () => {
    if (!canEditIdentity || identityBusy) return;
    const trimmed = aliasDraft.trim();
    if (trimmed && trimmed.length < 2) {
      toast.error("Tên trong chat cần ít nhất 2 ký tự");
      return;
    }

    setIdentityBusy(true);
    try {
      const response = await fetch(`/api/rooms/${encodeURIComponent(roomId)}/identity`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ alias: trimmed || null }),
      });
      const data = await response.json().catch(() => null);
      if (!response.ok) throw new Error(data?.error || "Không thể đổi tên trong chat");

      setConversationMeta?.((previous) =>
        previous
          ? {
              ...previous,
              identity: { ...previous.identity, myAlias: data.alias || null },
            }
          : previous,
      );
      setIdentityOpen(false);
      toast.success(data.alias ? `Đang hiển thị là ${data.alias}` : "Đã dùng lại tên profile trong chat này");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Không thể đổi tên trong chat");
    } finally {
      setIdentityBusy(false);
    }
  };

  const requestBurn = async () => {
    if (burnBusy || currentUser.isAdmin) return;
    setBurnBusy(true);

    try {
      const response = await fetch(`/api/rooms/${encodeURIComponent(roomId)}/burn`, { method: "POST" });
      const data = await response.json().catch(() => null);
      if (!response.ok) throw new Error(data?.error || "Không thể gửi yêu cầu burn");
      if (!data?.burned) updateBurnState(data?.requestedBy || []);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Không thể gửi yêu cầu burn");
    } finally {
      setBurnBusy(false);
    }
  };

  const cancelBurn = async () => {
    if (burnBusy || currentUser.isAdmin) return;
    setBurnBusy(true);

    try {
      const response = await fetch(`/api/rooms/${encodeURIComponent(roomId)}/burn`, { method: "DELETE" });
      const data = await response.json().catch(() => null);
      if (!response.ok) throw new Error(data?.error || "Không thể huỷ yêu cầu burn");
      updateBurnState(data?.requestedBy || []);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Không thể huỷ yêu cầu burn");
    } finally {
      setBurnBusy(false);
    }
  };

  const blockTarget = async () => {
    if (blockBusy || currentUser.isAdmin) return;
    setBlockBusy(true);

    try {
      const response = await fetch(`/api/users/${encodeURIComponent(targetUser._id)}/block`, { method: "POST" });
      const data = await response.json().catch(() => null);
      if (!response.ok) throw new Error(data?.error || "Không thể chặn người dùng");
      updateAccessState({ blockedByMe: true, blockedMe: Boolean(data?.blockedMe) });
      setReplyTarget(null);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Không thể chặn người dùng");
    } finally {
      setBlockBusy(false);
    }
  };

  const unblockTarget = async () => {
    if (blockBusy || currentUser.isAdmin) return;
    setBlockBusy(true);

    try {
      const response = await fetch(`/api/users/${encodeURIComponent(targetUser._id)}/block`, { method: "DELETE" });
      const data = await response.json().catch(() => null);
      if (!response.ok) throw new Error(data?.error || "Không thể bỏ chặn");
      updateAccessState({ blockedByMe: Boolean(data?.blockedByMe), blockedMe: Boolean(data?.blockedMe) });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Không thể bỏ chặn");
    } finally {
      setBlockBusy(false);
    }
  };

  const scrollToBottom = useCallback((behavior: ScrollBehavior = "smooth") => {
    if (!scrollViewportRef.current) return;
    scrollViewportRef.current.scrollTo({ top: scrollViewportRef.current.scrollHeight, behavior });
  }, []);

  const handleLoadMore = async () => {
    if (!scrollViewportRef.current || loadingMore) return;
    const container = scrollViewportRef.current;
    const oldScrollHeight = container.scrollHeight;
    const oldScrollTop = container.scrollTop;

    await loadMoreOlder();

    setTimeout(() => {
      const newScrollHeight = container.scrollHeight;
      container.scrollTop = oldScrollTop + (newScrollHeight - oldScrollHeight);
    }, 0);
  };

  const handleScroll = useCallback(() => {
    if (!scrollViewportRef.current) return;
    const { scrollTop, scrollHeight, clientHeight } = scrollViewportRef.current;
    const isAtBottom = scrollHeight - scrollTop - clientHeight < 200;
    isUserAtBottomRef.current = isAtBottom;
    setShowScrollButton(!isAtBottom);
  }, []);

  useEffect(() => {
    if (loading || messages.length === 0) return;
    const lastMsg = messages[messages.length - 1];
    const isNewMessage = lastMsg?._id !== lastMessageIdRef.current;

    if (
      prevMessagesLengthRef.current === 0 ||
      (isNewMessage && (isUserAtBottomRef.current || lastMsg?.userId === currentUser._id))
    ) {
      const behavior = prevMessagesLengthRef.current === 0 ? "auto" : "smooth";
      const timer = setTimeout(() => scrollToBottom(behavior), 50);
      lastMessageIdRef.current = lastMsg?._id;
      prevMessagesLengthRef.current = messages.length;
      return () => clearTimeout(timer);
    }

    lastMessageIdRef.current = lastMsg?._id;
    prevMessagesLengthRef.current = messages.length;
  }, [messages, loading, currentUser._id, scrollToBottom]);

  return (
    <div className="flex flex-col h-full bg-background relative">
      <header className="h-14 md:h-16 shrink-0 px-4 flex items-center justify-between gap-3 border-b border-border bg-background/80 backdrop-blur-md sticky top-0 z-30">
        <div className="flex items-center gap-3 min-w-0">
          {onBack && (
            <Button variant="ghost" size="icon" onClick={onBack} className="md:hidden -ml-2 h-9 w-9">
              <ChevronLeft className="w-5 h-5" />
            </Button>
          )}
          <div className="relative h-9 w-9 rounded-full bg-muted border border-border flex items-center justify-center font-bold text-xs shrink-0">
            {targetDisplayName.slice(0, 1).toUpperCase()}
            {peerOnline && !messagingBlocked && (
              <span className="absolute -right-0.5 -bottom-0.5 h-2.5 w-2.5 rounded-full bg-emerald-500 ring-2 ring-background" />
            )}
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h3 className="text-sm font-bold truncate leading-none">{targetDisplayName}</h3>
              {targetUser.accountType === "guest" && (
                <span className="text-[9px] uppercase tracking-wide text-muted-foreground">Guest</span>
              )}
              {conversationMeta?.identity?.peerAlias && (
                <span className="hidden sm:inline text-[9px] text-muted-foreground truncate">· {profileTargetName}</span>
              )}
            </div>
            <p className={`text-[10px] mt-1 truncate ${peerOnline || targetIsTyping ? "text-emerald-600 dark:text-emerald-400" : "text-muted-foreground"}`}>
              {messagingBlocked ? "Messaging unavailable" : presenceLabel}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-1 shrink-0">
          {lifecycleLabel && (
            <span className="hidden sm:inline-flex items-center gap-1 rounded-full border border-border px-2 py-1 text-[10px] text-muted-foreground mr-1">
              <Clock3 className="h-3 w-3" />
              {lifecycleLabel}
            </span>
          )}
          {canEditIdentity && (
            <Button
              variant="ghost"
              size="icon"
              disabled={identityBusy}
              onClick={() => setIdentityOpen((value) => !value)}
              aria-label="Đổi tên trong chat"
              title="Tên trong chat"
              className="h-8 w-8 text-muted-foreground hover:text-foreground">
              {identityBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <UserRoundPen className="h-4 w-4" />}
            </Button>
          )}
          {!readOnly && !currentUser.isAdmin && conversationMeta && !messagingBlocked && (
            <Button
              variant="ghost"
              size="icon"
              disabled={blockBusy}
              onClick={blockTarget}
              aria-label="Chặn người dùng"
              title="Chặn người dùng"
              className="h-8 w-8 text-muted-foreground hover:text-destructive hover:bg-destructive/10">
              {blockBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Ban className="h-4 w-4" />}
            </Button>
          )}
          {!readOnly && !currentUser.isAdmin && !burn?.requestedByPeer && !burn?.requestedByMe && (
            <Button
              variant="ghost"
              size="icon"
              disabled={burnBusy}
              onClick={requestBurn}
              aria-label="Đề nghị burn conversation"
              title="Đề nghị xoá vĩnh viễn conversation"
              className="h-8 w-8 text-muted-foreground hover:text-destructive hover:bg-destructive/10">
              {burnBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Flame className="h-4 w-4" />}
            </Button>
          )}
        </div>
      </header>

      {identityOpen && canEditIdentity && (
        <div className="border-b border-border/60 bg-muted/10 px-4 py-3">
          <div className="mx-auto flex max-w-xl flex-col gap-2">
            <div>
              <p className="text-xs font-semibold">Tên của bạn trong conversation này</p>
              <p className="mt-0.5 text-[10px] text-muted-foreground">
                Chỉ đổi tên hiển thị trong chat này. Username @{currentUser.username} và profile chính không đổi.
              </p>
            </div>
            <div className="flex gap-2">
              <Input
                value={aliasDraft}
                maxLength={32}
                disabled={identityBusy}
                onChange={(event) => setAliasDraft(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") void saveIdentity();
                  if (event.key === "Escape") setIdentityOpen(false);
                }}
                placeholder={currentUser.displayName || currentUser.username}
                className="h-8 text-xs"
              />
              <Button size="sm" className="h-8 text-xs" disabled={identityBusy} onClick={saveIdentity}>
                {identityBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Lưu"}
              </Button>
              {conversationMeta?.identity?.myAlias && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-8 text-xs"
                  disabled={identityBusy}
                  onClick={() => {
                    setAliasDraft("");
                    queueMicrotask(() => {
                      const input = document.activeElement as HTMLInputElement | null;
                      input?.blur();
                    });
                  }}>
                  Reset
                </Button>
              )}
            </div>
          </div>
        </div>
      )}

      {lifecycleLabel && (
        <div className="sm:hidden px-4 py-1.5 border-b border-border/50 text-[10px] text-muted-foreground flex items-center gap-1.5">
          <Clock3 className="h-3 w-3" />
          {lifecycleLabel}
        </div>
      )}

      {access?.blockedByMe && !currentUser.isAdmin && (
        <div className="px-4 py-2.5 border-b border-border bg-muted/20 flex items-center gap-3">
          <div className="flex-1 min-w-0">
            <p className="text-xs font-medium">Bạn đã chặn {targetDisplayName}. Lịch sử vẫn được giữ, gửi tin nhắn đã bị khoá.</p>
          </div>
          <Button variant="outline" size="sm" disabled={blockBusy} onClick={unblockTarget} className="h-7 text-xs">
            {blockBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Bỏ chặn"}
          </Button>
        </div>
      )}

      {access?.blockedMe && !access.blockedByMe && !currentUser.isAdmin && (
        <div className="px-4 py-2.5 border-b border-border bg-muted/20 text-xs text-muted-foreground">
          Không thể gửi tin nhắn trong cuộc trò chuyện này. Lịch sử cũ vẫn có thể xem.
        </div>
      )}

      {burn?.requestedByPeer && !burn.requestedByMe && !currentUser.isAdmin && (
        <div className="px-4 py-3 border-b border-destructive/20 bg-destructive/5 flex flex-col sm:flex-row sm:items-center gap-3">
          <div className="flex-1 min-w-0">
            <p className="text-xs font-semibold">{targetDisplayName} đề nghị burn conversation</p>
            <p className="mt-0.5 text-[10px] text-muted-foreground">
              Đồng ý sẽ xoá vĩnh viễn conversation, message và media của cuộc chat này.
            </p>
          </div>
          <Button size="sm" variant="destructive" disabled={burnBusy} onClick={requestBurn} className="h-8 text-xs gap-1.5">
            {burnBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Flame className="h-3.5 w-3.5" />}
            Đồng ý xoá
          </Button>
        </div>
      )}

      {burn?.requestedByMe && !burn.requestedByPeer && !currentUser.isAdmin && (
        <div className="px-4 py-2.5 border-b border-amber-500/20 bg-amber-500/5 flex items-center gap-3">
          <div className="flex-1 min-w-0">
            <p className="text-xs font-medium">Đang chờ {targetDisplayName} đồng ý burn.</p>
          </div>
          <Button variant="ghost" size="sm" disabled={burnBusy} onClick={cancelBurn} className="h-7 text-xs gap-1">
            {burnBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <X className="h-3.5 w-3.5" />}
            Huỷ yêu cầu
          </Button>
        </div>
      )}

      <div
        ref={scrollViewportRef}
        onScroll={handleScroll}
        className="flex-1 overflow-y-auto w-full px-4 md:px-6 scroll-smooth">
        <div className="flex flex-col min-h-full py-6">
          {hasMore && (
            <div className="flex justify-center mb-6">
              <Button
                variant="outline"
                size="sm"
                onClick={handleLoadMore}
                disabled={loadingMore}
                className="h-7 rounded-full text-[10px] font-bold uppercase tracking-widest px-4 border-border/50 bg-muted/10">
                {loadingMore ? <Loader2 className="w-3 h-3 animate-spin mr-2" /> : <History className="w-3 h-3 mr-2" />}
                {loadingMore ? "Syncing" : "Load older"}
              </Button>
            </div>
          )}

          <div className="space-y-4">
            {loading && messages.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-[40vh] text-muted-foreground/20">
                <Loader2 className="w-6 h-6 animate-spin mb-2" />
              </div>
            ) : (
              messages.map((msg) => (
                <MessageItem
                  key={msg._id}
                  message={msg}
                  isMe={msg.userId === observedUserId}
                  currentUser={currentUser}
                  setMessages={setMessages}
                  onReply={!readOnly && !currentUser.isAdmin && !messagingBlocked ? setReplyTarget : undefined}
                />
              ))
            )}
          </div>
        </div>
      </div>

      {showScrollButton && (
        <Button
          size="icon"
          variant="secondary"
          onClick={() => scrollToBottom()}
          className="absolute bottom-24 right-6 h-8 w-8 rounded-full shadow-md border border-border animate-in fade-in slide-in-from-bottom-2">
          <ChevronDown className="w-4 h-4" />
        </Button>
      )}

      {!readOnly && !messagingBlocked && (
        <div className="border-t border-border bg-background safe-bottom">
          <div className="h-5 px-5 pt-1 text-[10px] text-muted-foreground">
            {targetIsTyping ? `${targetDisplayName} đang nhập...` : ""}
          </div>
          <div className="px-4 pb-4">
            <ChatInput
              roomId={roomId}
              setMessages={setMessages}
              replyTo={replyTarget}
              onCancelReply={() => setReplyTarget(null)}
            />
          </div>
        </div>
      )}
    </div>
  );
}
