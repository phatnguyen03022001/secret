import { NextResponse } from "next/server";
import { connectDB } from "@/lib/server";
import User from "@/models/User";
import bcrypt from "bcryptjs";
import { cookies } from "next/headers";

// app/api/admin/login/route.ts
export async function POST(req: Request) {
  await connectDB();
  const { username, password } = await req.json();

  const user = await User.findOne({ username }); // Không lọc isAdmin ở đây nữa

  if (!user) {
    return NextResponse.json({ error: "Thông tin không chính xác" }, { status: 401 });
  }

  const isValid = await bcrypt.compare(password, user.password);
  if (!isValid) {
    return NextResponse.json({ error: "Thông tin không chính xác" }, { status: 401 });
  }

  const cookieStore = await cookies();
  // Vẫn cấp cookie admin_session bình thường
  cookieStore.set("admin_session", user._id.toString(), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
    path: "/",
    maxAge: 60 * 60 * 4,
  });

  // Trả về thông tin user để Frontend biết quyền
  return NextResponse.json({
    success: true,
    user: { username: user.username, isAdmin: user.isAdmin },
  });
}
