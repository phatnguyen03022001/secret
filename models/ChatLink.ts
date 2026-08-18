import mongoose, { Schema, model, models } from "mongoose";

const ChatLinkSchema = new Schema(
  {
    ownerId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, unique: true, index: true },
    slug: { type: String, required: true, unique: true, lowercase: true, trim: true, index: true },
    enabled: { type: Boolean, default: true },
    allowGuests: { type: Boolean, default: true },
    lifecycle: { type: String, enum: ["persistent", "quick", "temporary"], default: "persistent" },
    guestSessionHours: { type: Number, default: 24, min: 1, max: 168 },
  },
  { timestamps: true },
);

const ChatLink = models.ChatLink || model("ChatLink", ChatLinkSchema);
export default ChatLink;
