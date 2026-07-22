import { model, InferSchemaType } from 'mongoose';
import { createSalesDocumentSchema } from './tradeDocument.js';

/**
 * A confirmed order, not yet invoiced.
 *
 * Also moves no stock. A future phase may want to RESERVE stock against a
 * confirmed order — that is a real requirement and deliberately not implemented
 * here, because a reservation that nothing ever releases is worse than none.
 * When it lands it belongs in stock.service as a movement type of its own, not
 * as a deduction from this module.
 */

export const SALES_ORDER_STATUSES = [
  'Draft',
  'Confirmed',
  'PartiallyDelivered',
  'Delivered',
  'Cancelled',
  'Converted',
] as const;
export type SalesOrderStatus = (typeof SALES_ORDER_STATUSES)[number];

const salesOrderSchema = createSalesDocumentSchema({
  statuses: SALES_ORDER_STATUSES,
  defaultStatus: 'Draft',
  extraFields: {
    expectedDeliveryDate: { type: Date, default: null },
    /** 'OnlineStore' | null — marks orders placed via the public storefront. */
    source: { type: String, enum: ['OnlineStore', null], default: null },
    notes: { type: String, trim: true, default: null },
  },
});

export type SalesOrder = InferSchemaType<typeof salesOrderSchema>;
export const SalesOrderModel = model('SalesOrder', salesOrderSchema);
