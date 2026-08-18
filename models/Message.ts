import mongoose, { Schema, model, models } from "mongoose";

const ReactionSchema = new Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    emoji: { type: String, required: true },
    createdAt: { type: Date, default: Date.now },
  },
  { _id: false },
);

const EditHistorySchema = new Schema(
  {
    text: { type: String, default: "" },
    editedAt: { type: Date, required: true },
  },
  { _id: false },
);

const MediaSchema = new Schema(
  {
    publicId: { type: String, required: true },
    deliveryType: { type: String, enum: ["upload", "authenticated"], required: true },
    format: { type: String, required: true },
    width: { type: Number, required: true, min: 1 },
    height: { type: Number, required: true, min: 1 },
    bytes: { type: Number, required: true, min: 1 },
  },
  { _id: false },
);

const MessageSchema = new Schema(
  {
    roomId: { type: String, required: true, index: true },
    conversationId: { type: mongoose.Schema.Types.ObjectId, ref: "Conversation", default: null, index: true },
    clientMessageId: { type: String, default: undefined },
    type: { type: String, enum: ["text", "image"], default: "text" },
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    username: { type: String, required: true },
    text: { type: String, default: "" },
    media: { type: MediaSchema, default: null },
    imageUrl: { type: String, default: null },
    imageMode: { type: String, enum: ["normal", "once"], default: "normal" },
    onceViewedBy: [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }],
    replyTo: { type: mongoose.Schema.Types.ObjectId, ref: "Message", default: null },
    reactions: { type: [ReactionSchema], default: [] },
    editedAt: { type: Date, default: null },
    editHistory: { type: [EditHistorySchema], default: [] },
    deleted: { type: Boolean, default: false },
    deletedAt: { type: Date, default: null },
    seenBy: [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }],
  },
  { timestamps: true },
);

MessageSchema.index({ roomId: 1, createdAt: -1 });
MessageSchema.index({ roomId: 1, seenBy: 1 });
MessageSchema.index({ conversationId: 1, createdAt: -1 });
MessageSchema.index({ userId: 1, createdAt: -1 });
MessageSchema.index(
  { conversationId: 1, userId: 1, clientMessageId: 1 },
  { unique: true, partialFilterExpression: { clientMessageId: { $exists: true } } },
);
MessageSchema.index(
  { "media.publicId": 1 },
  { unique: true, partialFilterExpression: { "media.publicId": { $type: "string" } } },
);

const Message = models.Message || model("Message", MessageSchema);
export default Message;
