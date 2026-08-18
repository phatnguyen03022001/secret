import "server-only";
import mongoose from "mongoose";
import Pusher from "pusher";
import { v2 as cloudinary } from "cloudinary";

/* ---------- MongoDB ---------- */
const MONGODB_URI = process.env.MONGODB_URI!;

const cached = (global as any).mongoose || { conn: null, promise: null };

(global as any).mongoose = cached;

export const connectDB = async () => {
  if (cached.conn) return cached.conn;
  if (!cached.promise) {
    cached.promise = mongoose.connect(MONGODB_URI).then((m) => m);
  }
  try {
    cached.conn = await cached.promise;
  } catch (e) {
    cached.promise = null;
    throw e;
  }
  return cached.conn;
};

/* ---------- Pusher ---------- */
export const pusherServer = new Pusher({
  appId: process.env.PUSHER_APP_ID!,
  key: process.env.PUSHER_KEY!,
  secret: process.env.PUSHER_SECRET!,
  cluster: process.env.PUSHER_CLUSTER!,
  useTLS: true,
});

/* ---------- Cloudinary ---------- */
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

export const uploadImageToCloudinary = (file: Buffer) =>
  new Promise<string>((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream({ folder: "chat_images" }, (err, result) => {
      if (err) reject(err);
      else resolve(result!.secure_url);
    });

    stream.end(file);
  });

export async function deleteImageFromCloudinary(publicId: string) {
  if (!publicId) return;

  const result = await cloudinary.uploader.destroy(publicId, {
    resource_type: "image",
    invalidate: true,
  });

  if (result?.result !== "ok" && result?.result !== "not found") {
    throw new Error(`Cloudinary deletion failed for ${publicId}: ${result?.result || "unknown"}`);
  }
}
