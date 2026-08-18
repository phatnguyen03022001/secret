import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth/session";
import { findConversationByExternalId } from "@/lib/chat/conversations";
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

  const conversationPrefix = "private-chat-";
  if (channelName.startsWith(conversationPrefix)) {
    const conversationId = channelName.slice(conversationPrefix.length);
    const conversation = await findConversationByExternalId(conversationId);
    if (!conversation) {
      return NextResponse.json({ error: "Conversation not found" }, { status: 404 });
    }

    const isMember = conversation.members.some((member: any) => member.userId.toString() === userId);
    if (!isMember && !user.isAdmin) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    return NextResponse.json(pusherServer.authorizeChannel(socketId, channelName));
  }

  return NextResponse.json({ error: "Forbidden" }, { status: 403 });
}
