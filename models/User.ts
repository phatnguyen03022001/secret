import mongoose, { Schema, model, models } from "mongoose";

const PrivacySchema = new Schema(
  {
    showLastSeen: { type: Boolean, default: true },
    allowMessagesFrom: {
      type: String,
      enum: ["everyone", "link_only"],
      default: "everyone",
    },
  },
  { _id: false },
);

const UserSchema = new Schema(
  {
    username: { type: String, required: true, unique: true },
    displayName: { type: String, default: null },
    bio: { type: String, default: "" },
    avatarPublicId: { type: String, default: null },
    password: { type: String, default: null },
    accountType: { type: String, enum: ["registered", "guest"], default: "registered", index: true },
    status: { type: String, enum: ["active", "suspended"], default: "active", index: true },
    privacy: { type: PrivacySchema, default: () => ({}) },
    isAdmin: { type: Boolean, default: false },
    lastActive: { type: Date, default: Date.now },
    chatSchemaVersion: { type: Number, default: 0 },
  },
  { timestamps: true },
);

const User = models.User || model("User", UserSchema);
export default User;
