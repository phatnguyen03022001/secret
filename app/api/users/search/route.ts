import { NextRequest, NextResponse } from "next/server";
import { connectDB } from "@/lib/server";
import { getCurrentUser } from "@/lib/auth/session";
import User from "@/models/User";

export async function GET(req: NextRequest) {
  const currentUser = await getCurrentUser();
  if (!currentUser) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  await connectDB();

  const keyword = (req.nextUrl.searchParams.get("q") || "").trim();
  if (!keyword) return NextResponse.json([]);

  const escaped = keyword.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const maybeId = keyword.length === 24 ? keyword : null;

  const users = await User.find({
    _id: { $ne: currentUser._id },
    isAdmin: false,
    $or: [{ username: { $regex: `^${escaped}$`, $options: "i" } }, ...(maybeId ? [{ _id: maybeId }] : [])],
  })
    .limit(10)
    .select("username _id");

  return NextResponse.json(users);
}
