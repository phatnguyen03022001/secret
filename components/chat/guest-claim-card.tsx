"use client";

import { useState } from "react";
import { ArrowRight, CheckCircle2, KeyRound, Loader2, Save } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useAuth } from "@/context/AuthContext";

export function GuestClaimCard() {
  const { refreshUser } = useAuth();
  const [expanded, setExpanded] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({ username: "", password: "", confirmPassword: "" });

  const canSubmit =
    form.username.trim().length >= 3 &&
    form.password.length >= 8 &&
    form.password === form.confirmPassword &&
    !submitting;

  const claim = async () => {
    if (!canSubmit) return;
    setSubmitting(true);
    setError(null);

    try {
      const response = await fetch("/api/guest/claim", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data?.error || "Không thể lưu tài khoản");

      await refreshUser();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Không thể lưu tài khoản");
    } finally {
      setSubmitting(false);
    }
  };

  if (!expanded) {
    return (
      <div className="mx-4 mb-3 rounded-2xl border border-primary/20 bg-primary/5 p-3.5">
        <div className="flex items-start gap-3">
          <div className="h-9 w-9 shrink-0 rounded-xl bg-primary/10 text-primary flex items-center justify-center">
            <Save className="h-4 w-4" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-xs font-semibold">Giữ lại cuộc trò chuyện này</p>
            <p className="mt-1 text-[11px] text-muted-foreground leading-relaxed">
              Tạo username và mật khẩu. Lịch sử chat hiện tại được giữ nguyên.
            </p>
          </div>
        </div>
        <Button className="w-full h-8 mt-3 rounded-lg text-xs gap-1.5" onClick={() => setExpanded(true)}>
          Lưu tài khoản
          <ArrowRight className="h-3.5 w-3.5" />
        </Button>
      </div>
    );
  }

  return (
    <div className="mx-4 mb-3 rounded-2xl border border-primary/20 bg-background p-3.5 shadow-sm">
      <div className="flex items-center gap-2 mb-3">
        <KeyRound className="h-4 w-4 text-primary" />
        <p className="text-xs font-semibold">Lưu Spackie identity</p>
      </div>

      <div className="space-y-2.5">
        <Input
          value={form.username}
          maxLength={24}
          placeholder="username"
          autoComplete="username"
          className="h-9 rounded-lg text-sm"
          onChange={(event) => setForm({ ...form, username: event.target.value })}
        />
        <Input
          value={form.password}
          type="password"
          maxLength={72}
          placeholder="Mật khẩu · tối thiểu 8 ký tự"
          autoComplete="new-password"
          className="h-9 rounded-lg text-sm"
          onChange={(event) => setForm({ ...form, password: event.target.value })}
        />
        <Input
          value={form.confirmPassword}
          type="password"
          maxLength={72}
          placeholder="Nhập lại mật khẩu"
          autoComplete="new-password"
          className="h-9 rounded-lg text-sm"
          onChange={(event) => setForm({ ...form, confirmPassword: event.target.value })}
        />

        {form.confirmPassword && form.password !== form.confirmPassword && (
          <p className="text-[11px] text-destructive">Mật khẩu xác nhận chưa khớp.</p>
        )}
        {error && <p className="text-[11px] text-destructive">{error}</p>}

        <div className="grid grid-cols-[auto_1fr] gap-2">
          <Button variant="ghost" size="sm" className="h-8 text-xs" onClick={() => setExpanded(false)} disabled={submitting}>
            Để sau
          </Button>
          <Button size="sm" className="h-8 text-xs gap-1.5" onClick={claim} disabled={!canSubmit}>
            {submitting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CheckCircle2 className="h-3.5 w-3.5" />}
            {submitting ? "Đang lưu..." : "Giữ tài khoản & chat"}
          </Button>
        </div>
      </div>
    </div>
  );
}
