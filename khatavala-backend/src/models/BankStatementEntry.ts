import { Schema, model, InferSchemaType } from 'mongoose';

/**
 * BANK STATEMENT ENTRY — one row imported from a bank statement CSV/Excel.
 *
 * Rows are stored verbatim after import so:
 *   (a) the user can see what was imported without re-uploading
 *   (b) reconciliation queries can scan them in the DB rather than memory
 *   (c) an import can be "reset" by deleting unmatched rows
 *
 * `isMatched` and `matchedTransactionId` are set when the entry is
 * reconciled to a BankTransaction.
 */

const bankStatementEntrySchema = new Schema(
  {
    companyId: {
      type: Schema.Types.ObjectId,
      ref: 'Company',
      required: true,
      index: true,
    },
    bankAccountId: {
      type: Schema.Types.ObjectId,
      ref: 'BankAccount',
      required: true,
      index: true,
    },

    /** Which import batch this row came from (ISO timestamp string). */
    importBatch: { type: String, required: true },

    statementDate: { type: Date, required: true },
    description: { type: String, trim: true, default: '' },
    referenceNumber: { type: String, trim: true, default: null },

    /** Credit to the account (money received). 0 if debit row. */
    credit: { type: Number, default: 0 },
    /** Debit from the account (money sent). 0 if credit row. */
    debit: { type: Number, default: 0 },
    /** Running balance as reported by the bank. May be null if not in file. */
    balance: { type: Number, default: null },

    isMatched: { type: Boolean, default: false },
    matchedTransactionId: {
      type: Schema.Types.ObjectId,
      ref: 'BankTransaction',
      default: null,
    },
    matchedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

bankStatementEntrySchema.index({ companyId: 1, bankAccountId: 1, importBatch: 1 });
bankStatementEntrySchema.index({ companyId: 1, bankAccountId: 1, isMatched: 1 });

bankStatementEntrySchema.set('toJSON', {
  transform: (_doc, ret: Record<string, unknown>) => {
    delete ret.__v;
    return ret;
  },
});

export type BankStatementEntry = InferSchemaType<typeof bankStatementEntrySchema>;
export const BankStatementEntryModel = model('BankStatementEntry', bankStatementEntrySchema);
