import { Schema, model, InferSchemaType } from 'mongoose';

/**
 * THE STOCK AUDIT TRAIL
 * =====================
 * Every quantity that has ever entered or left a warehouse, one row per event,
 * APPEND-ONLY. The same discipline as CustomerLedgerEntry, for the same reason:
 * a ledger you can quietly edit is not a ledger. Correcting a mistake means
 * writing a compensating Adjustment, never touching the original row — and
 * `runningBalance` on every later row would be wrong if you did. The service
 * layer therefore exposes no update and no delete.
 *
 * WHY THIS IS NOT THE SOURCE OF TRUTH FOR "CURRENT STOCK"
 * ------------------------------------------------------
 * It could be — `sum(quantity)` is always the right answer, which is exactly
 * the property that makes an append-only design worth having. But it is O(n)
 * in the number of movements, and a busy counter posts thousands a month.
 * StockBalance holds the same figure as a maintained total, and stock.service
 * writes both inside one transaction so they cannot disagree. See the header of
 * StockBalance.ts for how the two are reconciled.
 *
 * SIGN CONVENTION
 * ---------------
 * `quantity` is the SIGNED delta this movement applied to the balance:
 * positive for In, negative for Out and Damage, either for Adjustment, and one
 * of each for the two legs of a Transfer. Storing it signed rather than as a
 * magnitude plus a direction means `runningBalance` is a plain running sum and
 * a reader can verify the arithmetic by eye. The UI splits it back into In/Out
 * columns for display.
 */

export const MOVEMENT_TYPES = ['In', 'Out', 'Transfer', 'Adjustment', 'Damage'] as const;
export type MovementType = (typeof MOVEMENT_TYPES)[number];

/**
 * What caused the movement. Unlike the customer ledger's `referenceModel` this
 * is NOT a refPath — several of these values (Opening, Adjustment, Damage) have
 * no document behind them at all, so there is no single collection to resolve
 * against. Where there IS a document, `referenceId` holds it: an Invoice for
 * Sale, a DeliveryChallan for a dispatch, a SalesReturn for goods coming back.
 */
export const REFERENCE_TYPES = [
  'Opening',
  'Sale',
  'SalesReturn',
  'Purchase',
  'PurchaseReturn',
  'Transfer',
  'Adjustment',
  'Damage',
  /** Goods dispatched on a delivery challan, ahead of any invoice. */
  'DeliveryChallan',
] as const;
export type ReferenceType = (typeof REFERENCE_TYPES)[number];

const stockLedgerEntrySchema = new Schema(
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
      index: true,
    },
    warehouseId: {
      type: Schema.Types.ObjectId,
      ref: 'Warehouse',
      required: true,
      index: true,
    },

    /**
     * Batch and expiry are per-MOVEMENT, not per-product: the same product
     * arrives in many batches and each is tracked separately from the moment it
     * lands. Both default to null rather than being absent, so the balance key
     * (product+warehouse+batch) is well defined for untracked products too —
     * see the unique index on StockBalance.
     */
    batchNumber: { type: String, trim: true, default: null },
    expiryDate: { type: Date, default: null },

    movementType: { type: String, enum: MOVEMENT_TYPES, required: true },

    /** Signed delta. See the sign-convention note above. */
    quantity: { type: Number, required: true },

    /** Stock in this product/warehouse/batch AFTER this movement. */
    runningBalance: { type: Number, required: true },

    referenceType: { type: String, enum: REFERENCE_TYPES, required: true },
    /**
     * The document that caused it, when there is one. Null for a manual
     * adjustment; for the two legs of a transfer both rows carry the SAME id so
     * the pair can be shown as one event.
     */
    referenceId: { type: Schema.Types.ObjectId, default: null },

    /** Required by the service for Adjustment and Damage — "why" is the point. */
    reason: { type: String, trim: true, default: null },

    timestamp: { type: Date, required: true, default: () => new Date() },

    /** Who posted it. Movements are the most audited thing in the system. */
    createdBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
  },
  { timestamps: true }
);

/**
 * The movement-history query: one product, newest first. `_id` breaks ties so
 * that two movements posted in the same millisecond — which the concurrency
 * test does on purpose — page deterministically instead of swapping places
 * between requests and making the running-balance column look wrong.
 */
stockLedgerEntrySchema.index({ companyId: 1, productId: 1, timestamp: -1, _id: -1 });

// Warehouse-scoped history, and the date-range filter on the same page.
stockLedgerEntrySchema.index({ companyId: 1, warehouseId: 1, timestamp: -1 });

// Backs the transfer-pair lookup and any "show me the movements this invoice
// caused" drill-down once Sales exists.
stockLedgerEntrySchema.index({ companyId: 1, referenceType: 1, referenceId: 1 });

export type StockLedgerEntry = InferSchemaType<typeof stockLedgerEntrySchema>;
export const StockLedgerEntryModel = model('StockLedgerEntry', stockLedgerEntrySchema);
