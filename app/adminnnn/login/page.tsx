"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { ShieldAlert, Loader2, Lock, User, Terminal } from "lucide-react";
import { cn } from "@/lib/utils";

export default function AdminLoginPage() {
  const [loading, setLoading] = useState(false);
  const [formData, setFormData] = useState({ username: "", password: "" });
  const [status, setStatus] = useState<"idle" | "verifying" | "redirecting">("idle");
  const router = useRouter();

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setStatus("verifying");

    try {
      const res = await fetch("/api/admin/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(formData),
      });

      const data = await res.json();

      if (res.ok) {
        // Đợi 1 giây để tạo hiệu ứng "kiểm tra bảo mật"
        setTimeout(() => {
          if (data.user.isAdmin) {
            setStatus("redirecting");
            router.push("/adminnnn");
          } else {
            // ĐÁNH LẠC HƯỚNG: User thường sẽ bị đẩy về trang chủ
            router.replace("/");
          }
        }, 1200);
      } else {
        alert(data.error || "Access Denied");
        setLoading(false);
        setStatus("idle");
      }
    } catch (error) {
      alert("System Error");
      setLoading(false);
      setStatus("idle");
    }
  };

  return (
    <div className="h-dvh w-full bg-black flex items-center justify-center p-4 font-mono selection:bg-emerald-500 selection:text-black">
      {/* Background Effect */}
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,_var(--tw-gradient-stops))] from-emerald-500/5 via-transparent to-transparent pointer-events-none" />

      <Card className="w-full max-w-md border-zinc-800 bg-zinc-950/50 backdrop-blur-xl relative overflow-hidden">
        {/* Top Scanline Effect */}
        <div className="absolute top-0 left-0 w-full h-[1px] bg-emerald-500/50 animate-[scan_2s_linear_infinite]" />

        <CardContent className="pt-10 pb-10 px-8">
          <div className="flex flex-col items-center mb-8">
            <div className="w-16 h-16 rounded-2xl bg-zinc-900 border border-zinc-800 flex items-center justify-center mb-4 group-hover:border-emerald-500/50 transition-colors">
              <ShieldAlert
                className={cn(
                  "w-8 h-8 transition-colors",
                  status === "idle" ? "text-zinc-500" : "text-emerald-500 animate-pulse",
                )}
              />
            </div>
            <h1 className="text-white font-black tracking-[0.4em] uppercase text-sm">Root Access Required</h1>
            <p className="text-[10px] text-zinc-500 mt-2 uppercase tracking-widest font-bold">
              {status === "idle" && "Secure encrypted line v2.0"}
              {status === "verifying" && "Verifying credentials..."}
              {status === "redirecting" && "Authorization granted. Redirecting..."}
            </p>
          </div>

          <form onSubmit={handleLogin} className="space-y-4">
            <div className="space-y-1.5">
              <div className="relative">
                <User className="absolute left-3 top-3 w-4 h-4 text-zinc-600" />
                <Input
                  placeholder="IDENTITY"
                  value={formData.username}
                  onChange={(e) => setFormData({ ...formData, username: e.target.value })}
                  className="bg-black border-zinc-800 focus:border-emerald-500/50 text-emerald-500 pl-10 h-11 placeholder:text-zinc-700 rounded-none border-x-0 border-t-0 focus-visible:ring-0"
                  required
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <div className="relative">
                <Lock className="absolute left-3 top-3 w-4 h-4 text-zinc-600" />
                <Input
                  type="password"
                  placeholder="ACCESS KEY"
                  value={formData.password}
                  onChange={(e) => setFormData({ ...formData, password: e.target.value })}
                  className="bg-black border-zinc-800 focus:border-emerald-500/50 text-emerald-500 pl-10 h-11 placeholder:text-zinc-700 rounded-none border-x-0 border-t-0 focus-visible:ring-0"
                  required
                />
              </div>
            </div>

            <Button
              type="submit"
              disabled={loading}
              className={cn(
                "w-full h-12 rounded-none uppercase font-black tracking-widest transition-all",
                "bg-emerald-600 hover:bg-emerald-500 text-black shadow-[0_0_15px_rgba(16,185,129,0.2)]",
              )}>
              {loading ? (
                <div className="flex items-center gap-2">
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Processing
                </div>
              ) : (
                <div className="flex items-center gap-2">
                  <Terminal className="w-4 h-4" />
                  Authorize
                </div>
              )}
            </Button>
          </form>

          <div className="mt-8 pt-6 border-t border-zinc-900 flex justify-between items-center text-[8px] text-zinc-600 font-bold uppercase tracking-widest">
            <div className="flex items-center gap-1">
              <div className="w-1.5 h-1.5 bg-emerald-500 rounded-full animate-pulse" />
              Node: SG-01
            </div>
            <div>AES-256 Active</div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
