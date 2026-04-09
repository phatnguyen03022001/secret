import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { ThemeProvider } from "../components/providers/theme-provider";
import { AuthProvider } from "@/context/AuthContext";
import { Toaster } from "sonner";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Spackie System",
  description: "Secure Intelligence Chat System",
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "Spackie",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: "cover",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="vi" suppressHydrationWarning className="h-full">
      <body
        className={`${geistSans.variable} ${geistMono.variable} 
        h-full w-full bg-background text-foreground antialiased 
        selection:bg-primary/30 selection:text-primary 
        overflow-hidden`}>
        {" "}
        {/* Đổi overflow-x-hidden thành overflow-hidden */}
        <ThemeProvider attribute="class" defaultTheme="dark" enableSystem disableTransitionOnChange>
          <AuthProvider>
            {/* Sử dụng thẻ div wrapper thay vì main để tránh lồng ghép */}
            <div className="relative flex flex-col h-dvh w-full">{children}</div>
            <Toaster position="top-center" />
          </AuthProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
