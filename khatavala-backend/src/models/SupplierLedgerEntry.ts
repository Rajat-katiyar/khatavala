import { Schema, model, InferSchemaType } from 'mongoose';

/**
 * Append-only statement of account for a supplier.
 *
 * The customer ledger's design notes apply here unchanged — append-only, both
 * columns stored rather than one signed amount, denormalised `runningBalance`,
 * polymorphic `referenceId`/`referenceModel` via refPath — with ONE inversion
 * that matters:
 *
 *   `credit` INCREASES what we owe (purchase invoices).
 *   `debit`  DECREASES it (payments we make, debit notes we raise).
 *
 * This is not a mirror-image typo of the customer ledger. A supplier is a
 * creditor in double-entry terms, so their account carries a credit balance
 * when money is owed. Booking a purchase bill as a debit — the way it would
 * look if this file were copy-pasted from the customer side — would invert the
 * payables report and misstate the books.
 */

export const SUPPLIER_LEDGER_ENTRY_TYPES = [
  'PurchaseInvoice',
  'Payment',
  'DebitNote',
  'Opening',
] as const;
export type SupplierLedgerEntryType = (typeof SUPPLIER_LEDGER_ENTRY_TYPES)[number];

// Collections a ledger entry may point at. `Supplier` is here for the opening
// balance entry, which references the supplier itself for want of a document.
export const SUPPLIER_LEDGER_REFERENCE_MODELS = [
  'PurchaseInvoice',
  'Payment',
  // Phase 11: supplier payments live in their own collection, so the refPath
  // needs its model name to resolve. 'Payment' above is left in place — Phase 6
  // entries were written with it and a ledger is append-only.
  'SupplierPayment',
  'DebitNote',
  'Supplier',
] as const;

const ledgerEntrySchema = new Schema(
  {
    companyId: {
      type: Schema.Types.ObjectId,
      ref: 'Company',
      required: true,
      index: true,
    },
    supplierId: {
      type: Schema.Types.ObjectId,
      ref: 'Supplier',
      required: true,
      index: true,
    },
    date: { type: Date, required: true, default: () => new Date() },
    type: { type: String, enum: SUPPLIER_LEDGER_ENTRY_TYPES, required: true },
    /** Reduces the payable — a payment made, or a debit note. */
    debit: { type: Number, default: 0, min: 0 },
    /** Increases the payable — a purchase bill. */
    credit: { type: Number, default: 0, min: 0 },
    runningBalance: { type: Number, required: true },

    referenceModel: {
      type: String,
      enum: SUPPLIER_LEDGER_REFERENCE_MODELS,
      required: true,
    },
    referenceId: {
      type: Schema.Types.ObjectId,
      required: true,
      refPath: 'referenceModel',
    },

    narration: { type: String, trim: true },

    /**
     * When this bill falls due. Set by the Purchases module on invoice entries
     * and left null on everything else — it is what the Payment Reminders tab
     * reads to decide what is overdue, so it lives on the entry that carries
     * the obligation rather than on the supplier.
     */
    dueDate: { type: Date, default: null },
  },
  { timestamps: true }
);

// The statement query: one supplier's entries, oldest first. `_id` breaks ties
// so that same-day entries page deterministically.
ledgerEntrySchema.index({ companyId: 1, supplierId: 1, date: 1, _id: 1 });

// Backs the payment-reminders query: unsettled bills by due date.
ledgerEntrySchema.index({ companyId: 1, dueDate: 1 });

export type SupplierLedgerEntry = InferSchemaType<typeof ledgerEntrySchema>;
export const SupplierLedgerEntryModel = model('SupplierLedgerEntry', ledgerEntrySchema);
