import mongoose, { Schema, model, models } from "mongoose";

const MediaUploadSchema = new Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
    publicId: { type: String, required: true, unique: true, index: true },
    deliveryType: { type: String, enum: ["upload", "authenticated"], required: true },
    cleanupAfter: { type: Date, required: true, index: true },
  },
  { timestamps: true },
);

const MediaUpload = models.MediaUpload || model("MediaUpload", MediaUploadSchema);
export default MediaUpload;
