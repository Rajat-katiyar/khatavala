import { Schema, model, InferSchemaType } from 'mongoose';
import { createSalesDocumentSchema } from './tradeDocument.js';

/**
 * Goods dispatched before they are invoiced.
 *
 * THIS DOCUMENT MOVES STOCK, AND THAT IS THE WHOLE POINT.
 * ------------------------------------------------------
 * A challan exists because the goods have physically left the godown. If it
 * did not deduct stock, the shop would show items it no longer has for however
 * long it takes to raise the invoice — which on a credit sale can be weeks.
 * Recording the paperwork and not the movement is the exact failure a stock
 * system exists to prevent.
 *
 * The consequence is the thing to be careful about: the invoice raised LATER
 * against this challan must NOT deduct the same stock again. That is handled
 * explicitly — a SalesInvoice carrying `deliveredByChallanId` skips its stock
 * step and posts only the ledger. See sales.service.postInvoice.
 */

export const CHALLAN_STATUSES = [
  'Draft',
  /** Dispatched — stock has left. */
  'Dispatched',
  'Invoiced',
  'Cancelled',
] as const;
export type ChallanStatus = (typeof CHALLAN_STATUSES)[number];

/** Statuses in which the challan's stock has actually been deducted. */
export const DISPATCHED_STATUSES: readonly ChallanStatus[] = ['Dispatched', 'Invoiced'];

const deliveryChallanSchema = createSalesDocumentSchema({
  statuses: CHALLAN_STATUSES,
  defaultStatus: 'Draft',
  extraFields: {
    /** Lorry receipt / vehicle number — what the driver carries. */
    vehicleNumber: { type: String, trim: true, default: null },
    dispatchedAt: { type: Date, default: null },
    /** Set when an invoice has been raised against this challan. */
    invoiceId: { type: Schema.Types.ObjectId, ref: 'Invoice', default: null },
  },
});

export type DeliveryChallan = InferSchemaType<typeof deliveryChallanSchema>;
export const DeliveryChallanModel = model('DeliveryChallan', deliveryChallanSchema);
