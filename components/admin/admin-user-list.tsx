"use client";

import { useEffect, useState, useCallback, useMemo } from "react";
import { User as UserIcon, ShieldCheck, Search, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { formatDistanceToNow } from "date-fns";
import { vi } from "date-fns/locale";
import { getPusherClient } from "@/lib/client";
import { adminGlobalChannel } from "@/lib/realtime/channels";

interface User {
  _id: string;
  username: string;
  email?: string;
  isAdmin: boolean;
  createdAt: string;
  lastActive?: string;
}

export function AdminUserList() {
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);

  const fetchUsers = useCallback(async (pageToLoad: number, isLoadMore = false) => {
    if (!isLoadMore) setLoading(true);
    else setLoadingMore(true);

    try {
      const res = await fetch(`/api/users?page=${pageToLoad}&limit=30`);
      if (!res.ok) throw new Error("Failed to fetch users");
      const data = await res.json();

      setUsers((prev) => (isLoadMore ? [...prev, ...data.users] : data.users));
      setHasMore(Boolean(data.hasMore));
      setPage(pageToLoad);
    } catch (error) {
      console.error("Fetch error:", error);
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  }, []);

  useEffect(() => {
    fetchUsers(1, false);
  }, [fetchUsers]);

  useEffect(() => {
    const pusher = getPusherClient();
    const channelName = adminGlobalChannel();
    const channel = pusher.subscribe(channelName);

    const handleUserOnline = (data: { userId: string; lastActive: string }) => {
      setUsers((prev) => prev.map((user) => (user._id === data.userId ? { ...user, lastActive: data.lastActive } : user)));
    };

    channel.bind("user-online", handleUserOnline);
    return () => {
      channel.unbind("user-online", handleUserOnline);
      pusher.unsubscribe(channelName);
    };
  }, []);

  const filteredUsers = useMemo(() => {
    const query = searchQuery.toLowerCase();
    return users.filter((user) => user.username.toLowerCase().includes(query) || user._id.includes(searchQuery));
  }, [users, searchQuery]);

  if (loading && page === 1) {
    return (
      <div className="flex h-[400px] items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full bg-background">
      <div className="flex flex-col gap-4 p-6 pb-4">
        <div>
          <h2 className="text-2xl font-semibold tracking-tight">Người dùng</h2>
          <p className="text-sm text-muted-foreground">Quản lý danh sách thực thể và phân quyền hệ thống.</p>
        </div>

        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Tìm kiếm người dùng..."
            value={searchQuery}
            onChange={(event) => setSearchQuery(event.target.value)}
            className="pl-9 h-9"
          />
        </div>
      </div>

      <ScrollArea className="flex-1">
        <div className="px-6 pb-6">
          <div className="rounded-lg border bg-card overflow-hidden">
            <div className="relative w-full overflow-auto">
              <table className="w-full caption-bottom text-sm">
                <thead className="bg-muted/30 sticky top-0 z-10 border-b">
                  <tr>
                    <th className="h-10 px-4 text-left align-middle font-medium text-muted-foreground">Người dùng</th>
                    <th className="h-10 px-4 text-right align-middle font-medium text-muted-foreground">Trạng thái</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredUsers.map((user) => {
                    const online =
                      user.lastActive && new Date().getTime() - new Date(user.lastActive).getTime() < 5 * 60 * 1000;

                    return (
                      <tr key={user._id} className="border-b transition-colors hover:bg-muted/20">
                        <td className="p-4 align-middle">
                          <div className="flex items-center gap-3">
                            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border bg-muted/20">
                              {user.isAdmin ? (
                                <ShieldCheck className="h-4 w-4 text-foreground/70" />
                              ) : (
                                <UserIcon className="h-4 w-4 text-muted-foreground" />
                              )}
                            </div>
                            <div className="flex flex-col">
                              <span className="font-medium text-foreground tracking-tight">{user.username}</span>
                              <span className="text-[11px] text-muted-foreground">{user.email || "No email"}</span>
                            </div>
                          </div>
                        </td>
                        <td className="p-4 align-middle text-right">
                          <div className="flex items-center justify-end gap-2">
                            <span className="text-xs text-muted-foreground">
                              {online
                                ? "Trực tuyến"
                                : user.lastActive
                                  ? formatDistanceToNow(new Date(user.lastActive), { addSuffix: true, locale: vi })
                                  : "Ngoại tuyến"}
                            </span>
                            <div
                              className={cn(
                                "h-1.5 w-1.5 rounded-full",
                                online ? "bg-green-500" : "bg-muted-foreground/30",
                              )}
                            />
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          {hasMore && (
            <div className="flex justify-center mt-6">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => fetchUsers(page + 1, true)}
                disabled={loadingMore}
                className="text-xs text-muted-foreground hover:text-foreground">
                {loadingMore ? <Loader2 className="mr-2 h-3 w-3 animate-spin" /> : "Tải thêm người dùng"}
              </Button>
            </div>
          )}
        </div>
      </ScrollArea>
    </div>
  );
}
