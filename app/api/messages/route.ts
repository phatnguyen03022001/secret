import { NextRequest, NextResponse } from "next/server";
import { connectDB, pusherServer } from "@/lib/server";
import { getCurrentUser } from "@/lib/auth/session";
import {
  getConversationMemberIds,
  getConversationMessageRoomIds,
  getMessagePreview,
  resolveConversationForUser,
} from "@/lib/chat/conversations";
import { adminGlobalChannel, conversationChannel, userChannel } from "@/lib/realtime/channels";
import { consumeRateLimit } from "@/lib/security/rate-limit";
import Conversation from "@/models/Conversation";
import Message from "@/models/Message";
import User from "@/models/User";
import mongoose from "mongoose";
import { z } from "zod";

const sendMessageSchema = z.object({
  text: z.string().max(4000).optional().default(""),
  roomId: z.string().min(1).max(200),
  imageUrl: z.string().url().nullable().optional(),
  imageMode: z.enum(["normal", "once"]).optional().default("normal"),
  clientMessageId: z.string().min(8).max(120).optional(),
});

function sanitizeMessageForRealtime(message: any) {
  const payload = typeof message.toObject === "function" ? message.toObject() : { ...message };
  if (payload.imageMode === "once") {
    payload.imageUrl = null;
    payload.onceAvailable = true;
  }
  return payload;
}

export async function GET(req: NextRequest) {
  await connectDB();

  const viewer = await getCurrentUser();
  if (!viewer) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const externalId = req.nextUrl.searchParams.get("roomId");
  const cursor = req.nextUrl.searchParams.get("cursor");
  const rawLimit = parseInt(req.nextUrl.searchParams.get("limit") || "10", 10);
  const limit = Math.min(Math.max(Number.isFinite(rawLimit) ? rawLimit : 10, 1), 50);

  if (!externalId) {
    return NextResponse.json({ error: "Thiếu conversation id" }, { status: 400 });
  }

  const conversation = await resolveConversationForUser(externalId, viewer, { allowAdminGodView: true });
  if (!conversation) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const roomIds = getConversationMessageRoomIds(conversation);
  const queryFilter: Record<string, unknown> = {
    $or: [{ conversationId: conversation._id }, { roomId: { $in: roomIds } }],
  };

  if (cursor && mongoose.Types.ObjectId.isValid(cursor)) {
    queryFilter._id = { $lt: new mongoose.Types.ObjectId(cursor) };
  }

  const messages = await Message.find(queryFilter).sort({ createdAt: -1 }).limit(limit).lean().exec();
  const viewerId = viewer._id.toString();

  const processed = messages.map((message: any) => {
    const item = { ...message };
    const isSender = item.userId?.toString() === viewerId;

    if (item.deleted) {
      item.isDeleted = true;
      if (!viewer.isAdmin) {
        item.text = "[Tin nhắn đã bị gỡ]";
        item.imageUrl = null;
      }
    }

    if (item.imageMode === "once" && !isSender && !viewer.isAdmin) {
      const hasViewed = (item.onceViewedBy ?? []).some((id: any) => id.toString() === viewerId);
      item.imageUrl = null;
      item.onceAvailable = !hasViewed && !item.deleted;
      item.onceViewed = hasViewed;
    }

    return item;
  });

  return NextResponse.json({
    messages: processed.reverse(),
    hasMore: messages.length === limit,
    nextCursor: messages.length ? messages[messages.length - 1]._id.toString() : null,
    conversationId: conversation._id.toString(),
  });
}

