import { Schema, model, InferSchemaType } from 'mongoose';
import { createSalesDocumentSchema } from './tradeDocument.js';

/**
 * Goods coming back from a customer.
 *
 * A return is NOT an edit of the original invoice. The invoice is a legal
 * record of what was sold on the day; what comes back is a second event with
 * its own date, its own quantities and its own reason. So this is a document in
 * its own right that REFERENCES the invoice, and the invoice itself is never
 * touched beyond a `returnedAmount` roll-up.
 *
 * PARTIAL BY DEFAULT. Customers return three of the ten they bought. The line
 * items here carry the RETURNED quantities, not the invoiced ones, and the
 * service refuses a quantity greater than what remains returnable on that line
 * across all previous returns against the same invoice.
 *
 * TWO SIDE EFFECTS, ONE TRANSACTION: stock comes back IN, and the customer is
 * credited via a CreditNote. See salesReturn.service.ts.
 */

export const RETURN_STATUSES = ['Draft', 'Completed', 'Cancelled'] as const;
export type ReturnStatus = (typeof RETURN_STATUSES)[number];

/** Why the goods came back. Reported on, so it is an enum, not free text. */
export const RETURN_REASONS = [
  'Damaged',
  'Expired',
  'WrongItem',
  'NotRequired',
  'QualityIssue',
  'Other',
] as const;
export type ReturnReason = (typeof RETURN_REASONS)[number];

const salesReturnSchema = createSalesDocumentSchema({
  statuses: RETURN_STATUSES,
  defaultStatus: 'Draft',
  extraFields: {
    /** The invoice being returned against. Required — see the header. */
    invoiceId: {
      type: Schema.Types.ObjectId,
      ref: 'Invoice',
      required: true,
      index: true,
    },
    invoiceNumber: { type: String, trim: true, required: true },

    reason: { type: String, enum: RETURN_REASONS, required: true },
    reasonNotes: { type: String, trim: true, default: null },

    /**
     * Where the goods go back to. Usually the warehouse they left from, but not
     * always — damaged stock often comes back to a quarantine location.
     */
    warehouseId: { type: Schema.Types.ObjectId, ref: 'Warehouse', default: null },

    /**
     * Damaged goods come back into the books as a return and are then written
     * off, rather than silently never returning. Two movements, both visible:
     * the customer's credit does not depend on whether the goods are resaleable.
     */
    restock: { type: Boolean, default: true },

    creditNoteId: { type: Schema.Types.ObjectId, ref: 'CreditNote', default: null },

    /**
     * Cash handed back at the counter, if any. The rest of the credit sits on
     * the customer's ledger against future purchases.
     */
    refundedAmount: { type: Number, default: 0, min: 0 },

    postedAt: { type: Date, default: null },
  },
});

export type SalesReturn = InferSchemaType<typeof salesReturnSchema>;
export const SalesReturnModel = model('SalesReturn', salesReturnSchema);
