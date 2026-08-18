import { NextRequest, NextResponse } from "next/server";
import { connectDB, pusherServer } from "@/lib/server";
import { getCurrentUser } from "@/lib/auth/session";
import Message from "@/models/Message";
import mongoose from "mongoose";
import { z } from "zod";
import { getParticipantsFromRoomId } from "@/lib/utils";

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

  message.deleted = true;
  message.deletedAt = new Date();
  await message.save();

  await pusherServer.trigger(`chat-${message.roomId}`, "message-deleted", {
    messageId: message._id.toString(),
  });

  const lastMessage = await Message.findOne({ roomId: message.roomId }).sort({ createdAt: -1 }).limit(1);
  if (lastMessage && lastMessage._id.toString() === id) {
    const newLastMessage = await Message.findOne({
      roomId: message.roomId,
      _id: { $ne: id },
    })
      .sort({ createdAt: -1 })
      .limit(1);

    const participants = getParticipantsFromRoomId(message.roomId);
    if (participants.length > 0) {
      const updatePayload = {
        roomId: message.roomId,
        lastMessage: newLastMessage
          ? {
              _id: newLastMessage._id,
              text: newLastMessage.text,
              imageUrl: newLastMessage.imageUrl,
              createdAt: newLastMessage.createdAt,
              userId: newLastMessage.userId,
            }
          : null,
      };

      await Promise.all(
        participants.map((participantId) => pusherServer.trigger(`user-${participantId}`, "rooms-updated", updatePayload)),
      );
    }
  }

  return NextResponse.json({ success: true });
}
