import "server-only";

import { randomBytes } from "node:crypto";
import { connectDB } from "@/lib/server";
import ChatLink from "@/models/ChatLink";
import User from "@/models/User";

const normalizeSlug = (value: string) =>
  value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, "")
    .slice(0, 40);

export async function ensureChatLinkForUser(user: any) {
  await connectDB();

  if (user.isAdmin || user.accountType === "guest") return null;

  const existing = await ChatLink.findOne({ ownerId: user._id });
  if (existing) return existing;

  const baseSlug = normalizeSlug(user.username) || `user-${user._id.toString().slice(-8)}`;

  try {
    return await ChatLink.create({
      ownerId: user._id,
      slug: baseSlug,
      enabled: true,
      allowGuests: true,
      lifecycle: "persistent",
      guestSessionHours: 24,
    });
  } catch (error: any) {
    if (error?.code !== 11000) throw error;

    const suffix = randomBytes(3).toString("hex");
    return ChatLink.create({
      ownerId: user._id,
      slug: `${baseSlug}-${suffix}`,
      enabled: true,
      allowGuests: true,
      lifecycle: "persistent",
      guestSessionHours: 24,
    });
  }
}

export async function getChatLinkBySlug(slug: string) {
  await connectDB();

  const link = await ChatLink.findOne({ slug: normalizeSlug(slug), enabled: true }).lean();
  if (!link) return null;

  const owner = await User.findById(link.ownerId).lean();
  if (!owner || owner.isAdmin || owner.accountType === "guest") return null;

  return { link, owner };
}

export function getPublicUserName(user: any) {
  return user.displayName?.trim() || user.username;
}
