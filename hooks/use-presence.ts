"use client";

import { useEffect, useState } from "react";
import { getPusherClient } from "@/lib/client";
import { conversationPresenceChannel } from "@/lib/realtime/channels";

interface PresenceMember {
  id: string;
}

interface PresenceMembers {
  get: (userId: string) => PresenceMember | null;
}

export function useConversationPresence(conversationId: string, peerUserId: string) {
  const [peerOnline, setPeerOnline] = useState(false);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (!conversationId || !peerUserId) {
      setPeerOnline(false);
      setReady(false);
      return;
    }

    const pusher = getPusherClient();
    const channelName = conversationPresenceChannel(conversationId);
    const channel = pusher.subscribe(channelName);

    const handleSucceeded = (members: PresenceMembers) => {
      setPeerOnline(Boolean(members.get(peerUserId)));
      setReady(true);
    };

    const handleAdded = (member: PresenceMember) => {
      if (member.id === peerUserId) setPeerOnline(true);
    };

    const handleRemoved = (member: PresenceMember) => {
      if (member.id === peerUserId) setPeerOnline(false);
    };

    const handleError = () => {
      setReady(true);
      setPeerOnline(false);
    };

    channel.bind("pusher:subscription_succeeded", handleSucceeded);
    channel.bind("pusher:member_added", handleAdded);
    channel.bind("pusher:member_removed", handleRemoved);
    channel.bind("pusher:subscription_error", handleError);

    return () => {
      channel.unbind("pusher:subscription_succeeded", handleSucceeded);
      channel.unbind("pusher:member_added", handleAdded);
      channel.unbind("pusher:member_removed", handleRemoved);
      channel.unbind("pusher:subscription_error", handleError);
      pusher.unsubscribe(channelName);
    };
  }, [conversationId, peerUserId]);

  return { peerOnline, presenceReady: ready };
}
