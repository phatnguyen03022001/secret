import { NextRequest, NextResponse } from "next/server";
import { connectDB } from "@/lib/server";
import { getCurrentUser } from "@/lib/auth/session";
import Message from "@/models/Message";
import User from "@/models/User";
import { getParticipantsFromRoomId } from "@/lib/utils";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  await connectDB();

  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const userId = user._id.toString();
  const { id } = await params;
  const message = await Message.findById(id);

  if (!message) {
    return NextResponse.json({ error: "Message not found" }, { status: 404 });
  }

  const roomParticipants = getParticipantsFromRoomId(message.roomId);
  const isParticipant = roomParticipants.includes(userId);
  const isSender = message.userId.toString() === userId;
  const isAdmin = user.isAdmin;

  if (!isSender && !isAdmin && !isParticipant) {
    return NextResponse.json({ error: "Forbidden: You are not in this conversation" }, { status: 403 });
  }

  if (isAdmin) {
    const participantsInfo = await User.find({ _id: { $in: roomParticipants } })
      .select("isAdmin")
      .lean();
    const hasNonAdmin = participantsInfo.some((participant) => !participant.isAdmin);
    if (hasNonAdmin) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
  }

  if (message.imageMode !== "once") {
    return NextResponse.json({ success: true, imageUrl: message.imageUrl });
  }

  if (isSender) {
    return NextResponse.json({ error: "Sender cannot mark once-viewed" }, { status: 403 });
  }

  if (isAdmin) {
    return NextResponse.json({ success: true, imageUrl: message.imageUrl });
  }

  if (message.onceViewedBy?.some((viewerId: { toString(): string }) => viewerId.toString() === userId)) {
    return NextResponse.json({ error: "Bạn đã xem ảnh này rồi" }, { status: 403 });
  }

  await Message.updateOne({ _id: id }, { $addToSet: { onceViewedBy: user._id } });

  return NextResponse.json({ success: true, imageUrl: message.imageUrl });
}
