import "server-only";

import mongoose from "mongoose";
import { connectDB } from "@/lib/server";
import Conversation from "@/models/Conversation";
import Message from "@/models/Message";
import User from "@/models/User";
import { getParticipantsFromRoomId, getPrivateRoomId } from "@/lib/utils";

export function getDirectKey(userAId: string, userBId: string) {
  return [userAId, userBId].sort().join(":");
}

export function getMessagePreview(message: {
  deleted?: boolean;
  text?: string | null;
  imageUrl?: string | null;
  imageMode?: string | null;
}) {
  if (message.deleted) return "[Tin nhắn đã bị gỡ]";
  if (message.text?.trim()) return message.text.trim().slice(0, 180);
  if (message.imageUrl) return message.imageMode === "once" ? "Ảnh xem một lần" : "Đã gửi một ảnh";
  return "";
}

function getLastMessageSnapshot(message: any) {
  if (!message) return null;
  return {
    messageId: message._id,
    senderId: message.userId,
    type: message.imageUrl ? "image" : "text",
    preview: getMessagePreview(message),
    createdAt: message.createdAt,
  };
}

export async function ensureDirectConversation(userA: any, userB: any) {
  await connectDB();

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
