"use client";

import { useState, useMemo } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Loader2, User, Lock, ArrowRight, CheckCircle2, AlertCircle } from "lucide-react";
import { cn } from "@/lib/utils";

export default function AuthForm({ onAuth }: { onAuth: (user: any) => void }) {
  const [isLogin, setIsLogin] = useState(true);
  const [loading, setLoading] = useState(false);
  const [formData, setFormData] = useState({
    username: "",
    password: "",
    confirmPassword: "",
  });

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setFormData({ ...formData, [e.target.name]: e.target.value });
  };

  // Logic kiểm tra mật khẩu khớp (UX real-time)
  const isPasswordMatch = useMemo(() => {
    if (isLogin) return true;
    if (!formData.confirmPassword) return true;
    return formData.password === formData.confirmPassword;
  }, [formData.password, formData.confirmPassword, isLogin]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isLogin && !isPasswordMatch) return;

    setLoading(true);
    try {
      const res = await fetch(`/api/${isLogin ? "login" : "register"}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(formData),
      });

      const data = await res.json();

      if (res.ok) {
        // Logic quan trọng: Kiểm tra quyền Admin ngay tại đây
        if (data.user.isAdmin) {
          // Bạn có thể thông báo nhẹ hoặc chuyển hướng thẳng
          onAuth(data.user);
        } else {
          onAuth(data.user);
        }
      } else {
        alert(data.error || "Có lỗi xảy ra");
      }
    } catch (error) {
      alert("Lỗi kết nối server");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex items-center justify-center py-10 w-full animate-in fade-in duration-700">
      <Card className="w-full max-w-100 border-border/50 bg-card/80 backdrop-blur-xl shadow-2xl shadow-primary/5 rounded-[2rem] overflow-hidden">
        {/* Header với Gradient mờ */}
        <CardHeader className="space-y-2 text-center pt-8 pb-4 relative">
          <div className="absolute top-0 left-1/2 -translate-x-1/2 w-32 h-1 bg-linear-to-r from-transparent via-primary to-transparent opacity-50" />

          <CardTitle className="text-3xl font-black tracking-tight uppercase">
            {isLogin ? "Welcome Back" : "Create Account"}
          </CardTitle>
          <CardDescription className="text-[11px] uppercase tracking-[0.2em] font-bold text-muted-foreground/60">
            {isLogin ? "Truy cập hệ thống kết nối" : "Bắt đầu hành trình mới của bạn"}
          </CardDescription>
        </CardHeader>

        <CardContent className="px-8 pb-10">
          <form onSubmit={submit} className="space-y-5">
            {/* Input Tên đăng nhập */}
            <div className="space-y-1.5">
              <label className="text-[10px] font-bold uppercase ml-1 text-muted-foreground">Username</label>
              <div className="relative group">
                <User className="absolute left-3 top-3 h-4 w-4 text-muted-foreground group-focus-within:text-primary transition-colors" />
                <Input
                  name="username"
                  placeholder="Tên của bạn..."
                  value={formData.username}
                  onChange={handleChange}
                  className="pl-10 h-11 bg-muted/40 border-border/50 rounded-xl focus-visible:ring-primary/30 focus-visible:bg-background transition-all"
                  required
                />
              </div>
            </div>

            {/* Input Mật khẩu */}
            <div className="space-y-1.5">
              <label className="text-[10px] font-bold uppercase ml-1 text-muted-foreground">Password</label>
              <div className="relative group">
                <Lock className="absolute left-3 top-3 h-4 w-4 text-muted-foreground group-focus-within:text-primary transition-colors" />
                <Input
                  name="password"
                  type="password"
                  placeholder="••••••••"
                  value={formData.password}
                  onChange={handleChange}
                  className="pl-10 h-11 bg-muted/40 border-border/50 rounded-xl focus-visible:ring-primary/30 focus-visible:bg-background transition-all"
                  required
                />
              </div>
            </div>

            {/* Confirm Password (Chỉ hiện khi Đăng ký) */}
            {!isLogin && (
              <div className="space-y-1.5 animate-in slide-in-from-top-4 duration-500">
                <label className="text-[10px] font-bold uppercase ml-1 text-muted-foreground">Confirm Password</label>
                <div className="relative group">
                  <Lock className="absolute left-3 top-3 h-4 w-4 text-muted-foreground group-focus-within:text-primary transition-colors" />
                  <Input
                    name="confirmPassword"
                    type="password"
                    placeholder="••••••••"
                    value={formData.confirmPassword}
                    onChange={handleChange}
                    className={cn(
                      "pl-10 h-11 bg-muted/40 border-border/50 rounded-xl transition-all",
                      !isPasswordMatch
                        ? "border-destructive/50 focus-visible:ring-destructive/30"
                        : "focus-visible:ring-primary/30",
                    )}
                    required
                  />
                  {formData.confirmPassword && (
                    <div className="absolute right-3 top-3.5">
                      {isPasswordMatch ? (
                        <CheckCircle2 className="w-4 h-4 text-success" />
                      ) : (
                        <AlertCircle className="w-4 h-4 text-destructive" />
                      )}
                    </div>
                  )}
                </div>
                {!isPasswordMatch && (
                  <p className="text-[10px] text-destructive font-bold ml-1 uppercase tracking-wider">
                    Mật khẩu không khớp
                  </p>
                )}
              </div>
            )}

            {/* Submit Button */}
            <Button
              type="submit"
              className={cn(
                "w-full h-11 font-bold uppercase tracking-widest transition-all rounded-xl shadow-lg",
                isLogin
                  ? "bg-primary text-primary-foreground shadow-primary/20 hover:shadow-primary/40"
                  : "bg-foreground text-background",
              )}
              disabled={loading || (!isLogin && !isPasswordMatch)}>
              {loading ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <span className="flex items-center gap-2">
                  {isLogin ? "Sign In" : "Register"}
                  <ArrowRight className="h-4 w-4" />
                </span>
              )}
            </Button>

            {/* Divider */}
            <div className="relative py-2">
              <div className="absolute inset-0 flex items-center px-2">
                <span className="w-full border-t border-border/50" />
              </div>
              <div className="relative flex justify-center text-[10px] font-black uppercase">
                <span className="bg-card px-3 text-muted-foreground/40">OR</span>
              </div>
            </div>

            {/* Toggle Mode */}
            <p className="text-center text-xs text-muted-foreground font-medium">
              {isLogin ? "Bạn là người mới?" : "Đã có tài khoản?"}{" "}
              <button
                type="button"
                onClick={() => setIsLogin(!isLogin)}
                className="font-black text-primary hover:text-primary/80 transition-colors uppercase ml-1 underline-offset-4 hover:underline">
                {isLogin ? "Tạo tài khoản ngay" : "Đăng nhập tại đây"}
              </button>
            </p>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
