"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { getPusherClient } from "@/lib/client";
import { conversationChannel } from "@/lib/realtime/channels";

interface PeerTypingState {
  userId: string;
  displayName: string;
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
      });
    } catch {
      // Message loading remains usable even if metadata refresh fails.
    }
  }, [roomId, userId]);

  const loadMessages = useCallback(
    async (cursor?: string | null, isLoadMore = false) => {
      if (!userId || !roomId) return;
      if (isLoadMore && (loadingMoreRef.current || !hasMoreRef.current)) return;

      const setter = isLoadMore ? setLoadingMore : setLoading;

      try {
        if (isLoadMore) loadingMoreRef.current = true;
        setter(true);

        const res = await fetch(`/api/messages?roomId=${roomId}&cursor=${cursor || ""}&limit=15`);
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
  }, [roomId, userId, loadMessages, loadConversationMeta]);

  useEffect(() => {
    if (!roomId || !userId) return;

    const markSeen = async () => {
      try {
        await fetch("/api/messages/seen", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ roomId }),
        });
      } catch (err) {
        console.error("Failed to mark seen", err);
      }
    };

    markSeen();
  }, [roomId, userId]);

  useEffect(() => {
    if (!roomId || !userId) return;

    const pusher = getPusherClient();
    const channelName = conversationChannel(roomId);
    const channel = pusher.subscribe(channelName);

    const handleNewMessage = (message: any) => {
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
              retryPayload: undefined,
            };
            return next;
          }
        }

        if (previous.some((item) => item._id === message._id)) return previous;
        return [...previous, { ...message, deliveryState: "sent" }];
      });
    };

    const handleMessageDeleted = ({ messageId }: { messageId: string }) => {
      setMessages((prev) =>
        prev.map((msg) => {
          if (msg._id !== messageId) return msg;
          return isAdminRef.current ? { ...msg, deleted: true } : { ...msg, deleted: true, text: null, imageUrl: null };
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

    const handleMessagesSeen = (data: { userId: string; isAdmin: boolean }) => {
      if (data.isAdmin) return;

      setMessages((prev) =>
        prev.map((msg) => {
          if (msg.userId === data.userId) return msg;
          const seen = msg.seenBy || [];
          if (seen.includes(data.userId)) return msg;
          return { ...msg, seenBy: [...seen, data.userId] };
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

    const handleConversationRemoved = (data: { conversationId: string }) => {
      if (data.conversationId !== roomId) return;
      setConversationRemoved(true);
      setMessages([]);
      setPeerTyping(null);
    };

    channel.bind("new-message", handleNewMessage);
    channel.bind("message-deleted", handleMessageDeleted);
    channel.bind("message-updated", handleMessageUpdated);
    channel.bind("messages-seen", handleMessagesSeen);
    channel.bind("message-reactions", handleReactions);
    channel.bind("typing-changed", handleTypingChanged);
    channel.bind("burn-status", handleBurnStatus);
    channel.bind("block-status", handleBlockStatus);
    channel.bind("conversation-removed", handleConversationRemoved);

    return () => {
      if (typingExpiryRef.current) clearTimeout(typingExpiryRef.current);
      setPeerTyping(null);
      channel.unbind_all();
      pusher.unsubscribe(channelName);
    };
  }, [roomId, userId]);

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
