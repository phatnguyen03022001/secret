import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth/session";
import { getConversationMemberIds, resolveConversationForUser } from "@/lib/chat/conversations";
import { isBlockedBetween } from "@/lib/privacy/blocks";
import { conversationChannel } from "@/lib/realtime/channels";
import { consumeRateLimit } from "@/lib/security/rate-limit";
import { pusherServer } from "@/lib/server";
import { z } from "zod";

const typingSchema = z.object({
  roomId: z.string().min(1).max(200),
  typing: z.boolean(),
});

export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user || user.isAdmin) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const rateLimit = await consumeRateLimit({
    scope: "typing",
    identifier: user._id.toString(),
    limit: 40,
    windowSeconds: 60,
  });
  if (!rateLimit.allowed) {
    return NextResponse.json({ ok: false }, { status: 429 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = typingSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid typing payload" }, { status: 400 });
  }

  const conversation = await resolveConversationForUser(parsed.data.roomId, user, { allowAdminGodView: false });
  if (!conversation) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const userId = user._id.toString();
  const memberIds = getConversationMemberIds(conversation);
  const peerId = memberIds.find((memberId) => memberId !== userId);
  if (peerId && (await isBlockedBetween(userId, peerId))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const currentMember = conversation.members.find((member: any) => member.userId.toString() === userId);
  const displayName = currentMember?.alias?.trim() || user.displayName || user.username;

  await pusherServer.trigger(conversationChannel(conversation._id.toString()), "typing-changed", {
    userId,
    displayName,
    typing: parsed.data.typing,
  });

  return NextResponse.json({ ok: true });
}
