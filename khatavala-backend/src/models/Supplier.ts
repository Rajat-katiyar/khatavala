import { Schema, model, InferSchemaType } from 'mongoose';

// Tenant-scoped collection. `companyId` is required and indexed, and EVERY
// query against this model must go through `tenantFilter`/`tenantStamp` —
// see docs/TENANCY.md.

const addressSchema = new Schema(
  {
    line1: { type: String, trim: true },
    line2: { type: String, trim: true },
    city: { type: String, trim: true },
    state: { type: String, trim: true },
    pincode: { type: String, trim: true },
  },
  { _id: false }
);

const supplierSchema = new Schema(
  {
    companyId: {
      type: Schema.Types.ObjectId,
      ref: 'Company',
      required: true,
      index: true,
    },
    name: { type: String, required: true, trim: true },
    phone: { type: String, required: true, trim: true },
    email: { type: String, trim: true, lowercase: true },
    gstNumber: { type: String, trim: true, uppercase: true },
    pan: { type: String, trim: true, uppercase: true },
    address: { type: addressSchema, default: () => ({}) },

    /**
     * Balance carried in from before this system — set once at creation (or by
     * the Excel import) and thereafter treated as immutable history: it is
     * materialised as the supplier's first ledger entry, so editing it later
     * would desync the ledger from the running balance. The update path
     * refuses it; correct one with an adjustment entry instead.
     */
    openingBalance: { type: Number, default: 0 },

    /**
     * Denormalised PAYABLE = openingBalance + Σcredit − Σdebit.
     *
     * Note the direction is the INVERSE of Customer.currentBalance. A supplier
     * is a creditor: a purchase bill credits them and increases what we owe, a
     * payment we make debits them and reduces it. So a positive balance here
     * means WE OWE THEM, which is the same reading as the customer field but
     * arrived at from the opposite column. See ledger.factory.ts.
     *
     * Maintained by supplierLedger.service.ts — never written directly from a
     * route handler, or it will drift from the ledger.
     */
    currentBalance: { type: Number, default: 0 },

    /** Optional 1–5 internal quality score. Null until someone rates them. */
    vendorRating: { type: Number, min: 1, max: 5, default: null },

    isActive: { type: Boolean, default: true },
  },
  { timestamps: true }
);

// Phone is unique WITHIN a company, not globally — two tenants must be free to
// use the same supplier. A plain `unique: true` would leak the existence of
// another tenant's supplier by rejecting the insert.
supplierSchema.index({ companyId: 1, phone: 1 }, { unique: true });

// Search index. A text index gives stemmed, ranked matching on name; phone and
// GST are matched by anchored regex in the service instead, because text
// indexes tokenise on word boundaries and would never match a partial number.
supplierSchema.index({ companyId: 1, name: 'text' });

// Backs the default list sort and the outstanding-payables report.
supplierSchema.index({ companyId: 1, currentBalance: -1 });

export type Supplier = InferSchemaType<typeof supplierSchema>;
export const SupplierModel = model('Supplier', supplierSchema);
