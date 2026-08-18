import "server-only";

import { getConversationMemberIds, getConversationMessageRoomIds } from "@/lib/chat/conversations";
import { getManagedCloudinaryPublicId } from "@/lib/media/cloudinary";
import { conversationChannel, userChannel } from "@/lib/realtime/channels";
import { connectDB, deleteImageFromCloudinary, pusherServer } from "@/lib/server";
import Conversation from "@/models/Conversation";
import Message from "@/models/Message";
import Session from "@/models/Session";
import User from "@/models/User";

export type ConversationPurgeReason = "expired" | "burned" | "admin";

type MediaAssetRef = {
  publicId: string;
  deliveryType: "upload" | "authenticated";
};

async function deleteCloudinaryAssets(assets: MediaAssetRef[]) {
  const batchSize = 8;

  for (let index = 0; index < assets.length; index += batchSize) {
    const batch = assets.slice(index, index + batchSize);
    await Promise.all(batch.map((asset) => deleteImageFromCloudinary(asset.publicId, asset.deliveryType)));
  }
}

async function cleanupOrphanGuestUsers(memberIds: string[]) {
  for (const memberId of memberIds) {
    const user = await User.findById(memberId).select("accountType").lean();
    if (!user || user.accountType !== "guest") continue;

    const remainingConversation = await Conversation.exists({ "members.userId": user._id });
    if (remainingConversation) continue;

    await Promise.all([Session.deleteMany({ userId: user._id }), User.deleteOne({ _id: user._id })]);
  }
}

export async function purgeConversationById(conversationId: string, reason: ConversationPurgeReason) {
  await connectDB();

  const conversation = await Conversation.findById(conversationId);
  if (!conversation) {
    return { purged: false, alreadyGone: true, conversationId };
  }

  const memberIds = getConversationMemberIds(conversation);
  const roomIds = getConversationMessageRoomIds(conversation);
  const messages = await Message.find({
    $or: [{ conversationId: conversation._id }, { roomId: { $in: roomIds } }],
  })
    .select("_id imageUrl media.publicId media.deliveryType")
    .lean();

  const assetMap = new Map<string, MediaAssetRef>();
  for (const message of messages as any[]) {
    if (message.media?.publicId) {
      const deliveryType = message.media.deliveryType === "authenticated" ? "authenticated" : "upload";
      assetMap.set(`${deliveryType}:${message.media.publicId}`, {
        publicId: message.media.publicId,
        deliveryType,
      });
      continue;
    }

    if (message.imageUrl) {
      const legacyPublicId = getManagedCloudinaryPublicId(message.imageUrl);
      if (legacyPublicId) {
        assetMap.set(`upload:${legacyPublicId}`, { publicId: legacyPublicId, deliveryType: "upload" });
      }
    }
  }

  const assets = [...assetMap.values()];

  // External media is deleted first. A retry is safe because Cloudinary "not found" is accepted.
  await deleteCloudinaryAssets(assets);

  await Message.deleteMany({
    $or: [{ conversationId: conversation._id }, { roomId: { $in: roomIds } }],
  });
  await Conversation.deleteOne({ _id: conversation._id });

  const payload = { conversationId, roomId: conversationId, reason };
  await Promise.allSettled([
    pusherServer.trigger(conversationChannel(conversationId), "conversation-removed", payload),
    ...memberIds.map((memberId) => pusherServer.trigger(userChannel(memberId), "conversation-removed", payload)),
  ]);

  await cleanupOrphanGuestUsers(memberIds);

  return {
    purged: true,
    alreadyGone: false,
    conversationId,
    deletedMessages: messages.length,
    deletedMedia: assets.length,
  };
}

export async function purgeExpiredConversations(options: { limit?: number; now?: Date } = {}) {
  await connectDB();

  const limit = Math.min(Math.max(options.limit ?? 25, 1), 100);
  const now = options.now ?? new Date();
  const conversations = await Conversation.find({ expiresAt: { $ne: null, $lte: now } })
    .sort({ expiresAt: 1 })
    .limit(limit)
    .select("_id")
    .lean();

  const results = [];
  for (const conversation of conversations) {
    try {
      results.push(await purgeConversationById(conversation._id.toString(), "expired"));
    } catch (error) {
      results.push({
        purged: false,
        conversationId: conversation._id.toString(),
        error: error instanceof Error ? error.message : "Unknown retention error",
      });
    }
  }

  return {
    scanned: conversations.length,
    purged: results.filter((result) => result.purged).length,
    results,
  };
}
