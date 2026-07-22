import { Schema, model, InferSchemaType } from 'mongoose';

/**
 * BANK ACCOUNT — master record for a company's bank account.
 *
 * Separate from the 'BANK' system account in the COA: the system account
 * aggregates all banks in the trial balance; this document holds the
 * institution detail (IFSC, account number) and tracks the reconciled balance.
 *
 * `currentBalance` is maintained in the service layer as transactions are
 * recorded and reconciled. It starts at `openingBalance`.
 */

const bankAccountSchema = new Schema(
  {
    companyId: {
      type: Schema.Types.ObjectId,
      ref: 'Company',
      required: true,
      index: true,
    },

    accountName: { type: String, required: true, trim: true },
    bankName: { type: String, required: true, trim: true },
    accountNumber: { type: String, required: true, trim: true },
    ifscCode: { type: String, trim: true, uppercase: true, default: null },
    branchName: { type: String, trim: true, default: null },

    openingBalance: { type: Number, default: 0 },
    currentBalance: { type: Number, default: 0 },
    currency: { type: String, default: 'INR', trim: true },

    /**
     * The COA account (Asset type) that journal entries for transactions in
     * this bank account should debit/credit. If null, the service falls back
     * to the BANK system account.
     */
    accountId: { type: Schema.Types.ObjectId, ref: 'Account', default: null },

    isActive: { type: Boolean, default: true },
    notes: { type: String, trim: true, default: null },
  },
  { timestamps: true }
);

bankAccountSchema.index({ companyId: 1, accountName: 1 }, { unique: true });

bankAccountSchema.set('toJSON', {
  transform: (_doc, ret: Record<string, unknown>) => {
    delete ret.__v;
    return ret;
  },
});

export type BankAccount = InferSchemaType<typeof bankAccountSchema>;
export const BankAccountModel = model('BankAccount', bankAccountSchema);
