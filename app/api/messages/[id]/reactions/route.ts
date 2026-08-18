import { NextRequest, NextResponse } from "next/server";
import mongoose from "mongoose";
import { z } from "zod";
import { getCurrentUser } from "@/lib/auth/session";
import { resolveConversationForUser } from "@/lib/chat/conversations";
import { conversationChannel } from "@/lib/realtime/channels";
import { consumeRateLimit } from "@/lib/security/rate-limit";
import { connectDB, pusherServer } from "@/lib/server";
import Message from "@/models/Message";

const reactionSchema = z.object({
  emoji: z.enum(["👍", "❤️", "😂", "😮", "😢"]),
});

function serializeReactions(reactions: any[] = []) {
  return reactions.map((reaction) => ({
    userId: reaction.userId.toString(),
    emoji: reaction.emoji,
    createdAt: reaction.createdAt,
  }));
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  await connectDB();

  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (user.isAdmin) {
    return NextResponse.json({ error: "God view is read-only for reactions" }, { status: 403 });
  }

  const { id } = await params;
  if (!mongoose.Types.ObjectId.isValid(id)) {
    return NextResponse.json({ error: "Invalid message id" }, { status: 400 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = reactionSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Reaction không hợp lệ" }, { status: 400 });
  }

  const rateLimit = await consumeRateLimit({
    scope: "message-reaction",
    identifier: user._id.toString(),
    limit: 60,
    windowSeconds: 60,
  });
  if (!rateLimit.allowed) {
    return NextResponse.json(
      { error: "Bạn đang reaction quá nhanh." },
      { status: 429, headers: { "Retry-After": String(rateLimit.retryAfterSeconds) } },
    );
  }

  const message = await Message.findById(id).select("conversationId roomId deleted").lean();
  if (!message || message.deleted) {
    return NextResponse.json({ error: "Message not found" }, { status: 404 });
  }

  const conversation = await resolveConversationForUser(message.conversationId?.toString() || message.roomId, user, {
    allowAdminGodView: false,
  });
  if (!conversation) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const userId = user._id;
  const now = new Date();
  const emoji = parsed.data.emoji;
  const reactionsExpression = { $ifNull: ["$reactions", []] };

  const updated = await Message.findOneAndUpdate(
    { _id: message._id, deleted: { $ne: true } },
    [
      {
        $set: {
          reactions: {
            $let: {
              vars: {
                existing: {
                  $arrayElemAt: [
                    {
                      $filter: {
                        input: reactionsExpression,
                        as: "reaction",
                        cond: { $eq: ["$$reaction.userId", userId] },
                      },
                    },
                    0,
                  ],
                },
                withoutUser: {
                  $filter: {
                    input: reactionsExpression,
                    as: "reaction",
                    cond: { $ne: ["$$reaction.userId", userId] },
                  },
                },
              },
              in: {
                $cond: [
                  { $eq: ["$$existing.emoji", emoji] },
                  "$$withoutUser",
                  {
                    $concatArrays: [
                      "$$withoutUser",
                      [
                        {
                          userId,
                          emoji,
                          createdAt: now,
                        },
                      ],
                    ],
                  },
                ],
              },
            },
          },
        },
      },
    ],
    { new: true },
  )
    .select("reactions")
    .lean();

  if (!updated) {
    return NextResponse.json({ error: "Message not found" }, { status: 404 });
  }

  const reactions = serializeReactions(updated.reactions as any[]);
  const conversationId = conversation._id.toString();

  await pusherServer.trigger(conversationChannel(conversationId), "message-reactions", {
    messageId: id,
    reactions,
  });

  return NextResponse.json({ messageId: id, reactions });
}
