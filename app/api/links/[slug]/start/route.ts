import { randomBytes } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { createSession, getCurrentUser } from "@/lib/auth/session";
import { ensureDirectConversation, getDirectKey } from "@/lib/chat/conversations";
import { purgeConversationById } from "@/lib/chat/retention";
import { getChatLinkBySlug } from "@/lib/chat/links";
import { isBlockedBetween } from "@/lib/privacy/blocks";
import { consumeRateLimit, getRequestIp } from "@/lib/security/rate-limit";
import { connectDB } from "@/lib/server";
import Conversation from "@/models/Conversation";
import User from "@/models/User";
import { z } from "zod";

const guestSchema = z.object({
  displayName: z
    .string()
    .trim()
    .min(2, "Tên hiển thị cần ít nhất 2 ký tự")
    .max(32, "Tên hiển thị tối đa 32 ký tự")
    .refine((value) => !/[<>\r\n\t]/.test(value), "Tên hiển thị không hợp lệ")
    .optional(),
});

export async function POST(req: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const actor = await getCurrentUser();
  const limiterId = actor ? actor._id.toString() : getRequestIp(req);
  const rateLimit = await consumeRateLimit({
    scope: `chat-link-start:${slug.toLowerCase()}`,
    identifier: limiterId,
    limit: actor ? 30 : 12,
    windowSeconds: 60 * 60,
  });

  if (!rateLimit.allowed) {
    return NextResponse.json(
      { error: "Bạn đã mở quá nhiều cuộc trò chuyện trong thời gian ngắn." },
      { status: 429, headers: { "Retry-After": String(rateLimit.retryAfterSeconds) } },
    );
  }

  await connectDB();

  const resolved = await getChatLinkBySlug(slug);
  if (!resolved) {
    return NextResponse.json({ error: "Link not found" }, { status: 404 });
  }

  let body: unknown = {};
  try {
    body = await req.json();
  } catch {
    body = {};
  }

  const parsed = guestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
  }

  const { link, owner } = resolved;
  let currentActor = actor;
  let createdGuest = false;

  if (currentActor?._id.toString() === owner._id.toString()) {
    return NextResponse.json({ error: "Bạn không thể mở chat link của chính mình" }, { status: 400 });
  }

  if (currentActor?.isAdmin) {
    return NextResponse.json({ error: "Admin accounts do not use public chat links" }, { status: 403 });
  }

  if (!currentActor) {
    if (!link.allowGuests) {
      return NextResponse.json({ error: "Link này yêu cầu đăng nhập" }, { status: 401 });
    }

    const displayName = parsed.data.displayName;
    if (!displayName) {
      return NextResponse.json({ error: "Hãy nhập tên hiển thị" }, { status: 400 });
    }

    currentActor = await User.create({
      username: `guest${randomBytes(8).toString("hex")}`,
      displayName,
      password: null,
      accountType: "guest",
      isAdmin: false,
      chatSchemaVersion: 2,
    });
    createdGuest = true;

    await createSession(currentActor._id.toString(), {
      maxAgeSeconds: link.guestSessionHours * 60 * 60,
      userAgent: req.headers.get("user-agent"),
    });
  }

  const actorId = currentActor._id.toString();
  const ownerId = owner._id.toString();

  if (await isBlockedBetween(actorId, ownerId)) {
    return NextResponse.json({ error: "Link not found" }, { status: 404 });
  }

  const directKey = getDirectKey(actorId, ownerId);
  let existingConversation = await Conversation.findOne({ directKey });

  if (existingConversation?.expiresAt && existingConversation.expiresAt.getTime() <= Date.now()) {
    await purgeConversationById(existingConversation._id.toString(), "expired");
    existingConversation = null;
  }

  const conversation =
    existingConversation ||
    (await ensureDirectConversation(currentActor, owner, {
      lifecycle: link.lifecycle || "persistent",
    }));

  return NextResponse.json({
    conversationId: conversation._id.toString(),
    roomId: conversation._id.toString(),
    createdGuest,
    accountType: currentActor.accountType ?? "registered",
    lifecycle: conversation.lifecycle || "persistent",
    expiresAt: conversation.expiresAt ?? null,
  });
}
