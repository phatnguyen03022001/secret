import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth/session";
import { ensureChatLinkForUser } from "@/lib/chat/links";

export async function GET() {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const link = await ensureChatLinkForUser(user);
  if (!link) {
    return NextResponse.json({ error: "Chat links are unavailable for this account" }, { status: 403 });
  }

  return NextResponse.json({
    slug: link.slug,
    path: `/chat/${link.slug}`,
    enabled: link.enabled,
    allowGuests: link.allowGuests,
    lifecycle: link.lifecycle,
  });
}
