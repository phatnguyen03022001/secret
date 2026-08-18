import { Schema, model, models } from "mongoose";

const MaintenanceLeaseSchema = new Schema(
  {
    key: { type: String, required: true, unique: true, index: true },
    lockedUntil: { type: Date, default: null },
    nextRunAt: { type: Date, default: null, index: true },
    lastRunAt: { type: Date, default: null },
    lastError: { type: String, default: null },
  },
  { timestamps: true },
);

const MaintenanceLease = models.MaintenanceLease || model("MaintenanceLease", MaintenanceLeaseSchema);
export default MaintenanceLease;
