"use client";

import { useEffect, useRef } from "react";

const DEFAULT_HEARTBEAT_INTERVAL_MS = 120_000;

export function useHeartbeat(intervalMs: number = DEFAULT_HEARTBEAT_INTERVAL_MS) {
  const intervalRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    const sendHeartbeat = async () => {
      if (document.visibilityState !== "visible") return;

      try {
        await fetch("/api/users/heartbeat", {
          method: "POST",
          keepalive: true,
          headers: { "Content-Type": "application/json" },
        });
      } catch {
        // Presence is best-effort and must never block the chat experience.
      }
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") sendHeartbeat();
    };

    sendHeartbeat();
    intervalRef.current = setInterval(sendHeartbeat, intervalMs);
    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [intervalMs]);
}
