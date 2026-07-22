import { Schema, model, InferSchemaType } from 'mongoose';

/**
 * BANK TRANSACTION — one debit or credit movement in a bank account.
 *
 * These are the system-side records that get reconciled against the bank's
 * own statement. A cheque written for a supplier payment, a NEFT received
 * from a customer, or a direct bank charge are all BankTransactions.
 *
 * STATUS LIFECYCLE:
 *   Pending  → recorded in the system, not yet confirmed by the bank statement
 *   Cleared  → matched to a bank statement entry (reconciled)
 *   Bounced  → cheque returned / NEFT rejected
 *
 * `statementEntryId` is set when the transaction is reconciled to a specific
 * imported statement row — the link in the other direction.
 */

export const TRANSACTION_MODES = [
  'NEFT',
  'RTGS',
  'IMPS',
  'UPI',
  'Cheque',
  'Cash',
  'DD',
  'DirectDebit',
  'Interest',
  'Charges',
  'Other',
] as const;
export type TransactionMode = (typeof TRANSACTION_MODES)[number];

export const TRANSACTION_STATUSES = ['Pending', 'Cleared', 'Bounced'] as const;
export type TransactionStatus = (typeof TRANSACTION_STATUSES)[number];

const bankTransactionSchema = new Schema(
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

    transactionDate: { type: Date, required: true },
    valueDate: { type: Date, default: null },

    /**
     * Always positive. `type` tells which direction:
     *   Credit — money coming in to the account
     *   Debit  — money going out
     */
    amount: { type: Number, required: true, min: 0 },
    type: { type: String, enum: ['Credit', 'Debit'], required: true },

    mode: { type: String, enum: TRANSACTION_MODES, required: true },
    referenceNumber: { type: String, trim: true, default: null },
    chequeNumber: { type: String, trim: true, default: null },
    description: { type: String, trim: true, default: '' },

    status: {
      type: String,
      enum: TRANSACTION_STATUSES,
      default: 'Pending',
    },

    /** Set when reconciled to a specific imported statement row. */
    statementEntryId: { type: Schema.Types.ObjectId, default: null },
    reconciledAt: { type: Date, default: null },

    /** Optional: the journal entry this transaction generated/links to. */
    journalEntryId: { type: Schema.Types.ObjectId, ref: 'JournalEntry', default: null },

    createdBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
  },
  { timestamps: true }
);

bankTransactionSchema.index({ companyId: 1, bankAccountId: 1, transactionDate: -1 });
bankTransactionSchema.index({ companyId: 1, status: 1 });

bankTransactionSchema.set('toJSON', {
  transform: (_doc, ret: Record<string, unknown>) => {
    delete ret.__v;
    return ret;
  },
});

export type BankTransaction = InferSchemaType<typeof bankTransactionSchema>;
export const BankTransactionModel = model('BankTransaction', bankTransactionSchema);
