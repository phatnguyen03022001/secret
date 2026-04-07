"use client";

import { useEffect, useState, useCallback, useMemo } from "react";
import { useRouter } from "next/navigation";
import ChatContainer from "@/components/chat/chat-container";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { LogOut, ShieldCheck, Loader2, Eye, Users, ChevronLeft, Clock, Search, Filter, Activity } from "lucide-react";
import { useHeartbeat } from "@/hooks/useHeartbeat";
import { cn } from "@/lib/utils";
import { ModeToggle } from "@/components/mode/mode-toggle";
import { getPusherClient } from "@/lib/client";

// Helper thời gian tương đối giữ nguyên logic của bạn
function getRelativeTime(dateString: string | Date) {
  if (!dateString) return "N/A";
  const now = new Date();
  const past = new Date(dateString);
  const diffInMs = now.getTime() - past.getTime();
  const diffInMins = Math.floor(diffInMs / 60000);
  const diffInHours = Math.floor(diffInMs / 3600000);
  const diffInDays = Math.floor(diffInMs / 86400000);

  if (diffInMins < 1) return "Vừa xong";
  if (diffInMins < 60) return `${diffInMins}m`;
  if (diffInHours < 24) return `${diffInHours}h`;
  if (diffInDays === 1) return "Hôm qua";
  return past.toLocaleDateString("vi-VN", { day: "2-digit", month: "2-digit" });
}

