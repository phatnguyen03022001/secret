import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth/session";
import { getConversationMemberIds, resolveConversationForUser } from "@/lib/chat/conversations";
import { conversationChannel, userChannel } from "@/lib/realtime/channels";
import { consumeRateLimit } from "@/lib/security/rate-limit";
import { pusherServer } from "@/lib/server";
import Conversation from "@/models/Conversation";
import { z } from "zod";

const aliasSchema = z.object({
  alias: z
    .union([
      z
        .string()
        .trim()
        .min(2, "Tên trong chat cần ít nhất 2 ký tự")
        .max(32, "Tên trong chat tối đa 32 ký tự")
        .refine((value) => !/[<>\r\n\t]/.test(value), "Tên trong chat không hợp lệ"),
      z.null(),
    ]),
});

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (user.isAdmin) return NextResponse.json({ error: "Admin cannot change conversation identity" }, { status: 403 });

  const { id } = await params;
  const conversation = await resolveConversationForUser(id, user, { allowAdminGodView: false });
  if (!conversation) return NextResponse.json({ error: "Conversation not found" }, { status: 404 });

  const rateLimit = await consumeRateLimit({
    scope: "conversation-identity",
    identifier: user._id.toString(),
    limit: 30,
    windowSeconds: 60 * 60,
  });
  if (!rateLimit.allowed) {
    return NextResponse.json(
      { error: "Bạn đang đổi tên trong chat quá thường xuyên." },
      { status: 429, headers: { "Retry-After": String(rateLimit.retryAfterSeconds) } },
    );
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = aliasSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
  }

  const alias = parsed.data.alias?.trim() || null;
  const updated = await Conversation.findOneAndUpdate(
    { _id: conversation._id, "members.userId": user._id },
    { $set: { "members.$.alias": alias } },
    { new: true },
  );
  if (!updated) return NextResponse.json({ error: "Conversation not found" }, { status: 404 });

  const payload = {
    conversationId: updated._id.toString(),
    userId: user._id.toString(),
    alias,
  };
  const memberIds = getConversationMemberIds(updated);

  await Promise.allSettled([
    pusherServer.trigger(conversationChannel(updated._id.toString()), "identity-updated", payload),
    ...memberIds.map((memberId) => pusherServer.trigger(userChannel(memberId), "identity-updated", payload)),
  ]);

  return NextResponse.json(payload);
}
