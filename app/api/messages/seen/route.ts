import { NextRequest, NextResponse } from "next/server";
import { connectDB, pusherServer } from "@/lib/server";
import { getCurrentUser } from "@/lib/auth/session";
import {
  getConversationMessageRoomIds,
  resolveConversationForUser,
} from "@/lib/chat/conversations";
import Conversation from "@/models/Conversation";
import Message from "@/models/Message";

export async function POST(req: NextRequest) {
  await connectDB();

  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const externalId = typeof (body as { roomId?: unknown })?.roomId === "string" ? (body as { roomId: string }).roomId : null;
  if (!externalId) {
    return NextResponse.json({ error: "Thiếu conversation id" }, { status: 400 });
  }

  const conversation = await resolveConversationForUser(externalId, user, { allowAdminGodView: true });
  if (!conversation) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const userId = user._id.toString();
  const isMember = conversation.members.some((member: any) => member.userId.toString() === userId);

  if (user.isAdmin && !isMember) {
    return NextResponse.json({ modified: 0, godView: true });
  }

  const roomIds = getConversationMessageRoomIds(conversation);
  const messageFilter = {
    $or: [{ conversationId: conversation._id }, { roomId: { $in: roomIds } }],
  };

  const latestMessage = await Message.findOne(messageFilter).sort({ createdAt: -1 }).select("_id").lean();
  const result = await Message.updateMany(
    {
      ...messageFilter,
      seenBy: { $ne: user._id },
      userId: { $ne: user._id },
    },
    { $addToSet: { seenBy: user._id } },
  );

  const memberUpdate: Record<string, unknown> = {
    "members.$.unreadCount": 0,
  };
  if (latestMessage?._id) {
    memberUpdate["members.$.lastReadMessageId"] = latestMessage._id;
  }

  await Conversation.updateOne(
    { _id: conversation._id, "members.userId": user._id },
    { $set: memberUpdate },
  );

  if (result.modifiedCount > 0 && !user.isAdmin) {
    const conversationId = conversation._id.toString();
    await Promise.all([
      pusherServer.trigger(`chat-${conversationId}`, "messages-seen", {
        roomId: conversationId,
        conversationId,
        userId,
        isAdmin: false,
      }),
      pusherServer.trigger(`user-${userId}`, "unread-updated", {
        roomId: conversationId,
        conversationId,
        unreadCount: 0,
      }),
    ]);
  }

  return NextResponse.json({ modified: result.modifiedCount });
}
