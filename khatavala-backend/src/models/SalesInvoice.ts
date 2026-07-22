import { Schema, model, InferSchemaType } from 'mongoose';
import { createSalesDocumentSchema } from './tradeDocument.js';

/**
 * The invoice — the only document in this module with side effects.
 *
 * Confirming one deducts stock and posts to the customer ledger, both inside a
 * single transaction. See sales.service.ts.
 *
 * REGISTERED AS 'Invoice', STORED IN `salesinvoices`
 * --------------------------------------------------
 * The model name is 'Invoice' because Phase 5 fixed that string into
 * `CustomerLedgerEntry.referenceModel`'s enum and its `refPath`. Mongoose
 * resolves a refPath by MODEL name, so naming this 'SalesInvoice' would make
 * `.populate('referenceId')` on a customer statement fail to resolve every
 * invoice row — silently, returning null rather than throwing. The collection
 * name is pinned explicitly so it still reads as `salesinvoices` in the
 * database rather than mongoose's pluralisation of the model name.
 */

export const INVOICE_STATUSES = [
  'Draft',
  /** Confirmed and unpaid — stock moved, ledger posted, nothing received. */
  'Unpaid',
  'PartiallyPaid',
  'Paid',
  'Cancelled',
] as const;
export type InvoiceStatus = (typeof INVOICE_STATUSES)[number];

/** Statuses in which the invoice has been posted to stock and the ledger. */
export const POSTED_STATUSES: readonly InvoiceStatus[] = [
  'Unpaid',
  'PartiallyPaid',
  'Paid',
];

const salesInvoiceSchema = createSalesDocumentSchema({
  statuses: INVOICE_STATUSES,
  defaultStatus: 'Draft',
  extraFields: {
    /**
     * Total received against this invoice. A DERIVED roll-up of the Payment
     * collection — payment.service is the only writer, and it moves this in the
     * same transaction that inserts the Payment row. Kept here rather than
     * summed on read because every invoice list shows a balance.
     *
     * `amountDue` is deliberately NOT stored: it is exactly
     * `grandTotal - amountPaid`, with no historical meaning of its own, so
     * storing it would just be a second number to keep in step. Contrast the
     * totals, which ARE stored because they must not move.
     */
    amountPaid: { type: Number, default: 0, min: 0 },

    /**
     * Value returned across all SalesReturn documents against this invoice.
     * Like `amountPaid`, a roll-up with a single writer — salesReturn.service —
     * and the guard that stops a customer returning more than they bought.
     */
    returnedAmount: { type: Number, default: 0, min: 0 },

    /**
     * Set when the goods left on a delivery challan that ALREADY deducted the
     * stock. Confirming such an invoice posts the ledger but skips the stock
     * step — otherwise the same goods leave the warehouse twice. See
     * sales.service.postInvoice and models/DeliveryChallan.ts.
     */
    deliveredByChallanId: {
      type: Schema.Types.ObjectId,
      ref: 'DeliveryChallan',
      default: null,
    },

    /** How this invoice was raised. POS sales are the counter, not the office. */
    channel: { type: String, enum: ['Standard', 'POS'], default: 'Standard' },

    /** When the confirming transaction committed. Null while Draft. */
    postedAt: { type: Date, default: null },

    /** Set when a Cancelled invoice's stock and ledger have been reversed. */
    reversedAt: { type: Date, default: null },
  },
});

export type SalesInvoice = InferSchemaType<typeof salesInvoiceSchema>;
export const SalesInvoiceModel = model('Invoice', salesInvoiceSchema, 'salesinvoices');
