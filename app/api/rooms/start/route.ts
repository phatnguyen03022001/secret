import { NextRequest, NextResponse } from "next/server";
import { connectDB } from "@/lib/server";
import { getCurrentUser } from "@/lib/auth/session";
import User from "@/models/User";
import { getPrivateRoomId } from "@/lib/utils";
import mongoose from "mongoose";
import { z } from "zod";

const startRoomSchema = z.object({
  targetUserId: z.string().refine((val) => mongoose.Types.ObjectId.isValid(val), {
    message: "Invalid targetUserId format",
  }),
});

export async function POST(req: NextRequest) {
  await connectDB();

  const currentUser = await getCurrentUser();
  if (!currentUser) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parseResult = startRoomSchema.safeParse(body);
  if (!parseResult.success) {
    return NextResponse.json({ error: parseResult.error.issues[0].message }, { status: 400 });
  }

  const userId = currentUser._id.toString();
  const { targetUserId } = parseResult.data;

  if (targetUserId === userId) {
    return NextResponse.json({ error: "Cannot start chat with yourself" }, { status: 400 });
  }

  const targetUser = await User.findById(targetUserId);
  if (!targetUser) {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }

  if (currentUser.isAdmin !== targetUser.isAdmin) {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }

  const roomId = getPrivateRoomId(userId, targetUserId);

  return NextResponse.json({
    roomId,
    targetUser: {
      _id: targetUser._id,
      username: targetUser.username,
      isAdmin: targetUser.isAdmin,
    },
  });
}
