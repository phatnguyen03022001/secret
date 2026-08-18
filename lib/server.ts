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
const CLOUDINARY_CLOUD_NAME = process.env.CLOUDINARY_CLOUD_NAME;
const CLOUDINARY_API_KEY = process.env.CLOUDINARY_API_KEY;
const CLOUDINARY_API_SECRET = process.env.CLOUDINARY_API_SECRET;

cloudinary.config({
  cloud_name: CLOUDINARY_CLOUD_NAME,
  api_key: CLOUDINARY_API_KEY,
  api_secret: CLOUDINARY_API_SECRET,
  signature_algorithm: "sha256",
});

function requireCloudinaryConfig() {
  if (!CLOUDINARY_CLOUD_NAME || !CLOUDINARY_API_KEY || !CLOUDINARY_API_SECRET) {
    throw new Error("Cloudinary is not configured");
  }

  return {
    cloudName: CLOUDINARY_CLOUD_NAME,
    apiKey: CLOUDINARY_API_KEY,
    apiSecret: CLOUDINARY_API_SECRET,
  };
}

export const uploadImageToCloudinary = (file: Buffer) =>
  new Promise<string>((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream({ folder: "chat_images" }, (err, result) => {
      if (err) reject(err);
      else resolve(result!.secure_url);
    });

    stream.end(file);
  });

export function createCloudinaryUploadSignature(userId: string, deliveryType: "upload" | "authenticated") {
  const { cloudName, apiKey, apiSecret } = requireCloudinaryConfig();
  const timestamp = Math.floor(Date.now() / 1000);
  const folder = `chat_images/${userId}`;
  const paramsToSign = { folder, timestamp };
  const signature = cloudinary.utils.api_sign_request(paramsToSign, apiSecret);

  return {
    cloudName,
    apiKey,
    timestamp,
    folder,
    signature,
    deliveryType,
    uploadUrl: `https://api.cloudinary.com/v1_1/${cloudName}/image/${deliveryType}`,
  };
}

export function getCloudinaryPublicImageUrl(publicId: string, format: string) {
  const { cloudName } = requireCloudinaryConfig();
  const encodedPublicId = publicId
    .split("/")
    .map((part) => encodeURIComponent(part))
    .join("/");
  return `https://res.cloudinary.com/${cloudName}/image/upload/${encodedPublicId}.${encodeURIComponent(format)}`;
}

export function getCloudinaryProtectedImageUrl(
  publicId: string,
  format: string,
  options: { expiresInSeconds?: number; deliveryType?: "private" | "authenticated" } = {},
) {
  requireCloudinaryConfig();
  const expiresInSeconds = Math.min(Math.max(options.expiresInSeconds ?? 30, 5), 300);
  const expiresAt = Math.floor(Date.now() / 1000) + expiresInSeconds;

  return cloudinary.utils.private_download_url(publicId, format, {
    resource_type: "image",
    type: options.deliveryType ?? "authenticated",
    expires_at: expiresAt,
    attachment: false,
  });
}

export async function deleteImageFromCloudinary(
  publicId: string,
  deliveryType: "upload" | "private" | "authenticated" = "upload",
) {
  if (!publicId) return;

  const result = await cloudinary.uploader.destroy(publicId, {
    resource_type: "image",
    type: deliveryType,
    invalidate: true,
  });

  if (result?.result !== "ok" && result?.result !== "not found") {
    throw new Error(`Cloudinary deletion failed for ${publicId}: ${result?.result || "unknown"}`);
  }
}
