import { Schema, model, InferSchemaType } from 'mongoose';
import { PAYMENT_MODES } from '../services/payment.factory.js';

/**
 * Money paid OUT to a supplier against their bill.
 *
 * A separate collection from the sales-side `Payment` rather than one table
 * with a direction flag. Two reasons, both practical: every report is asked
 * one-sided ("what did we receive today", "what did we pay this week"), and the
 * two sides diverge as soon as payables grow up — a supplier payment wants
 * cheque clearing dates and TDS deducted, neither of which means anything on a
 * customer receipt. A shared table would carry both sets of nulls.
 *
 * The MECHANICS are shared, though: see payment.factory.ts. Only the
 * collections and the ledger direction differ.
 */

const supplierPaymentSchema = new Schema(
  {
    companyId: {
      type: Schema.Types.ObjectId,
      ref: 'Company',
      required: true,
      index: true,
    },

    /** Human-facing serial, e.g. SPAY-2026-27-0042. */
    documentNumber: { type: String, required: true, trim: true },

    purchaseInvoiceId: {
      type: Schema.Types.ObjectId,
      ref: 'PurchaseInvoice',
      required: true,
      index: true,
    },
    supplierId: {
      type: Schema.Types.ObjectId,
      ref: 'Supplier',
      required: true,
      index: true,
    },

    amount: { type: Number, required: true, min: 0 },
    mode: { type: String, enum: PAYMENT_MODES, required: true },
    date: { type: Date, required: true, default: () => new Date() },

    /** UTR, cheque number, card auth — whatever reconciles it to the bank. */
    referenceNumber: { type: String, trim: true, default: null },
    notes: { type: String, trim: true, default: null },

    /**
     * True when money came BACK from the supplier — a refund against a debit
     * note. Stored as a flag on a positive amount, not a negative amount, so
     * "total paid by mode" does not silently net refunds away.
     */
    isReversal: { type: Boolean, default: false },
    debitNoteId: { type: Schema.Types.ObjectId, ref: 'DebitNote', default: null },

    /** Named `receivedBy` to match the shared engine's field. */
    receivedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
  },
  { timestamps: true }
);

supplierPaymentSchema.index({ companyId: 1, documentNumber: 1 }, { unique: true });
supplierPaymentSchema.index({ companyId: 1, purchaseInvoiceId: 1, date: 1, _id: 1 });
supplierPaymentSchema.index({ companyId: 1, date: -1, mode: 1 });

export type SupplierPayment = InferSchemaType<typeof supplierPaymentSchema>;
export const SupplierPaymentModel = model('SupplierPayment', supplierPaymentSchema);
