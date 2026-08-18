import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth/session";
import { consumeRateLimit } from "@/lib/security/rate-limit";
import User from "@/models/User";
import { z } from "zod";

const profileSchema = z.object({
  displayName: z
    .string()
    .trim()
    .min(2, "Tên hiển thị cần ít nhất 2 ký tự")
    .max(32, "Tên hiển thị tối đa 32 ký tự")
    .refine((value) => !/[<>\r\n\t]/.test(value), "Tên hiển thị không hợp lệ")
    .optional(),
  bio: z.string().trim().max(120, "Bio tối đa 120 ký tự").optional(),
  showLastSeen: z.boolean().optional(),
  allowMessagesFrom: z.enum(["everyone", "link_only"]).optional(),
});

function serializeProfile(user: any) {
  return {
    _id: user._id,
    username: user.username,
    displayName: user.displayName || user.username,
    bio: user.bio || "",
    avatarPublicId: user.avatarPublicId || null,
    privacy: {
      showLastSeen: user.privacy?.showLastSeen !== false,
      allowMessagesFrom: user.privacy?.allowMessagesFrom || "everyone",
    },
  };
}

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (user.accountType === "guest") {
    return NextResponse.json({ error: "Guest profiles must be claimed first" }, { status: 403 });
  }

  const freshUser = await User.findById(user._id).select("username displayName bio avatarPublicId privacy").lean();
  if (!freshUser) return NextResponse.json({ error: "User not found" }, { status: 404 });
  return NextResponse.json(serializeProfile(freshUser));
}

export async function PATCH(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (user.accountType === "guest" || user.isAdmin) {
    return NextResponse.json({ error: "Profile settings are unavailable for this account" }, { status: 403 });
  }

  const rateLimit = await consumeRateLimit({
    scope: "profile-update",
    identifier: user._id.toString(),
    limit: 30,
    windowSeconds: 60 * 60,
  });
  if (!rateLimit.allowed) {
    return NextResponse.json(
      { error: "Bạn đang cập nhật profile quá thường xuyên." },
      { status: 429, headers: { "Retry-After": String(rateLimit.retryAfterSeconds) } },
    );
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = profileSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
  }

  const updates: Record<string, unknown> = {};
  if (parsed.data.displayName !== undefined) updates.displayName = parsed.data.displayName;
  if (parsed.data.bio !== undefined) updates.bio = parsed.data.bio;
  if (parsed.data.showLastSeen !== undefined) updates["privacy.showLastSeen"] = parsed.data.showLastSeen;
  if (parsed.data.allowMessagesFrom !== undefined) {
    updates["privacy.allowMessagesFrom"] = parsed.data.allowMessagesFrom;
  }

  if (Object.keys(updates).length === 0) {
    const current = await User.findById(user._id).select("username displayName bio avatarPublicId privacy").lean();
    return NextResponse.json(serializeProfile(current));
  }

  const updated = await User.findByIdAndUpdate(user._id, { $set: updates }, { new: true })
    .select("username displayName bio avatarPublicId privacy")
    .lean();
  if (!updated) return NextResponse.json({ error: "User not found" }, { status: 404 });

  return NextResponse.json(serializeProfile(updated));
}
