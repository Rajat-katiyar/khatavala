import { Schema, model, InferSchemaType } from 'mongoose';

/**
 * EXPENSE CATEGORY — classifies an expense and links it to a ledger account.
 *
 * The `accountId` points at a Chart-of-Accounts account of type Expense.
 * When an expense is posted, the system debits that account and credits Cash
 * or Bank depending on the payment mode.
 *
 * Pre-seeded categories (Salary, Rent, Electricity, Fuel, Transport) are
 * created by the expense service the first time any expense is saved for a
 * company, following the same lazy-seed pattern as ensureDefaultAccounts.
 */

const expenseCategorySchema = new Schema(
  {
    companyId: {
      type: Schema.Types.ObjectId,
      ref: 'Company',
      required: true,
      index: true,
    },
    name: { type: String, required: true, trim: true },
    description: { type: String, trim: true, default: '' },
    /**
     * The COA account debited when an expense of this category is posted.
     * If null, the expense service creates an Expense-type account under
     * "Indirect Expenses" and links it here.
     */
    accountId: { type: Schema.Types.ObjectId, ref: 'Account', default: null },
    isActive: { type: Boolean, default: true },
    /** Pre-seeded categories carry a key so they survive renames. */
    systemKey: { type: String, trim: true, default: null },
  },
  { timestamps: true }
);

expenseCategorySchema.index({ companyId: 1, name: 1 }, { unique: true });
expenseCategorySchema.index(
  { companyId: 1, systemKey: 1 },
  { unique: true, partialFilterExpression: { systemKey: { $type: 'string' } } }
);

expenseCategorySchema.set('toJSON', {
  transform: (_doc, ret: Record<string, unknown>) => {
    delete ret.__v;
    return ret;
  },
});

export type ExpenseCategory = InferSchemaType<typeof expenseCategorySchema>;
export const ExpenseCategoryModel = model('ExpenseCategory', expenseCategorySchema);
