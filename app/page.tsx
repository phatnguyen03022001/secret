"use client";

import { useEffect, useRef, useState } from "react";
import { useAuth } from "@/context/AuthContext";
import { useChat } from "@/hooks/use-chat";
import { ConversationList } from "@/components/chat/conversation-list";
import ChatContainer from "@/components/chat/chat-container";
import { UserSearch } from "@/components/chat/user-search";
import { SpackieLinkCard } from "@/components/chat/spackie-link-card";
import { GuestClaimCard } from "@/components/chat/guest-claim-card";
import { ModeToggle } from "@/components/mode/mode-toggle";
import { Loader2, LogOut, MessageSquare, Zap, Shield, Clock3 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useRouter } from "next/navigation";
import { cn } from "@/lib/utils";
import { useHeartbeat } from "@/hooks/useHeartbeat";

const useMediaQuery = (query: string) => {
  const getMatch = () => (typeof window !== "undefined" ? window.matchMedia(query).matches : false);
  const [matches, setMatches] = useState(getMatch);

  useEffect(() => {
    const media = window.matchMedia(query);
    const listener = () => setMatches(media.matches);
    media.addEventListener("change", listener);
    return () => media.removeEventListener("change", listener);
  }, [query]);

  return matches;
};

interface ChatTarget {
  _id: string;
  username: string;
  displayName?: string;
  accountType?: "registered" | "guest";
  isAdmin?: boolean;
  lastActive?: string | null;
}

