import mongoose, { Schema, model, models } from "mongoose";

const SessionSchema = new Schema(
  {
    tokenHash: { type: String, required: true, unique: true },
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
    expiresAt: { type: Date, required: true },
    userAgent: { type: String, default: null },
  },
  { timestamps: true },
);

// MongoDB automatically removes expired sessions in the background.
SessionSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

const Session = models.Session || model("Session", SessionSchema);
export default Session;
