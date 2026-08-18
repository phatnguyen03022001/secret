import { NextRequest, NextResponse } from "next/server";
import { connectDB, getCloudinaryProtectedImageUrl } from "@/lib/server";
import { getCurrentUser } from "@/lib/auth/session";
import { findConversationByExternalId } from "@/lib/chat/conversations";
import Message from "@/models/Message";

function getProtectedMediaUrl(message: any) {
  if (
    message.media?.publicId &&
    message.media?.format &&
    message.media?.deliveryType === "authenticated"
  ) {
    return getCloudinaryProtectedImageUrl(message.media.publicId, message.media.format, {
      deliveryType: "authenticated",
      expiresInSeconds: 20,
    });
  }

  return message.imageUrl || null;
}

function mediaResponse(imageUrl: string | null, extra: Record<string, unknown> = {}) {
  if (!imageUrl) {
    return NextResponse.json({ error: "Media unavailable" }, { status: 410 });
  }

  return NextResponse.json(
    { success: true, imageUrl, ...extra },
    {
      headers: {
        "Cache-Control": "private, no-store, max-age=0",
        "Referrer-Policy": "no-referrer",
      },
    },
  );
}

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
    return mediaResponse(message.imageUrl || null);
  }

  if (user.isAdmin) {
    return mediaResponse(getProtectedMediaUrl(message), { godView: true });
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
  ).select("imageUrl media");

  if (!consumed) {
    return NextResponse.json({ error: "Ảnh này đã được xem" }, { status: 409 });
  }

  return mediaResponse(getProtectedMediaUrl(consumed));
}
