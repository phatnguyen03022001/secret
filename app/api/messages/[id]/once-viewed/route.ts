import { NextRequest, NextResponse } from "next/server";
import { connectDB } from "@/lib/server";
import { getCurrentUser } from "@/lib/auth/session";
import { findConversationByExternalId } from "@/lib/chat/conversations";
import Message from "@/models/Message";

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

  const conversation = await findConversationByExternalId(message.conversationId?.toString() || message.roomId);
  if (!conversation) {
    return NextResponse.json({ error: "Conversation not found" }, { status: 404 });
  }

  const isMember = conversation.members.some((member: any) => member.userId.toString() === userId);
  const isSender = message.userId.toString() === userId;

  if (!user.isAdmin && !isMember) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  if (message.imageMode !== "once") {
    return NextResponse.json({ success: true, imageUrl: message.imageUrl });
  }

  if (user.isAdmin) {
    return NextResponse.json({ success: true, imageUrl: message.imageUrl, godView: true });
  }

  if (isSender) {
    return NextResponse.json({ error: "Sender cannot consume view-once media" }, { status: 403 });
  }

  const consumed = await Message.findOneAndUpdate(
    {
      _id: message._id,
      imageMode: "once",
      onceViewedBy: { $ne: user._id },
    },
    { $addToSet: { onceViewedBy: user._id } },
    { new: false },
  ).select("imageUrl");

  if (!consumed) {
    return NextResponse.json({ error: "Ảnh này đã được xem" }, { status: 409 });
  }

  return NextResponse.json({ success: true, imageUrl: consumed.imageUrl });
}
