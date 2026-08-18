import { NextRequest, NextResponse } from "next/server";
import { connectDB, pusherServer } from "@/lib/server";
import { getCurrentUser } from "@/lib/auth/session";
import { getConversationMessageRoomIds, resolveConversationForUser } from "@/lib/chat/conversations";
import { conversationChannel } from "@/lib/realtime/channels";
import Conversation from "@/models/Conversation";
import Message from "@/models/Message";
import mongoose from "mongoose";

function isNewerObjectId(candidate: mongoose.Types.ObjectId, current?: mongoose.Types.ObjectId | null) {
  if (!current) return true;
  return candidate.toString() > current.toString();
}

export async function POST(req: NextRequest) {
  await connectDB();

  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (user.isAdmin) return NextResponse.json({ delivered: false, godView: true });

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const roomId = typeof (body as { roomId?: unknown })?.roomId === "string" ? (body as { roomId: string }).roomId : null;
  const messageId =
    typeof (body as { messageId?: unknown })?.messageId === "string" &&
    mongoose.Types.ObjectId.isValid((body as { messageId: string }).messageId)
      ? (body as { messageId: string }).messageId
      : null;

  if (!roomId) return NextResponse.json({ error: "Thiếu conversation id" }, { status: 400 });

  const conversation = await resolveConversationForUser(roomId, user, { allowAdminGodView: false });
  if (!conversation) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const roomIds = getConversationMessageRoomIds(conversation);
  const filter: Record<string, unknown> = {
    userId: { $ne: user._id },
    $or: [{ conversationId: conversation._id }, { roomId: { $in: roomIds } }],
  };
  if (messageId) filter._id = messageId;

  const deliveredMessage = await Message.findOne(filter).sort(messageId ? undefined : { createdAt: -1 }).select("_id").lean();
  if (!deliveredMessage?._id) return NextResponse.json({ delivered: false });

  const userId = user._id.toString();
  const member = conversation.members.find((item: any) => item.userId.toString() === userId);
  if (!member) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  if (!isNewerObjectId(deliveredMessage._id, member.lastDeliveredMessageId)) {
    return NextResponse.json({ delivered: false, messageId: member.lastDeliveredMessageId?.toString() || null });
  }

  await Conversation.updateOne(
    { _id: conversation._id, "members.userId": user._id },
    { $set: { "members.$.lastDeliveredMessageId": deliveredMessage._id } },
  );

  const conversationId = conversation._id.toString();
  await pusherServer.trigger(conversationChannel(conversationId), "messages-delivered", {
    roomId: conversationId,
    conversationId,
    userId,
    messageId: deliveredMessage._id.toString(),
  });

  return NextResponse.json({ delivered: true, messageId: deliveredMessage._id.toString() });
}
