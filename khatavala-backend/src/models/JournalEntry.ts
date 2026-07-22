import { Schema, model, InferSchemaType } from 'mongoose';

/**
 * JOURNAL ENTRY — the only place money is recorded in double-entry form.
 *
 * Append-only, like every other ledger in this system. A wrong entry is
 * corrected by posting its reverse, never by editing it: `runningBalance` in
 * every account ledger is derived by summing entries in order, and an entry you
 * can quietly change is not a book of account.
 *
 * THE INVARIANT: sum(debitAmount) === sum(creditAmount), on every entry,
 * always. It is enforced in journal.service BEFORE the write — see the note
 * there on why the check lives in the service and not only here.
 *
 * `source` is what makes the books auditable in both directions: from an
 * invoice you can find the entry it produced, and from an entry you can find
 * the document that caused it. A journal nobody can trace back to a document is
 * a set of numbers, not a record.
 */

export const JOURNAL_SOURCE_TYPES = [
  'SalesInvoice',
  'PurchaseInvoice',
  'CustomerReceipt',
  'SupplierPayment',
  'CreditNote',
  'DebitNote',
  /** A user-entered journal. */
  'Manual',
  /** Cash ↔ bank movement. */
  'Contra',
  /** The reversal of another entry. */
  'Reversal',
  /** Phase 15 — business expense. */
  'Expense',
  /** Phase 15 — bank transaction record. */
  'BankTransaction',
] as const;
export type JournalSourceType = (typeof JOURNAL_SOURCE_TYPES)[number];

/**
 * One side of an entry.
 *
 * Both columns are stored rather than one signed amount, because that is how a
 * journal is read, printed and reconciled — and because "exactly one of the two
 * is non-zero" is a rule worth being able to state and check. The service
 * rejects a line with both or neither.
 */
const journalLineSchema = new Schema(
  {
    accountId: { type: Schema.Types.ObjectId, ref: 'Account', required: true },
    /** Snapshotted so a renamed account does not rewrite an old entry. */
    accountName: { type: String, required: true, trim: true },

    debitAmount: { type: Number, default: 0, min: 0 },
    creditAmount: { type: Number, default: 0, min: 0 },

    description: { type: String, trim: true, default: null },
  },
  { _id: true }
);

const journalEntrySchema = new Schema(
  {
    companyId: {
      type: Schema.Types.ObjectId,
      ref: 'Company',
      required: true,
      index: true,
    },

    /** Human-facing serial, e.g. JV-2026-27-0042. */
    documentNumber: { type: String, required: true, trim: true },

    date: { type: Date, required: true, default: () => new Date() },
    narration: { type: String, trim: true, default: null },

    lines: {
      type: [journalLineSchema],
      validate: {
        // A single-line journal cannot balance, by definition.
        validator: (lines: unknown[]) => lines.length >= 2,
        message: 'A journal entry needs at least two lines',
      },
    },

    /**
     * Stored, not derived. They are checked against the lines before every
     * write, so persisting them costs nothing and lets a trial balance sum
     * entries without unwinding the arrays.
     */
    totalDebit: { type: Number, required: true },
    totalCredit: { type: Number, required: true },

    sourceType: { type: String, enum: JOURNAL_SOURCE_TYPES, required: true },
    /** The document that caused it. Null for a manual journal. */
    sourceId: { type: Schema.Types.ObjectId, default: null },
    sourceNumber: { type: String, trim: true, default: null },

    /** Set on a reversal, pointing at the entry it undoes. */
    reversesEntryId: { type: Schema.Types.ObjectId, ref: 'JournalEntry', default: null },
    /** Set on an entry that has BEEN reversed, so the UI can mark it. */
    reversedByEntryId: { type: Schema.Types.ObjectId, ref: 'JournalEntry', default: null },

    createdBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
  },
  { timestamps: true }
);

journalEntrySchema.index({ companyId: 1, documentNumber: 1 }, { unique: true });

// The day book: newest first. `_id` breaks ties so entries posted in the same
// millisecond page deterministically.
journalEntrySchema.index({ companyId: 1, date: -1, _id: -1 });

/**
 * THE account-ledger query: every line touching one account, in date order.
 * Multikey on the embedded lines, so `$match` on `lines.accountId` is an index
 * seek rather than a scan of every entry the company has ever posted.
 */
journalEntrySchema.index({ companyId: 1, 'lines.accountId': 1, date: 1, _id: 1 });

// Tracing an entry back to its document, and finding the entry a document made.
journalEntrySchema.index({ companyId: 1, sourceType: 1, sourceId: 1 });

export type JournalEntry = InferSchemaType<typeof journalEntrySchema>;
export const JournalEntryModel = model('JournalEntry', journalEntrySchema);
