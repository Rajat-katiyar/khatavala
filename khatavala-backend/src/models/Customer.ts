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

const customerSchema = new Schema(
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
    billingAddress: { type: addressSchema, default: () => ({}) },
    shippingAddress: { type: addressSchema, default: () => ({}) },
    creditLimit: { type: Number, default: 0, min: 0 },

    /**
     * Balance carried in from before this system — set once at creation (or by
     * the Excel import) and thereafter treated as immutable history: the
     * opening balance is materialised as the customer's first ledger entry, so
     * editing it later would desync the ledger from the running balance. The
     * update path deliberately refuses it; correct an opening balance with an
     * adjustment entry instead.
     */
    openingBalance: { type: Number, default: 0 },

    /**
     * Denormalised running total = openingBalance + Σdebit − Σcredit.
     * Positive means the customer owes us. Maintained by
     * customerLedger.service.ts as entries are appended — never written
     * directly from a route handler, or it will drift from the ledger.
     */
    currentBalance: { type: Number, default: 0 },

    isActive: { type: Boolean, default: true },
  },
  { timestamps: true }
);

// Phone is unique WITHIN a company, not globally — two tenants must be free to
// hold the same customer. A plain `unique: true` would leak the existence of
// another tenant's customer by rejecting the insert.
customerSchema.index({ companyId: 1, phone: 1 }, { unique: true });

// Search index. A text index gives stemmed, ranked matching on name; phone and
// GST are matched by anchored regex in the service instead, because text
// indexes tokenise on word boundaries and would never match a partial number.
customerSchema.index({ companyId: 1, name: 'text' });

// Backs the default list sort and the outstanding-balance report.
customerSchema.index({ companyId: 1, currentBalance: -1 });

export type Customer = InferSchemaType<typeof customerSchema>;
export const CustomerModel = model('Customer', customerSchema);
