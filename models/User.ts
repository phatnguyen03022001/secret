// models/User.ts
import mongoose, { Schema, model, models } from "mongoose";

const UserSchema = new Schema(
  {
    username: { type: String, required: true, unique: true },
    password: { type: String, required: true },
    isAdmin: { type: Boolean, default: false },
    lastActive: { type: Date, default: Date.now },
    chatSchemaVersion: { type: Number, default: 2 },
  },
  { timestamps: true },
);

const User = models.User || model("User", UserSchema);
export default User;
