import { model, InferSchemaType } from 'mongoose';
import { createSalesDocumentSchema } from './tradeDocument.js';

/**
 * A price offer. Moves no stock and touches no ledger — nothing has been sold
 * yet, and treating a quotation as a commitment is how shops end up with
 * negative stock and receivables for orders that were never placed.
 */

export const QUOTATION_STATUSES = [
  'Draft',
  'Sent',
  'Accepted',
  'Rejected',
  'Expired',
  'Converted',
] as const;
export type QuotationStatus = (typeof QUOTATION_STATUSES)[number];

const quotationSchema = createSalesDocumentSchema({
  statuses: QUOTATION_STATUSES,
  defaultStatus: 'Draft',
  extraFields: {
    /**
     * Quotations lapse. Stored rather than computed from `date` + N days so
     * that a negotiated validity survives a change to the company default.
     * `dueDate` on the shared schema means "payment due" and is meaningless
     * here, so this is its own field rather than a reuse of it.
     */
    validUntil: { type: Date, default: null },
  },
});

export type Quotation = InferSchemaType<typeof quotationSchema>;
export const QuotationModel = model('Quotation', quotationSchema);
