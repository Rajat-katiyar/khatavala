import { Schema, model, InferSchemaType } from 'mongoose';

/**
 * Append-only statement of account for a customer.
 *
 * Design notes for the phases that will write into this collection (Sales,
 * Payments, Credit Notes):
 *
 *  - Entries are APPEND-ONLY. Reversing a mistake means writing a contra entry,
 *    never mutating or deleting a row — `runningBalance` on every later row
 *    would otherwise be wrong, and a ledger you can silently edit is not a
 *    ledger. The service layer exposes no update/delete for this reason.
 *
 *  - `debit` increases what the customer owes (invoices, debit notes).
 *    `credit` decreases it (payments received, credit notes).
 *    Exactly one of the two is non-zero on any entry; both are stored rather
 *    than one signed `amount` because statements print them as two columns and
 *    accountants reconcile them as two columns.
 *
 *  - `runningBalance` is the customer's balance AFTER this entry. Denormalised
 *    deliberately: a statement must show the balance as it stood on each line,
 *    and recomputing that by summing all prior rows on every render is O(n) per
 *    row. It is only correct if entries are appended in date order — which is
 *    why appendEntry serialises on the customer.
 *
 *  - `referenceId` + `referenceModel` are a polymorphic pointer back to the
 *    document that caused the entry (an Invoice, a Payment, …). Stored as a
 *    refPath so `.populate('referenceId')` resolves to the right collection
 *    once those models exist.
 */

export const LEDGER_ENTRY_TYPES = ['Invoice', 'Payment', 'CreditNote', 'Opening'] as const;
export type LedgerEntryType = (typeof LEDGER_ENTRY_TYPES)[number];

// Collections a ledger entry may point at. `Customer` is here for the opening
// balance entry, which references the customer itself for want of a document.
export const LEDGER_REFERENCE_MODELS = ['Invoice', 'Payment', 'CreditNote', 'Customer'] as const;

const ledgerEntrySchema = new Schema(
  {
    companyId: {
      type: Schema.Types.ObjectId,
      ref: 'Company',
      required: true,
      index: true,
    },
    customerId: {
      type: Schema.Types.ObjectId,
      ref: 'Customer',
      required: true,
      index: true,
    },
    date: { type: Date, required: true, default: () => new Date() },
    type: { type: String, enum: LEDGER_ENTRY_TYPES, required: true },
    debit: { type: Number, default: 0, min: 0 },
    credit: { type: Number, default: 0, min: 0 },
    runningBalance: { type: Number, required: true },

    referenceModel: { type: String, enum: LEDGER_REFERENCE_MODELS, required: true },
    referenceId: {
      type: Schema.Types.ObjectId,
      required: true,
      refPath: 'referenceModel',
    },

    narration: { type: String, trim: true },
  },
  { timestamps: true }
);

// The statement query: one customer's entries, oldest first. `_id` breaks ties
// so that same-day entries page deterministically — without it, two entries
// dated 2026-07-18 could swap order between requests and the running balance
// column would appear to jump around.
ledgerEntrySchema.index({ companyId: 1, customerId: 1, date: 1, _id: 1 });

export type CustomerLedgerEntry = InferSchemaType<typeof ledgerEntrySchema>;
export const CustomerLedgerEntryModel = model('CustomerLedgerEntry', ledgerEntrySchema);
