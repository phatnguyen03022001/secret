import mongoose, { Schema, model, models } from "mongoose";

const BlockSchema = new Schema(
  {
    blockerId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
    blockedId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
  },
  { timestamps: true },
);

BlockSchema.index({ blockerId: 1, blockedId: 1 }, { unique: true });
BlockSchema.index({ blockedId: 1, blockerId: 1 });

const Block = models.Block || model("Block", BlockSchema);
export default Block;
