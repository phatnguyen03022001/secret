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
import { conversationChannel, userChannel } from "@/lib/realtime/channels";
import { consumeRateLimit } from "@/lib/security/rate-limit";
import Conversation from "@/models/Conversation";
import Message from "@/models/Message";
import mongoose from "mongoose";
import { z } from "zod";

const paramsSchema = z.object({
  id: z.string().refine((val) => mongoose.Types.ObjectId.isValid(val), {
    message: "Invalid message id format",
  }),
});

const editSchema = z.object({
  text: z.string().max(160, "Tin nhắn tối đa 160 ký tự"),
});

function getReplyContent(message: any) {
  if (message.imageMode === "once") return "Ảnh xem một lần";
  if (message.imageUrl) return message.text?.trim() || "Ảnh";
  return message.text?.trim() || "Tin nhắn";
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  await connectDB();

  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (user.isAdmin) {
    return NextResponse.json({ error: "God view is read-only for message edits" }, { status: 403 });
  }

  const { id: rawId } = await params;
  const parseParams = paramsSchema.safeParse({ id: rawId });
  if (!parseParams.success) {
    return NextResponse.json({ error: parseParams.error.issues[0].message }, { status: 400 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = editSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
  }

  const rateLimit = await consumeRateLimit({
    scope: "message-edit",
    identifier: user._id.toString(),
    limit: 30,
    windowSeconds: 60,
  });
  if (!rateLimit.allowed) {
    return NextResponse.json(
      { error: "Bạn đang chỉnh sửa quá nhanh." },
      { status: 429, headers: { "Retry-After": String(rateLimit.retryAfterSeconds) } },
    );
  }

  const message = await Message.findById(parseParams.data.id);
  if (!message || message.deleted) {
    return NextResponse.json({ error: "Message not found" }, { status: 404 });
  }

  if (message.userId.toString() !== user._id.toString()) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const nextText = parsed.data.text.trim();
  if (!nextText && !message.imageUrl) {
    return NextResponse.json({ error: "Nội dung trống" }, { status: 400 });
  }

  if (nextText === message.text) {
    return NextResponse.json({
      messageId: message._id.toString(),
      text: message.text,
      editedAt: message.editedAt,
      replyContent: getReplyContent(message),
    });
  }

  const now = new Date();
  const updated = await Message.findOneAndUpdate(
    {
      _id: message._id,
      userId: user._id,
      deleted: { $ne: true },
      text: message.text,
    },
    {
      $set: { text: nextText, editedAt: now },
      $push: {
        editHistory: {
          $each: [{ text: message.text || "", editedAt: now }],
          $slice: -10,
        },
      },
    },
    { new: true },
  );

  if (!updated) {
    return NextResponse.json(
      { error: "Tin nhắn đã thay đổi ở nơi khác. Hãy tải lại trước khi sửa tiếp." },
      { status: 409 },
    );
  }

  const conversation = await findConversationByExternalId(updated.conversationId?.toString() || updated.roomId);
  const realtimeRoomId = conversation?._id.toString() || updated.roomId;
  const updateEvent = {
    messageId: updated._id.toString(),
    text: updated.text,
    editedAt: updated.editedAt,
    replyContent: getReplyContent(updated),
  };

  await pusherServer.trigger(conversationChannel(realtimeRoomId), "message-updated", updateEvent);

  if (conversation && conversation.lastMessage?.messageId?.toString() === updated._id.toString()) {
    const lastMessage = getConversationLastMessageSnapshot(updated);
    await Conversation.updateOne({ _id: conversation._id }, { $set: { lastMessage } });

    const participants = getConversationMemberIds(conversation);
    const updatePayload = {
      roomId: realtimeRoomId,
      conversationId: realtimeRoomId,
      lastMessage: {
        content: getMessagePreview(updated),
        createdAt: updated.createdAt,
        userId: updated.userId,
      },
    };

    await Promise.all(
      participants.map((participantId) => pusherServer.trigger(userChannel(participantId), "rooms-updated", updatePayload)),
    );
  }

  return NextResponse.json(updateEvent);
}

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

  await pusherServer.trigger(conversationChannel(realtimeRoomId), "message-deleted", {
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
      participants.map((participantId) => pusherServer.trigger(userChannel(participantId), "rooms-updated", updatePayload)),
    );
  }

  return NextResponse.json({ success: true });
}
