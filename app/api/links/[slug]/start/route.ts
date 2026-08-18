import { randomBytes } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { createSession, getCurrentUser } from "@/lib/auth/session";
import { ensureDirectConversation } from "@/lib/chat/conversations";
import { getChatLinkBySlug } from "@/lib/chat/links";
import { connectDB } from "@/lib/server";
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
  await connectDB();

  const { slug } = await params;
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
  let actor = await getCurrentUser();
  let createdGuest = false;

  if (actor?._id.toString() === owner._id.toString()) {
    return NextResponse.json({ error: "Bạn không thể mở chat link của chính mình" }, { status: 400 });
  }

  if (actor?.isAdmin) {
    return NextResponse.json({ error: "Admin accounts do not use public chat links" }, { status: 403 });
  }

  if (!actor) {
    if (!link.allowGuests) {
      return NextResponse.json({ error: "Link này yêu cầu đăng nhập" }, { status: 401 });
    }

    const displayName = parsed.data.displayName;
    if (!displayName) {
      return NextResponse.json({ error: "Hãy nhập tên hiển thị" }, { status: 400 });
    }

    actor = await User.create({
      username: `guest${randomBytes(8).toString("hex")}`,
      displayName,
      password: null,
      accountType: "guest",
      isAdmin: false,
      chatSchemaVersion: 2,
    });
    createdGuest = true;

    await createSession(actor._id.toString(), {
      maxAgeSeconds: link.guestSessionHours * 60 * 60,
      userAgent: req.headers.get("user-agent"),
    });
  }

  const conversation = await ensureDirectConversation(actor, owner);

  return NextResponse.json({
    conversationId: conversation._id.toString(),
    roomId: conversation._id.toString(),
    createdGuest,
    accountType: actor.accountType ?? "registered",
  });
}
