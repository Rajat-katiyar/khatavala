import { Schema, model, InferSchemaType } from 'mongoose';
import { createTradeDocumentSchema, SUPPLIER_PARTY } from './tradeDocument.js';

/**
 * GOODS RECEIPT NOTE — what actually turned up.
 *
 * The buying side's counterpart to the delivery challan, and the document that
 * MOVES STOCK IN. Confirming one is transactional: stock in, status Received,
 * and the purchase order's progress updated, all together.
 *
 * WHY RECEIPT IS A SEPARATE DOCUMENT FROM THE ORDER
 * ------------------------------------------------
 * Because what arrives is routinely not what was ordered. A supplier ships 95
 * of 100, or sends the balance a week later, or delivers 100 and 3 are broken
 * on arrival. If receiving were just "mark the PO received", none of that could
 * be recorded, and stock would be wrong by exactly the amount nobody checked.
 *
 * So `lineItems[].quantity` here is the quantity ACCEPTED — what goes into
 * stock — and `orderedQuantity` / `rejectedQuantity` sit alongside it to record
 * the discrepancy rather than hide it.
 *
 * STOCK IS DEDUCTED BY NOTHING ELSE ON THIS SIDE. The purchase invoice that
 * follows posts the supplier ledger only, the same way an invoice raised
 * against a delivery challan skips its stock step — see purchase.service.
 */

export const GRN_STATUSES = ['Draft', 'Received', 'Cancelled'] as const;
export type GrnStatus = (typeof GRN_STATUSES)[number];

/** Statuses in which the GRN's stock has actually been taken in. */
export const RECEIVED_STATUSES: readonly GrnStatus[] = ['Received'];

const grnSchema = createTradeDocumentSchema({
  statuses: GRN_STATUSES,
  defaultStatus: 'Draft',
  party: SUPPLIER_PARTY,
  extraFields: {
    /** The order being received against. Null for an unordered delivery. */
    purchaseOrderId: { type: Schema.Types.ObjectId, ref: 'PurchaseOrder', default: null },
    purchaseOrderNumber: { type: String, trim: true, default: null },

    /** Where the goods landed. Resolved at receipt and pinned to the lines. */
    warehouseId: { type: Schema.Types.ObjectId, ref: 'Warehouse', default: null },

    /** The supplier's own delivery-note number, for their paperwork. */
    supplierDocumentNumber: { type: String, trim: true, default: null },
    vehicleNumber: { type: String, trim: true, default: null },

    receivedAt: { type: Date, default: null },

    /** Set once a purchase invoice has been raised against this receipt. */
    purchaseInvoiceId: { type: Schema.Types.ObjectId, ref: 'PurchaseInvoice', default: null },
  },
});

export type GoodsReceiptNote = InferSchemaType<typeof grnSchema>;
export const GoodsReceiptNoteModel = model('GoodsReceiptNote', grnSchema);
