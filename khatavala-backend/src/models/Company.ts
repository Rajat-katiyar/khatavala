import { Schema, model, InferSchemaType, HydratedDocument } from 'mongoose';

// A Company is the tenant boundary. Every tenant-scoped document carries a
// `companyId` pointing here, and every query on those collections is filtered
// by it — see docs/TENANCY.md.
const companySchema = new Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 160 },

    // GSTIN: 15 chars — 2 state code, 10 PAN, 1 entity, 1 'Z', 1 checksum.
    gstNumber: {
      type: String,
      trim: true,
      uppercase: true,
      match: [/^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][0-9A-Z]Z[0-9A-Z]$/, 'Invalid GSTIN'],
    },
    panNumber: {
      type: String,
      trim: true,
      uppercase: true,
      match: [/^[A-Z]{5}[0-9]{4}[A-Z]$/, 'Invalid PAN'],
    },

    address: {
      line1: { type: String, trim: true },
      line2: { type: String, trim: true },
      city: { type: String, trim: true },
      pincode: { type: String, trim: true },
    },
    state: { type: String, trim: true },

    // Indian FY starts 1 April by default; stored as a month index (1-12) so a
    // company on a different cycle can be represented without a full date.
    financialYearStart: { type: Number, min: 1, max: 12, default: 4 },

    currency: { type: String, trim: true, uppercase: true, default: 'INR' },
    timeZone: { type: String, trim: true, default: 'Asia/Kolkata' },
    logoUrl: { type: String, trim: true },
    invoicePrefix: { type: String, trim: true, uppercase: true, default: 'INV' },

    isActive: { type: Boolean, default: true },

    // The user who created the company. Ownership is also expressed as an
    // 'Owner' row in UserCompanyRole; this field is the immutable creator.
    ownerId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  },
  { timestamps: true }
);

// A GSTIN identifies a legal entity in one state — it may not be reused across
// companies. Sparse so companies that have not registered yet are allowed.
companySchema.index({ gstNumber: 1 }, { unique: true, sparse: true });

companySchema.set('toJSON', {
  transform: (_doc, ret: Record<string, unknown>) => {
    delete ret.__v;
    return ret;
  },
});

export type Company = InferSchemaType<typeof companySchema>;
export type CompanyDocument = HydratedDocument<Company>;
export const CompanyModel = model<Company>('Company', companySchema);
