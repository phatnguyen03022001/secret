import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth/session";
import { getChatLinkBySlug, getPublicUserName } from "@/lib/chat/links";

export async function GET(req: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const resolved = await getChatLinkBySlug(slug);

  if (!resolved) {
    return NextResponse.json({ error: "Link not found" }, { status: 404 });
  }

  const viewer = await getCurrentUser();
  const { link, owner } = resolved;

  return NextResponse.json({
    slug: link.slug,
    owner: {
      username: owner.username,
      displayName: getPublicUserName(owner),
    },
    allowGuests: link.allowGuests,
    viewer: {
      authenticated: Boolean(viewer),
      isOwner: viewer?._id.toString() === owner._id.toString(),
      accountType: viewer?.accountType ?? null,
    },
  });
}