export async function POST(req: NextRequest) {
  await connectDB();

  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Chưa đăng nhập" }, { status: 401 });
  }

  const rateLimit = await consumeRateLimit({
    scope: "message-send",
    identifier: user._id.toString(),
    limit: 90,
    windowSeconds: 60,
  });

  if (!rateLimit.allowed) {
    return NextResponse.json(
      { error: "Bạn đang gửi tin nhắn quá nhanh." },
      { status: 429, headers: { "Retry-After": String(rateLimit.retryAfterSeconds) } },
    );
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = sendMessageSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
  }

  const conversation = await resolveConversationForUser(parsed.data.roomId, user, { allowAdminGodView: false });
  if (!conversation) {
    return NextResponse.json({ error: "Không có quyền gửi vào cuộc trò chuyện này" }, { status: 403 });
  }

  const text = parsed.data.text.trim();
  const imageUrl = parsed.data.imageUrl ?? null;
  const clientMessageId = parsed.data.clientMessageId;

  if (!text && !imageUrl) {
    return NextResponse.json({ error: "Nội dung trống" }, { status: 400 });
  }

  if (!user.isAdmin && text.length > 160) {
    return NextResponse.json({ error: "Tin nhắn tối đa 160 ký tự" }, { status: 400 });
  }

  if (clientMessageId) {
    const duplicate = await Message.findOne({ conversationId: conversation._id, userId: user._id, clientMessageId });
    if (duplicate) {
      return NextResponse.json(sanitizeMessageForRealtime(duplicate), { status: 200 });
    }
  }

  const conversationId = conversation._id.toString();
  const imageMode = imageUrl && parsed.data.imageMode === "once" ? "once" : "normal";

  let message;
  try {
    message = await Message.create({
      roomId: conversationId,
      conversationId: conversation._id,
      clientMessageId,
      type: imageUrl ? "image" : "text",
      userId: user._id,
      username: user.displayName || user.username,
      isAdmin: user.isAdmin || false,
      text,
      imageUrl,
      imageMode,
    });
  } catch (error: any) {
    if (error?.code === 11000 && clientMessageId) {
      const duplicate = await Message.findOne({ conversationId: conversation._id, userId: user._id, clientMessageId });
      if (duplicate) return NextResponse.json(sanitizeMessageForRealtime(duplicate), { status: 200 });
    }
    throw error;
  }

  const messageSnapshot = {
    messageId: message._id,
    senderId: user._id,
    type: imageUrl ? "image" : "text",
    preview: getMessagePreview(message),
    createdAt: message.createdAt,
  };

  await Conversation.updateOne(
    { _id: conversation._id },
    {
      $set: { lastMessage: messageSnapshot },
      $inc: { "members.$[recipient].unreadCount": 1 },
    },
    { arrayFilters: [{ "recipient.userId": { $ne: user._id } }] },
  );

  const memberIds = getConversationMemberIds(conversation);
  const members = await User.find({ _id: { $in: memberIds } })
    .select("username displayName accountType isAdmin")
    .lean();
  const membersMap = new Map(members.map((member: any) => [member._id.toString(), member]));
  const realtimeMessage = sanitizeMessageForRealtime(message);

  await pusherServer.trigger(conversationChannel(conversationId), "new-message", realtimeMessage);

  const userUpdates = memberIds.map((participantId: string) => {
    const otherMemberId = memberIds.find((id: string) => id !== participantId);
    const otherMember = otherMemberId ? membersMap.get(otherMemberId) : null;

    return pusherServer.trigger(userChannel(participantId), "rooms-updated", {
      roomId: conversationId,
      conversationId,
      lastMessage: {
        content: messageSnapshot.preview,
        createdAt: message.createdAt,
        userId: user._id,
      },
      otherUser: otherMember
        ? {
            _id: otherMember._id,
            username: otherMember.username,
            displayName: otherMember.displayName || otherMember.username,
            accountType: otherMember.accountType || "registered",
            isAdmin: otherMember.isAdmin,
          }
        : undefined,
    });
  });

  const hasAdminMember = members.some((member: any) => member.isAdmin);
  const adminUpdate = hasAdminMember
    ? Promise.resolve()
    : pusherServer.trigger(adminGlobalChannel(), "rooms-updated", {
        roomId: conversationId,
        conversationId,
        lastMessage: realtimeMessage,
        participants: memberIds,
      });

  await Promise.all([...userUpdates, adminUpdate]);

  return NextResponse.json(realtimeMessage, { status: 201 });
}
