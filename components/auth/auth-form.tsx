"use client";

import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Loader2, ArrowRight, User, LockKeyhole } from "lucide-react";
import { cn } from "@/lib/utils";
import { useAuth } from "@/context/AuthContext";
import { toast } from "sonner";

export default function AuthForm({ isRegister = false }: { isRegister?: boolean }) {
  const { login, register } = useAuth();
  const [isLogin, setIsLogin] = useState(!isRegister);
  const [submitting, setSubmitting] = useState(false);
  const [formData, setFormData] = useState({ username: "", password: "", confirmPassword: "" });

  const isPasswordMatch = useMemo(
    () => isLogin || formData.password === formData.confirmPassword,
    [formData.password, formData.confirmPassword, isLogin],
  );
  const registrationPasswordValid = isLogin || (formData.password.length >= 8 && formData.password.length <= 72);
  const canSubmit =
    Boolean(formData.username.trim() && formData.password) &&
    isPasswordMatch &&
    registrationPasswordValid &&
    !submitting;

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!canSubmit) return;

    setSubmitting(true);
    try {
      if (isLogin) {
        await login(formData.username, formData.password);
        toast.success("Đăng nhập thành công");
      } else {
        await register(formData.username, formData.password, formData.confirmPassword);
        toast.success("Tạo tài khoản thành công");
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Thao tác thất bại");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="w-full space-y-6">
      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="username">Username</Label>
          <div className="relative">
            <User className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              id="username"
              name="username"
              autoComplete="username"
              maxLength={24}
              placeholder="username"
              className="pl-10 h-11 bg-muted/20 border-border/50 focus:bg-background transition-all text-base"
              value={formData.username}
              onChange={(event) => setFormData({ ...formData, username: event.target.value })}
            />
          </div>
          {!isLogin && <p className="text-[11px] text-muted-foreground">3–24 ký tự, chữ, số hoặc dấu gạch dưới.</p>}
        </div>

        <div className="space-y-2">
          <Label htmlFor="password">Mật khẩu</Label>
          <div className="relative">
            <LockKeyhole className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              id="password"
              name="password"
              type="password"
              autoComplete={isLogin ? "current-password" : "new-password"}
              minLength={isLogin ? undefined : 8}
              maxLength={72}
              className="pl-10 h-11 bg-muted/20 border-border/50 focus:bg-background transition-all text-base"
              value={formData.password}
              onChange={(event) => setFormData({ ...formData, password: event.target.value })}
            />
          </div>
          {!isLogin && <p className="text-[11px] text-muted-foreground">Tối thiểu 8 ký tự.</p>}
        </div>

        {!isLogin && (
          <div className="space-y-2 animate-in fade-in zoom-in-95">
            <Label htmlFor="confirmPassword">Xác nhận mật khẩu</Label>
            <Input
              id="confirmPassword"
              name="confirmPassword"
              type="password"
              autoComplete="new-password"
              maxLength={72}
              className={cn(
                "h-11 bg-muted/20 border-border/50 focus:bg-background transition-all text-base",
                !isPasswordMatch && formData.confirmPassword && "border-destructive ring-destructive/20",
              )}
              value={formData.confirmPassword}
              onChange={(event) => setFormData({ ...formData, confirmPassword: event.target.value })}
            />
            {!isPasswordMatch && <p className="text-[11px] text-destructive">Mật khẩu xác nhận chưa khớp.</p>}
          </div>
        )}

        <Button type="submit" disabled={!canSubmit} className="w-full h-11 mt-2 shadow-sm">
          {submitting ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <>
              {isLogin ? "Đăng nhập" : "Tạo tài khoản"}
              <ArrowRight className="ml-2 h-4 w-4" />
            </>
          )}
        </Button>
      </form>

      <div className="relative">
        <div className="absolute inset-0 flex items-center">
          <span className="w-full border-t border-border" />
        </div>
        <div className="relative flex justify-center text-[10px] uppercase tracking-widest font-bold">
          <span className="bg-card px-2 text-muted-foreground">Hoặc</span>
        </div>
      </div>

      <Button
        type="button"
        variant="ghost"
        className="w-full h-11 text-xs font-semibold hover:bg-muted"
        onClick={() => {
          setIsLogin((value) => !value);
          setFormData({ username: "", password: "", confirmPassword: "" });
        }}>
        {isLogin ? "Chưa có tài khoản? Tạo một tài khoản" : "Đã có tài khoản? Đăng nhập"}
      </Button>
    </div>
  );
}
