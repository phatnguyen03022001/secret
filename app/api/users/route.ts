import { NextRequest, NextResponse } from "next/server";
import { connectDB } from "@/lib/server";
import { getCurrentUser } from "@/lib/auth/session";
import User from "@/models/User";

export async function GET(req: NextRequest) {
  await connectDB();

  const currentUser = await getCurrentUser();
  if (!currentUser) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!currentUser.isAdmin) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const page = Math.max(parseInt(req.nextUrl.searchParams.get("page") || "1", 10), 1);
  const limit = Math.min(Math.max(parseInt(req.nextUrl.searchParams.get("limit") || "20", 10), 1), 50);
  const skip = (page - 1) * limit;

  const totalUsers = await User.countDocuments({});
  const users = await User.find({}, "-password").sort({ createdAt: -1 }).skip(skip).limit(limit);

  const hasMore = skip + users.length < totalUsers;

  return NextResponse.json({ users, hasMore, nextPage: page + 1 });
}
