import { NextRequest, NextResponse } from "next/server";
import { connectDB, getCloudinaryPublicImageUrl, pusherServer } from "@/lib/server";
import { getCurrentUser } from "@/lib/auth/session";
import {
  getConversationMemberIds,
  getConversationMessageRoomIds,
  getMessagePreview,
  resolveConversationForUser,
} from "@/lib/chat/conversations";
import { isManagedCloudinaryImageUrl } from "@/lib/media/cloudinary";
import { isBlockedBetween } from "@/lib/privacy/blocks";
import { adminGlobalChannel, conversationChannel, userChannel } from "@/lib/realtime/channels";
import { consumeRateLimit } from "@/lib/security/rate-limit";
import Conversation from "@/models/Conversation";
import MediaUpload from "@/models/MediaUpload";
import Message from "@/models/Message";
import User from "@/models/User";
import mongoose from "mongoose";
import { z } from "zod";

const mediaSchema = z.object({
  publicId: z.string().min(10).max(300),
  deliveryType: z.enum(["upload", "authenticated"]),
  format: z.enum(["jpg", "jpeg", "png", "webp", "gif"]),
  width: z.number().int().min(1).max(12000),
  height: z.number().int().min(1).max(12000),
  bytes: z.number().int().min(1).max(8 * 1024 * 1024),
});

const sendMessageSchema = z.object({
  text: z.string().max(4000).optional().default(""),
  roomId: z.string().min(1).max(200),
  imageUrl: z.string().url().nullable().optional(),
  media: mediaSchema.nullable().optional(),
  imageMode: z.enum(["normal", "once"]).optional().default("normal"),
  clientMessageId: z.string().min(8).max(120).optional(),
  replyToId: z
    .string()
    .refine((value) => mongoose.Types.ObjectId.isValid(value), "Invalid reply target")
    .nullable()
    .optional(),
});

function buildReplyPreview(message: any) {
  if (!message) return null;

  const base = {
    messageId: message._id.toString(),
    senderId: message.userId?.toString(),
    senderName: message.username || "Spackie user",
  };

  if (message.deleted) {
    return { ...base, type: "deleted", content: "Tin nhắn đã bị gỡ" };
  }

  if (message.imageMode === "once") {
    return { ...base, type: "image", content: "Ảnh xem một lần" };
  }

  if (message.imageUrl || message.media?.publicId) {
    return { ...base, type: "image", content: message.text?.trim() || "Ảnh" };
  }

  return {
    ...base,
    type: "text",
    content: (message.text || "Tin nhắn").trim().slice(0, 160),
  };
}

function sanitizeMediaForClient(media: any, exposePublicId = false) {
  if (!media) return null;
  return {
    ...(exposePublicId ? { publicId: media.publicId } : {}),
    deliveryType: media.deliveryType,
    format: media.format,
    width: media.width,
    height: media.height,
    bytes: media.bytes,
  };
}

function sanitizeMessageForRealtime(message: any, replyPreview?: ReturnType<typeof buildReplyPreview>) {
  const payload = typeof message.toObject === "function" ? message.toObject() : { ...message };
  delete payload.editHistory;
  if (payload.media) payload.media = sanitizeMediaForClient(payload.media, false);
  if (payload.imageMode === "once") {
    payload.imageUrl = null;
    payload.onceAvailable = true;
  }
  if (replyPreview) payload.replyPreview = replyPreview;
  return payload;
}

