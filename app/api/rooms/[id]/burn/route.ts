import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth/session";
import { getConversationMemberIds, resolveConversationForUser } from "@/lib/chat/conversations";
import { purgeConversationById } from "@/lib/chat/retention";
import { conversationChannel } from "@/lib/realtime/channels";
import { consumeRateLimit } from "@/lib/security/rate-limit";
import { pusherServer } from "@/lib/server";
import Conversation from "@/models/Conversation";

async function getConversationForMember(id: string) {
  const user = await getCurrentUser();
  if (!user) return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  if (user.isAdmin) return { error: NextResponse.json({ error: "Admin cannot burn user conversations" }, { status: 403 }) };

  const conversation = await resolveConversationForUser(id, user, { allowAdminGodView: false });
  if (!conversation) return { error: NextResponse.json({ error: "Conversation not found" }, { status: 404 }) };

  return { user, conversation };
}

async function publishBurnState(conversation: any, userId: string) {
  const requestedBy = (conversation.burnRequestedBy || []).map((id: any) => id.toString());
  const payload = {
    conversationId: conversation._id.toString(),
    requestedBy,
    actorId: userId,
  };

  await pusherServer.trigger(conversationChannel(conversation._id.toString()), "burn-status", payload);
  return payload;
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const resolved = await getConversationForMember(id);
  if (resolved.error) return resolved.error;

  const { user, conversation } = resolved;
  const userId = user._id.toString();
  const rateLimit = await consumeRateLimit({
    scope: "conversation-burn",
    identifier: userId,
    limit: 20,
    windowSeconds: 60 * 60,
  });

  if (!rateLimit.allowed) {
    return NextResponse.json(
      { error: "Bạn đang thay đổi trạng thái burn quá thường xuyên." },
      { status: 429, headers: { "Retry-After": String(rateLimit.retryAfterSeconds) } },
    );
  }

  const updated = await Conversation.findOneAndUpdate(
    { _id: conversation._id, "members.userId": user._id },
    { $addToSet: { burnRequestedBy: user._id } },
    { new: true },
  );

  if (!updated) return NextResponse.json({ error: "Conversation not found" }, { status: 404 });

  const memberIds = getConversationMemberIds(updated);
  const requestedBy = (updated.burnRequestedBy || []).map((memberId: any) => memberId.toString());
  const everyoneAccepted = memberIds.every((memberId) => requestedBy.includes(memberId));

  if (everyoneAccepted) {
    await purgeConversationById(updated._id.toString(), "burned");
    return NextResponse.json({ burned: true, conversationId: updated._id.toString() });
  }

  const state = await publishBurnState(updated, userId);
  return NextResponse.json({ burned: false, ...state });
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const resolved = await getConversationForMember(id);
  if (resolved.error) return resolved.error;

  const { user, conversation } = resolved;
  const updated = await Conversation.findOneAndUpdate(
    { _id: conversation._id, "members.userId": user._id },
    { $pull: { burnRequestedBy: user._id } },
    { new: true },
  );

  if (!updated) return NextResponse.json({ error: "Conversation not found" }, { status: 404 });

  const state = await publishBurnState(updated, user._id.toString());
  return NextResponse.json({ burned: false, ...state });
}
