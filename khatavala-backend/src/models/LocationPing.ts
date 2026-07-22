import { Schema, model, type InferSchemaType } from 'mongoose';

const locationPingSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    companyId: { type: Schema.Types.ObjectId, ref: 'Company', required: true, index: true },
    latitude: { type: Number, required: true },
    longitude: { type: Number, required: true },
    batteryLevel: { type: Number, default: 100 },
    timestamp: { type: Date, required: true, default: Date.now, index: true },
  },
  { timestamps: true }
);

locationPingSchema.index({ companyId: 1, userId: 1, timestamp: -1 });

export type ILocationPing = InferSchemaType<typeof locationPingSchema>;
export const LocationPingModel = model('LocationPing', locationPingSchema);
