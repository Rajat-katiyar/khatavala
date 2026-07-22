import { Schema, model, InferSchemaType } from 'mongoose';
import { createTradeDocumentSchema, SUPPLIER_PARTY } from './tradeDocument.js';

/**
 * What we have asked a supplier to send us.
 *
 * The buying-side mirror of SalesOrder, and like it, it MOVES NO STOCK. Goods
 * ordered are not goods held: stock changes when the GRN records what actually
 * turned up, which is routinely not what was ordered.
 */

export const PURCHASE_ORDER_STATUSES = [
  'Draft',
  /** Sent to the supplier. */
  'Sent',
  'Confirmed',
  /** Some lines received; a GRN exists but the order is not complete. */
  'PartiallyReceived',
  'Received',
  'Cancelled',
  'Converted',
] as const;
export type PurchaseOrderStatus = (typeof PURCHASE_ORDER_STATUSES)[number];

const purchaseOrderSchema = createTradeDocumentSchema({
  statuses: PURCHASE_ORDER_STATUSES,
  defaultStatus: 'Draft',
  party: SUPPLIER_PARTY,
  extraFields: {
    /** When the supplier says it will arrive. */
    expectedDate: { type: Date, default: null },
    /** Where the goods are expected to land. */
    warehouseId: { type: Schema.Types.ObjectId, ref: 'Warehouse', default: null },
  },
});

export type PurchaseOrder = InferSchemaType<typeof purchaseOrderSchema>;
export const PurchaseOrderModel = model('PurchaseOrder', purchaseOrderSchema);
