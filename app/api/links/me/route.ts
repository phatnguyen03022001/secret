import { randomBytes } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth/session";
import { ensureChatLinkForUser } from "@/lib/chat/links";
import { consumeRateLimit } from "@/lib/security/rate-limit";
import ChatLink from "@/models/ChatLink";
import { z } from "zod";

const updateSchema = z.object({
  enabled: z.boolean().optional(),
  allowGuests: z.boolean().optional(),
  rotate: z.boolean().optional(),
});

function serializeLink(link: any) {
  return {
    slug: link.slug,
    path: `/chat/${link.slug}`,
    enabled: link.enabled,
    allowGuests: link.allowGuests,
    lifecycle: link.lifecycle,
  };
}

export async function GET() {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const link = await ensureChatLinkForUser(user);
  if (!link) {
    return NextResponse.json({ error: "Chat links are unavailable for this account" }, { status: 403 });
  }

  return NextResponse.json(serializeLink(link));
}

export async function PATCH(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const link = await ensureChatLinkForUser(user);
  if (!link) {
    return NextResponse.json({ error: "Chat links are unavailable for this account" }, { status: 403 });
  }

  const rateLimit = await consumeRateLimit({
    scope: "chat-link-settings",
    identifier: user._id.toString(),
    limit: 12,
    windowSeconds: 60 * 60,
  });
  if (!rateLimit.allowed) {
    return NextResponse.json(
      { error: "Bạn đang thay đổi link quá thường xuyên." },
      { status: 429, headers: { "Retry-After": String(rateLimit.retryAfterSeconds) } },
    );
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = updateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid link settings" }, { status: 400 });
  }

  const updates: Record<string, unknown> = {};
  if (typeof parsed.data.enabled === "boolean") updates.enabled = parsed.data.enabled;
  if (typeof parsed.data.allowGuests === "boolean") updates.allowGuests = parsed.data.allowGuests;

  if (parsed.data.rotate) {
    const base = user.username.toLowerCase().slice(0, 24);
    updates.slug = `${base}-${randomBytes(4).toString("hex")}`;
  }

  if (Object.keys(updates).length === 0) {
    return NextResponse.json(serializeLink(link));
  }

  try {
    const updated = await ChatLink.findOneAndUpdate({ _id: link._id, ownerId: user._id }, { $set: updates }, { new: true });
    if (!updated) return NextResponse.json({ error: "Link not found" }, { status: 404 });
    return NextResponse.json(serializeLink(updated));
  } catch (error: any) {
    if (error?.code === 11000 && parsed.data.rotate) {
      const fallbackSlug = `${user.username.toLowerCase().slice(0, 20)}-${randomBytes(6).toString("hex")}`;
      const updated = await ChatLink.findOneAndUpdate(
        { _id: link._id, ownerId: user._id },
        { $set: { ...updates, slug: fallbackSlug } },
        { new: true },
      );
      if (updated) return NextResponse.json(serializeLink(updated));
    }
    throw error;
  }
}
