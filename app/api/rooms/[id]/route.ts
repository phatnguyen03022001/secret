import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth/session";
import { resolveConversationForUser } from "@/lib/chat/conversations";
import { getBlockState } from "@/lib/privacy/blocks";
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
  const currentMember = isMember
    ? conversation.members.find((member: any) => member.userId.toString() === userId)
    : null;
  const targetMember = isMember
    ? conversation.members.find((member: any) => member.userId.toString() !== userId)
    : conversation.members[0];

  if (!targetMember) {
    return NextResponse.json({ error: "Conversation has no target user" }, { status: 404 });
  }

  const targetUser = await User.findById(targetMember.userId)
    .select("username displayName accountType isAdmin lastActive privacy.showLastSeen")
    .lean();

  if (!targetUser) {
    return NextResponse.json({ error: "Target user not found" }, { status: 404 });
  }

  const conversationId = conversation._id.toString();
  const burnRequestedBy = (conversation.burnRequestedBy || []).map((memberId: any) => memberId.toString());
  const blockState = isMember && !user.isAdmin
    ? await getBlockState(userId, targetUser._id.toString())
    : { blockedByMe: false, blockedMe: false };
  const canSeeLastSeen = user.isAdmin || targetUser.privacy?.showLastSeen !== false;
  const peerAlias = targetMember.alias?.trim() || null;

  return NextResponse.json({
    roomId: conversationId,
    conversationId,
    lifecycle: conversation.lifecycle || "persistent",
    expiresAt: conversation.expiresAt ?? null,
    burn: {
      requestedBy: burnRequestedBy,
      requestedByMe: isMember && burnRequestedBy.includes(userId),
      requestedByPeer: isMember && burnRequestedBy.some((memberId: string) => memberId !== userId),
    },
    access: blockState,
    identity: {
      myAlias: currentMember?.alias?.trim() || null,
      peerAlias,
    },
    targetUser: {
      _id: targetUser._id,
      username: targetUser.username,
      displayName: peerAlias || targetUser.displayName || targetUser.username,
      profileDisplayName: targetUser.displayName || targetUser.username,
      accountType: targetUser.accountType || "registered",
      isAdmin: targetUser.isAdmin,
      lastActive: canSeeLastSeen ? targetUser.lastActive ?? null : null,
    },
  });
}
