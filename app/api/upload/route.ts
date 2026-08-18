import { NextRequest, NextResponse } from "next/server";
import { uploadImageToCloudinary } from "@/lib/server";
import { getCurrentUser } from "@/lib/auth/session";
import { consumeRateLimit } from "@/lib/security/rate-limit";

const MAX_UPLOAD_BYTES = 8 * 1024 * 1024;
const ALLOWED_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);

export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const rateLimit = await consumeRateLimit({
    scope: "upload",
    identifier: user._id.toString(),
    limit: 12,
    windowSeconds: 60,
  });

  if (!rateLimit.allowed) {
    return NextResponse.json(
      { error: "Bạn đang tải ảnh lên quá nhanh." },
      { status: 429, headers: { "Retry-After": String(rateLimit.retryAfterSeconds) } },
    );
  }

  const formData = await req.formData();
  const file = formData.get("file");

  if (!(file instanceof File)) {
    return NextResponse.json({ error: "No file" }, { status: 400 });
  }

  if (!ALLOWED_TYPES.has(file.type)) {
    return NextResponse.json({ error: "Unsupported image type" }, { status: 415 });
  }

  if (file.size <= 0 || file.size > MAX_UPLOAD_BYTES) {
    return NextResponse.json({ error: "Image must be between 1 byte and 8 MB" }, { status: 413 });
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  const imageUrl = await uploadImageToCloudinary(buffer);

  return NextResponse.json({ url: imageUrl });
}
