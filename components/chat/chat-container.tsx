"use client";

import { useEffect, useRef, useCallback, useState } from "react";
import MessageItem from "./message-item";
import ChatInput from "./chat-input";
import { Loader2, ChevronDown, ChevronLeft, History } from "lucide-react";
import { Button } from "@/components/ui/button";

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
    accountType?: "registered" | "guest";
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
  onBack?: () => void;
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
  onBack,
}: ChatContainerProps) {
  const scrollViewportRef = useRef<HTMLDivElement>(null);
  const [showScrollButton, setShowScrollButton] = useState(false);
  const isUserAtBottomRef = useRef(true);
  const prevMessagesLengthRef = useRef(0);
  const lastMessageIdRef = useRef<string | null>(null);
  const hasMarkedSeenRef = useRef<string | null>(null);
  const observedUserId = currentUser.isAdmin ? targetUser._id : currentUser._id;
  const lastMessageId = messages[messages.length - 1]?._id;
  const targetDisplayName = targetUser.displayName || targetUser.username;
  const targetIsTyping = peerTyping?.userId === targetUser._id;

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
      <header className="h-14 md:h-16 shrink-0 px-4 flex items-center justify-between border-b border-border bg-background/80 backdrop-blur-md sticky top-0 z-30">
        <div className="flex items-center gap-3 min-w-0">
          {onBack && (
            <Button variant="ghost" size="icon" onClick={onBack} className="md:hidden -ml-2 h-9 w-9">
              <ChevronLeft className="w-5 h-5" />
            </Button>
          )}
          <div className="h-9 w-9 rounded-full bg-muted border border-border flex items-center justify-center font-bold text-xs shrink-0">
            {targetDisplayName.slice(0, 1).toUpperCase()}
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h3 className="text-sm font-bold truncate leading-none">{targetDisplayName}</h3>
              {targetUser.accountType === "guest" && (
                <span className="text-[9px] uppercase tracking-wide text-muted-foreground">Guest</span>
              )}
            </div>
            <p className="text-[10px] text-muted-foreground mt-1 truncate">
              {targetIsTyping
                ? "đang nhập..."
                : targetUser.displayName && targetUser.displayName !== targetUser.username && targetUser.accountType !== "guest"
                  ? `@${targetUser.username}`
                  : "Spackie conversation"}
            </p>
          </div>
        </div>
      </header>

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

      {!readOnly && (
        <div className="border-t border-border bg-background safe-bottom">
          <div className="h-5 px-5 pt-1 text-[10px] text-muted-foreground">
            {targetIsTyping ? `${targetDisplayName} đang nhập...` : ""}
          </div>
          <div className="px-4 pb-4">
            <ChatInput roomId={roomId} setMessages={setMessages} />
          </div>
        </div>
      )}
    </div>
  );
}
