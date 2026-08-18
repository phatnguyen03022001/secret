import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth/session";
import { adminGlobalChannel, userChannel } from "@/lib/realtime/channels";
import { consumeRateLimit } from "@/lib/security/rate-limit";
import { pusherServer } from "@/lib/server";
import Session from "@/models/Session";
import User from "@/models/User";
import mongoose from "mongoose";
import { z } from "zod";

const statusSchema = z.object({
  status: z.enum(["active", "suspended"]),
});

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const admin = await getCurrentUser();
  if (!admin) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!admin.isAdmin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { id } = await params;
  if (!mongoose.Types.ObjectId.isValid(id)) {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }

  const rateLimit = await consumeRateLimit({
    scope: "admin-user-status",
    identifier: admin._id.toString(),
    limit: 120,
    windowSeconds: 60 * 60,
  });
  if (!rateLimit.allowed) {
    return NextResponse.json(
      { error: "Too many moderation actions" },
      { status: 429, headers: { "Retry-After": String(rateLimit.retryAfterSeconds) } },
    );
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = statusSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Invalid status" }, { status: 400 });

  const target = await User.findOne({ _id: id, isAdmin: false });
  if (!target) return NextResponse.json({ error: "User not found" }, { status: 404 });

  target.status = parsed.data.status;
  await target.save();

  if (target.status === "suspended") {
    await Session.deleteMany({ userId: target._id });
  }

  const payload = {
    userId: target._id.toString(),
    status: target.status,
    updatedAt: new Date().toISOString(),
  };

  await Promise.allSettled([
    pusherServer.trigger(userChannel(target._id.toString()), "account-status", payload),
    pusherServer.trigger(adminGlobalChannel(), "user-status", payload),
  ]);

  return NextResponse.json(payload);
}
