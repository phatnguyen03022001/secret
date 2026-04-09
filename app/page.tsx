"use client";

import { useState, useEffect } from "react";
import { useAuth } from "@/context/AuthContext";
import { useChat } from "@/hooks/use-chat";
import { ConversationList } from "@/components/chat/conversation-list";
import ChatContainer from "@/components/chat/chat-container";
import { UserSearch } from "@/components/chat/user-search";
import { ModeToggle } from "@/components/mode/mode-toggle";
import { Loader2, LogOut, MessageSquare, Zap, Shield } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useRouter } from "next/navigation";
import { cn } from "@/lib/utils";
import { useHeartbeat } from "../hooks/useHeartbeat";

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

export default function HomePage() {
  useHeartbeat();
  const { user, logout, loading: authLoading } = useAuth();
  const router = useRouter();
  const [manualSidebarOpen, setManualSidebarOpen] = useState(false);
  const [selectedRoomId, setSelectedRoomId] = useState<string | null>(null);
  const [targetUser, setTargetUser] = useState<any>(null);

  const { messages, loading, loadingMore, loadMoreOlder, hasMore, setMessages } = useChat(user, selectedRoomId || "");
  const isMobile = useMediaQuery("(max-width: 767px)");
  const isSidebarOpen = isMobile ? (selectedRoomId ? manualSidebarOpen : true) : true;

  useEffect(() => {
    if (!authLoading && !user) router.replace("/login");
  }, [user, authLoading, router]);

  if (authLoading) {
    return (
      <div className="h-dvh w-full flex flex-col items-center justify-center bg-background">
        <Loader2 className="w-8 h-8 animate-spin text-primary/50" />
        <p className="mt-4 text-[11px] font-medium tracking-widest text-muted-foreground uppercase">
          Initializing secure tunnel...
        </p>
      </div>
    );
  }

  if (!user) return null;

  const handleSelectRoom = (roomId: string, userData: any) => {
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
      {" "}
      {/* 1. SIDEBAR - Soft Professional Style */}
      <aside
        className={cn(
          // Sửa lg:w-85 thành lg:w-[340px]
          "fixed inset-y-0 left-0 z-50 w-full md:relative md:z-auto md:w-80 lg:w-85 flex flex-col bg-card/50 backdrop-blur-xl transition-all duration-500 border-r border-border",
          isSidebarOpen ? "translate-x-0" : "-translate-x-full",
          "md:translate-x-0",
        )}>
        {/* Sidebar Header */}
        <div className="p-5 flex items-center justify-between border-b border-border/60">
          <div className="flex items-center gap-3">
            <div className="h-9 w-9 bg-primary/10 flex items-center justify-center rounded-xl">
              <Zap className="w-4.5 h-4.5 text-primary fill-current" />
            </div>
            <div>
              <h1 className="font-bold text-lg tracking-tight leading-none">Spackie</h1>
              <div className="flex items-center gap-1.5 mt-1">
                <div className="h-1.5 w-1.5 rounded-full bg-primary animate-pulse" />
                <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">
                  Node Active
                </span>
              </div>
            </div>
          </div>
          <div className="flex items-center gap-1">
            <ModeToggle />
            <Button
              variant="ghost"
              size="icon"
              onClick={logout}
              className="h-8 w-8 rounded-lg hover:bg-destructive/10 hover:text-destructive transition-colors">
              <LogOut className="w-4 h-4" />
            </Button>
          </div>
        </div>

        {/* Search Area */}
        <UserSearch currentUserId={user._id} onStartChat={handleSelectRoom} />

        {/* Conversation List */}
        <div className="flex-1 overflow-hidden py-2">
          <ConversationList
            currentUserId={user._id}
            selectedRoomId={selectedRoomId || ""}
            onSelectRoom={handleSelectRoom}
          />
        </div>

        {/* User Profile Footer */}
        <div className="p-4 bg-muted/20 border-t border-border/60">
          <div className="flex items-center gap-3 p-2.5 rounded-xl border border-border/50 bg-background/50 shadow-sm group transition-all hover:border-primary/30">
            <div className="h-10 w-10 bg-primary/5 border border-primary/10 flex items-center justify-center rounded-lg font-bold text-primary text-sm">
              {user.username[0].toUpperCase()}
            </div>
            <div className="flex flex-col min-w-0 flex-1">
              <span className="text-sm font-bold truncate">{user.username}</span>
              <span className="text-[10px] font-medium text-muted-foreground tracking-tight">Secure Session</span>
            </div>
            <Shield className="w-4 h-4 text-muted-foreground/30 group-hover:text-primary transition-colors" />
          </div>
        </div>
      </aside>
      {/* 2. MAIN CHAT CONTENT */}
      <section
        className={cn(
          "flex-1 min-h-0 flex flex-col bg-background transition-all duration-500 relative",
          // Thêm pointer-events-none trên mobile khi ẩn để tránh click nhầm
          isMobile && isSidebarOpen ? "opacity-0 pointer-events-none" : "opacity-100",
        )}>
        {/* Subtle Background pattern */}
        <div
          className="absolute inset-0 z-0 opacity-[0.4] pointer-events-none"
          style={{ backgroundImage: `radial-gradient(var(--border) 1px, transparent 0)`, backgroundSize: "32px 32px" }}
        />

        {selectedRoomId && targetUser ? (
          <div className="flex-1 min-h-0 relative z-10 animate-in fade-in slide-in-from-right-2 duration-500">
            {" "}
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
              onBack={handleBackToList}
            />
          </div>
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center p-12 text-center relative z-10">
            <div className="mb-6 p-6 rounded-4xl bg-muted/30 border border-border shadow-inner">
              <MessageSquare className="w-10 h-10 text-muted-foreground/40 stroke-[1.25]" />
            </div>
            <div className="space-y-2">
              <h2 className="text-lg font-bold tracking-tight">Hệ thống liên lạc</h2>
              <p className="text-xs text-muted-foreground max-w-60 leading-relaxed">
                Chọn một cuộc trò chuyện để bắt đầu trao đổi dữ liệu an toàn.
              </p>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
