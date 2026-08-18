import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth/session";
import { getDirectKey } from "@/lib/chat/conversations";
import { getBlockState } from "@/lib/privacy/blocks";
import { conversationChannel } from "@/lib/realtime/channels";
import { consumeRateLimit } from "@/lib/security/rate-limit";
import { pusherServer } from "@/lib/server";
import Block from "@/models/Block";
import Conversation from "@/models/Conversation";
import User from "@/models/User";
import mongoose from "mongoose";

async function resolveTarget(id: string) {
  if (!mongoose.Types.ObjectId.isValid(id)) return null;
  return User.findOne({ _id: id, isAdmin: false }).select("_id").lean();
}

async function publishBlockState(viewerId: string, targetId: string) {
  const conversation = await Conversation.findOne({ directKey: getDirectKey(viewerId, targetId) }).select("_id").lean();
  if (!conversation) return;

  const state = await getBlockState(viewerId, targetId);
  await pusherServer.trigger(conversationChannel(conversation._id.toString()), "block-status", {
    conversationId: conversation._id.toString(),
    blockerId: state.blockedByMe ? viewerId : state.blockedMe ? targetId : null,
    blockedId: state.blockedByMe ? targetId : state.blockedMe ? viewerId : null,
    blocked: state.blockedByMe || state.blockedMe,
  });
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  if (id === user._id.toString()) return NextResponse.json({ blockedByMe: false, blockedMe: false });
  const target = await resolveTarget(id);
  if (!target) return NextResponse.json({ error: "User not found" }, { status: 404 });

  return NextResponse.json(await getBlockState(user._id.toString(), id));
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (user.isAdmin) return NextResponse.json({ error: "Admin cannot block users" }, { status: 403 });

  const { id } = await params;
  const userId = user._id.toString();
  if (id === userId) return NextResponse.json({ error: "Cannot block yourself" }, { status: 400 });
  const target = await resolveTarget(id);
  if (!target) return NextResponse.json({ error: "User not found" }, { status: 404 });

  const rateLimit = await consumeRateLimit({
    scope: "user-block",
    identifier: userId,
    limit: 40,
    windowSeconds: 60 * 60,
  });
  if (!rateLimit.allowed) {
    return NextResponse.json(
      { error: "Bạn đang thay đổi danh sách block quá thường xuyên." },
      { status: 429, headers: { "Retry-After": String(rateLimit.retryAfterSeconds) } },
    );
  }

  await Block.updateOne(
    { blockerId: user._id, blockedId: target._id },
    { $setOnInsert: { blockerId: user._id, blockedId: target._id } },
    { upsert: true },
  );
  await publishBlockState(userId, id);
  return NextResponse.json({ blockedByMe: true, blockedMe: false });
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  if (!mongoose.Types.ObjectId.isValid(id)) return NextResponse.json({ error: "User not found" }, { status: 404 });

  await Block.deleteOne({ blockerId: user._id, blockedId: id });
  await publishBlockState(user._id.toString(), id);
  return NextResponse.json(await getBlockState(user._id.toString(), id));
}
