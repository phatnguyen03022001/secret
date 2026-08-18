import { NextRequest, NextResponse } from "next/server";
import { connectDB } from "@/lib/server";
import { getCurrentUser } from "@/lib/auth/session";
import Message from "@/models/Message";
import User from "@/models/User";
import mongoose from "mongoose";

export async function GET(req: NextRequest) {
  await connectDB();

  const currentUser = await getCurrentUser();
  if (!currentUser) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const userId = currentUser._id.toString();
  const escapedUserId = userId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const roomIdPattern = `(^|-)${escapedUserId}(-|$)`;

  const page = Math.max(parseInt(req.nextUrl.searchParams.get("page") || "1", 10), 1);
  const limit = Math.min(Math.max(parseInt(req.nextUrl.searchParams.get("limit") || "20", 10), 1), 50);
  const skip = (page - 1) * limit;

  const rooms = await Message.aggregate([
    { $match: { roomId: { $regex: roomIdPattern, $options: "" } } },
    { $group: { _id: "$roomId", lastMessageAt: { $max: "$createdAt" } } },
    { $sort: { lastMessageAt: -1 } },
    { $skip: skip },
    { $limit: limit },
    { $project: { roomId: "$_id", _id: 0, lastMessageAt: 1 } },
  ]);

  const totalCountResult = await Message.aggregate([
    { $match: { roomId: { $regex: roomIdPattern, $options: "" } } },
    { $group: { _id: "$roomId" } },
    { $count: "total" },
  ]);
  const totalRooms = totalCountResult[0]?.total || 0;
  const hasMore = skip + rooms.length < totalRooms;

  const result = [];
  for (const room of rooms) {
    const { roomId, lastMessageAt } = room;
    const parts = roomId.split("-");
    const otherUserId = parts.find((id: string) => id !== userId && id !== "room");

    if (!otherUserId || !mongoose.Types.ObjectId.isValid(otherUserId)) continue;

    const otherUser = await User.findById(otherUserId).select("username isAdmin");
    if (!otherUser || otherUser.isAdmin) continue;

    const [unreadCount, latestMessage] = await Promise.all([
      Message.countDocuments({
        roomId,
        seenBy: { $ne: currentUser._id },
        userId: { $ne: currentUser._id },
      }),
      Message.findOne({ roomId }).sort({ createdAt: -1 }).select("text imageUrl createdAt userId deleted").lean(),
    ]);

    const lastMessage = latestMessage
      ? {
          content: latestMessage.deleted
            ? "[Tin nhắn đã bị gỡ]"
            : latestMessage.text || (latestMessage.imageUrl ? "Đã gửi một ảnh" : ""),
          createdAt: latestMessage.createdAt,
          userId: latestMessage.userId,
        }
      : undefined;

    result.push({
      roomId,
      otherUser: { _id: otherUserId, username: otherUser.username },
      lastMessageAt,
      lastMessage,
      unreadCount,
    });
  }

  return NextResponse.json({ rooms: result, hasMore, nextPage: page + 1 });
}
