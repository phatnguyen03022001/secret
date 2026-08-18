import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth/session";
import { getConversationMemberIds, resolveConversationForUser } from "@/lib/chat/conversations";
import { isBlockedBetween } from "@/lib/privacy/blocks";
import { pusherServer } from "@/lib/server";

export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const formData = await req.formData();
  const socketId = formData.get("socket_id");
  const channelName = formData.get("channel_name");

  if (typeof socketId !== "string" || typeof channelName !== "string") {
    return NextResponse.json({ error: "Invalid authorization payload" }, { status: 400 });
  }

  const userId = user._id.toString();

  if (channelName === `private-user-${userId}`) {
    return NextResponse.json(pusherServer.authorizeChannel(socketId, channelName));
  }

  if (channelName === "private-admin-global") {
    if (!user.isAdmin) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    return NextResponse.json(pusherServer.authorizeChannel(socketId, channelName));
  }

  const privateConversationPrefix = "private-chat-";
  const presenceConversationPrefix = "presence-chat-";
  const isPrivateConversation = channelName.startsWith(privateConversationPrefix);
  const isPresenceConversation = channelName.startsWith(presenceConversationPrefix);

  if (isPrivateConversation || isPresenceConversation) {
    const prefix = isPresenceConversation ? presenceConversationPrefix : privateConversationPrefix;
    const externalId = channelName.slice(prefix.length);
    if (!externalId) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    const conversation = await resolveConversationForUser(externalId, user, {
      allowAdminGodView: isPrivateConversation,
    });
    if (!conversation) {
      return NextResponse.json({ error: "Conversation unavailable" }, { status: 403 });
    }

    const memberIds = getConversationMemberIds(conversation);
    const isMember = memberIds.includes(userId);

    if (isPresenceConversation) {
      if (!isMember || user.isAdmin) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      }

      const peerId = memberIds.find((memberId) => memberId !== userId);
      if (peerId && (await isBlockedBetween(userId, peerId))) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      }

      const currentMember = conversation.members.find((member: any) => member.userId.toString() === userId);
      const displayName = currentMember?.alias?.trim() || user.displayName || user.username;

      return NextResponse.json(
        pusherServer.authorizeChannel(socketId, channelName, {
          user_id: userId,
          user_info: {
            displayName,
            accountType: user.accountType || "registered",
          },
        }),
      );
    }

    if (!isMember && !user.isAdmin) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    return NextResponse.json(pusherServer.authorizeChannel(socketId, channelName));
  }

  return NextResponse.json({ error: "Forbidden" }, { status: 403 });
}
