import "server-only";

import { createHash } from "node:crypto";
import type { NextRequest } from "next/server";
import { connectDB } from "@/lib/server";
import RateLimit from "@/models/RateLimit";

function hashKey(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

export function getRequestIp(req: Request | NextRequest) {
  const forwarded = req.headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0].trim();
  return req.headers.get("x-real-ip") || "unknown";
}

export async function consumeRateLimit(options: {
  scope: string;
  identifier: string;
  limit: number;
  windowSeconds: number;
}) {
  await connectDB();

  const now = Date.now();
  const windowMs = options.windowSeconds * 1000;
  const bucket = Math.floor(now / windowMs);
  const key = hashKey(`${options.scope}:${options.identifier}:${bucket}`);
  const expiresAt = new Date((bucket + 1) * windowMs + 60_000);

  let record;
  try {
    record = await RateLimit.findOneAndUpdate(
      { key },
      {
        $inc: { count: 1 },
        $setOnInsert: { expiresAt },
      },
      { upsert: true, new: true, setDefaultsOnInsert: true },
    ).lean();
  } catch (error: any) {
    if (error?.code !== 11000) throw error;
    record = await RateLimit.findOneAndUpdate({ key }, { $inc: { count: 1 } }, { new: true }).lean();
  }

  const count = record?.count ?? options.limit + 1;
  const allowed = count <= options.limit;
  const retryAfterSeconds = Math.max(1, Math.ceil(((bucket + 1) * windowMs - now) / 1000));

  return {
    allowed,
    remaining: Math.max(0, options.limit - count),
    retryAfterSeconds,
  };
}
