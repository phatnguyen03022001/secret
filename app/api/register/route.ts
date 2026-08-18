import { NextResponse } from "next/server";
import { connectDB } from "@/lib/server";
import { consumeRateLimit, getRequestIp } from "@/lib/security/rate-limit";
import User from "@/models/User";
import bcrypt from "bcryptjs";
import { z } from "zod";

const registerSchema = z
  .object({
    username: z
      .string()
      .trim()
      .min(3, "Username must be at least 3 characters")
      .max(24, "Username must be at most 24 characters")
      .regex(/^[a-zA-Z0-9_]+$/, "Username can only contain letters, numbers, and underscores"),
    password: z.string().min(8, "Password must be at least 8 characters").max(72, "Password is too long"),
    confirmPassword: z.string(),
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: "Passwords do not match",
    path: ["confirmPassword"],
  });

export async function POST(req: Request) {
  const rateLimit = await consumeRateLimit({
    scope: "register",
    identifier: getRequestIp(req),
    limit: 5,
    windowSeconds: 60 * 60,
  });

  if (!rateLimit.allowed) {
    return NextResponse.json(
      { error: "Quá nhiều tài khoản được tạo từ kết nối này. Hãy thử lại sau." },
      { status: 429, headers: { "Retry-After": String(rateLimit.retryAfterSeconds) } },
    );
  }

  await connectDB();

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = registerSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
  }

  const username = parsed.data.username.toLowerCase();
  const existingUser = await User.findOne({ username });
  if (existingUser) {
    return NextResponse.json({ error: "Username already exists" }, { status: 409 });
  }

  const hashedPassword = await bcrypt.hash(parsed.data.password, 12);
  const user = await User.create({
    username,
    displayName: username,
    password: hashedPassword,
    accountType: "registered",
    isAdmin: false,
    chatSchemaVersion: 2,
  });

  return NextResponse.json(
    {
      user: {
        _id: user._id,
        username: user.username,
        displayName: user.displayName,
        accountType: user.accountType,
        isAdmin: user.isAdmin,
      },
    },
    { status: 201 },
  );
}
