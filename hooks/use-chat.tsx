"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { getPusherClient } from "@/lib/client";
import { conversationChannel } from "@/lib/realtime/channels";

interface PeerTypingState {
  userId: string;
  displayName: string;
}

type ReceiptState = "sent" | "delivered" | "seen";

const RECEIPT_RANK: Record<ReceiptState, number> = {
  sent: 1,
  delivered: 2,
  seen: 3,
};

function advanceReceipt(current: unknown, next: ReceiptState): ReceiptState {
  const normalized = current === "seen" || current === "delivered" || current === "sent" ? current : "sent";
  return RECEIPT_RANK[next] > RECEIPT_RANK[normalized] ? next : normalized;
}

function isAtOrBeforeCursor(messageId: unknown, cursorId: unknown) {
  if (!messageId || !cursorId) return false;
  return messageId.toString() <= cursorId.toString();
}

export interface ConversationMeta {
  lifecycle: "persistent" | "quick" | "temporary";
  expiresAt: string | null;
  burn: {
    requestedBy: string[];
    requestedByMe: boolean;
    requestedByPeer: boolean;
  };
  access: {
    blockedByMe: boolean;
    blockedMe: boolean;
  };
  identity: {
    myAlias: string | null;
    peerAlias: string | null;
  };
}

