import { Schema, model, InferSchemaType } from 'mongoose';

/**
 * CHART OF ACCOUNTS — the spine of double-entry.
 *
 * Every journal line points at one of these. The hierarchy (`parentAccountId`)
 * exists so a trial balance can be read at any depth: "Bank" as one figure, or
 * broken out per bank account, without changing how anything posts.
 *
 * ACCOUNT TYPE DETERMINES WHICH SIDE INCREASES THE BALANCE, and that is not a
 * cosmetic label — it is the arithmetic:
 *
 *   Asset, Expense     → DEBIT increases (normal balance: debit)
 *   Liability, Equity, Income → CREDIT increases (normal balance: credit)
 *
 * Cash going up is a debit; money owed to a supplier going up is a credit. Get
 * this wrong and every report inverts, so `normalBalanceOf` below is the single
 * place it is decided and everything else asks it.
 */

export const ACCOUNT_TYPES = [
  'Asset',
  'Liability',
  'Equity',
  'Income',
  'Expense',
] as const;
export type AccountType = (typeof ACCOUNT_TYPES)[number];

/** Which side increases this type. See the header. */
export function normalBalanceOf(type: AccountType): 'debit' | 'credit' {
  return type === 'Asset' || type === 'Expense' ? 'debit' : 'credit';
}

/**
 * Accounts the POSTING SERVICE needs to find by role rather than by name.
 *
 * A user may rename "Sales" to "Revenue from Operations" or add fifty child
 * accounts; the automatic postings still have to know where a sales invoice's
 * income goes. So the machine-facing identity is this key, and `accountName` is
 * free for humans to change.
 */
export const SYSTEM_ACCOUNT_KEYS = [
  'CASH',
  'BANK',
  'ACCOUNTS_RECEIVABLE',
  'ACCOUNTS_PAYABLE',
  'SALES',
  'SALES_RETURN',
  'PURCHASE',
  'PURCHASE_RETURN',
  'GST_OUTPUT',
  'GST_INPUT',
  'ROUND_OFF',
  'OPENING_BALANCE_EQUITY',
] as const;
export type SystemAccountKey = (typeof SYSTEM_ACCOUNT_KEYS)[number];

const accountSchema = new Schema(
  {
    companyId: {
      type: Schema.Types.ObjectId,
      ref: 'Company',
      required: true,
      index: true,
    },

    accountName: { type: String, required: true, trim: true },
    accountType: { type: String, enum: ACCOUNT_TYPES, required: true },

    /** Optional user-facing code, e.g. '1100'. Not used for lookup. */
    code: { type: String, trim: true, default: null },

    parentAccountId: { type: Schema.Types.ObjectId, ref: 'Account', default: null },

    /**
     * Set only on the accounts the posting service resolves by role. Null on
     * anything a user creates.
     */
    systemKey: { type: String, enum: SYSTEM_ACCOUNT_KEYS, default: null },

    /**
     * System accounts cannot be deleted or retyped — an invoice posted into
     * them last year still refers to them, and changing an account's TYPE would
     * silently flip the sign of every historic figure in it.
     */
    isSystem: { type: Boolean, default: false },

    description: { type: String, trim: true, default: null },
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true }
);

// Names are unique per company — two accounts called "Bank" make every report
// ambiguous and every dropdown a guess.
accountSchema.index({ companyId: 1, accountName: 1 }, { unique: true });

/**
 * One account per system role per company.
 *
 * `partialFilterExpression` rather than `sparse`: on a compound index a sparse
 * index only skips documents missing EVERY indexed field, and `companyId` is
 * always present — so every user-created account (systemKey: null) would be
 * indexed and they would all collide. Same trap as Product.barcode.
 */
accountSchema.index(
  { companyId: 1, systemKey: 1 },
  { unique: true, partialFilterExpression: { systemKey: { $type: 'string' } } }
);

accountSchema.index({ companyId: 1, accountType: 1 });
accountSchema.index({ companyId: 1, parentAccountId: 1 });

export type Account = InferSchemaType<typeof accountSchema>;
export const AccountModel = model('Account', accountSchema);
