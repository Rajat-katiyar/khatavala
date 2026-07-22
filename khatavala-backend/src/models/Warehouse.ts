import { Schema, model, InferSchemaType } from 'mongoose';

/**
 * A physical place stock sits — a shop floor, a godown, a delivery van.
 *
 * Tenant-scoped like every other master; see docs/TENANCY.md. `UserCompanyRole`
 * already carries a `warehouseId`, so this is the collection that field has
 * been pointing at since Phase 4.
 *
 * ONE DEFAULT PER COMPANY. Sales and Purchase will need a warehouse to move
 * stock into or out of long before the UI asks the user to pick one, so there
 * must always be exactly one obvious answer. The uniqueness is enforced by a
 * partial index below rather than by application code, because two concurrent
 * "make this the default" requests would both pass a read-then-write check.
 */

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

const warehouseSchema = new Schema(
  {
    companyId: {
      type: Schema.Types.ObjectId,
      ref: 'Company',
      required: true,
      index: true,
    },

    name: { type: String, required: true, trim: true },
    address: { type: addressSchema, default: () => ({}) },

    /** Where stock lands when a caller does not name a warehouse. */
    isDefault: { type: Boolean, default: false },

    isActive: { type: Boolean, default: true },
  },
  { timestamps: true }
);

// Names are unique within a company — "Main Godown" in two tenants is fine, two
// in one company is a data-entry mistake that makes every stock report ambiguous.
warehouseSchema.index({ companyId: 1, name: 1 }, { unique: true });

/**
 * At most one default per company.
 *
 * `partialFilterExpression` restricts the unique constraint to the rows where
 * `isDefault` is actually true, so the many non-default warehouses do not all
 * collide on `isDefault: false`. (The same trap as Product.barcode — a plain
 * compound unique index would permit exactly one non-default warehouse.)
 */
warehouseSchema.index(
  { companyId: 1, isDefault: 1 },
  { unique: true, partialFilterExpression: { isDefault: true } }
);

export type Warehouse = InferSchemaType<typeof warehouseSchema>;
export const WarehouseModel = model('Warehouse', warehouseSchema);
