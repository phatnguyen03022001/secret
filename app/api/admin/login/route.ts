import { NextResponse } from "next/server";
import { connectDB } from "@/lib/server";
import { createSession } from "@/lib/auth/session";
import User from "@/models/User";
import bcrypt from "bcryptjs";
import { z } from "zod";

const adminLoginSchema = z.object({
  username: z.string().trim().min(1).max(50),
  password: z.string().min(1).max(200),
});

export async function POST(req: Request) {
  await connectDB();

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = adminLoginSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Thông tin không chính xác" }, { status: 400 });
  }

  const username = parsed.data.username.toLowerCase();
  const user = await User.findOne({
    username,
    isAdmin: true,
    accountType: { $ne: "guest" },
  });

  if (!user?.password || !(await bcrypt.compare(parsed.data.password, user.password))) {
    return NextResponse.json({ error: "Thông tin không chính xác" }, { status: 401 });
  }

  await createSession(user._id.toString(), {
    maxAgeSeconds: 60 * 60 * 4,
    userAgent: req.headers.get("user-agent"),
  });

  return NextResponse.json({
    success: true,
    user: {
      _id: user._id,
      username: user.username,
      displayName: user.displayName || user.username,
      accountType: user.accountType || "registered",
      isAdmin: user.isAdmin,
    },
  });
}
