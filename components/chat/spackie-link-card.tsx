"use client";

import { useEffect, useState } from "react";
import { Check, Copy, Link2, Loader2, Share2 } from "lucide-react";
import { Button } from "@/components/ui/button";

interface LinkData {
  slug: string;
  path: string;
  enabled: boolean;
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

  const handleCopy = async () => {
    if (!link) return;
    await copyText(getFullUrl());
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1800);
  };

  const handleShare = async () => {
    if (!link) return;
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
        // User cancelled or native sharing is unavailable; copying is the safe fallback.
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

  if (!link?.enabled) return null;

  return (
    <div className="mx-4 mb-3 rounded-2xl border border-border/60 bg-background/70 p-3.5 shadow-sm">
      <div className="flex items-start gap-3">
        <div className="h-9 w-9 shrink-0 rounded-xl bg-primary/10 text-primary flex items-center justify-center">
          <Link2 className="h-4 w-4" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-xs font-semibold">Your Spackie Link</p>
          <p className="mt-0.5 text-[11px] text-muted-foreground truncate">/chat/{link.slug}</p>
        </div>
      </div>

      <div className="mt-3 grid grid-cols-2 gap-2">
        <Button variant="outline" size="sm" className="h-8 rounded-lg gap-1.5 text-xs" onClick={handleCopy}>
          {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
          {copied ? "Đã copy" : "Copy link"}
        </Button>
        <Button variant="secondary" size="sm" className="h-8 rounded-lg gap-1.5 text-xs" onClick={handleShare}>
          <Share2 className="h-3.5 w-3.5" />
          Chia sẻ
        </Button>
      </div>
    </div>
  );
}
