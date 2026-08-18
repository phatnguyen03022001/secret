import { NextRequest, NextResponse } from "next/server";
import { connectDB, pusherServer } from "@/lib/server";
import { getCurrentUser } from "@/lib/auth/session";
import { getConversationMessageRoomIds, resolveConversationForUser } from "@/lib/chat/conversations";
import { conversationChannel } from "@/lib/realtime/channels";
import Conversation from "@/models/Conversation";
import Message from "@/models/Message";
import mongoose from "mongoose";

function isNewerReceipt(
  candidate: { _id: mongoose.Types.ObjectId; createdAt: Date },
  currentAt?: Date | null,
  currentId?: mongoose.Types.ObjectId | null,
) {
  if (!currentAt) return true;
  const candidateTime = new Date(candidate.createdAt).getTime();
  const currentTime = new Date(currentAt).getTime();
  if (candidateTime !== currentTime) return candidateTime > currentTime;
  if (!currentId) return true;
  return candidate._id.toString() > currentId.toString();
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
    deleted: { $ne: true },
    $or: [{ conversationId: conversation._id }, { roomId: { $in: roomIds } }],
  };
  if (messageId) filter._id = messageId;

  const deliveredMessage = await Message.findOne(filter)
    .sort(messageId ? undefined : { createdAt: -1, _id: -1 })
    .select("_id createdAt")
    .lean();
  if (!deliveredMessage?._id) return NextResponse.json({ delivered: false });

  const userId = user._id.toString();
  const member = conversation.members.find((item: any) => item.userId.toString() === userId);
  if (!member) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  if (!isNewerReceipt(deliveredMessage as any, member.lastDeliveredAt, member.lastDeliveredMessageId)) {
    return NextResponse.json({
      delivered: false,
      messageId: member.lastDeliveredMessageId?.toString() || null,
    });
  }

  await Conversation.updateOne(
    { _id: conversation._id, "members.userId": user._id },
    {
      $set: {
        "members.$.lastDeliveredMessageId": deliveredMessage._id,
        "members.$.lastDeliveredAt": deliveredMessage.createdAt,
      },
    },
  );

  const conversationId = conversation._id.toString();
  await pusherServer.trigger(conversationChannel(conversationId), "messages-delivered", {
    roomId: conversationId,
    conversationId,
    userId,
    messageId: deliveredMessage._id.toString(),
    deliveredAt: deliveredMessage.createdAt,
  });

  return NextResponse.json({
    delivered: true,
    messageId: deliveredMessage._id.toString(),
    deliveredAt: deliveredMessage.createdAt,
  });
}
