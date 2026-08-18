"use client";

import { useState } from "react";
import { Search, Loader2, X, SendHorizontal, UserRoundSearch } from "lucide-react";
import { Input } from "@/components/ui/input";

interface UserSearchProps {
  onStartChat: (roomId: string, targetUser: any) => void;
  currentUserId: string;
}

export function UserSearch({ onStartChat, currentUserId }: UserSearchProps) {
  const [keyword, setKeyword] = useState("");
  const [results, setResults] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [startingChatId, setStartingChatId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleSearch = async () => {
    const query = keyword.trim();
    if (!query) return;

    setLoading(true);
    setError(null);

    try {
      const response = await fetch(`/api/users/search?q=${encodeURIComponent(query)}`);
      const data = await response.json();
      if (!response.ok) throw new Error(data?.error || "Không thể tìm người dùng");

      setResults((data || []).filter((user: any) => user._id !== currentUserId && !user.isAdmin));
    } catch (err) {
      setResults([]);
      setError(err instanceof Error ? err.message : "Không thể tìm người dùng");
    } finally {
      setLoading(false);
    }
  };

  const handleStartChat = async (targetUser: any) => {
    setStartingChatId(targetUser._id);
    setError(null);

    try {
      const response = await fetch("/api/rooms/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ targetUserId: targetUser._id }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data?.error || "Không thể mở cuộc trò chuyện");

      onStartChat(data.roomId, data.targetUser);
      setResults([]);
      setKeyword("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Không thể mở cuộc trò chuyện");
    } finally {
      setStartingChatId(null);
    }
  };

  return (
    <div className="w-full flex flex-col gap-2 p-4">
      <div className="relative group">
        <div className="absolute left-3.5 top-1/2 -translate-y-1/2 z-10">
          {loading ? (
            <Loader2 className="w-4 h-4 animate-spin text-primary" />
          ) : (
            <Search className="w-4 h-4 text-muted-foreground/60 group-focus-within:text-primary transition-colors" />
          )}
        </div>

        <Input
          type="text"
          placeholder="Tìm username hoặc tên..."
          value={keyword}
          onChange={(event) => {
            setKeyword(event.target.value);
            setError(null);
            if (!event.target.value) setResults([]);
          }}
          onKeyDown={(event) => event.key === "Enter" && handleSearch()}
          className="h-11 pl-10 pr-16 bg-muted/20 border-border/50 rounded-xl text-sm transition-all focus-visible:ring-1 focus-visible:ring-primary/30"
        />

        <div className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center gap-1">
          {keyword && (
            <button
              type="button"
              aria-label="Xóa tìm kiếm"
              onClick={() => {
                setKeyword("");
                setResults([]);
                setError(null);
              }}
              className="p-1.5 hover:bg-muted rounded-md text-muted-foreground hover:text-foreground">
              <X className="w-3.5 h-3.5" />
            </button>
          )}
          <button
            type="button"
            onClick={handleSearch}
            disabled={!keyword.trim() || loading}
            className="text-xs font-semibold text-primary disabled:opacity-30 px-2 py-1.5">
            Tìm
          </button>
        </div>
      </div>

      {error && <p className="px-1 text-xs text-destructive">{error}</p>}

      {results.length > 0 && (
        <div className="mt-1 overflow-hidden border border-border/50 rounded-2xl bg-card shadow-xl">
          <div className="max-h-72 overflow-y-auto">
            {results.map((user) => {
              const displayName = user.displayName || user.username;
              return (
                <button
                  key={user._id}
                  disabled={Boolean(startingChatId)}
                  onClick={() => handleStartChat(user)}
                  className="w-full group flex items-center justify-between p-3.5 hover:bg-muted/40 transition-colors border-b border-border/30 last:border-none text-left">
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="h-10 w-10 shrink-0 rounded-xl bg-muted border border-border/50 flex items-center justify-center font-semibold text-sm">
                      {displayName.slice(0, 1).toUpperCase()}
                    </div>
                    <div className="flex flex-col min-w-0">
                      <span className="text-sm font-semibold truncate">{displayName}</span>
                      <span className="text-[11px] text-muted-foreground truncate">@{user.username}</span>
                    </div>
                  </div>

                  <div className="shrink-0 ml-4 p-2 rounded-lg bg-muted group-hover:bg-primary group-hover:text-primary-foreground transition-colors">
                    {startingChatId === user._id ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      <SendHorizontal className="w-3.5 h-3.5" />
                    )}
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {!loading && keyword.trim() && results.length === 0 && !error && (
        <div className="mt-1 p-6 text-center rounded-2xl bg-muted/10 border border-dashed border-border/50">
          <UserRoundSearch className="w-6 h-6 mx-auto mb-2 text-muted-foreground/30" />
          <p className="text-xs text-muted-foreground">Không tìm thấy người dùng phù hợp.</p>
        </div>
      )}
    </div>
  );
}
