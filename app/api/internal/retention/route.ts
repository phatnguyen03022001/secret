import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth/session";
import { cleanupAbandonedMediaUploads, purgeExpiredConversations } from "@/lib/chat/retention";

async function isAuthorized(req: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  const authorization = req.headers.get("authorization");

  if (cronSecret && authorization === `Bearer ${cronSecret}`) return true;

  const user = await getCurrentUser();
  return Boolean(user?.isAdmin);
}

async function runRetention(req: NextRequest) {
  if (!(await isAuthorized(req))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const [conversations, mediaUploads] = await Promise.all([
    purgeExpiredConversations({ limit: 50 }),
    cleanupAbandonedMediaUploads({ limit: 100 }),
  ]);

  return NextResponse.json({ conversations, mediaUploads });
}

export async function GET(req: NextRequest) {
  return runRetention(req);
}

export async function POST(req: NextRequest) {
  return runRetention(req);
}
