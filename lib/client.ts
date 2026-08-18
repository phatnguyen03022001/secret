// lib/client.ts
"use client";

import Pusher from "pusher-js";

let pusherInstance: Pusher | null = null;

export const getPusherClient = (): Pusher => {
  if (typeof window === "undefined") {
    throw new Error("Pusher client only works in browser");
  }

  if (!pusherInstance) {
    pusherInstance = new Pusher(process.env.NEXT_PUBLIC_PUSHER_KEY!, {
      cluster: process.env.NEXT_PUBLIC_PUSHER_CLUSTER!,
      channelAuthorization: {
        endpoint: "/api/realtime/auth",
        transport: "ajax",
      },
    });
  }

  return pusherInstance;
};

export const pusherClient = typeof window !== "undefined" ? getPusherClient() : null;
