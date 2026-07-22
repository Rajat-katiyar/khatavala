import { Schema, model, InferSchemaType } from 'mongoose';

/**
 * The three product master lists: Category, Brand and Unit.
 *
 * They live in one file because they are the same shape — a company-scoped
 * named lookup — and keeping them together makes it obvious that they share
 * one CRUD implementation (services/catalog.service.ts) rather than three
 * near-identical copies.
 *
 * All three are tenant-scoped: `companyId` is required and indexed, and EVERY
 * query must go through `tenantFilter`/`tenantStamp`. See docs/TENANCY.md.
 */

const companyId = {
  type: Schema.Types.ObjectId,
  ref: 'Company',
  required: true,
  index: true,
} as const;

/* ------------------------------- Category ------------------------------- */

const categorySchema = new Schema(
  {
    companyId,
    name: { type: String, required: true, trim: true },
    description: { type: String, trim: true },
    /**
     * Optional self-reference for a two-level catalog ("Beverages > Juices").
     * Not a full tree: arbitrary nesting makes every listing query recursive,
     * and no shop in this segment has asked for more than one level.
     */
    parentId: { type: Schema.Types.ObjectId, ref: 'Category', default: null },
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true }
);

// Names are unique WITHIN a company, not globally — two tenants must be free
// to both have a "Groceries".
categorySchema.index({ companyId: 1, name: 1 }, { unique: true });

export type Category = InferSchemaType<typeof categorySchema>;
export const CategoryModel = model('Category', categorySchema);

/* -------------------------------- Brand --------------------------------- */

const brandSchema = new Schema(
  {
    companyId,
    name: { type: String, required: true, trim: true },
    description: { type: String, trim: true },
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true }
);

brandSchema.index({ companyId: 1, name: 1 }, { unique: true });

export type Brand = InferSchemaType<typeof brandSchema>;
export const BrandModel = model('Brand', brandSchema);

/* --------------------------------- Unit --------------------------------- */

const unitSchema = new Schema(
  {
    companyId,
    name: { type: String, required: true, trim: true },
    /** Short form printed on invoices — "kg", "pcs", "ltr". */
    symbol: { type: String, required: true, trim: true },
    /**
     * Whole-number units cannot be sold in fractions. A shop selling bottles
     * needs "2 pcs" to be rejected as "2.5 pcs", while 2.5 kg is fine.
     */
    allowsDecimal: { type: Boolean, default: true },
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true }
);

unitSchema.index({ companyId: 1, name: 1 }, { unique: true });

export type Unit = InferSchemaType<typeof unitSchema>;
export const UnitModel = model('Unit', unitSchema);
