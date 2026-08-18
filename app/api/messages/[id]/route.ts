import { NextRequest, NextResponse } from "next/server";
import { connectDB, pusherServer } from "@/lib/server";
import { getCurrentUser } from "@/lib/auth/session";
import {
  findConversationByExternalId,
  getConversationLastMessageSnapshot,
  getConversationMemberIds,
  getConversationMessageRoomIds,
  getMessagePreview,
} from "@/lib/chat/conversations";
import Conversation from "@/models/Conversation";
import Message from "@/models/Message";
import mongoose from "mongoose";
import { z } from "zod";

const paramsSchema = z.object({
  id: z.string().refine((val) => mongoose.Types.ObjectId.isValid(val), {
    message: "Invalid message id format",
  }),
});

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  await connectDB();

  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id: rawId } = await params;
  const parseResult = paramsSchema.safeParse({ id: rawId });
  if (!parseResult.success) {
    return NextResponse.json({ error: parseResult.error.issues[0].message }, { status: 400 });
  }

  const { id } = parseResult.data;
  const message = await Message.findById(id);
  if (!message) {
    return NextResponse.json({ error: "Message not found" }, { status: 404 });
  }

  const userId = user._id.toString();
  const isOwner = message.userId.toString() === userId;
  if (!isOwner && !user.isAdmin) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const conversation = await findConversationByExternalId(message.conversationId?.toString() || message.roomId);
  const realtimeRoomId = conversation?._id.toString() || message.roomId;

  message.deleted = true;
  message.deletedAt = new Date();
  await message.save();

  await pusherServer.trigger(`chat-${realtimeRoomId}`, "message-deleted", {
    messageId: message._id.toString(),
  });

  if (conversation && conversation.lastMessage?.messageId?.toString() === id) {
    const roomIds = getConversationMessageRoomIds(conversation);
    const newLastMessage = await Message.findOne({
      _id: { $ne: message._id },
      deleted: { $ne: true },
      $or: [{ conversationId: conversation._id }, { roomId: { $in: roomIds } }],
    })
      .sort({ createdAt: -1 })
      .lean();

    await Conversation.updateOne(
      { _id: conversation._id },
      { $set: { lastMessage: getConversationLastMessageSnapshot(newLastMessage) } },
    );

    const participants = getConversationMemberIds(conversation);
    const updatePayload = {
      roomId: realtimeRoomId,
      conversationId: realtimeRoomId,
      lastMessage: newLastMessage
        ? {
            content: getMessagePreview(newLastMessage),
            createdAt: newLastMessage.createdAt,
            userId: newLastMessage.userId,
          }
        : null,
    };

    await Promise.all(
      participants.map((participantId) => pusherServer.trigger(`user-${participantId}`, "rooms-updated", updatePayload)),
    );
  }

  return NextResponse.json({ success: true });
}