export function useChat(currentUser: any, roomId: string) {
  const userId = currentUser?._id ?? null;
  const isAdmin = currentUser?.isAdmin ?? false;

  const [messages, setMessages] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [peerTyping, setPeerTyping] = useState<PeerTypingState | null>(null);
  const [conversationMeta, setConversationMeta] = useState<ConversationMeta | null>(null);
  const [conversationRemoved, setConversationRemoved] = useState(false);

  const loadingMoreRef = useRef(false);
  const hasMoreRef = useRef(true);
  const isAdminRef = useRef(isAdmin);
  const typingExpiryRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    hasMoreRef.current = hasMore;
  }, [hasMore]);

  useEffect(() => {
    isAdminRef.current = isAdmin;
  }, [isAdmin]);

  const loadConversationMeta = useCallback(async () => {
    if (!userId || !roomId) return;

    try {
      const response = await fetch(`/api/rooms/${encodeURIComponent(roomId)}`, { cache: "no-store" });
      if (!response.ok) return;
      const data = await response.json();
      setConversationMeta({
        lifecycle: data.lifecycle || "persistent",
        expiresAt: data.expiresAt || null,
        burn: data.burn || { requestedBy: [], requestedByMe: false, requestedByPeer: false },
        access: data.access || { blockedByMe: false, blockedMe: false },
        identity: data.identity || { myAlias: null, peerAlias: null },
      });
    } catch {
      // Message loading remains usable even if metadata refresh fails.
    }
  }, [roomId, userId]);

  const acknowledgeSeen = useCallback(
    async (messageId?: string | null) => {
      if (!userId || !roomId || isAdmin) return;
      if (typeof document !== "undefined" && (document.visibilityState !== "visible" || !document.hasFocus())) return;

      try {
        await fetch("/api/messages/seen", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ roomId, messageId: messageId || undefined }),
        });
      } catch {
        // Delivery state will reconcile from the server on refresh/reconnect.
      }
    },
    [isAdmin, roomId, userId],
  );

  const loadMessages = useCallback(
    async (cursor?: string | null, isLoadMore = false) => {
      if (!userId || !roomId) return;
      if (isLoadMore && (loadingMoreRef.current || !hasMoreRef.current)) return;

      const setter = isLoadMore ? setLoadingMore : setLoading;

      try {
        if (isLoadMore) loadingMoreRef.current = true;
        setter(true);

        const res = await fetch(`/api/messages?roomId=${encodeURIComponent(roomId)}&cursor=${cursor || ""}&limit=15`, {
          cache: "no-store",
        });
        if (!res.ok) throw new Error("fetch failed");

        const data = await res.json();

        setMessages((prev) => {
          if (!isLoadMore) return data.messages || [];
          const existingIds = new Set(prev.map((message) => message._id));
          const newMessages = (data.messages || []).filter((message: any) => !existingIds.has(message._id));
          return [...newMessages, ...prev];
        });

        setHasMore(Boolean(data.hasMore));
        setNextCursor(data.nextCursor ?? null);
      } catch (err) {
        console.error("Load messages failed", err);
        if (!isLoadMore) setMessages([]);
      } finally {
        setter(false);
        if (isLoadMore) loadingMoreRef.current = false;
      }
    },
    [userId, roomId],
  );

  useEffect(() => {
    if (!roomId || !userId) return;
    setMessages([]);
    setPeerTyping(null);
    setConversationMeta(null);
    setConversationRemoved(false);
    setHasMore(true);
    setNextCursor(null);
    void Promise.all([loadMessages(), loadConversationMeta()]);
    void acknowledgeSeen();
  }, [roomId, userId, loadMessages, loadConversationMeta, acknowledgeSeen]);

  useEffect(() => {
    if (!roomId || !userId || isAdmin) return;

    const handleForeground = () => {
      if (document.visibilityState === "visible" && document.hasFocus()) {
        void acknowledgeSeen();
      }
    };

    window.addEventListener("focus", handleForeground);
    document.addEventListener("visibilitychange", handleForeground);
    return () => {
      window.removeEventListener("focus", handleForeground);
      document.removeEventListener("visibilitychange", handleForeground);
    };
  }, [acknowledgeSeen, isAdmin, roomId, userId]);

  useEffect(() => {
    if (!roomId || !userId) return;

    const pusher = getPusherClient();
    const channelName = conversationChannel(roomId);
    const channel = pusher.subscribe(channelName);

    const handleNewMessage = (message: any) => {
      const fromPeer = message.userId?.toString() !== userId;

      setMessages((previous) => {
        if (message.clientMessageId) {
          const optimisticIndex = previous.findIndex(
            (item) => item.clientMessageId && item.clientMessageId === message.clientMessageId,
          );

          if (optimisticIndex !== -1) {
            const next = [...previous];
            next[optimisticIndex] = {
              ...message,
              deliveryState: "sent",
              receiptState: message.receiptState || "sent",
              retryPayload: undefined,
            };
            return next;
          }
        }

        if (previous.some((item) => item._id === message._id)) return previous;
        return [...previous, { ...message, deliveryState: "sent", receiptState: message.receiptState || "sent" }];
      });

      if (fromPeer) void acknowledgeSeen(message._id);
    };

    const handleMessageDeleted = ({ messageId }: { messageId: string }) => {
      setMessages((prev) =>
        prev.map((msg) => {
          if (msg._id !== messageId) return msg;
          return isAdminRef.current
            ? { ...msg, deleted: true }
            : { ...msg, deleted: true, text: null, imageUrl: null, onceAvailable: false };
        }),
      );
    };

    const handleMessageUpdated = (data: {
      messageId: string;
      text: string;
      editedAt: string;
      replyContent: string;
    }) => {
      setMessages((previous) =>
        previous.map((message) => {
          const next = message._id === data.messageId ? { ...message, text: data.text, editedAt: data.editedAt } : { ...message };
          if (next.replyPreview?.messageId === data.messageId) {
            next.replyPreview = { ...next.replyPreview, content: data.replyContent };
          }
          return next;
        }),
      );
    };

    const handleMessagesDelivered = (data: { userId: string; messageId?: string | null }) => {
      if (!data.messageId || data.userId === userId) return;

      setMessages((previous) =>
        previous.map((message) =>
          message.userId?.toString() === userId && isAtOrBeforeCursor(message._id, data.messageId)
            ? { ...message, receiptState: advanceReceipt(message.receiptState, "delivered") }
            : message,
        ),
      );
    };

    const handleMessagesSeen = (data: { userId: string; messageId?: string | null; isAdmin: boolean }) => {
      if (data.isAdmin || !data.messageId || data.userId === userId) return;

      setMessages((previous) =>
        previous.map((message) => {
          if (message.userId?.toString() !== userId || !isAtOrBeforeCursor(message._id, data.messageId)) return message;
          const seen = message.seenBy || [];
          return {
            ...message,
            receiptState: advanceReceipt(message.receiptState, "seen"),
            seenBy: seen.includes(data.userId) ? seen : [...seen, data.userId],
          };
        }),
      );
    };

    const handleReactions = (data: { messageId: string; reactions: any[] }) => {
      setMessages((previous) =>
        previous.map((message) =>
          message._id === data.messageId ? { ...message, reactions: data.reactions || [] } : message,
        ),
      );
    };

    const handleTypingChanged = (data: { userId: string; displayName: string; typing: boolean }) => {
      if (data.userId === userId) return;

      if (typingExpiryRef.current) clearTimeout(typingExpiryRef.current);

      if (!data.typing) {
        setPeerTyping(null);
        typingExpiryRef.current = null;
        return;
      }

      setPeerTyping({ userId: data.userId, displayName: data.displayName });
      typingExpiryRef.current = setTimeout(() => {
        setPeerTyping(null);
        typingExpiryRef.current = null;
      }, 3500);
    };

    const handleBurnStatus = (data: { conversationId: string; requestedBy: string[] }) => {
      if (data.conversationId !== roomId) return;
      const requestedBy = data.requestedBy || [];
      setConversationMeta((previous) =>
        previous
          ? {
              ...previous,
              burn: {
                requestedBy,
                requestedByMe: requestedBy.includes(userId),
                requestedByPeer: requestedBy.some((id) => id !== userId),
              },
            }
          : previous,
      );
    };

    const handleBlockStatus = (data: {
      conversationId: string;
      blockerId: string | null;
      blockedId: string | null;
      blocked: boolean;
    }) => {
      if (data.conversationId !== roomId) return;
      setConversationMeta((previous) =>
        previous
          ? {
              ...previous,
              access: {
                blockedByMe: Boolean(data.blocked && data.blockerId === userId),
                blockedMe: Boolean(data.blocked && data.blockedId === userId),
              },
            }
          : previous,
      );
    };

    const handleIdentityUpdated = (data: { conversationId: string; userId: string; alias: string | null }) => {
      if (data.conversationId !== roomId) return;
      setConversationMeta((previous) =>
        previous
          ? {
              ...previous,
              identity: {
                ...previous.identity,
                ...(data.userId === userId ? { myAlias: data.alias } : { peerAlias: data.alias }),
              },
            }
          : previous,
      );
    };

    const handleConversationRemoved = (data: { conversationId: string }) => {
      if (data.conversationId !== roomId) return;
      setConversationRemoved(true);
      setMessages([]);
      setPeerTyping(null);
    };

    channel.bind("new-message", handleNewMessage);
    channel.bind("message-deleted", handleMessageDeleted);
    channel.bind("message-updated", handleMessageUpdated);
    channel.bind("messages-delivered", handleMessagesDelivered);
    channel.bind("messages-seen", handleMessagesSeen);
    channel.bind("message-reactions", handleReactions);
    channel.bind("typing-changed", handleTypingChanged);
    channel.bind("burn-status", handleBurnStatus);
    channel.bind("block-status", handleBlockStatus);
    channel.bind("identity-updated", handleIdentityUpdated);
    channel.bind("conversation-removed", handleConversationRemoved);

    return () => {
      if (typingExpiryRef.current) clearTimeout(typingExpiryRef.current);
      setPeerTyping(null);
      channel.unbind_all();
      pusher.unsubscribe(channelName);
    };
  }, [acknowledgeSeen, roomId, userId]);

  const loadMoreOlder = useCallback(async () => {
    if (!nextCursor || loadingMoreRef.current || !hasMoreRef.current) return;
    await loadMessages(nextCursor, true);
  }, [nextCursor, loadMessages]);

  return {
    messages,
    loading,
    loadingMore,
    hasMore,
    peerTyping,
    conversationMeta,
    conversationRemoved,
    loadMoreOlder,
    loadConversationMeta,
    setConversationMeta,
    setMessages,
  };
}
