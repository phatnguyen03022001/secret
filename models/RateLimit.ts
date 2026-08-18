import { Schema, model, models } from "mongoose";

const RateLimitSchema = new Schema(
  {
    key: { type: String, required: true, unique: true, index: true },
    count: { type: Number, required: true, default: 0 },
    expiresAt: { type: Date, required: true },
  },
  { timestamps: true },
);

RateLimitSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

const RateLimit = models.RateLimit || model("RateLimit", RateLimitSchema);
export default RateLimit;
