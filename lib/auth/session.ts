import "server-only";

import { createHash, randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import { connectDB } from "@/lib/server";
import Session from "@/models/Session";
import User from "@/models/User";

const SESSION_COOKIE = "auth_session";
const DEFAULT_MAX_AGE_SECONDS = 60 * 60 * 24 * 7;

const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");

export async function createSession(
  userId: string,
  options: { maxAgeSeconds?: number; userAgent?: string | null } = {},
) {
  await connectDB();

  const maxAgeSeconds = options.maxAgeSeconds ?? DEFAULT_MAX_AGE_SECONDS;
  const token = randomBytes(32).toString("base64url");
  const tokenHash = hashToken(token);
  const expiresAt = new Date(Date.now() + maxAgeSeconds * 1000);

  await Session.create({
    tokenHash,
    userId,
    expiresAt,
    userAgent: options.userAgent ?? null,
  });

  const cookieStore = await cookies();
  cookieStore.set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: maxAgeSeconds,
  });

  return { expiresAt };
}

export async function getCurrentSession() {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE)?.value;
  if (!token) return null;

  await connectDB();

  const session = await Session.findOne({
    tokenHash: hashToken(token),
    expiresAt: { $gt: new Date() },
  }).lean();

  if (!session) return null;

  const user = await User.findById(session.userId);
  if (!user) {
    await Session.deleteOne({ _id: session._id });
    return null;
  }

  if (!user.isAdmin && user.status === "suspended") {
    await Session.deleteMany({ userId: user._id });
    cookieStore.delete(SESSION_COOKIE);
    return null;
  }

  return { session, user };
}

export async function getCurrentUser() {
  const current = await getCurrentSession();
  return current?.user ?? null;
}

export async function destroyCurrentSession() {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE)?.value;

  if (token) {
    await connectDB();
    await Session.deleteOne({ tokenHash: hashToken(token) });
  }

  cookieStore.delete(SESSION_COOKIE);
}
