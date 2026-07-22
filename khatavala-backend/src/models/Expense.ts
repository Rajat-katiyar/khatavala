import { Schema, model, InferSchemaType } from 'mongoose';
import { PAYMENT_MODES } from '../services/payment.factory.js';

/**
 * EXPENSE — a business spend posted to the general ledger.
 *
 * JOURNAL POSTING (always informs the books):
 *   Dr  [Category Account]   amount     (expense incurred)
 *     Cr Cash / Bank           amount   (money paid out)
 *
 * A draft expense sits here without a journal; posting it creates the entry and
 * sets journalEntryId. The same append-only discipline applies: a wrong expense
 * is deleted and a correcting one created, never silently edited after posting.
 *
 * RECURRING:
 * When `isRecurring` is true the BullMQ recurring job reads `nextDueDate`.
 * When it fires it creates a new Expense (Draft → auto-post) and advances
 * `nextDueDate` by `recurrenceFrequency`.
 */

export const RECURRENCE_FREQUENCIES = ['daily', 'weekly', 'monthly', 'yearly'] as const;
export type RecurrenceFrequency = (typeof RECURRENCE_FREQUENCIES)[number];

const expenseSchema = new Schema(
  {
    companyId: {
      type: Schema.Types.ObjectId,
      ref: 'Company',
      required: true,
      index: true,
    },

    /** Human serial — EXP-2025-26-0001. */
    documentNumber: { type: String, required: true, trim: true },

    categoryId: { type: Schema.Types.ObjectId, ref: 'ExpenseCategory', required: true },
    /** Snapshotted so the expense is readable after a category rename. */
    categoryName: { type: String, required: true, trim: true },
    /**
     * Snapshotted COA account id at posting time, so the journal line is
     * traceable even if the category's accountId is later changed.
     */
    accountId: { type: Schema.Types.ObjectId, ref: 'Account', default: null },

    amount: { type: Number, required: true, min: 0 },
    date: { type: Date, required: true, default: () => new Date() },

    paymentMode: { type: String, enum: PAYMENT_MODES, required: true },

    description: { type: String, trim: true, default: '' },
    referenceNumber: { type: String, trim: true, default: null },

    /** Links to the auto-generated JournalEntry after posting. */
    journalEntryId: { type: Schema.Types.ObjectId, ref: 'JournalEntry', default: null },
    status: { type: String, enum: ['Draft', 'Posted'], default: 'Draft' },

    /* ---- Recurring ---- */
    isRecurring: { type: Boolean, default: false },
    recurrenceFrequency: {
      type: String,
      enum: RECURRENCE_FREQUENCIES,
      default: null,
    },
    nextDueDate: { type: Date, default: null },
    /** The original template expense this was generated from. */
    parentExpenseId: { type: Schema.Types.ObjectId, ref: 'Expense', default: null },

    createdBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
  },
  { timestamps: true }
);

expenseSchema.index({ companyId: 1, documentNumber: 1 }, { unique: true });
expenseSchema.index({ companyId: 1, date: -1, _id: -1 });
expenseSchema.index({ companyId: 1, categoryId: 1 });
// Recurring scheduler query: all active recurring expenses with overdue nextDueDate.
expenseSchema.index({ isRecurring: 1, nextDueDate: 1, status: 1 });

expenseSchema.set('toJSON', {
  transform: (_doc, ret: Record<string, unknown>) => {
    delete ret.__v;
    return ret;
  },
});

export type Expense = InferSchemaType<typeof expenseSchema>;
export const ExpenseModel = model('Expense', expenseSchema);
