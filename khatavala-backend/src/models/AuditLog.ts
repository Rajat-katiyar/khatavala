import { Schema, model, InferSchemaType, HydratedDocument } from 'mongoose';

/**
 * An append-only record of who changed what. Written by the `withAudit` wrapper
 * in services/audit.service.ts — never by route handlers directly, and never by
 * Mongoose hooks (see that file for why).
 *
 * `oldValue` / `newValue` are `Schema.Types.Mixed`: the shape differs per
 * entity, and validating it here would couple the log to every module's schema.
 */
const auditLogSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    companyId: {
      type: Schema.Types.ObjectId,
      ref: 'Company',
      required: true,
      index: true,
    },

    /** `create` | `update` | `delete` | a domain verb such as `user.invite`. */
    action: { type: String, required: true, index: true },

    /** The model/collection touched, e.g. `Product`, `Role`, `UserCompanyRole`. */
    entityName: { type: String, required: true, index: true },
    entityId: { type: String, default: null },

    oldValue: { type: Schema.Types.Mixed, default: null },
    newValue: { type: Schema.Types.Mixed, default: null },

    // Not in the brief, but an audit trail that cannot answer "from where?" is
    // half an audit trail — and both are free at write time.
    ip: { type: String, default: null },
    userAgent: { type: String, default: null },

    timestamp: { type: Date, default: Date.now, index: true },
  },
  // `timestamps: false` — `timestamp` above is the single time field. A second
  // `createdAt` would invite queries that filter on the wrong one.
  { timestamps: false }
);

// The activity-log page filters by company and reads newest-first; this
// compound index serves that as a covered sort rather than an in-memory one.
auditLogSchema.index({ companyId: 1, timestamp: -1 });
auditLogSchema.index({ companyId: 1, entityName: 1, entityId: 1 });

export type AuditLog = InferSchemaType<typeof auditLogSchema>;
export type AuditLogDocument = HydratedDocument<AuditLog>;
export const AuditLogModel = model<AuditLog>('AuditLog', auditLogSchema);
