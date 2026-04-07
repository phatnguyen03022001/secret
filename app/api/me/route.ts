// app/api/me/route.ts
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { connectDB } from "@/lib/server";
import User from "@/models/User";

export async function GET() {
  try {
    await connectDB();
    const cookieStore = await cookies();
    const userId = cookieStore.get("auth_session")?.value; // Kiểm tra lại tên cookie bạn đặt khi login

    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const user = await User.findById(userId).select("-password");
    if (!user) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    // Quan trọng: Phải trả về isAdmin ở đây
    return NextResponse.json({
      _id: user._id,
      username: user.username,
      isAdmin: user.isAdmin,
    });
  } catch (error) {
    return NextResponse.json({ error: "Server Error" }, { status: 500 });
  }
}
