import mongoose, { Schema, model, models } from "mongoose";

const ConversationMemberSchema = new Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    unreadCount: { type: Number, default: 0, min: 0 },
    lastReadMessageId: { type: mongoose.Schema.Types.ObjectId, ref: "Message", default: null },
    lastDeliveredMessageId: { type: mongoose.Schema.Types.ObjectId, ref: "Message", default: null },
  },
  { _id: false },
);

const LastMessageSchema = new Schema(
  {
    messageId: { type: mongoose.Schema.Types.ObjectId, ref: "Message", required: true },
    senderId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    type: { type: String, enum: ["text", "image"], required: true },
    preview: { type: String, default: "" },
    createdAt: { type: Date, required: true },
  },
  { _id: false },
);

const ConversationSchema = new Schema(
  {
    type: { type: String, enum: ["direct"], default: "direct", required: true },
    directKey: { type: String, required: true, unique: true, index: true },
    members: { type: [ConversationMemberSchema], required: true },
    legacyRoomId: { type: String, default: null, index: true },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    lifecycle: { type: String, enum: ["persistent", "quick", "temporary"], default: "persistent" },
    expiresAt: { type: Date, default: null },
    burnRequestedBy: [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }],
    lastMessage: { type: LastMessageSchema, default: null },
  },
  { timestamps: true },
);

ConversationSchema.index({ "members.userId": 1, "lastMessage.createdAt": -1 });

const Conversation = models.Conversation || model("Conversation", ConversationSchema);
export default Conversation;
