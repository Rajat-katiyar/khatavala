import { Schema, model, InferSchemaType } from 'mongoose';

/**
 * CURRENT STOCK — the maintained total behind every "how many do we have?"
 *
 * One row per (product, warehouse, batch). `quantity` is moved ONLY by
 * `$inc` inside `stock.service.recordMovement`, never by a read-then-write, and
 * never by anything outside that service.
 *
 * WHY $inc AND NOT read-modify-write
 * ----------------------------------
 * Two concurrent sales of the same product both read `quantity: 10`, both
 * compute 10 - 1, both write 9, and one unit is sold twice. That is not a
 * theoretical race — it is the single most common inventory bug there is, and
 * it gets worse under exactly the load where it matters. `$inc` pushes the
 * arithmetic into the server, where it is atomic against the document, and
 * `findOneAndUpdate(..., { new: true })` hands back the post-update figure to
 * use as the ledger row's `runningBalance`. So the two collections agree by
 * construction rather than by hoping the arithmetic matched.
 *
 * WHY A SEPARATE COLLECTION AND NOT Product.currentStock
 * -----------------------------------------------------
 * `Product.currentStock` is one number for the whole company. Real stock is
 * per-warehouse and per-batch — "20 in hand" is useless when 20 are in the
 * godown and the shop counter has none, and worse than useless when 15 of them
 * expired last week. Product.currentStock is kept in step as a company-wide
 * roll-up for the low-stock listing (Phase 7 already indexes it), but THIS is
 * the collection stock decisions are made from.
 */

const stockBalanceSchema = new Schema(
  {
    companyId: {
      type: Schema.Types.ObjectId,
      ref: 'Company',
      required: true,
      index: true,
    },

    productId: {
      type: Schema.Types.ObjectId,
      ref: 'Product',
      required: true,
    },
    warehouseId: {
      type: Schema.Types.ObjectId,
      ref: 'Warehouse',
      required: true,
    },

    /**
     * Null for products that are not batch-tracked. Stored as an explicit null
     * rather than left absent so the unique index below has a stable key: in a
     * compound index a missing field and a null field both index as null, but
     * the upsert path relies on the filter and the stored document matching
     * exactly, and an absent field would not round-trip.
     */
    batchNumber: { type: String, trim: true, default: null },

    /** Carried alongside the batch for the near-expiry report. */
    expiryDate: { type: Date, default: null },

    quantity: { type: Number, required: true, default: 0 },

    /** Timestamp of the most recent movement, for "stale stock" reporting. */
    lastMovementAt: { type: Date, default: null },
  },
  { timestamps: true }
);

/**
 * THE KEY. Unique, and the reason concurrent movements cannot create two rows
 * for the same bucket and each count half the stock.
 *
 * A note on the upsert that uses it: MongoDB can still return E11000 when two
 * upserts race on a key that does not exist yet — the constraint is doing its
 * job, and the loser must retry rather than fail the request. stock.service
 * handles that; see RETRYABLE_CODES there.
 */
stockBalanceSchema.index(
  { companyId: 1, productId: 1, warehouseId: 1, batchNumber: 1 },
  { unique: true }
);

// Backs the /inventory listing filtered by warehouse.
stockBalanceSchema.index({ companyId: 1, warehouseId: 1, quantity: 1 });

// Backs the near-expiry report: only rows that actually carry an expiry.
stockBalanceSchema.index(
  { companyId: 1, expiryDate: 1 },
  { partialFilterExpression: { expiryDate: { $type: 'date' } } }
);

export type StockBalance = InferSchemaType<typeof stockBalanceSchema>;
export const StockBalanceModel = model('StockBalance', stockBalanceSchema);
