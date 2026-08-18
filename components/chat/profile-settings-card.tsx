"use client";

import { useEffect, useState } from "react";
import { Eye, EyeOff, Loader2, Settings2, UserRound, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useAuth } from "@/context/AuthContext";
import { cn } from "@/lib/utils";

interface ProfileData {
  username: string;
  displayName: string;
  bio: string;
  privacy: {
    showLastSeen: boolean;
    allowMessagesFrom: "everyone" | "link_only";
  };
}

export function ProfileSettingsCard() {
  const { refreshUser } = useAuth();
  const [open, setOpen] = useState(false);
  const [profile, setProfile] = useState<ProfileData | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open || profile || loading) return;
    let cancelled = false;
    setLoading(true);

    fetch("/api/profile/me", { cache: "no-store" })
      .then(async (response) => {
        const data = await response.json().catch(() => null);
        if (!response.ok) throw new Error(data?.error || "Không thể tải profile");
        return data;
      })
      .then((data) => {
        if (!cancelled) setProfile(data);
      })
      .catch((error) => {
        if (!cancelled) toast.error(error instanceof Error ? error.message : "Không thể tải profile");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [open, profile, loading]);

  const save = async () => {
    if (!profile || saving) return;
    setSaving(true);

    try {
      const response = await fetch("/api/profile/me", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          displayName: profile.displayName,
          bio: profile.bio,
          showLastSeen: profile.privacy.showLastSeen,
          allowMessagesFrom: profile.privacy.allowMessagesFrom,
        }),
      });
      const data = await response.json().catch(() => null);
      if (!response.ok) throw new Error(data?.error || "Không thể lưu profile");

      setProfile(data);
      await refreshUser();
      toast.success("Đã lưu profile & privacy");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Không thể lưu profile");
    } finally {
      setSaving(false);
    }
  };

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="mx-4 mb-3 flex items-center gap-3 rounded-xl border border-border/50 bg-muted/10 px-3 py-2.5 text-left hover:bg-muted/20 transition-colors">
        <Settings2 className="h-4 w-4 text-muted-foreground" />
        <div className="min-w-0">
          <p className="text-xs font-semibold">Profile & Privacy</p>
          <p className="text-[10px] text-muted-foreground">Identity, last seen, contact access</p>
        </div>
      </button>
    );
  }

  return (
    <div className="mx-4 mb-3 rounded-2xl border border-border/60 bg-background/90 p-3.5 shadow-sm">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <UserRound className="h-4 w-4 text-primary" />
          <p className="text-xs font-semibold">Profile & Privacy</p>
        </div>
        <Button variant="ghost" size="icon" onClick={() => setOpen(false)} className="h-7 w-7">
          <X className="h-3.5 w-3.5" />
        </Button>
      </div>

      {loading || !profile ? (
        <div className="h-28 flex items-center justify-center">
          <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
        </div>
      ) : (
        <div className="mt-3 space-y-3">
          <div>
            <p className="mb-1 text-[10px] font-medium text-muted-foreground">Display name</p>
            <Input
              value={profile.displayName}
              maxLength={32}
              onChange={(event) => setProfile({ ...profile, displayName: event.target.value })}
              className="h-8 text-xs"
            />
            <p className="mt-1 text-[9px] text-muted-foreground/70">@{profile.username}</p>
          </div>

          <div>
            <p className="mb-1 text-[10px] font-medium text-muted-foreground">Bio</p>
            <textarea
              value={profile.bio}
              maxLength={120}
              onChange={(event) => setProfile({ ...profile, bio: event.target.value })}
              placeholder="Một dòng ngắn về bạn..."
              className="min-h-16 w-full resize-none rounded-lg border border-input bg-transparent px-3 py-2 text-xs outline-none focus:border-primary"
            />
          </div>

          <button
            type="button"
            onClick={() =>
              setProfile({
                ...profile,
                privacy: { ...profile.privacy, showLastSeen: !profile.privacy.showLastSeen },
              })
            }
            className="w-full flex items-center justify-between rounded-lg border border-border/50 px-3 py-2 text-left">
            <div>
              <p className="text-[11px] font-medium">Last seen</p>
              <p className="text-[9px] text-muted-foreground">Cho phép peer thấy lần hoạt động gần nhất.</p>
            </div>
            {profile.privacy.showLastSeen ? (
              <Eye className="h-4 w-4 text-primary" />
            ) : (
              <EyeOff className="h-4 w-4 text-muted-foreground" />
            )}
          </button>

          <div>
            <p className="mb-1.5 text-[10px] font-medium text-muted-foreground">Ai có thể bắt đầu chat trực tiếp?</p>
            <div className="grid grid-cols-2 gap-1.5">
              <button
                type="button"
                onClick={() =>
                  setProfile({
                    ...profile,
                    privacy: { ...profile.privacy, allowMessagesFrom: "everyone" },
                  })
                }
                className={cn(
                  "h-8 rounded-lg border text-[10px] font-semibold",
                  profile.privacy.allowMessagesFrom === "everyone"
                    ? "border-primary bg-primary text-primary-foreground"
                    : "border-border/60 hover:bg-muted/40",
                )}>
                Ai cũng được tìm
              </button>
              <button
                type="button"
                onClick={() =>
                  setProfile({
                    ...profile,
                    privacy: { ...profile.privacy, allowMessagesFrom: "link_only" },
                  })
                }
                className={cn(
                  "h-8 rounded-lg border text-[10px] font-semibold",
                  profile.privacy.allowMessagesFrom === "link_only"
                    ? "border-primary bg-primary text-primary-foreground"
                    : "border-border/60 hover:bg-muted/40",
                )}>
                Chỉ qua Spackie Link
              </button>
            </div>
            <p className="mt-1.5 text-[9px] leading-relaxed text-muted-foreground/70">
              Link-only ẩn bạn khỏi search và chặn direct chat mới; conversation đang có vẫn hoạt động trừ khi bạn block.
            </p>
          </div>

          <Button onClick={save} disabled={saving || profile.displayName.trim().length < 2} className="w-full h-8 text-xs">
            {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Lưu thay đổi"}
          </Button>
        </div>
      )}
    </div>
  );
}
