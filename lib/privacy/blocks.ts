import "server-only";

import { connectDB } from "@/lib/server";
import Block from "@/models/Block";

export async function isBlockedBetween(userAId: string, userBId: string) {
  await connectDB();
  return Boolean(
    await Block.exists({
      $or: [
        { blockerId: userAId, blockedId: userBId },
        { blockerId: userBId, blockedId: userAId },
      ],
    }),
  );
}

export async function getBlockState(viewerId: string, targetId: string) {
  await connectDB();
  const blocks = await Block.find({
    $or: [
      { blockerId: viewerId, blockedId: targetId },
      { blockerId: targetId, blockedId: viewerId },
    ],
  })
    .select("blockerId blockedId")
    .lean();

  return {
    blockedByMe: blocks.some((block: any) => block.blockerId.toString() === viewerId),
    blockedMe: blocks.some((block: any) => block.blockerId.toString() === targetId),
  };
}

export async function getBlockedUserIds(userId: string) {
  await connectDB();
  const blocks = await Block.find({
    $or: [{ blockerId: userId }, { blockedId: userId }],
  })
    .select("blockerId blockedId")
    .lean();

  return [
    ...new Set(
      blocks.map((block: any) =>
        block.blockerId.toString() === userId ? block.blockedId.toString() : block.blockerId.toString(),
      ),
    ),
  ];
}
