import { NextRequest, NextResponse } from "next/server";
import { connectDB } from "@/lib/server";
import { getCurrentUser } from "@/lib/auth/session";
import { getBlockedUserIds } from "@/lib/privacy/blocks";
import User from "@/models/User";

export async function GET(req: NextRequest) {
  const currentUser = await getCurrentUser();
  if (!currentUser) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (currentUser.accountType === "guest") {
    return NextResponse.json({ error: "Guest sessions cannot browse users" }, { status: 403 });
  }

  await connectDB();

  const keyword = (req.nextUrl.searchParams.get("q") || "").trim();
  if (!keyword) return NextResponse.json([]);

  const escaped = keyword.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const maybeId = keyword.length === 24 ? keyword : null;
  const blockedIds = await getBlockedUserIds(currentUser._id.toString());
  const excludedIds = [currentUser._id.toString(), ...blockedIds];

  const users = await User.find({
    _id: { $nin: excludedIds },
    isAdmin: false,
    accountType: { $ne: "guest" },
    status: { $ne: "suspended" },
    $and: [
      {
        $or: [
          { "privacy.allowMessagesFrom": "everyone" },
          { "privacy.allowMessagesFrom": { $exists: false } },
        ],
      },
      {
        $or: [
          { username: { $regex: `^${escaped}$`, $options: "i" } },
          { displayName: { $regex: `^${escaped}$`, $options: "i" } },
          ...(maybeId ? [{ _id: maybeId }] : []),
        ],
      },
    ],
  })
    .limit(10)
    .select("username displayName accountType _id");

  return NextResponse.json(users);
}
