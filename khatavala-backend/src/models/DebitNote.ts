import { Schema, model, InferSchemaType } from 'mongoose';
import { createTradeDocumentSchema, SUPPLIER_PARTY } from './tradeDocument.js';

/**
 * PURCHASE RETURN / DEBIT NOTE — goods going back to the supplier.
 *
 * The exact mirror of the sales-side CreditNote, with both directions flipped:
 *
 *   Sales return:    stock IN,  customer CREDITED (we owe them).
 *   Purchase return: stock OUT, supplier DEBITED  (they owe us).
 *
 * Unlike the sales side this is ONE document rather than two. The split there
 * exists because a credit note is routinely issued with no goods behind it — a
 * post-sale discount, an overcharge. On the buying side the goods-and-money
 * event is almost always the same event, and a purely financial debit note (a
 * rate correction from a supplier) is expressible here by returning zero
 * quantity with a value, so a second collection would earn nothing.
 *
 * Registered as 'DebitNote' because Phase 6 fixed that string into
 * SupplierLedgerEntry's `referenceModel` enum.
 */

export const DEBIT_NOTE_STATUSES = ['Draft', 'Issued', 'Cancelled'] as const;
export type DebitNoteStatus = (typeof DEBIT_NOTE_STATUSES)[number];

/** Why the goods went back. Reported on, so an enum rather than free text. */
export const PURCHASE_RETURN_REASONS = [
  'Damaged',
  'Expired',
  'WrongItem',
  'ShortSupply',
  'QualityIssue',
  'RateDifference',
  'Other',
] as const;
export type PurchaseReturnReason = (typeof PURCHASE_RETURN_REASONS)[number];

const debitNoteSchema = createTradeDocumentSchema({
  statuses: DEBIT_NOTE_STATUSES,
  defaultStatus: 'Issued',
  party: SUPPLIER_PARTY,
  extraFields: {
    /** The bill being debited against. */
    purchaseInvoiceId: {
      type: Schema.Types.ObjectId,
      ref: 'PurchaseInvoice',
      required: true,
      index: true,
    },
    purchaseInvoiceNumber: { type: String, trim: true, required: true },

    reason: { type: String, enum: PURCHASE_RETURN_REASONS, required: true },
    reasonNotes: { type: String, trim: true, default: null },

    /** Where the goods leave from. */
    warehouseId: { type: Schema.Types.ObjectId, ref: 'Warehouse', default: null },

    /**
     * False for a purely financial debit note — a rate correction, where no
     * goods move. The supplier is still debited.
     */
    returnsStock: { type: Boolean, default: true },

    /** Cash actually received back from the supplier, if any. */
    refundedAmount: { type: Number, default: 0, min: 0 },

    postedAt: { type: Date, default: null },
  },
});

export type DebitNote = InferSchemaType<typeof debitNoteSchema>;
export const DebitNoteModel = model('DebitNote', debitNoteSchema);
