import { Schema, model, InferSchemaType, Types } from 'mongoose';

// One document per issued refresh token. The raw JWT is never stored — only a
// SHA-256 hash — so a database leak cannot be replayed against /refresh-token.
const refreshTokenSchema = new Schema(
  {
    user: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    tokenHash: { type: String, required: true, unique: true },
    expiresAt: { type: Date, required: true },
    revoked: { type: Boolean, default: false },
    revokedAt: { type: Date },
    // Set during rotation so a replayed token can be traced to its successor.
    replacedByTokenHash: { type: String },
    userAgent: { type: String },
    ip: { type: String },
  },
  { timestamps: true }
);

// Let Mongo reap expired documents; the `revoked` flag stays authoritative
// for the lifetime of a token that has not yet expired.
refreshTokenSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export type RefreshToken = InferSchemaType<typeof refreshTokenSchema>;
export type RefreshTokenId = Types.ObjectId;
export const RefreshTokenModel = model('RefreshToken', refreshTokenSchema);
