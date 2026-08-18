import { NextRequest, NextResponse } from "next/server";
import { connectDB } from "@/lib/server";
import { getCurrentUser } from "@/lib/auth/session";
import Message from "@/models/Message";
import User from "@/models/User";
import mongoose from "mongoose";

export async function GET(req: NextRequest) {
  try {
    await connectDB();

    const admin = await getCurrentUser();
    if (!admin) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    if (!admin.isAdmin) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const page = Math.max(parseInt(req.nextUrl.searchParams.get("page") || "1", 10), 1);
    const limit = Math.min(Math.max(parseInt(req.nextUrl.searchParams.get("limit") || "20", 10), 1), 50);
    const skip = (page - 1) * limit;

    const allRoomIds = await Message.distinct("roomId");
    allRoomIds.sort();

    const totalRooms = allRoomIds.length;
    const paginatedRoomIds = allRoomIds.slice(skip, skip + limit);
    const hasMore = skip + paginatedRoomIds.length < totalRooms;

    if (paginatedRoomIds.length === 0) {
      return NextResponse.json({ rooms: [], hasMore, nextPage: page + 1 });
    }

    const roomData = paginatedRoomIds.map((roomId) => {
      const parts = roomId.split("-");
      const userIds = parts.filter((part: string) => part !== "room" && part !== "" && mongoose.Types.ObjectId.isValid(part));
      return { roomId, userIds };
    });

    const uniqueUserIds = [...new Set(roomData.flatMap((room) => room.userIds))];
    const usersMap = new Map<string, { _id: unknown; username: string }>();

    if (uniqueUserIds.length > 0) {
      const users = await User.find({ _id: { $in: uniqueUserIds } }).select("username");
      users.forEach((user) => {
        usersMap.set(user._id.toString(), { _id: user._id, username: user.username });
      });
    }

    const result = roomData
      .map((room) => ({
        roomId: room.roomId,
        participants: room.userIds.map((id: string) => usersMap.get(id)).filter(Boolean),
      }))
      .filter((room) => room.participants.length > 0);

    return NextResponse.json({ rooms: result, hasMore, nextPage: page + 1 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Internal server error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
