import { Schema, model, InferSchemaType } from 'mongoose';
import { createTradeDocumentSchema, SUPPLIER_PARTY } from './tradeDocument.js';

/**
 * The supplier's bill — what we owe, and why.
 *
 * The buying-side mirror of SalesInvoice, with one important asymmetry:
 *
 *   A SALES invoice moves stock OUT and DEBITS the customer.
 *   A PURCHASE invoice moves NO STOCK and CREDITS the supplier.
 *
 * Stock came in on the GRN, at receipt, because that is when the goods
 * physically arrived. Deducting or adding it again here would count the same
 * delivery twice — the same trap the delivery challan sets on the selling side,
 * and handled the same way: this document posts the ledger only.
 *
 * The exception is a STANDALONE bill with no GRN behind it (a service charge, a
 * freight bill, or a shop that bills and receives in one step). Those carry
 * `receivesStock: true` and take the goods in themselves. See purchase.service.
 *
 * Registered as 'PurchaseInvoice' because Phase 6 fixed that string into
 * SupplierLedgerEntry's `referenceModel` enum and refPath.
 */

export const PURCHASE_INVOICE_STATUSES = [
  'Draft',
  /** Posted and unpaid. */
  'Unpaid',
  'PartiallyPaid',
  'Paid',
  'Cancelled',
] as const;
export type PurchaseInvoiceStatus = (typeof PURCHASE_INVOICE_STATUSES)[number];

/** Statuses in which the bill has been posted to the supplier ledger. */
export const POSTED_PURCHASE_STATUSES: readonly PurchaseInvoiceStatus[] = [
  'Unpaid',
  'PartiallyPaid',
  'Paid',
];

const purchaseInvoiceSchema = createTradeDocumentSchema({
  statuses: PURCHASE_INVOICE_STATUSES,
  defaultStatus: 'Draft',
  party: SUPPLIER_PARTY,
  extraFields: {
    purchaseOrderId: { type: Schema.Types.ObjectId, ref: 'PurchaseOrder', default: null },
    grnId: { type: Schema.Types.ObjectId, ref: 'GoodsReceiptNote', default: null },

    /**
     * The supplier's OWN invoice number. Required in practice for GST input
     * credit — the number on the paper bill is what the return is matched
     * against, and our internal `documentNumber` means nothing to the tax
     * authority.
     */
    supplierInvoiceNumber: { type: String, trim: true, default: null },
    supplierInvoiceDate: { type: Date, default: null },

    /**
     * True when this bill also brings the goods in — a standalone bill with no
     * GRN behind it. False (the norm) means a GRN already took the stock and
     * this document must not touch it. See the header.
     */
    receivesStock: { type: Boolean, default: false },
    warehouseId: { type: Schema.Types.ObjectId, ref: 'Warehouse', default: null },

    /** Paid to the supplier so far. Written only by supplierPayment.service. */
    amountPaid: { type: Number, default: 0, min: 0 },
    /** Value debited back via debit notes. Written only by purchaseReturn.service. */
    returnedAmount: { type: Number, default: 0, min: 0 },

    postedAt: { type: Date, default: null },
    reversedAt: { type: Date, default: null },
  },
});

export type PurchaseInvoice = InferSchemaType<typeof purchaseInvoiceSchema>;
export const PurchaseInvoiceModel = model('PurchaseInvoice', purchaseInvoiceSchema);
