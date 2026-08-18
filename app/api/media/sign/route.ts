import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth/session";
import { consumeRateLimit } from "@/lib/security/rate-limit";
import { createCloudinaryUploadSignature } from "@/lib/server";
import MediaUpload from "@/models/MediaUpload";
import { z } from "zod";

const signSchema = z.object({
  mode: z.enum(["normal", "once"]),
});

export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (user.isAdmin) return NextResponse.json({ error: "Admin cannot upload chat media" }, { status: 403 });

  const rateLimit = await consumeRateLimit({
    scope: "media-sign",
    identifier: user._id.toString(),
    limit: 20,
    windowSeconds: 60,
  });
  if (!rateLimit.allowed) {
    return NextResponse.json(
      { error: "Bạn đang tải ảnh lên quá nhanh." },
      { status: 429, headers: { "Retry-After": String(rateLimit.retryAfterSeconds) } },
    );
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = signSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Invalid upload mode" }, { status: 400 });

  const deliveryType = parsed.data.mode === "once" ? "authenticated" : "upload";
  const signed = createCloudinaryUploadSignature(user._id.toString(), deliveryType);

  await MediaUpload.create({
    userId: user._id,
    publicId: signed.publicId,
    deliveryType,
    cleanupAfter: new Date(Date.now() + 60 * 60 * 1000),
  });

  return NextResponse.json({
    ...signed,
    maxBytes: 8 * 1024 * 1024,
    allowedFormats: ["jpg", "jpeg", "png", "webp", "gif"],
  });
}
