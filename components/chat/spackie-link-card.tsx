"use client";

import { useEffect, useState } from "react";
import { Check, Copy, Link2, Loader2, Pause, Play, RefreshCw, Share2 } from "lucide-react";
import { Button } from "@/components/ui/button";

interface LinkData {
  slug: string;
  path: string;
  enabled: boolean;
  allowGuests?: boolean;
  lifecycle?: "persistent" | "quick" | "temporary";
}

async function copyText(value: string) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(value);
    return;
  }

  const textarea = document.createElement("textarea");
  textarea.value = value;
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  document.body.appendChild(textarea);
  textarea.select();
  document.execCommand("copy");
  textarea.remove();
}

export function SpackieLinkCard() {
  const [link, setLink] = useState<LinkData | null>(null);
  const [loading, setLoading] = useState(true);
  const [copied, setCopied] = useState(false);
  const [busyAction, setBusyAction] = useState<"toggle" | "rotate" | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    fetch("/api/links/me", { cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) return null;
        return response.json();
      })
      .then((data) => {
        if (!cancelled) setLink(data);
      })
      .catch(() => {
        if (!cancelled) setError("Không thể tải Spackie Link");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const getFullUrl = () => {
    if (!link) return "";
    return `${window.location.origin}${link.path}`;
  };

  const patchLink = async (payload: Record<string, unknown>, action: "toggle" | "rotate") => {
    if (!link || busyAction) return;
    setBusyAction(action);
    setError(null);

    try {
      const response = await fetch("/api/links/me", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await response.json().catch(() => null);
      if (!response.ok) throw new Error(data?.error || "Không thể cập nhật link");
      setLink(data);
      setCopied(false);
    } catch (patchError) {
      setError(patchError instanceof Error ? patchError.message : "Không thể cập nhật link");
    } finally {
      setBusyAction(null);
    }
  };

  const handleCopy = async () => {
    if (!link || !link.enabled) return;
    await copyText(getFullUrl());
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1800);
  };

  const handleShare = async () => {
    if (!link || !link.enabled) return;
    const url = getFullUrl();

    if (navigator.share) {
      try {
        await navigator.share({
          title: "Chat with me on Spackie",
          text: "Talk first. Connect later.",
          url,
        });
        return;
      } catch {
        // User cancelled native share. Copy remains available as a fallback.
      }
    }

    await handleCopy();
  };

  if (loading) {
    return (
      <div className="mx-4 mb-3 h-20 rounded-2xl border border-border/50 bg-muted/10 flex items-center justify-center">
        <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!link) return null;

  return (
    <div className="mx-4 mb-3 rounded-2xl border border-border/60 bg-background/70 p-3.5 shadow-sm">
      <div className="flex items-start gap-3">
        <div className="h-9 w-9 shrink-0 rounded-xl bg-primary/10 text-primary flex items-center justify-center">
          <Link2 className="h-4 w-4" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <p className="text-xs font-semibold">Your Spackie Link</p>
            <span
              className={`h-1.5 w-1.5 rounded-full ${link.enabled ? "bg-emerald-500" : "bg-muted-foreground/40"}`}
              aria-label={link.enabled ? "Link đang hoạt động" : "Link đang tạm dừng"}
            />
          </div>
          <p className="mt-0.5 text-[11px] text-muted-foreground truncate">/chat/{link.slug}</p>
          <p className="mt-1 text-[10px] text-muted-foreground/70">
            {link.enabled ? "Ai có link có thể bắt đầu chat." : "Link đang tạm dừng. Conversation cũ vẫn giữ nguyên."}
          </p>
        </div>
      </div>

      {error && <p className="mt-2 text-[10px] text-destructive">{error}</p>}

      <div className="mt-3 grid grid-cols-2 gap-2">
        <Button
          variant="outline"
          size="sm"
          className="h-8 rounded-lg gap-1.5 text-xs"
          onClick={handleCopy}
          disabled={!link.enabled || !!busyAction}>
          {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
          {copied ? "Đã copy" : "Copy link"}
        </Button>
        <Button
          variant="secondary"
          size="sm"
          className="h-8 rounded-lg gap-1.5 text-xs"
          onClick={handleShare}
          disabled={!link.enabled || !!busyAction}>
          <Share2 className="h-3.5 w-3.5" />
          Chia sẻ
        </Button>
        <Button
          variant="ghost"
          size="sm"
          className="h-8 rounded-lg gap-1.5 text-xs"
          onClick={() => patchLink({ enabled: !link.enabled }, "toggle")}
          disabled={!!busyAction}>
          {busyAction === "toggle" ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : link.enabled ? (
            <Pause className="h-3.5 w-3.5" />
          ) : (
            <Play className="h-3.5 w-3.5" />
          )}
          {link.enabled ? "Tạm dừng" : "Bật lại"}
        </Button>
        <Button
          variant="ghost"
          size="sm"
          className="h-8 rounded-lg gap-1.5 text-xs"
          onClick={() => patchLink({ rotate: true }, "rotate")}
          disabled={!!busyAction}>
          {busyAction === "rotate" ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <RefreshCw className="h-3.5 w-3.5" />
          )}
          Đổi link
        </Button>
      </div>
    </div>
  );
}
