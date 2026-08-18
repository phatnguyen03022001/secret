import { NextRequest, NextResponse } from "next/server";
import { connectDB, pusherServer } from "@/lib/server";
import { getCurrentUser } from "@/lib/auth/session";
import User from "@/models/User";
import Message from "@/models/Message";
import mongoose from "mongoose";
import { z } from "zod";
import { getParticipantsFromRoomId } from "@/lib/utils";

const sendMessageSchema = z.object({
  text: z.string().max(4000).optional().default(""),
  roomId: z.string().min(1).max(200).optional(),
  imageUrl: z.string().url().nullable().optional(),
  imageMode: z.enum(["normal", "once"]).optional().default("normal"),
});

export async function GET(req: NextRequest) {
  await connectDB();

  const viewer = await getCurrentUser();
  if (!viewer) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const viewerId = viewer._id.toString();
  const roomId = req.nextUrl.searchParams.get("roomId");
  const cursor = req.nextUrl.searchParams.get("cursor");
  const rawLimit = parseInt(req.nextUrl.searchParams.get("limit") || "10", 10);
  const limit = Math.min(Math.max(Number.isFinite(rawLimit) ? rawLimit : 10, 1), 50);

  if (!roomId) {
    return NextResponse.json({ error: "Thiếu roomId" }, { status: 400 });
  }

  const participants = getParticipantsFromRoomId(roomId);
  const isOwnerRoom = roomId === `room-${viewerId}`;
  const isPrivateRoom = participants.includes(viewerId);

  if (!viewer.isAdmin && !isOwnerRoom && !isPrivateRoom) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const queryFilter: Record<string, unknown> = { roomId };
  if (cursor && mongoose.Types.ObjectId.isValid(cursor)) {
    queryFilter._id = { $lt: new mongoose.Types.ObjectId(cursor) };
  }

  const messages = await Message.find(queryFilter).sort({ createdAt: -1 }).limit(limit).lean().exec();

  const processed = messages.map((message: any) => {
    const item = { ...message };
    if (item.deleted) {
      item.isDeleted = true;
      if (!viewer.isAdmin) {
        item.text = "[Tin nhắn đã bị gỡ]";
        item.imageUrl = null;
      }
    }
    return item;
  });

  const hasMore = messages.length === limit;
  const nextCursor = messages.length ? messages[messages.length - 1]._id.toString() : null;

  return NextResponse.json({
    messages: processed.reverse(),
    hasMore,
    nextCursor,
  });
}

export async function POST(req: NextRequest) {
  await connectDB();

  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Chưa đăng nhập" }, { status: 401 });
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

  const userId = user._id.toString();
  const text = parsed.data.text.trim();
  const imageUrl = parsed.data.imageUrl ?? null;

  if (!text && !imageUrl) {
    return NextResponse.json({ error: "Nội dung trống" }, { status: 400 });
  }

  if (!user.isAdmin && text.length > 160) {
    return NextResponse.json({ error: "Tin nhắn tối đa 160 ký tự" }, { status: 400 });
  }

  const finalRoomId = parsed.data.roomId || `room-${userId}`;
  const participants = getParticipantsFromRoomId(finalRoomId);
  const isOwnerRoom = finalRoomId === `room-${userId}`;
  const isPrivateRoom = participants.includes(userId);

  if (!user.isAdmin && !isOwnerRoom && !isPrivateRoom) {
    return NextResponse.json({ error: "Không có quyền gửi vào phòng này" }, { status: 403 });
  }

  if (user.isAdmin) {
    const participantsInfo = await User.find({ _id: { $in: participants } }).select("isAdmin").lean();
    if (participantsInfo.some((participant) => !participant.isAdmin)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
  }

  const msg = await Message.create({
    roomId: finalRoomId,
    userId: user._id,
    username: user.username,
    isAdmin: user.isAdmin || false,
    text,
    imageUrl,
    imageMode: imageUrl && parsed.data.imageMode === "once" ? "once" : "normal",
  });

  const msgObj = msg.toObject();
  await pusherServer.trigger(`chat-${finalRoomId}`, "new-message", msgObj);

  const otherUserForUpdate = { _id: user._id, username: user.username };
  const userUpdates = participants.map((participantId: string) =>
    pusherServer.trigger(`user-${participantId}`, "rooms-updated", {
      roomId: finalRoomId,
      lastMessage: msgObj,
      otherUser: otherUserForUpdate,
    }),
  );

  const adminParticipants = await User.find({
    _id: { $in: participants },
    isAdmin: true,
  })
    .select("_id")
    .lean();

  const adminUpdate = adminParticipants.length
    ? Promise.resolve()
    : pusherServer.trigger("admin-global", "rooms-updated", {
        roomId: finalRoomId,
        lastMessage: msgObj,
        participants,
      });

  await Promise.all([...userUpdates, adminUpdate]);

  return NextResponse.json(msg, { status: 201 });
}
