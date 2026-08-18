import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth/session";
import { consumeRateLimit } from "@/lib/security/rate-limit";
import { connectDB } from "@/lib/server";
import User from "@/models/User";
import bcrypt from "bcryptjs";
import { z } from "zod";

const claimSchema = z
  .object({
    username: z
      .string()
      .trim()
      .min(3, "Username cần ít nhất 3 ký tự")
      .max(24, "Username tối đa 24 ký tự")
      .regex(/^[a-zA-Z0-9_]+$/, "Username chỉ gồm chữ, số và dấu gạch dưới"),
    password: z.string().min(8, "Mật khẩu cần ít nhất 8 ký tự").max(72, "Mật khẩu quá dài"),
    confirmPassword: z.string(),
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: "Mật khẩu xác nhận chưa khớp",
    path: ["confirmPassword"],
  });

export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (user.accountType !== "guest") {
    return NextResponse.json({ error: "Tài khoản này đã được lưu" }, { status: 409 });
  }

  const rateLimit = await consumeRateLimit({
    scope: "guest-claim",
    identifier: user._id.toString(),
    limit: 5,
    windowSeconds: 60 * 60,
  });
  if (!rateLimit.allowed) {
    return NextResponse.json(
      { error: "Bạn đã thử lưu tài khoản quá nhiều lần. Hãy thử lại sau." },
      { status: 429, headers: { "Retry-After": String(rateLimit.retryAfterSeconds) } },
    );
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = claimSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
  }

  await connectDB();
  const username = parsed.data.username.toLowerCase();
  const existing = await User.findOne({ username, _id: { $ne: user._id } }).select("_id").lean();
  if (existing) {
    return NextResponse.json({ error: "Username này đã được sử dụng" }, { status: 409 });
  }

  const password = await bcrypt.hash(parsed.data.password, 12);
  const updated = await User.findOneAndUpdate(
    { _id: user._id, accountType: "guest" },
    {
      $set: {
        username,
        password,
        accountType: "registered",
        chatSchemaVersion: 2,
      },
    },
    { new: true },
  );

  if (!updated) {
    return NextResponse.json({ error: "Guest session is no longer claimable" }, { status: 409 });
  }

  return NextResponse.json({
    user: {
      _id: updated._id,
      username: updated.username,
      displayName: updated.displayName || updated.username,
      accountType: updated.accountType,
      isAdmin: updated.isAdmin,
    },
  });
}
