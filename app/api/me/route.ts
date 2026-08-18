import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth/session";

export async function GET() {
  try {
    const user = await getCurrentUser();

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    return NextResponse.json({
      _id: user._id,
      username: user.username,
      isAdmin: user.isAdmin,
    });
  } catch {
    return NextResponse.json({ error: "Server Error" }, { status: 500 });
  }
}
