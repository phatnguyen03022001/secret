import { NextRequest, NextResponse } from "next/server";
import { connectDB, pusherServer } from "@/lib/server";
import { getCurrentUser } from "@/lib/auth/session";
import Message from "@/models/Message";
import { isUserInRoom } from "@/lib/utils";

export async function POST(req: NextRequest) {
  await connectDB();

  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const roomId = typeof (body as { roomId?: unknown })?.roomId === "string" ? (body as { roomId: string }).roomId : null;
  if (!roomId) {
    return NextResponse.json({ error: "Thiếu hoặc sai roomId" }, { status: 400 });
  }

  const userId = user._id.toString();
  if (!user.isAdmin && !isUserInRoom(roomId, userId)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const result = await Message.updateMany(
    {
      roomId,
      seenBy: { $ne: user._id },
      userId: { $ne: user._id },
    },
    { $addToSet: { seenBy: user._id } },
  );

  if (result.modifiedCount > 0 && !user.isAdmin) {
    await Promise.all([
      pusherServer.trigger(`chat-${roomId}`, "messages-seen", { roomId, userId, isAdmin: false }),
      pusherServer.trigger(`user-${userId}`, "unread-updated", {
        roomId,
        unreadCount: 0,
      }),
    ]);
  }

  return NextResponse.json({ modified: result.modifiedCount });
}
