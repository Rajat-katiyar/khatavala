import { Schema, model, InferSchemaType } from 'mongoose';

/**
 * GST RATE MASTER — HSN/SAC code to tax rate mapping.
 *
 * Products already carry `hsnCode` and `gstPercentage`, but the gstPercentage
 * is the combined rate. This master breaks it into the component parts that
 * appear on returns: CGST, SGST (for intra-state) or IGST (inter-state), and
 * CESS (for luxury / sin goods).
 *
 * For most goods, cgstPercent === sgstPercent === gstPercentage / 2, and
 * igstPercent === gstPercentage. The cess is an additional levy.
 *
 * Tenant-scoped: every query must go through `tenantFilter`/`tenantStamp`.
 */

const gstRateSchema = new Schema(
  {
    companyId: {
      type: Schema.Types.ObjectId,
      ref: 'Company',
      required: true,
      index: true,
    },

    /**
     * 4-digit HSN (Harmonized System Nomenclature) for goods or 6-digit SAC
     * (Service Accounting Code) for services. Both are treated as a string so
     * leading zeros are preserved.
     */
    hsnCode: { type: String, required: true, trim: true, uppercase: true },

    /** Human-readable label, e.g. "Footwear - Leather (Value ≤ ₹1000)". */
    description: { type: String, trim: true, default: '' },

    /** Component rates — intra-state supply is CGST + SGST. */
    cgstPercent: { type: Number, default: 0, min: 0, max: 100 },
    sgstPercent: { type: Number, default: 0, min: 0, max: 100 },

    /** IGST rate — inter-state supply. Usually cgst + sgst. */
    igstPercent: { type: Number, default: 0, min: 0, max: 100 },

    /**
     * Cess rate — applied on top of the base GST, e.g. tobacco, luxury cars.
     * Most goods have 0%.
     */
    cessPercent: { type: Number, default: 0, min: 0, max: 100 },

    isActive: { type: Boolean, default: true },
  },
  { timestamps: true }
);

// An HSN code is unique per company — two different rates for the same code
// would make every invoice line lookup ambiguous.
gstRateSchema.index({ companyId: 1, hsnCode: 1 }, { unique: true });

gstRateSchema.set('toJSON', {
  transform: (_doc, ret: Record<string, unknown>) => {
    delete ret.__v;
    return ret;
  },
});

export type GSTRate = InferSchemaType<typeof gstRateSchema>;
export const GSTRateModel = model('GSTRate', gstRateSchema);
