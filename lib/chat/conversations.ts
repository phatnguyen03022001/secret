import "server-only";

import mongoose from "mongoose";
import { connectDB } from "@/lib/server";
import Conversation from "@/models/Conversation";
import Message from "@/models/Message";
import User from "@/models/User";
import { getParticipantsFromRoomId, getPrivateRoomId } from "@/lib/utils";

export type ConversationLifecycle = "persistent" | "quick" | "temporary";

let retentionIndexPromise: Promise<void> | null = null;

export function getDirectKey(userAId: string, userBId: string) {
  return [userAId, userBId].sort().join(":");
}

export function getLifecycleExpiry(lifecycle: ConversationLifecycle, now = new Date()) {
  if (lifecycle === "persistent") return null;
  const expiresAt = new Date(now);
  expiresAt.setHours(expiresAt.getHours() + (lifecycle === "quick" ? 24 : 24 * 7));
  return expiresAt;
}

export async function ensureConversationRetentionIndex() {
  await connectDB();
  if (retentionIndexPromise) return retentionIndexPromise;

  retentionIndexPromise = (async () => {
    const indexes = await Conversation.collection.indexes();
    const unsafeTtlIndex = indexes.find(
      (index: any) => index.name === "expiresAt_1" && typeof index.expireAfterSeconds === "number",
    );

    if (unsafeTtlIndex) {
      await Conversation.collection.dropIndex("expiresAt_1");
    }

    const refreshedIndexes = await Conversation.collection.indexes();
    const hasLookupIndex = refreshedIndexes.some((index: any) => index.name === "expiresAt_lookup");
    if (!hasLookupIndex) {
      await Conversation.collection.createIndex({ expiresAt: 1 }, { name: "expiresAt_lookup" });
    }
  })().catch((error) => {
    retentionIndexPromise = null;
    throw error;
  });

  return retentionIndexPromise;
}

export function getMessagePreview(message: {
  deleted?: boolean;
  text?: string | null;
  media?: { publicId?: string | null } | null;
  imageUrl?: string | null;
  imageMode?: string | null;
}) {
  if (message.deleted) return "[Tin nhắn đã bị gỡ]";
  if (message.text?.trim()) return message.text.trim().slice(0, 180);
  if (message.imageUrl || message.media?.publicId) {
    return message.imageMode === "once" ? "Ảnh xem một lần" : "Đã gửi một ảnh";
  }
  return "";
}

function getLastMessageSnapshot(message: any) {
  if (!message) return null;
  const hasImage = Boolean(message.imageUrl || message.media?.publicId);
  return {
    messageId: message._id,
    senderId: message.userId,
    type: hasImage ? "image" : "text",
    preview: getMessagePreview(message),
    createdAt: message.createdAt,
  };
}

export async function ensureDirectConversation(
  userA: any,
  userB: any,
  options: { lifecycle?: ConversationLifecycle; expiresAt?: Date | null } = {},
) {
  await connectDB();
  await ensureConversationRetentionIndex();

  const userAId = userA._id.toString();
  const userBId = userB._id.toString();
  const directKey = getDirectKey(userAId, userBId);

  const existing = await Conversation.findOne({ directKey });
  if (existing) return existing;

  const legacyRoomId = getPrivateRoomId(userAId, userBId);
  const latestLegacyMessage = await Message.findOne({ roomId: legacyRoomId }).sort({ createdAt: -1 }).lean();

  const [userAUnread, userBUnread] = await Promise.all([
    Message.countDocuments({ roomId: legacyRoomId, userId: { $ne: userA._id }, seenBy: { $ne: userA._id } }),
    Message.countDocuments({ roomId: legacyRoomId, userId: { $ne: userB._id }, seenBy: { $ne: userB._id } }),
  ]);

  const lifecycle = options.lifecycle ?? "persistent";
  const expiresAt = options.expiresAt === undefined ? getLifecycleExpiry(lifecycle) : options.expiresAt;

  return Conversation.findOneAndUpdate(
    { directKey },
    {
      $setOnInsert: {
        type: "direct",
        directKey,
        legacyRoomId,
        createdBy: userA._id,
        members: [
          { userId: userA._id, unreadCount: userAUnread },
          { userId: userB._id, unreadCount: userBUnread },
        ],
        lifecycle,
        expiresAt,
        burnRequestedBy: [],
        lastMessage: getLastMessageSnapshot(latestLegacyMessage),
      },
    },
    { upsert: true, new: true, setDefaultsOnInsert: true },
  );
}

export async function migrateLegacyConversationsForUser(user: any) {
  await connectDB();

  if ((user.chatSchemaVersion ?? 0) >= 2) return;

  const userId = user._id.toString();
  const escapedUserId = userId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const roomIdPattern = `(^|-)${escapedUserId}(-|$)`;
  const legacyRoomIds = await Message.distinct("roomId", { roomId: { $regex: roomIdPattern } });

  for (const legacyRoomId of legacyRoomIds) {
    const participantIds = getParticipantsFromRoomId(legacyRoomId);
    if (participantIds.length !== 2 || !participantIds.includes(userId)) continue;

    const participants = await User.find({ _id: { $in: participantIds } });
    if (participants.length !== 2) continue;

    await ensureDirectConversation(participants[0], participants[1]);
  }

  await User.updateOne({ _id: user._id }, { $set: { chatSchemaVersion: 2 } });
  user.chatSchemaVersion = 2;
}

export async function findConversationByExternalId(externalId: string) {
  await connectDB();

  if (mongoose.Types.ObjectId.isValid(externalId)) {
    const byId = await Conversation.findById(externalId);
    if (byId) return byId;
  }

  const byLegacyRoom = await Conversation.findOne({ legacyRoomId: externalId });
  if (byLegacyRoom) return byLegacyRoom;

  const participantIds = getParticipantsFromRoomId(externalId);
  if (participantIds.length !== 2) return null;

  const participants = await User.find({ _id: { $in: participantIds } });
  if (participants.length !== 2) return null;

  return ensureDirectConversation(participants[0], participants[1]);
}

export async function resolveConversationForUser(
  externalId: string,
  user: any,
  options: { allowAdminGodView?: boolean } = {},
) {
  const conversation = await findConversationByExternalId(externalId);
  if (!conversation) return null;

  if (conversation.expiresAt && conversation.expiresAt.getTime() <= Date.now()) {
    return null;
  }

  if (user.isAdmin && options.allowAdminGodView !== false) return conversation;

  const userId = user._id.toString();
  const isMember = conversation.members.some((member: any) => member.userId.toString() === userId);
  return isMember ? conversation : null;
}

export function getConversationMessageRoomIds(conversation: any) {
  return [...new Set([conversation._id.toString(), conversation.legacyRoomId].filter(Boolean))];
}

export function getConversationMemberIds(conversation: any) {
  return conversation.members.map((member: any) => member.userId.toString());
}

export function getConversationLastMessageSnapshot(message: any) {
  return getLastMessageSnapshot(message);
}