export default function HomePage() {
  useHeartbeat();
  const { user, logout, loading: authLoading } = useAuth();
  const router = useRouter();
  const deepLinkHandledRef = useRef(false);
  const [manualSidebarOpen, setManualSidebarOpen] = useState(false);
  const [selectedRoomId, setSelectedRoomId] = useState<string | null>(null);
  const [targetUser, setTargetUser] = useState<ChatTarget | null>(null);

  const {
    messages,
    loading,
    loadingMore,
    loadMoreOlder,
    hasMore,
    peerTyping,
    conversationMeta,
    conversationRemoved,
    setConversationMeta,
    setMessages,
  } = useChat(user, selectedRoomId || "");
  const isMobile = useMediaQuery("(max-width: 767px)");
  const isSidebarOpen = isMobile ? (selectedRoomId ? manualSidebarOpen : true) : true;
  const isGuest = user?.accountType === "guest";
  const userDisplayName = user?.displayName || user?.username || "";

  useEffect(() => {
    if (!authLoading && !user) router.replace("/login");
  }, [user, authLoading, router]);

  useEffect(() => {
    if (!conversationRemoved) return;
    setSelectedRoomId(null);
    setTargetUser(null);
    if (isMobile) setManualSidebarOpen(true);
  }, [conversationRemoved, isMobile]);

  useEffect(() => {
    if (authLoading || !user || deepLinkHandledRef.current) return;

    const conversationId = new URLSearchParams(window.location.search).get("conversation");
    if (!conversationId) {
      deepLinkHandledRef.current = true;
      return;
    }

    deepLinkHandledRef.current = true;

    const openConversation = async () => {
      try {
        const response = await fetch(`/api/rooms/${encodeURIComponent(conversationId)}`, { cache: "no-store" });
        if (!response.ok) return;

        const data = await response.json();
        setSelectedRoomId(data.conversationId);
        setTargetUser(data.targetUser);
        if (isMobile) setManualSidebarOpen(false);
      } finally {
        window.history.replaceState({}, "", "/");
      }
    };

    openConversation();
  }, [authLoading, user, isMobile]);

  if (authLoading) {
    return (
      <div className="h-dvh w-full flex flex-col items-center justify-center bg-background">
        <Loader2 className="w-7 h-7 animate-spin text-primary/60" />
        <p className="mt-4 text-xs font-medium text-muted-foreground">Đang mở Spackie...</p>
      </div>
    );
  }

  if (!user) return null;

  const handleSelectRoom = (roomId: string, userData: ChatTarget) => {
    setSelectedRoomId(roomId);
    setTargetUser(userData);
    if (isMobile) setManualSidebarOpen(false);
  };

  const handleBackToList = () => {
    setSelectedRoomId(null);
    setTargetUser(null);
    if (isMobile) setManualSidebarOpen(true);
  };

  return (
    <div className="h-full w-full flex bg-background text-foreground overflow-hidden relative font-sans">
      <aside
        className={cn(
          "fixed inset-y-0 left-0 z-50 w-full md:relative md:z-auto md:w-80 lg:w-[340px] flex flex-col bg-card/50 backdrop-blur-xl transition-transform duration-300 border-r border-border",
          isSidebarOpen ? "translate-x-0" : "-translate-x-full",
          "md:translate-x-0",
        )}>
        <div className="p-5 flex items-center justify-between border-b border-border/60">
          <div className="flex items-center gap-3">
            <div className="h-9 w-9 bg-primary/10 flex items-center justify-center rounded-xl">
              <Zap className="w-4 h-4 text-primary fill-current" />
            </div>
            <div>
              <h1 className="font-bold text-lg tracking-tight leading-none">Spackie</h1>
              <span className="text-[10px] font-medium text-muted-foreground">Talk first. Connect later.</span>
            </div>
          </div>
          <div className="flex items-center gap-1">
            <ModeToggle />
            <Button
              variant="ghost"
              size="icon"
              onClick={logout}
              aria-label="Đăng xuất"
              className="h-8 w-8 rounded-lg hover:bg-destructive/10 hover:text-destructive transition-colors">
              <LogOut className="w-4 h-4" />
            </Button>
          </div>
        </div>

        {!isGuest && <UserSearch currentUserId={user._id} onStartChat={handleSelectRoom} />}

        <div className="flex-1 overflow-hidden py-2">
          <ConversationList
            currentUserId={user._id}
            selectedRoomId={selectedRoomId || ""}
            onSelectRoom={handleSelectRoom}
          />
        </div>

        {isGuest ? <GuestClaimCard /> : !user.isAdmin ? <SpackieLinkCard /> : null}

        <div className="p-4 bg-muted/20 border-t border-border/60">
          <div className="flex items-center gap-3 p-2.5 rounded-xl border border-border/50 bg-background/50 shadow-sm">
            <div className="h-10 w-10 bg-primary/5 border border-primary/10 flex items-center justify-center rounded-lg font-bold text-primary text-sm">
              {userDisplayName.slice(0, 1).toUpperCase()}
            </div>
            <div className="flex flex-col min-w-0 flex-1">
              <span className="text-sm font-bold truncate">{userDisplayName}</span>
              <span className="text-[10px] font-medium text-muted-foreground tracking-tight flex items-center gap-1">
                {isGuest ? <Clock3 className="h-3 w-3" /> : <Shield className="h-3 w-3" />}
                {isGuest ? "Guest session" : `@${user.username}`}
              </span>
            </div>
          </div>
        </div>
      </aside>

      <section
        className={cn(
          "flex-1 min-h-0 flex flex-col bg-background transition-opacity duration-200 relative",
          isMobile && isSidebarOpen ? "opacity-0 pointer-events-none" : "opacity-100",
        )}>
        <div
          className="absolute inset-0 z-0 opacity-[0.35] pointer-events-none"
          style={{ backgroundImage: `radial-gradient(var(--border) 1px, transparent 0)`, backgroundSize: "32px 32px" }}
        />

        {selectedRoomId && targetUser ? (
          <div className="flex-1 min-h-0 relative z-10 animate-in fade-in duration-200">
            <ChatContainer
              roomId={selectedRoomId}
              targetUser={targetUser}
              currentUser={user}
              messages={messages}
              setMessages={setMessages}
              loadMoreOlder={loadMoreOlder}
              hasMore={hasMore}
              loading={loading}
              loadingMore={loadingMore}
              peerTyping={peerTyping}
              conversationMeta={conversationMeta}
              setConversationMeta={setConversationMeta}
              onBack={handleBackToList}
            />
          </div>
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center p-8 text-center relative z-10">
            <div className="mb-5 p-5 rounded-3xl bg-muted/30 border border-border">
              <MessageSquare className="w-9 h-9 text-muted-foreground/40 stroke-[1.25]" />
            </div>
            <div className="space-y-2 max-w-sm">
              <h2 className="text-lg font-semibold tracking-tight">
                {isGuest ? "Cuộc trò chuyện của bạn đã sẵn sàng" : "Chọn một cuộc trò chuyện"}
              </h2>
              <p className="text-sm text-muted-foreground leading-relaxed">
                {isGuest
                  ? "Phiên khách giúp bạn trò chuyện mà không cần trao đổi số điện thoại hay tài khoản mạng xã hội."
                  : "Hoặc chia sẻ Spackie Link của bạn để ai đó có thể nhắn mà chưa cần add social."}
              </p>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
