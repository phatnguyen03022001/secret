import { NextRequest, NextResponse } from "next/server";
import { connectDB } from "@/lib/server";
import { getCurrentUser } from "@/lib/auth/session";
import Conversation from "@/models/Conversation";
import Message from "@/models/Message";
import User from "@/models/User";
import { getParticipantsFromRoomId } from "@/lib/utils";

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

    const [conversations, rawRoomIds] = await Promise.all([
      Conversation.find({}).sort({ "lastMessage.createdAt": -1, updatedAt: -1 }).lean(),
      Message.distinct("roomId"),
    ]);

    const knownRawRoomIds = new Set<string>();
    const entries: Array<{ roomId: string; userIds: string[]; sortAt: Date }> = [];

    for (const conversation of conversations as any[]) {
      const conversationId = conversation._id.toString();
      knownRawRoomIds.add(conversationId);
      if (conversation.legacyRoomId) knownRawRoomIds.add(conversation.legacyRoomId);

      entries.push({
        roomId: conversationId,
        userIds: conversation.members.map((member: any) => member.userId.toString()),
        sortAt: new Date(conversation.lastMessage?.createdAt ?? conversation.updatedAt),
      });
    }

    for (const rawRoomId of rawRoomIds) {
      if (knownRawRoomIds.has(rawRoomId)) continue;
      const userIds = getParticipantsFromRoomId(rawRoomId);
      if (userIds.length === 0) continue;

      const latest = await Message.findOne({ roomId: rawRoomId }).sort({ createdAt: -1 }).select("createdAt").lean();
      entries.push({
        roomId: rawRoomId,
        userIds,
        sortAt: new Date(latest?.createdAt ?? 0),
      });
    }

    entries.sort((a, b) => b.sortAt.getTime() - a.sortAt.getTime());

    const paginatedEntries = entries.slice(skip, skip + limit);
    const uniqueUserIds = [...new Set(paginatedEntries.flatMap((entry) => entry.userIds))];
    const users = await User.find({ _id: { $in: uniqueUserIds } }).select("username isAdmin").lean();
    const usersMap = new Map(users.map((user: any) => [user._id.toString(), user]));

    const rooms = paginatedEntries
      .map((entry) => ({
        roomId: entry.roomId,
        conversationId: entry.roomId,
        participants: entry.userIds
          .map((id) => usersMap.get(id))
          .filter(Boolean)
          .map((user: any) => ({ _id: user._id, username: user.username, isAdmin: user.isAdmin })),
      }))
      .filter((room) => room.participants.length > 0);

    return NextResponse.json({
      rooms,
      hasMore: skip + paginatedEntries.length < entries.length,
      nextPage: page + 1,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Internal server error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
