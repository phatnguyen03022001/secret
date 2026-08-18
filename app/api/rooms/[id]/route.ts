import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth/session";
import { resolveConversationForUser } from "@/lib/chat/conversations";
import User from "@/models/User";

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const conversation = await resolveConversationForUser(id, user, { allowAdminGodView: true });
  if (!conversation) {
    return NextResponse.json({ error: "Conversation not found" }, { status: 404 });
  }

  const userId = user._id.toString();
  const isMember = conversation.members.some((member: any) => member.userId.toString() === userId);
  const targetMember = isMember
    ? conversation.members.find((member: any) => member.userId.toString() !== userId)
    : conversation.members[0];

  if (!targetMember) {
    return NextResponse.json({ error: "Conversation has no target user" }, { status: 404 });
  }

  const targetUser = await User.findById(targetMember.userId)
    .select("username displayName accountType isAdmin lastActive")
    .lean();

  if (!targetUser) {
    return NextResponse.json({ error: "Target user not found" }, { status: 404 });
  }

  const conversationId = conversation._id.toString();
  const burnRequestedBy = (conversation.burnRequestedBy || []).map((id: any) => id.toString());

  return NextResponse.json({
    roomId: conversationId,
    conversationId,
    lifecycle: conversation.lifecycle || "persistent",
    expiresAt: conversation.expiresAt ?? null,
    burn: {
      requestedBy: burnRequestedBy,
      requestedByMe: isMember && burnRequestedBy.includes(userId),
      requestedByPeer: isMember && burnRequestedBy.some((id: string) => id !== userId),
    },
    targetUser: {
      _id: targetUser._id,
      username: targetUser.username,
      displayName: targetUser.displayName || targetUser.username,
      accountType: targetUser.accountType || "registered",
      isAdmin: targetUser.isAdmin,
      lastActive: targetUser.lastActive ?? null,
    },
  });
}
