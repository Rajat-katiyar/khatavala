import { Schema, model, InferSchemaType } from 'mongoose';
import { createSalesDocumentSchema } from './tradeDocument.js';

/**
 * The financial side of a return — what the customer is owed.
 *
 * WHY THIS IS SEPARATE FROM SalesReturn
 * ------------------------------------
 * They answer different questions and do not always correspond one-to-one. A
 * return is a GOODS event ("three boxes came back"); a credit note is a MONEY
 * event ("we owe you ₹855"). A credit note can be issued with no goods at all —
 * a post-sale discount, an overcharge, a rate correction — and GST treats it as
 * a document in its own right with its own series, which must be reported
 * whether or not stock moved.
 *
 * Merging the two would mean either a return that cannot be issued without
 * goods, or a goods return whose value cannot differ from the invoice line —
 * and both happen in practice.
 *
 * `referenceModel: 'CreditNote'` is already in CustomerLedgerEntry's enum from
 * Phase 5, so the ledger has been ready for this since the customer module.
 */

export const CREDIT_NOTE_STATUSES = ['Draft', 'Issued', 'Cancelled'] as const;
export type CreditNoteStatus = (typeof CREDIT_NOTE_STATUSES)[number];

const creditNoteSchema = createSalesDocumentSchema({
  statuses: CREDIT_NOTE_STATUSES,
  defaultStatus: 'Issued',
  extraFields: {
    /** The invoice being credited. */
    invoiceId: {
      type: Schema.Types.ObjectId,
      ref: 'Invoice',
      required: true,
      index: true,
    },
    invoiceNumber: { type: String, trim: true, required: true },

    /** The goods return behind it, when there is one. Null for a pure credit. */
    salesReturnId: { type: Schema.Types.ObjectId, ref: 'SalesReturn', default: null },

    reason: { type: String, trim: true, default: null },

    /** When the ledger credit was posted. */
    postedAt: { type: Date, default: null },
  },
});

export type CreditNote = InferSchemaType<typeof creditNoteSchema>;
export const CreditNoteModel = model('CreditNote', creditNoteSchema);
