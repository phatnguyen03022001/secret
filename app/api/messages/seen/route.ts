import { NextRequest, NextResponse } from "next/server";
import mongoose from "mongoose";
import { connectDB, pusherServer } from "@/lib/server";
import { getCurrentUser } from "@/lib/auth/session";
import { getConversationMessageRoomIds, resolveConversationForUser } from "@/lib/chat/conversations";
import { conversationChannel, userChannel } from "@/lib/realtime/channels";
import Conversation from "@/models/Conversation";
import Message from "@/models/Message";

export async function POST(req: NextRequest) {
  await connectDB();

  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const roomId = typeof (body as { roomId?: unknown })?.roomId === "string" ? (body as { roomId: string }).roomId : null;
  const requestedMessageId =
    typeof (body as { messageId?: unknown })?.messageId === "string" &&
    mongoose.Types.ObjectId.isValid((body as { messageId: string }).messageId)
      ? (body as { messageId: string }).messageId
      : null;

  if (!roomId) return NextResponse.json({ error: "Thiếu conversation id" }, { status: 400 });

  const conversation = await resolveConversationForUser(roomId, user, { allowAdminGodView: true });
  if (!conversation) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const userId = user._id.toString();
  const isMember = conversation.members.some((member: any) => member.userId.toString() === userId);
  if (user.isAdmin && !isMember) return NextResponse.json({ modified: 0, godView: true });

  const roomIds = getConversationMessageRoomIds(conversation);
  const peerMessageFilter: Record<string, unknown> = {
    userId: { $ne: user._id },
    $or: [{ conversationId: conversation._id }, { roomId: { $in: roomIds } }],
  };

  let latestPeerMessage: any = null;
  if (requestedMessageId) {
    latestPeerMessage = await Message.findOne({ ...peerMessageFilter, _id: requestedMessageId }).select("_id").lean();
  }
  if (!latestPeerMessage) {
    latestPeerMessage = await Message.findOne(peerMessageFilter).sort({ createdAt: -1 }).select("_id").lean();
  }

  const memberUpdate: Record<string, unknown> = {
    "members.$.unreadCount": 0,
  };
  if (latestPeerMessage?._id) {
    memberUpdate["members.$.lastReadMessageId"] = latestPeerMessage._id;
    memberUpdate["members.$.lastDeliveredMessageId"] = latestPeerMessage._id;
  }

  await Conversation.updateOne(
    { _id: conversation._id, "members.userId": user._id },
    { $set: memberUpdate },
  );

  if (!user.isAdmin) {
    const conversationId = conversation._id.toString();
    await Promise.all([
      latestPeerMessage?._id
        ? pusherServer.trigger(conversationChannel(conversationId), "messages-seen", {
            roomId: conversationId,
            conversationId,
            userId,
            messageId: latestPeerMessage._id.toString(),
            isAdmin: false,
          })
        : Promise.resolve(),
      pusherServer.trigger(userChannel(userId), "unread-updated", {
        roomId: conversationId,
        conversationId,
        unreadCount: 0,
      }),
    ]);
  }

  return NextResponse.json({
    modified: latestPeerMessage?._id ? 1 : 0,
    messageId: latestPeerMessage?._id?.toString() || null,
  });
}
