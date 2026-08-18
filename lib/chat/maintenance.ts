import "server-only";

import { cleanupAbandonedMediaUploads, purgeExpiredConversations } from "@/lib/chat/retention";
import { connectDB } from "@/lib/server";
import MaintenanceLease from "@/models/MaintenanceLease";

const LEASE_KEY = "chat-retention";
const DEFAULT_INTERVAL_MS = 15 * 60 * 1000;
const LOCK_MS = 4 * 60 * 1000;
const RETRY_AFTER_FAILURE_MS = 5 * 60 * 1000;

export async function maybeRunChatMaintenance(options: { intervalMs?: number } = {}) {
  await connectDB();

  const now = new Date();
  const intervalMs = Math.max(options.intervalMs ?? DEFAULT_INTERVAL_MS, 60_000);
  const lockedUntil = new Date(now.getTime() + LOCK_MS);
  const nextRunAt = new Date(now.getTime() + intervalMs);

  let lease: any = null;
  try {
    lease = await MaintenanceLease.findOneAndUpdate(
      {
        key: LEASE_KEY,
        $and: [
          {
            $or: [
              { lockedUntil: null },
              { lockedUntil: { $exists: false } },
              { lockedUntil: { $lte: now } },
            ],
          },
          {
            $or: [{ nextRunAt: null }, { nextRunAt: { $exists: false } }, { nextRunAt: { $lte: now } }],
          },
        ],
      },
      {
        $set: {
          lockedUntil,
          nextRunAt,
          lastError: null,
        },
        $setOnInsert: { key: LEASE_KEY },
      },
      { upsert: true, new: true },
    );
  } catch (error: any) {
    if (error?.code === 11000) return { ran: false, reason: "lease-busy" as const };
    throw error;
  }

  if (!lease) return { ran: false, reason: "not-due" as const };

  try {
    const [conversations, mediaUploads] = await Promise.all([
      purgeExpiredConversations({ limit: 10 }),
      cleanupAbandonedMediaUploads({ limit: 25 }),
    ]);

    await MaintenanceLease.updateOne(
      { _id: lease._id },
      {
        $set: {
          lockedUntil: now,
          lastRunAt: new Date(),
          lastError: null,
        },
      },
    );

    return { ran: true, conversations, mediaUploads };
  } catch (error) {
    const message = error instanceof Error ? error.message.slice(0, 500) : "Unknown maintenance error";
    await MaintenanceLease.updateOne(
      { _id: lease._id },
      {
        $set: {
          lockedUntil: now,
          nextRunAt: new Date(Date.now() + RETRY_AFTER_FAILURE_MS),
          lastError: message,
        },
      },
    ).catch(() => undefined);
    throw error;
  }
}