export default function AdminPage() {
  const router = useRouter();
  const [admin, setAdmin] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [rooms, setRooms] = useState<any[]>([]);
  const [selectedRoom, setSelectedRoom] = useState<any>(null);
  const [users, setUsers] = useState<any[]>([]);
  const [isAuthorized, setIsAuthorized] = useState(false);

  const [userSearch, setUserSearch] = useState("");
  const [showOnlyOnline, setShowOnlyOnline] = useState(false);
  const [roomsHasMore, setRoomsHasMore] = useState(false);
  const [roomsPage, setRoomsPage] = useState(1);
  const [isLoadingMore, setIsLoadingMore] = useState(false);

  useHeartbeat();

  // --- Logic Auth & Fetching (Giữ nguyên từ code của bạn) ---
  useEffect(() => {
    const fetchAdmin = async () => {
      try {
        const res = await fetch("/api/me", { cache: "no-store" });
        const userData = await res.json();

        if (res.ok && userData.isAdmin) {
          setAdmin(userData);
          setIsAuthorized(true); // Chỉ bật cái này khi là Admin thật
        } else {
          router.replace("/");
        }
      } catch (error) {
        router.replace("/");
      } finally {
        setLoading(false);
      }
    };
    fetchAdmin();
  }, [router]);

  const fetchRooms = useCallback(async (page: number, isLoadMore = false) => {
    if (isLoadMore) setIsLoadingMore(true);
    try {
      const res = await fetch(`/api/admin/rooms?page=${page}&limit=20`);
      const data = await res.json();
      setRooms((prev) => (isLoadMore ? [...prev, ...data.rooms] : data.rooms));
      setRoomsHasMore(data.hasMore);
      setRoomsPage(page);
    } catch {
    } finally {
      setIsLoadingMore(false);
    }
  }, []);

  const fetchUsers = useCallback(async () => {
    try {
      const res = await fetch(`/api/users?limit=100`);
      const data = await res.json();
      setUsers(data.users || []);
    } catch {}
  }, []);

  const filteredUsers = useMemo(() => {
    return users.filter((u) => {
      const matchesSearch = u.username.toLowerCase().includes(userSearch.toLowerCase());
      const isOnline = new Date().getTime() - new Date(u.lastActive).getTime() < 2 * 60 * 1000;
      return showOnlyOnline ? matchesSearch && isOnline : matchesSearch;
    });
  }, [users, userSearch, showOnlyOnline]);

  useEffect(() => {
    if (!admin) return;
    fetchRooms(1);
    fetchUsers();

    const pusher = getPusherClient();
    const channel = pusher.subscribe(`admin-global`);

    channel.bind("rooms-updated", (data: any) => {
      setRooms((prev) => {
        const index = prev.findIndex((r) => r.roomId === data.roomId);
        const updatedList = [...prev];
        if (index !== -1) {
          const updatedRoom = { ...updatedList[index], ...data };
          updatedList.splice(index, 1);
          updatedList.unshift(updatedRoom);
        } else {
          updatedList.unshift(data);
        }
        return updatedList;
      });
    });

    const interval = setInterval(fetchUsers, 20000);
    return () => {
      pusher.unsubscribe(`admin-global`);
      clearInterval(interval);
    };
  }, [admin, fetchRooms, fetchUsers]);

  if (loading || !isAuthorized) {
    return (
      <div className="flex flex-col items-center justify-center h-dvh bg-black">
        <Loader2 className="animate-spin text-emerald-500 w-8 h-8 mb-4" />
        <p className="text-[10px] text-emerald-500/50 font-mono tracking-[0.3em] uppercase animate-pulse">
          Establishing Secure Link...
        </p>
      </div>
    );
  }

  return (
    <main className="flex h-dvh bg-background p-0 sm:p-4 gap-0 sm:gap-4 overflow-hidden isolate">
      {/* SIDEBAR */}
      <aside
        className={cn(
          "w-full lg:w-80 flex flex-col gap-4 shrink-0 overflow-hidden h-full transition-all",
          selectedRoom ? "hidden lg:flex" : "flex",
        )}>
        {/* Admin Profile - Minimalist style */}
        <Card className="shrink-0 sm:rounded-2xl border-border bg-card/50 backdrop-blur-sm shadow-none">
          <CardContent className="p-3 flex justify-between items-center">
            <div className="flex items-center gap-2 min-w-0">
              <div className="w-8 h-8 bg-foreground text-background rounded-full flex items-center justify-center font-black text-[10px] shrink-0">
                AD
              </div>
              <div className="flex flex-col min-w-0">
                <span className="font-bold text-[11px] truncate uppercase tracking-wider leading-none">
                  {admin?.username}
                </span>
                <span className="text-[8px] text-muted-foreground font-medium uppercase mt-1">
                  System Administrator
                </span>
              </div>
            </div>
            <div className="flex items-center gap-1">
              <ModeToggle />
              <Button
                variant="ghost"
                size="icon"
                onClick={() => router.push("/")}
                className="h-8 w-8 hover:bg-destructive/10 hover:text-destructive transition-colors">
                <LogOut className="w-4 h-4" />
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* User Monitor - High Contrast Status */}
        <Card className="flex-[0.5] min-h-[300px] flex flex-col overflow-hidden sm:rounded-2xl border-border bg-card/30 shadow-none">
          <div className="p-4 border-b bg-muted/5 shrink-0 space-y-3">
            <div className="flex items-center justify-between font-black text-[9px] uppercase tracking-[0.2em] text-muted-foreground/80">
              <div className="flex items-center gap-2">
                <Activity className="w-3 h-3" /> Live Monitor
              </div>
              <span className="text-[8px] bg-foreground/5 px-1.5 py-0.5 rounded border border-border/50">
                {filteredUsers.length} Users
              </span>
            </div>
            <div className="relative group">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3 h-3 text-muted-foreground group-focus-within:text-foreground transition-colors" />
              <Input
                placeholder="Search database..."
                value={userSearch}
                onChange={(e) => setUserSearch(e.target.value)}
                className="h-8 pl-8 text-[11px] bg-background/50 border-border/50 focus:border-foreground/50 transition-all rounded-lg"
              />
              <Button
                variant={showOnlyOnline ? "default" : "ghost"}
                size="icon"
                className={cn(
                  "absolute right-1 top-1/2 -translate-y-1/2 h-6 w-6 rounded-md transition-all",
                  showOnlyOnline ? "bg-foreground text-background" : "text-muted-foreground",
                )}
                onClick={() => setShowOnlyOnline(!showOnlyOnline)}>
                <Filter className="w-3 h-3" />
              </Button>
            </div>
          </div>

          <div className="flex-1 overflow-hidden relative">
            <ScrollArea className="h-full w-full custom-scrollbar">
              <div className="p-2 space-y-1">
                {filteredUsers.map((u) => {
                  const isOnline = new Date().getTime() - new Date(u.lastActive).getTime() < 2 * 60 * 1000;
                  return (
                    <div
                      key={u._id}
                      className="flex items-center justify-between p-2.5 rounded-xl hover:bg-foreground/[0.03] transition-all group border border-transparent hover:border-border/40">
                      <div className="flex items-center gap-3 min-w-0 w-full">
                        <div className="relative shrink-0">
                          <div className="w-10 h-10 bg-secondary rounded-xl flex items-center justify-center text-[12px] font-black border border-border/50 transition-all group-hover:bg-foreground group-hover:text-background">
                            {u.username[0]?.toUpperCase()}
                          </div>
                          <div
                            className={cn(
                              "absolute -top-1 -right-1 w-2.5 h-2.5 rounded-full border-2 border-card",
                              isOnline ? "bg-success shadow-[0_0_8px_rgba(34,197,94,0.5)]" : "bg-muted-foreground/20",
                            )}
                          />
                        </div>

                        <div className="flex flex-col min-w-0 flex-1">
                          <div className="flex items-center justify-between gap-2">
                            <span className="text-[11px] font-black truncate uppercase tracking-tight">
                              {u.username}
                            </span>
                            <span className="text-[8px] font-mono text-muted-foreground">
                              {isOnline ? "LIVE" : getRelativeTime(u.lastActive)}
                            </span>
                          </div>
                          <div className="flex items-center gap-1.5 mt-1">
                            <div
                              className={cn(
                                "w-1 h-1 rounded-full",
                                isOnline ? "bg-success animate-pulse" : "bg-muted-foreground/30",
                              )}
                            />
                            <span className="text-[8px] font-bold uppercase tracking-widest text-muted-foreground/60">
                              {isOnline ? "Encrypted Line" : "Disconnected"}
                            </span>
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </ScrollArea>
          </div>
        </Card>

        {/* Room List - Takes remaining space */}
        <Card className="flex-1 flex flex-col overflow-hidden sm:rounded-2xl border-border bg-card/30 shadow-none">
          <div className="p-4 border-b bg-muted/5 font-black text-[9px] uppercase tracking-[0.2em] text-muted-foreground/80 shrink-0">
            Active Rooms
          </div>
          <div className="flex-1 overflow-hidden relative">
            <ScrollArea className="h-full w-full custom-scrollbar">
              <div className="p-2 space-y-1.5">
                {rooms.map((room) => (
                  <div
                    key={room.roomId}
                    onClick={() => setSelectedRoom(room)}
                    className={cn(
                      "flex items-center gap-3 p-3 cursor-pointer rounded-xl transition-all border",
                      selectedRoom?.roomId === room.roomId
                        ? "bg-foreground text-background border-foreground shadow-lg"
                        : "hover:bg-muted/50 border-transparent hover:border-border/60",
                    )}>
                    <div
                      className={cn(
                        "w-8 h-8 rounded-lg flex items-center justify-center transition-colors",
                        selectedRoom?.roomId === room.roomId ? "bg-background/20" : "bg-secondary",
                      )}>
                      <Eye className="w-3.5 h-3.5" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="font-black text-[10px] truncate uppercase tracking-tighter">
                        {room.participants?.map((p: any) => (typeof p === "string" ? p : p.username)).join(" + ") ||
                          "Room"}
                      </p>
                      <div className="flex items-center gap-2 mt-0.5">
                        <span className="text-[8px] font-mono opacity-50 uppercase">HEX:{room.roomId.slice(-6)}</span>
                      </div>
                    </div>
                  </div>
                ))}
                {roomsHasMore && (
                  <Button
                    variant="ghost"
                    className="w-full text-[9px] font-black uppercase tracking-widest h-10 hover:bg-transparent hover:underline"
                    onClick={() => fetchRooms(roomsPage + 1, true)}
                    disabled={isLoadingMore}>
                    {isLoadingMore ? "Processing..." : "Load Archive"}
                  </Button>
                )}
              </div>
            </ScrollArea>
          </div>
        </Card>
      </aside>

      {/* MONITOR AREA - STARK CONTRAST */}
      <section
        className={cn(
          "flex-1 overflow-hidden border-border bg-card flex flex-col sm:rounded-2xl shadow-none relative h-full",
          !selectedRoom ? "hidden lg:flex" : "flex",
          selectedRoom && "border-2 border-foreground/5 lg:border",
        )}>
        {selectedRoom ? (
          <>
            <header className="p-4 border-b flex items-center justify-between bg-card/80 backdrop-blur-xl shrink-0 z-10">
              <div className="flex items-center gap-4 min-w-0">
                <Button variant="ghost" size="icon" className="lg:hidden -ml-2" onClick={() => setSelectedRoom(null)}>
                  <ChevronLeft className="w-5 h-5" />
                </Button>
                <div className="min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
                    <span className="text-[9px] text-red-500 font-black uppercase tracking-[0.2em]">
                      Live Intercept
                    </span>
                  </div>
                  <h3 className="font-black text-sm sm:text-lg truncate uppercase tracking-tighter">
                    {selectedRoom.participants?.map((p: any) => (typeof p === "string" ? p : p.username)).join(" • ")}
                  </h3>
                </div>
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setSelectedRoom(null)}
                className="rounded-lg text-[9px] font-black uppercase tracking-widest h-8 px-4 border-foreground/20 hover:bg-foreground hover:text-background transition-all">
                Terminate
              </Button>
            </header>
            <div className="flex-1 min-h-0 relative bg-background/20">
              <ChatContainer key={selectedRoom.roomId} user={admin} roomId={selectedRoom.roomId} readOnly={true} />
            </div>
          </>
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center p-8 text-center select-none">
            <div className="relative mb-6">
              <ShieldCheck className="w-16 h-16 text-foreground/[0.03]" />
              <div className="absolute inset-0 flex items-center justify-center">
                <div className="w-12 h-12 border border-foreground/5 rounded-full animate-ping" />
              </div>
            </div>
            <p className="text-[10px] uppercase font-black tracking-[0.5em] text-muted-foreground/40">
              Security Protocol Active
            </p>
            <p className="text-[9px] mt-2 text-muted-foreground/20 font-medium">Select a node to begin monitoring</p>
          </div>
        )}
      </section>
    </main>
  );
}
