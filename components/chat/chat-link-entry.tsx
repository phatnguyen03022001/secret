"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, Loader2, MessageCircle, ShieldCheck, UserRound } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useAuth } from "@/context/AuthContext";

interface LinkMetadata {
  slug: string;
  owner: {
    username: string;
    displayName: string;
  };
  allowGuests: boolean;
  viewer: {
    authenticated: boolean;
    isOwner: boolean;
    accountType: "registered" | "guest" | null;
  };
}

export default function ChatLinkEntry({ slug }: { slug: string }) {
  const router = useRouter();
  const { user, loading: authLoading, refreshUser } = useAuth();
  const [metadata, setMetadata] = useState<LinkMetadata | null>(null);
  const [displayName, setDisplayName] = useState("");
  const [loading, setLoading] = useState(true);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      try {
        const response = await fetch(`/api/links/${encodeURIComponent(slug)}`, { cache: "no-store" });
        const data = await response.json();
        if (!response.ok) throw new Error(data?.error || "Link không còn khả dụng");
        if (!cancelled) setMetadata(data);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "Không thể mở link này");
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    load();
    return () => {
      cancelled = true;
    };
  }, [slug]);

  const publicName = metadata?.owner.displayName || metadata?.owner.username || "Spackie user";
  const isAuthenticated = Boolean(user) || metadata?.viewer.authenticated;
  const isOwner = metadata?.viewer.isOwner || (user?.username && user.username === metadata?.owner.username);
  const canStart = useMemo(
    () => Boolean(metadata && !isOwner && (isAuthenticated || (metadata.allowGuests && displayName.trim().length >= 2))),
    [metadata, isOwner, isAuthenticated, displayName],
  );

  const startConversation = async () => {
    if (!metadata || !canStart || starting) return;

    setStarting(true);
    setError(null);

    try {
      const response = await fetch(`/api/links/${encodeURIComponent(slug)}/start`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(isAuthenticated ? {} : { displayName: displayName.trim() }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data?.error || "Không thể bắt đầu cuộc trò chuyện");

      if (data.createdGuest) await refreshUser();
      router.push(`/?conversation=${encodeURIComponent(data.conversationId)}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Không thể bắt đầu cuộc trò chuyện");
    } finally {
      setStarting(false);
    }
  };

  if (loading || authLoading) {
    return (
      <div className="flex-1 flex items-center justify-center bg-background">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!metadata) {
    return (
      <div className="flex-1 flex items-center justify-center p-6 bg-background">
        <div className="max-w-md text-center space-y-3">
          <MessageCircle className="h-10 w-10 mx-auto text-muted-foreground/40" />
          <h1 className="text-xl font-semibold">Link không khả dụng</h1>
          <p className="text-sm text-muted-foreground">{error || "Link này có thể đã bị tắt hoặc không tồn tại."}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto bg-background">
      <div className="min-h-full flex items-center justify-center px-5 py-10">
        <div className="w-full max-w-md">
          <div className="mb-10">
            <div className="inline-flex items-center gap-2 text-sm font-semibold">
              <div className="h-8 w-8 rounded-xl bg-primary text-primary-foreground flex items-center justify-center">
                <MessageCircle className="h-4 w-4" />
              </div>
              Spackie
            </div>
          </div>

          <div className="space-y-3 mb-8">
            <p className="text-sm font-medium text-primary">Talk first. Connect later.</p>
            <h1 className="text-3xl sm:text-4xl font-semibold tracking-tight leading-tight">
              Trò chuyện với {publicName}
            </h1>
            <p className="text-sm sm:text-base text-muted-foreground leading-relaxed">
              Bắt đầu một cuộc trò chuyện riêng mà không cần trao đổi số điện thoại hay tài khoản mạng xã hội.
            </p>
          </div>

          <div className="rounded-3xl border border-border bg-card p-5 sm:p-6 shadow-sm">
            <div className="flex items-center gap-3 pb-5 border-b border-border/70">
              <div className="h-11 w-11 rounded-2xl bg-muted flex items-center justify-center font-semibold">
                {publicName.slice(0, 1).toUpperCase()}
              </div>
              <div className="min-w-0">
                <p className="font-semibold truncate">{publicName}</p>
                <p className="text-xs text-muted-foreground">@{metadata.owner.username}</p>
              </div>
            </div>

            {isOwner ? (
              <div className="pt-5 space-y-3">
                <p className="text-sm font-medium">Đây là Spackie Link của bạn.</p>
                <p className="text-sm text-muted-foreground">Chia sẻ link này để người khác có thể bắt đầu chat với bạn.</p>
                <Button className="w-full rounded-xl" onClick={() => router.push("/")}>
                  Về hộp thư
                </Button>
              </div>
            ) : (
              <div className="pt-5 space-y-4">
                {!isAuthenticated && (
                  <div className="space-y-2">
                    <label htmlFor="guest-name" className="text-sm font-medium">
                      Mọi người nên gọi bạn là gì?
                    </label>
                    <div className="relative">
                      <UserRound className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                      <Input
                        id="guest-name"
                        value={displayName}
                        maxLength={32}
                        onChange={(event) => setDisplayName(event.target.value)}
                        onKeyDown={(event) => event.key === "Enter" && canStart && startConversation()}
                        placeholder="Tên hiển thị"
                        className="h-12 pl-10 rounded-xl text-base"
                        autoComplete="nickname"
                        autoFocus
                      />
                    </div>
                    <p className="text-xs text-muted-foreground">Không cần đăng ký. Phiên khách sẽ được tạo tự động.</p>
                  </div>
                )}

                {isAuthenticated && (
                  <div className="rounded-xl bg-muted/50 px-4 py-3 text-sm">
                    Tiếp tục với <span className="font-semibold">{user?.displayName || user?.username}</span>
                  </div>
                )}

                {error && <p className="text-sm text-destructive">{error}</p>}

                <Button
                  className="w-full h-12 rounded-xl gap-2"
                  disabled={!canStart || starting}
                  onClick={startConversation}>
                  {starting ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowRight className="h-4 w-4" />}
                  {starting ? "Đang mở cuộc trò chuyện..." : "Bắt đầu trò chuyện"}
                </Button>

                <div className="flex items-start gap-2 text-xs text-muted-foreground leading-relaxed">
                  <ShieldCheck className="h-4 w-4 mt-0.5 shrink-0" />
                  <span>Link chỉ giúp hai người kết nối; bạn không cần thêm nhau vào danh bạ hay social graph.</span>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
