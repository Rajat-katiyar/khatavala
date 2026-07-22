import { Schema, model, InferSchemaType } from 'mongoose';

/**
 * Money actually received against an invoice.
 *
 * Phase 9 kept `amountPaid` on the invoice and posted a ledger credit, with no
 * document behind it — deliberately, as a placeholder. THIS is that document,
 * and it is now the only thing that may move `amountPaid`.
 *
 * WHY A COLLECTION AND NOT JUST A NUMBER ON THE INVOICE
 * ----------------------------------------------------
 * `amountPaid: 4000` cannot answer any of the questions a shop actually asks:
 * how much came in as cash today, which UPI reference matches this bank line,
 * who took the payment, was it one payment or four. A running total is a
 * summary of a history that has to exist somewhere, so it exists here and the
 * total is derived from it.
 *
 * APPEND-ONLY, like the ledgers. A wrong payment is reversed with a refund
 * (`isReversal`), never edited away — the same discipline as
 * CustomerLedgerEntry, and for the same reason: `amountPaid` on the invoice and
 * the credit in the customer ledger were both computed from these rows.
 */

export const PAYMENT_MODES = ['Cash', 'UPI', 'Card', 'Bank', 'Cheque'] as const;
export type PaymentMode = (typeof PAYMENT_MODES)[number];

const paymentSchema = new Schema(
  {
    companyId: {
      type: Schema.Types.ObjectId,
      ref: 'Company',
      required: true,
      index: true,
    },

    /** Human-facing serial, e.g. PAY-2026-27-0042. */
    documentNumber: { type: String, required: true, trim: true },

    /**
     * The invoice this settles. Required: this phase only supports payment
     * AGAINST an invoice. A customer advance with no invoice yet, and one
     * payment split across several invoices, both need an allocation table
     * rather than a single id — that is the Payments phase proper, and forcing
     * either through this field would misreport both.
     */
    invoiceId: { type: Schema.Types.ObjectId, ref: 'Invoice', required: true, index: true },
    customerId: {
      type: Schema.Types.ObjectId,
      ref: 'Customer',
      required: true,
      index: true,
    },

    amount: { type: Number, required: true, min: 0 },
    mode: { type: String, enum: PAYMENT_MODES, required: true },
    date: { type: Date, required: true, default: () => new Date() },

    /** UPI txn id, cheque number, card auth code — whatever reconciles it. */
    referenceNumber: { type: String, trim: true, default: null },

    notes: { type: String, trim: true, default: null },

    /**
     * True when this row REFUNDS money rather than receiving it — a cancelled
     * payment, or the cash handed back on a return. Stored as a flag on a
     * positive amount rather than as a negative amount, so that "total received
     * by mode" reports do not silently net refunds away and understate the
     * till.
     */
    isReversal: { type: Boolean, default: false },

    /** Set when this payment was created by a return rather than a receipt. */
    salesReturnId: { type: Schema.Types.ObjectId, ref: 'SalesReturn', default: null },

    receivedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
  },
  { timestamps: true }
);

paymentSchema.index({ companyId: 1, documentNumber: 1 }, { unique: true });

// The payment history on an invoice: oldest first, which is how a statement
// reads. `_id` breaks ties so two payments taken in the same second do not
// swap order between requests.
paymentSchema.index({ companyId: 1, invoiceId: 1, date: 1, _id: 1 });

// "What came in today, by mode" — the cash-up report at close of business.
paymentSchema.index({ companyId: 1, date: -1, mode: 1 });

export type Payment = InferSchemaType<typeof paymentSchema>;
export const PaymentModel = model('Payment', paymentSchema);
