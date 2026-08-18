import { NextRequest, NextResponse } from "next/server";
import { connectDB, pusherServer } from "@/lib/server";
import { getCurrentUser } from "@/lib/auth/session";
import User from "@/models/User";

export async function POST(req: NextRequest) {
  try {
    const currentUser = await getCurrentUser();
    if (!currentUser) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    await connectDB();
    const user = await User.findByIdAndUpdate(
      currentUser._id,
      { lastActive: new Date() },
      { new: true, runValidators: false },
    );

    if (!user) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    await pusherServer.trigger("admin-global", "user-online", {
      userId: user._id.toString(),
      username: user.username,
      lastActive: user.lastActive,
    });

    return NextResponse.json({ success: true, lastActive: user.lastActive });
  } catch (error) {
    console.error("Heartbeat API error:", error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
