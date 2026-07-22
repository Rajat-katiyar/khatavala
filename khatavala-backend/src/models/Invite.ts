import { Schema, model, InferSchemaType, HydratedDocument } from 'mongoose';

/**
 * A pending invitation to join a company. Separate from UserCompanyRole because
 * an invite exists *before* there is a user to attach a membership to — the
 * invitee may not have a Khatavala account at all.
 *
 * Only the SHA-256 hash of the emailed token is stored, the same treatment as
 * password-reset tokens: a leaked database dump must not yield working invite
 * links.
 */
const inviteSchema = new Schema(
  {
    companyId: {
      type: Schema.Types.ObjectId,
      ref: 'Company',
      required: true,
      index: true,
    },
    email: { type: String, required: true, lowercase: true, trim: true, index: true },
    roleId: { type: Schema.Types.ObjectId, ref: 'Role', required: true },

    // Denormalized so the users table can show the pending role without a join.
    roleName: { type: String, required: true },

    tokenHash: { type: String, required: true, index: true },
    expiresAt: { type: Date, required: true },

    status: {
      type: String,
      enum: ['pending', 'accepted', 'revoked', 'expired'],
      default: 'pending',
      index: true,
    },

    invitedBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    acceptedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

// At most one live invite per address per company. Re-inviting someone should
// replace the outstanding invite, not create a second one that also works.
// Partial so that historical accepted/revoked rows can pile up freely.
inviteSchema.index(
  { companyId: 1, email: 1 },
  { unique: true, partialFilterExpression: { status: 'pending' } }
);

export type Invite = InferSchemaType<typeof inviteSchema>;
export type InviteDocument = HydratedDocument<Invite>;
export const InviteModel = model<Invite>('Invite', inviteSchema);
