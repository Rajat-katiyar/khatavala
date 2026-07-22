import { Schema, model, type InferSchemaType } from 'mongoose';

const idempotencyKeySchema = new Schema(
  {
    key: { type: String, required: true, unique: true, index: true },
    companyId: { type: Schema.Types.ObjectId, ref: 'Company', required: true },
    statusCode: { type: Number, required: true },
    responseBody: { type: Schema.Types.Mixed, required: true },
    expiresAt: {
      type: Date,
      required: true,
      default: () => new Date(Date.now() + 24 * 60 * 60 * 1000), // TTL 24 hours
      index: { expires: 0 },
    },
  },
  { timestamps: true }
);

export type IIdempotencyKey = InferSchemaType<typeof idempotencyKeySchema>;
export const IdempotencyKeyModel = model('IdempotencyKey', idempotencyKeySchema);
