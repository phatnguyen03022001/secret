"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { getPusherClient } from "@/lib/client";
import { userChannel } from "@/lib/realtime/channels";
import { Clock3, MessageSquare, Loader2, User as UserIcon, Layers } from "lucide-react";
import { cn } from "@/lib/utils";
import { ScrollArea } from "@/components/ui/scroll-area";

interface User {
  _id: string;
  username: string;
  displayName?: string;
  profileDisplayName?: string;
  conversationAlias?: string | null;
  accountType?: "registered" | "guest";
  isAdmin?: boolean;
}

interface Room {
  roomId: string;
  conversationId?: string;
  lifecycle?: "persistent" | "quick" | "temporary";
  expiresAt?: string | null;
  otherUser: User;
  lastMessage?: {
    content: string;
    createdAt: string;
    userId: string;
  };
  unreadCount?: number;
}

export function ConversationList({
  currentUserId,
  onSelectRoom,
  selectedRoomId,
}: {
  currentUserId: string;
  onSelectRoom: (roomId: string, otherUser: any) => void;
  selectedRoomId?: string;
}) {
  const [rooms, setRooms] = useState<Room[]>([]);
  const [loading, setLoading] = useState(true);
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [page, setPage] = useState(1);
  const isFetchingRef = useRef(false);

  const acknowledgeDelivered = useCallback((roomId: string) => {
    if (!roomId) return;
    void fetch("/api/messages/delivered", {
      method: "POST",
      keepalive: true,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ roomId }),
    }).catch(() => undefined);
  }, []);

  const fetchRooms = useCallback(
    async (pageToLoad: number, isLoadMore = false) => {
      if (isFetchingRef.current) return;
      isFetchingRef.current = true;

      if (!isLoadMore) setLoading(true);
      else setLoadingMore(true);

      try {
        const response = await fetch(`/api/rooms?page=${pageToLoad}&limit=20`, { cache: "no-store" });
        if (!response.ok) throw new Error("Failed to fetch conversations");

        const data = await response.json();
        const validRooms = (data.rooms || []).filter((room: Room) => !room.otherUser?.isAdmin);

        for (const room of validRooms as Room[]) {
          if (room.lastMessage && room.lastMessage.userId?.toString() !== currentUserId) {
            acknowledgeDelivered(room.roomId);
          }
        }

        setRooms((previous) => {
          if (!isLoadMore) return validRooms;
          const knownIds = new Set(previous.map((room) => room.roomId));
          return [...previous, ...validRooms.filter((room: Room) => !knownIds.has(room.roomId))];
        });
        setHasMore(Boolean(data.hasMore));
        setPage(pageToLoad);
      } catch (error) {
        console.error("Fetch rooms error:", error);
      } finally {
        setLoading(false);
        setLoadingMore(false);
        isFetchingRef.current = false;
      }
    },
    [acknowledgeDelivered, currentUserId],
  );

  useEffect(() => {
    fetchRooms(1, false);
  }, [fetchRooms]);

  useEffect(() => {
    const pusher = getPusherClient();
    const channelName = userChannel(currentUserId);
    const channel = pusher.subscribe(channelName);

    const handleRoomsUpdate = (data: any) => {
      if (!data.lastMessage) {
        setRooms((previous) => previous.filter((room) => room.roomId !== data.roomId));
        return;
      }
      if (data.otherUser?.isAdmin) return;

      const isOwnMessage = data.lastMessage?.userId?.toString() === currentUserId;
      if (!isOwnMessage) acknowledgeDelivered(data.roomId);

      setRooms((previous) => {
        const roomIndex = previous.findIndex((room) => room.roomId === data.roomId);
        const isOpen = data.roomId === selectedRoomId;

        if (roomIndex !== -1) {
          const updatedRooms = [...previous];
          const targetRoom = { ...updatedRooms[roomIndex] };
          targetRoom.lastMessage = data.lastMessage;
          targetRoom.unreadCount = isOwnMessage || isOpen ? 0 : (targetRoom.unreadCount || 0) + 1;
          if (data.otherUser) targetRoom.otherUser = { ...targetRoom.otherUser, ...data.otherUser };
          updatedRooms.splice(roomIndex, 1);
          updatedRooms.unshift(targetRoom);
          return updatedRooms;
        }

        if (!data.otherUser) {
          fetchRooms(1, false);
          return previous;
        }

        return [
          {
            roomId: data.roomId,
            conversationId: data.conversationId,
            otherUser: data.otherUser,
            lastMessage: data.lastMessage,
            unreadCount: isOwnMessage || isOpen ? 0 : 1,
          },
          ...previous,
        ];
      });
    };

    const handleUnreadUpdate = (data: { roomId: string; unreadCount: number }) => {
      setRooms((previous) =>
        previous.map((room) => (room.roomId === data.roomId ? { ...room, unreadCount: data.unreadCount } : room)),
      );
    };

    const handleConversationRemoved = (data: { conversationId: string; roomId?: string }) => {
      const id = data.conversationId || data.roomId;
      setRooms((previous) => previous.filter((room) => room.roomId !== id));
    };

    const handleAccountStatus = (data: { userId: string; status: "active" | "suspended" }) => {
      if (data.userId === currentUserId && data.status === "suspended") {
        window.location.assign("/login");
      }
    };

    const handleIdentityUpdated = (data: { conversationId: string; userId: string; alias: string | null }) => {
      setRooms((previous) =>
        previous.map((room) => {
          if (room.roomId !== data.conversationId || room.otherUser._id !== data.userId) return room;
          const baseName = room.otherUser.profileDisplayName || room.otherUser.username;
          return {
            ...room,
            otherUser: {
              ...room.otherUser,
              conversationAlias: data.alias,
              displayName: data.alias || baseName,
            },
          };
        }),
      );
    };

    channel.bind("rooms-updated", handleRoomsUpdate);
    channel.bind("unread-updated", handleUnreadUpdate);
    channel.bind("conversation-removed", handleConversationRemoved);
    channel.bind("account-status", handleAccountStatus);
    channel.bind("identity-updated", handleIdentityUpdated);

    return () => {
      channel.unbind("rooms-updated", handleRoomsUpdate);
      channel.unbind("unread-updated", handleUnreadUpdate);
      channel.unbind("conversation-removed", handleConversationRemoved);
      channel.unbind("account-status", handleAccountStatus);
      channel.unbind("identity-updated", handleIdentityUpdated);
      pusher.unsubscribe(channelName);
    };
  }, [acknowledgeDelivered, currentUserId, fetchRooms, selectedRoomId]);

  const loadMore = () => {
    if (!hasMore || loadingMore) return;
    fetchRooms(page + 1, true);
  };

  if (loading && page === 1) {
    return (
      <div className="flex flex-col gap-3 p-4">
        {[1, 2, 3, 4].map((item) => (
          <div key={item} className="h-18 w-full animate-pulse bg-muted/40 rounded-2xl border border-border/20" />
        ))}
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full bg-transparent">
      <div className="px-6 py-4 flex items-center justify-between border-b border-border/5">
        <div className="flex items-center gap-2">
          <Layers className="w-3.5 h-3.5 text-primary/50" />
          <h2 className="text-[10px] font-black uppercase text-muted-foreground">Conversations</h2>
        </div>
        <div className="h-1.5 w-1.5 rounded-full bg-primary" />
      </div>

      <ScrollArea className="flex-1 px-3 mt-4">
        <div className="space-y-1 pb-4">
          {rooms.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-20 opacity-20">
              <MessageSquare className="w-6 h-6 mb-2" />
              <p className="text-[9px] font-black uppercase tracking-widest">No conversations</p>
            </div>
          ) : (
            rooms.map((room) => {
              const isActive = selectedRoomId === room.roomId;
              const unread = room.unreadCount ?? 0;
              const displayName = room.otherUser?.displayName || room.otherUser?.username;
              const lastTime = room.lastMessage?.createdAt
                ? new Date(room.lastMessage.createdAt).toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit" })
                : "";

              return (
                <button
                  key={room.roomId}
                  onClick={() => onSelectRoom(room.roomId, room.otherUser)}
                  className={cn(
                    "w-full text-left relative group p-3 rounded-2xl flex items-center gap-3 transition-all duration-200 border",
                    isActive
                      ? "bg-primary text-primary-foreground border-primary"
                      : "bg-transparent border-transparent hover:bg-muted/30 hover:border-border/10 active:scale-[0.98]",
                  )}>
                  <div
                    className={cn(
                      "h-10 w-10 shrink-0 rounded-xl flex items-center justify-center border",
                      isActive
                        ? "bg-primary-foreground/10 border-primary-foreground/20"
                        : "bg-muted/50 border-border/40 group-hover:border-primary/20",
                    )}>
                    <UserIcon className={cn("w-4 h-4", isActive ? "text-primary-foreground" : "text-muted-foreground/60")} />
                  </div>

                  <div className="flex-1 min-w-0">
                    <div className="flex justify-between items-center mb-0.5">
                      <div className="flex items-center gap-2 overflow-hidden">
                        <p className={cn("text-xs font-bold truncate", isActive ? "text-primary-foreground" : "text-foreground")}>
                          {displayName}
                        </p>
                        {room.otherUser?.accountType === "guest" && (
                          <span className={cn("text-[8px] uppercase tracking-wide opacity-60", isActive && "text-primary-foreground")}>
                            Guest
                          </span>
                        )}
                        {room.lifecycle && room.lifecycle !== "persistent" && (
                          <Clock3 className={cn("h-3 w-3 opacity-60", isActive && "text-primary-foreground")} />
                        )}
                        {unread > 0 && (
                          <span
                            className={cn(
                              "text-[9px] font-bold min-w-5 h-5 px-1.5 inline-flex items-center justify-center rounded-full",
                              isActive ? "bg-primary-foreground text-primary" : "bg-primary text-primary-foreground",
                            )}>
                            {unread > 99 ? "99+" : unread}
                          </span>
                        )}
                      </div>
                      <span className={cn("text-[9px] opacity-50 tabular-nums shrink-0", isActive && "text-primary-foreground")}>
                        {lastTime}
                      </span>
                    </div>

                    <p className={cn("text-[11px] truncate opacity-60", isActive ? "text-primary-foreground" : "text-muted-foreground")}>
                      {room.lastMessage?.content || "Chưa có tin nhắn"}
                    </p>
                  </div>
                </button>
              );
            })
          )}

          {hasMore && (
            <button
              onClick={loadMore}
              disabled={loadingMore}
              className="w-full py-4 text-[9px] font-bold uppercase tracking-wider text-muted-foreground/50 hover:text-primary transition-colors flex items-center justify-center gap-2">
              {loadingMore ? <Loader2 className="w-3 h-3 animate-spin" /> : "Tải thêm"}
            </button>
          )}
        </div>
      </ScrollArea>
    </div>
  );
}
