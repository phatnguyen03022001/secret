import { NextRequest, NextResponse } from "next/server";
import { connectDB } from "@/lib/server";
import { getCurrentUser } from "@/lib/auth/session";
import { migrateLegacyConversationsForUser } from "@/lib/chat/conversations";
import Conversation from "@/models/Conversation";
import User from "@/models/User";

export async function GET(req: NextRequest) {
  await connectDB();

  const currentUser = await getCurrentUser();
  if (!currentUser) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  await migrateLegacyConversationsForUser(currentUser);

  const page = Math.max(parseInt(req.nextUrl.searchParams.get("page") || "1", 10), 1);
  const limit = Math.min(Math.max(parseInt(req.nextUrl.searchParams.get("limit") || "20", 10), 1), 50);
  const skip = (page - 1) * limit;
  const now = new Date();

  const membershipFilter = {
    "members.userId": currentUser._id,
    $or: [{ expiresAt: null }, { expiresAt: { $exists: false } }, { expiresAt: { $gt: now } }],
  };

  const [totalRooms, conversations] = await Promise.all([
    Conversation.countDocuments(membershipFilter),
    Conversation.find(membershipFilter)
      .sort({ "lastMessage.createdAt": -1, updatedAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean(),
  ]);

  const otherUserIds = conversations
    .flatMap((conversation: any) => conversation.members)
    .map((member: any) => member.userId.toString())
    .filter((id: string) => id !== currentUser._id.toString());

  const users = await User.find({ _id: { $in: [...new Set(otherUserIds)] } })
    .select("username displayName accountType isAdmin lastActive privacy.showLastSeen")
    .lean();
  const usersMap = new Map(users.map((user: any) => [user._id.toString(), user]));

  const rooms = conversations
    .map((conversation: any) => {
      const currentMember = conversation.members.find(
        (member: any) => member.userId.toString() === currentUser._id.toString(),
      );
      const otherMember = conversation.members.find(
        (member: any) => member.userId.toString() !== currentUser._id.toString(),
      );
      if (!otherMember) return null;

      const otherUser = usersMap.get(otherMember.userId.toString());
      if (!otherUser || otherUser.isAdmin) return null;

      const conversationId = conversation._id.toString();
      const lastMessage = conversation.lastMessage
        ? {
            content: conversation.lastMessage.preview,
            createdAt: conversation.lastMessage.createdAt,
            userId: conversation.lastMessage.senderId,
          }
        : undefined;
      const canSeeLastSeen = currentUser.isAdmin || otherUser.privacy?.showLastSeen !== false;

      return {
        roomId: conversationId,
        conversationId,
        lifecycle: conversation.lifecycle || "persistent",
        expiresAt: conversation.expiresAt ?? null,
        otherUser: {
          _id: otherUser._id,
          username: otherUser.username,
          displayName: otherUser.displayName || otherUser.username,
          accountType: otherUser.accountType || "registered",
          lastActive: canSeeLastSeen ? otherUser.lastActive ?? null : null,
        },
        lastMessageAt: conversation.lastMessage?.createdAt ?? conversation.updatedAt,
        lastMessage,
        unreadCount: currentMember?.unreadCount ?? 0,
      };
    })
    .filter(Boolean);

  return NextResponse.json({
    rooms,
    hasMore: skip + conversations.length < totalRooms,
    nextPage: page + 1,
  });
}
