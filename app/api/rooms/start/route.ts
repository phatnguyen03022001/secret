import { NextRequest, NextResponse } from "next/server";
import { connectDB } from "@/lib/server";
import { getCurrentUser } from "@/lib/auth/session";
import { ensureDirectConversation } from "@/lib/chat/conversations";
import User from "@/models/User";
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

  if (currentUser.accountType === "guest") {
    return NextResponse.json({ error: "Guest sessions cannot browse or start arbitrary conversations" }, { status: 403 });
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

  const targetUser = await User.findOne({
    _id: targetUserId,
    accountType: { $ne: "guest" },
  });
  if (!targetUser) {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }

  if (currentUser.isAdmin !== targetUser.isAdmin) {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }

  const conversation = await ensureDirectConversation(currentUser, targetUser);
  const conversationId = conversation._id.toString();

  return NextResponse.json({
    roomId: conversationId,
    conversationId,
    targetUser: {
      _id: targetUser._id,
      username: targetUser.username,
      displayName: targetUser.displayName || targetUser.username,
      accountType: targetUser.accountType || "registered",
      isAdmin: targetUser.isAdmin,
    },
  });
}
