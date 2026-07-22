import { Schema, model, InferSchemaType } from 'mongoose';

/**
 * The product master — the catalog that inventory, sales and purchases all
 * read from.
 *
 * Tenant-scoped: `companyId` is required and indexed, and EVERY query must go
 * through `tenantFilter`/`tenantStamp`. See docs/TENANCY.md.
 *
 * NOTE ON PRICES: all four are stored, none are derived. `sellingPrice` is
 * what the till charges, `mrp` is the printed ceiling, `wholesalePrice` is the
 * bulk rate and `purchasePrice` is what it cost. They move independently in
 * practice — a discounted line still prints its MRP — so computing any of them
 * from the others would be wrong the first time a shop runs a promotion.
 */

const productSchema = new Schema(
  {
    companyId: {
      type: Schema.Types.ObjectId,
      ref: 'Company',
      required: true,
      index: true,
    },

    name: { type: String, required: true, trim: true },
    sku: { type: String, required: true, trim: true, uppercase: true },
    /** Scanned barcode (EAN/UPC/custom). Optional — not everything is labelled. */
    barcode: { type: String, trim: true, default: null },

    categoryId: { type: Schema.Types.ObjectId, ref: 'Category', default: null },
    brandId: { type: Schema.Types.ObjectId, ref: 'Brand', default: null },

    /** Indian HSN/SAC code, used on the GST invoice. */
    hsnCode: { type: String, trim: true, uppercase: true, default: null },
    gstPercentage: { type: Number, default: 0, min: 0, max: 100 },

    primaryUnitId: { type: Schema.Types.ObjectId, ref: 'Unit', required: true },

    /**
     * Optional second unit for goods bought in one measure and sold in
     * another — a case of 24 bottles. `conversionFactor` is how many PRIMARY
     * units make one SECONDARY unit, so a case of 24 is factor 24. The two
     * fields are meaningless apart, and the service layer enforces that they
     * are set or cleared together.
     */
    secondaryUnitId: { type: Schema.Types.ObjectId, ref: 'Unit', default: null },
    conversionFactor: { type: Number, default: null, min: 0 },

    purchasePrice: { type: Number, default: 0, min: 0 },
    sellingPrice: { type: Number, default: 0, min: 0 },
    mrp: { type: Number, default: 0, min: 0 },
    wholesalePrice: { type: Number, default: 0, min: 0 },

    /**
     * Stock carried in at setup. Like an opening balance it is history: the
     * Inventory module owns movements from here on, so this is set once and
     * the update path refuses it.
     */
    openingStock: { type: Number, default: 0 },
    /**
     * Live quantity on hand. Denormalised for the low-stock query — recomputing
     * it by summing every movement on each listing would be O(movements) per
     * row. Seeded from `openingStock` at creation; the Inventory module owns it
     * thereafter.
     */
    currentStock: { type: Number, default: 0 },

    /** Reorder trigger. A product at or below this shows as low stock. */
    minStockLevel: { type: Number, default: 0, min: 0 },
    maxStockLevel: { type: Number, default: 0, min: 0 },

    /**
     * Traceability switches, read by the Inventory module when it decides what
     * a stock movement must capture. Kept on the product because it varies per
     * item: milk needs an expiry, a phone needs a serial, a screw needs
     * neither.
     */
    trackBatch: { type: Boolean, default: false },
    trackExpiry: { type: Boolean, default: false },
    trackSerial: { type: Boolean, default: false },

    imageUrl: { type: String, trim: true, default: null },

    isActive: { type: Boolean, default: true },

    /** When true, this product appears on the public online storefront. */
    isOnlineStoreVisible: { type: Boolean, default: false, index: true },
    /** Short description shown on the storefront product card. */
    onlineStoreDescription: { type: String, trim: true, default: null },
  },
  { timestamps: true }
);

// SKUs are unique WITHIN a company, not globally — two tenants must be free to
// use the same SKU. A plain `unique: true` would leak the existence of another
// tenant's product by rejecting the insert.
productSchema.index({ companyId: 1, sku: 1 }, { unique: true });

/**
 * Barcodes are likewise unique per company — but only among products that
 * HAVE one, and most do not.
 *
 * `sparse: true` is the obvious answer and is WRONG on a compound index: a
 * sparse compound index skips a document only when it has none of the indexed
 * fields, and `companyId` is always present. So every product would be
 * indexed, every `barcode: null` would collide, and a company could hold
 * exactly one product without a barcode. (Verified — it fails on the second
 * insert.)
 *
 * `partialFilterExpression` is the correct tool: it indexes only documents
 * whose barcode is actually a string, leaving nulls out entirely.
 */
productSchema.index(
  { companyId: 1, barcode: 1 },
  { unique: true, partialFilterExpression: { barcode: { $type: 'string' } } }
);

/**
 * Full-text search across the three fields a user searches by.
 *
 * `companyId` leads the index so a search never scans another tenant's rows.
 * Weights put an SKU or barcode hit above a name hit: someone typing an exact
 * SKU wants that product first, not every product whose name happens to
 * contain the same token.
 *
 * Text search alone is NOT sufficient for this catalog — it tokenises on word
 * boundaries, so it cannot match a partial SKU or a half-typed barcode. The
 * service layer pairs this index with exact and prefix matching; see
 * product.service.ts.
 */
productSchema.index(
  { companyId: 1, name: 'text', sku: 'text', barcode: 'text' },
  {
    name: 'product_search_text',
    weights: { sku: 10, barcode: 10, name: 5 },
  }
);

// Backs the category/brand filters and the low-stock report.
productSchema.index({ companyId: 1, categoryId: 1 });
productSchema.index({ companyId: 1, brandId: 1 });
productSchema.index({ companyId: 1, currentStock: 1 });

export type Product = InferSchemaType<typeof productSchema>;
export const ProductModel = model('Product', productSchema);