async function getReplyPreviewForMessage(message: any) {
  if (!message?.replyTo) return null;
  const replyTarget = await Message.findById(message.replyTo)
    .select("_id userId username text imageUrl media imageMode deleted")
    .lean();
  return buildReplyPreview(replyTarget);
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
  const replyIds = [
    ...new Set(
      messages
        .map((message: any) => message.replyTo?.toString())
        .filter((value: string | undefined): value is string => Boolean(value)),
    ),
  ];
  const replyTargets = replyIds.length
    ? await Message.find({ _id: { $in: replyIds } })
        .select("_id userId username text imageUrl media imageMode deleted")
        .lean()
    : [];
  const replyMap = new Map(replyTargets.map((message: any) => [message._id.toString(), message]));
  const viewerId = viewer._id.toString();

  const processed = messages.map((message: any) => {
    const item = { ...message };
    const isSender = item.userId?.toString() === viewerId;

    if (!viewer.isAdmin) {
      delete item.editHistory;
      if (item.media) item.media = sanitizeMediaForClient(item.media, false);
    }

    if (item.replyTo) {
      item.replyPreview = buildReplyPreview(replyMap.get(item.replyTo.toString()));
    }

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

  const conversationId = conversation._id.toString();
  const memberIds = getConversationMemberIds(conversation);
  const userId = user._id.toString();
  const peerId = memberIds.find((memberId) => memberId !== userId);

  if (!user.isAdmin && peerId && (await isBlockedBetween(userId, peerId))) {
    return NextResponse.json({ error: "Không thể gửi tin nhắn trong cuộc trò chuyện này" }, { status: 403 });
  }

  const text = parsed.data.text.trim();
  const legacyImageUrl = parsed.data.imageUrl ?? null;
  const media = parsed.data.media ?? null;
  const clientMessageId = parsed.data.clientMessageId;
  const imageMode = parsed.data.imageMode;

  if (legacyImageUrl && media) {
    return NextResponse.json({ error: "Media payload không hợp lệ" }, { status: 400 });
  }

  if (!text && !legacyImageUrl && !media) {
    return NextResponse.json({ error: "Nội dung trống" }, { status: 400 });
  }

  if (!user.isAdmin && text.length > 160) {
    return NextResponse.json({ error: "Tin nhắn tối đa 160 ký tự" }, { status: 400 });
  }

  if (clientMessageId) {
    const duplicate = await Message.findOne({ conversationId: conversation._id, userId: user._id, clientMessageId });
    if (duplicate) {
      const duplicateReplyPreview = await getReplyPreviewForMessage(duplicate);
      return NextResponse.json(sanitizeMessageForRealtime(duplicate, duplicateReplyPreview), { status: 200 });
    }
  }

  let imageUrl: string | null = null;
  let persistedMedia: typeof media = null;

  if (media) {
    const expectedPrefix = `chat_images/${userId}/`;
    const expectedDeliveryType = imageMode === "once" ? "authenticated" : "upload";

    if (!media.publicId.startsWith(expectedPrefix)) {
      return NextResponse.json({ error: "Media không thuộc tài khoản hiện tại" }, { status: 400 });
    }
    if (media.deliveryType !== expectedDeliveryType) {
      return NextResponse.json({ error: "Media delivery mode không hợp lệ" }, { status: 400 });
    }

    const pendingUpload = await MediaUpload.exists({
      userId: user._id,
      publicId: media.publicId,
      deliveryType: media.deliveryType,
      cleanupAfter: { $gt: new Date() },
    });
    if (!pendingUpload) {
      return NextResponse.json({ error: "Media upload không còn hợp lệ" }, { status: 400 });
    }

    persistedMedia = media;
    imageUrl = imageMode === "normal" ? getCloudinaryPublicImageUrl(media.publicId, media.format) : null;
  } else if (legacyImageUrl) {
    if (!isManagedCloudinaryImageUrl(legacyImageUrl)) {
      return NextResponse.json({ error: "Media URL không thuộc Spackie" }, { status: 400 });
    }
    if (imageMode === "once") {
      return NextResponse.json({ error: "Ảnh xem một lần cần protected upload" }, { status: 400 });
    }
    imageUrl = legacyImageUrl;
  }

  const roomIds = getConversationMessageRoomIds(conversation);
  let replyTarget: any = null;

  if (parsed.data.replyToId) {
    replyTarget = await Message.findOne({
      _id: parsed.data.replyToId,
      deleted: { $ne: true },
      $or: [{ conversationId: conversation._id }, { roomId: { $in: roomIds } }],
    })
      .select("_id userId username text imageUrl media imageMode deleted")
      .lean();

    if (!replyTarget) {
      return NextResponse.json({ error: "Tin nhắn được trả lời không còn khả dụng" }, { status: 400 });
    }
  }

  const hasImage = Boolean(imageUrl || persistedMedia);
  const replyPreview = buildReplyPreview(replyTarget);
  let message;
  try {
    message = await Message.create({
      roomId: conversationId,
      conversationId: conversation._id,
      clientMessageId,
      type: hasImage ? "image" : "text",
      userId: user._id,
      username: user.displayName || user.username,
      text,
      media: persistedMedia,
      imageUrl,
      imageMode: hasImage && imageMode === "once" ? "once" : "normal",
      replyTo: replyTarget?._id ?? null,
    });
  } catch (error: any) {
    if (error?.code === 11000 && clientMessageId) {
      const duplicate = await Message.findOne({ conversationId: conversation._id, userId: user._id, clientMessageId });
      if (duplicate) {
        const duplicateReplyPreview = await getReplyPreviewForMessage(duplicate);
        return NextResponse.json(sanitizeMessageForRealtime(duplicate, duplicateReplyPreview), { status: 200 });
      }
    }
    throw error;
  }

  const messageSnapshot = {
    messageId: message._id,
    senderId: user._id,
    type: hasImage ? "image" : "text",
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

  const members = await User.find({ _id: { $in: memberIds } })
    .select("username displayName accountType isAdmin lastActive privacy.showLastSeen")
    .lean();
  const membersMap = new Map(members.map((member: any) => [member._id.toString(), member]));
  const realtimeMessage = sanitizeMessageForRealtime(message, replyPreview);

  await pusherServer.trigger(conversationChannel(conversationId), "new-message", realtimeMessage);

  const userUpdates = memberIds.map((participantId: string) => {
    const participant = membersMap.get(participantId);
    const otherMemberId = memberIds.find((id: string) => id !== participantId);
    const otherMember = otherMemberId ? membersMap.get(otherMemberId) : null;
    const canSeeLastSeen = participant?.isAdmin || otherMember?.privacy?.showLastSeen !== false;

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
            lastActive: canSeeLastSeen ? otherMember.lastActive ?? null : null,
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
