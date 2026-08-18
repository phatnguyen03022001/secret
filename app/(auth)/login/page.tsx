"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import AuthForm from "@/components/auth/auth-form";
import { useAuth } from "@/context/AuthContext";
import { Loader2, Link2, MessageCircle } from "lucide-react";

export default function LoginPage() {
  const router = useRouter();
  const { user, loading } = useAuth();

  useEffect(() => {
    if (user) {
      router.replace(user.isAdmin ? "/admin-secret-route" : "/");
    }
  }, [user, router]);

  if (loading) {
    return (
      <div className="h-dvh w-full flex flex-col items-center justify-center bg-background">
        <Loader2 className="w-7 h-7 animate-spin text-primary/60" />
        <p className="mt-4 text-xs font-medium text-muted-foreground">Đang kiểm tra phiên đăng nhập...</p>
      </div>
    );
  }

  return (
    <main className="h-dvh w-full overflow-y-auto bg-background">
      <div className="min-h-full grid lg:grid-cols-[1.05fr_0.95fr]">
        <section className="hidden lg:flex flex-col justify-between p-12 xl:p-16 border-r border-border bg-muted/20">
          <div className="inline-flex items-center gap-2 text-sm font-semibold">
            <div className="h-9 w-9 rounded-xl bg-primary text-primary-foreground flex items-center justify-center">
              <MessageCircle className="h-4 w-4" />
            </div>
            Spackie
          </div>

          <div className="max-w-lg space-y-5">
            <p className="text-sm font-semibold text-primary">Talk first. Connect later.</p>
            <h1 className="text-5xl font-semibold tracking-tight leading-[1.08]">
              Nhắn trước. Chia sẻ social sau.
            </h1>
            <p className="text-base text-muted-foreground leading-relaxed max-w-md">
              Dùng Spackie Link để bắt đầu một cuộc trò chuyện mà chưa cần trao đổi số điện thoại, Facebook hay Zalo.
            </p>
          </div>

          <div className="flex items-start gap-3 text-sm text-muted-foreground max-w-md">
            <Link2 className="h-4 w-4 mt-0.5 shrink-0" />
            <p>Nếu bạn nhận được một Spackie Link, bạn có thể trả lời dưới dạng guest mà không cần tạo tài khoản.</p>
          </div>
        </section>

        <section className="flex items-center justify-center px-5 py-10 sm:px-8">
          <div className="w-full max-w-md">
            <div className="lg:hidden mb-10 inline-flex items-center gap-2 text-sm font-semibold">
              <div className="h-9 w-9 rounded-xl bg-primary text-primary-foreground flex items-center justify-center">
                <MessageCircle className="h-4 w-4" />
              </div>
              Spackie
            </div>

            <div className="mb-7 space-y-2">
              <h2 className="text-2xl font-semibold tracking-tight">Đăng nhập vào Spackie</h2>
              <p className="text-sm text-muted-foreground">Quản lý inbox và Spackie Link của bạn.</p>
            </div>

            <div className="rounded-3xl border border-border bg-card p-6 sm:p-7 shadow-sm">
              <AuthForm />
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}
