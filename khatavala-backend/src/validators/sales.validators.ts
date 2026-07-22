import { z } from 'zod';
import { QUOTATION_STATUSES } from '../models/Quotation.js';
import { SALES_ORDER_STATUSES } from '../models/SalesOrder.js';
import { INVOICE_STATUSES } from '../models/SalesInvoice.js';
import { PAYMENT_MODES } from '../models/Payment.js';
import { RETURN_REASONS } from '../models/SalesReturn.js';
import { CHALLAN_STATUSES } from '../models/DeliveryChallan.js';

const objectId = z
  .string()
  .trim()
  .regex(/^[0-9a-fA-F]{24}$/, 'Not a valid id');

/**
 * A line item as the CLIENT may state it.
 *
 * Note what is absent: `lineTotal`, `taxableAmount`, `taxAmount` and every
 * other computed figure. The server derives all of them (see
 * salesDocument.factory.ts) and would ignore them anyway — accepting them here
 * would imply they are honoured, and a client that "corrects" a total is a
 * client that can bill a customer ₹1 for a ₹10,000 order.
 *
 * `unitPrice` and `gstPercent` ARE accepted: shops negotiate prices, and an
 * invoice that silently overrode an agreed rate would be wrong. They default
 * from the product master when omitted.
 */
const lineItemSchema = z.object({
  productId: objectId,
  quantity: z.coerce
    .number()
    .positive('Quantity must be greater than zero')
    .max(1_000_000, 'Quantity looks unreasonably large'),
  unitPrice: z.coerce.number().min(0).max(100_000_000).optional(),
  discountPercent: z.coerce.number().min(0).max(100).optional(),
  gstPercent: z.coerce.number().min(0).max(100).optional(),
  warehouseId: objectId.nullable().optional(),
  batchNumber: z.string().trim().max(64).nullable().optional(),
});

const baseDocumentSchema = z.object({
  customerId: objectId,
  lineItems: z.array(lineItemSchema).min(1, 'Add at least one line item'),
  date: z.coerce.date().optional(),
  dueDate: z.coerce.date().nullable().optional(),
  notes: z.string().trim().max(2000).nullable().optional(),
  termsAndConditions: z.string().trim().max(2000).nullable().optional(),
});

export const createQuotationSchema = baseDocumentSchema.extend({
  validUntil: z.coerce.date().nullable().optional(),
  status: z.enum(QUOTATION_STATUSES).optional(),
});

export const createSalesOrderSchema = baseDocumentSchema.extend({
  expectedDeliveryDate: z.coerce.date().nullable().optional(),
  status: z.enum(SALES_ORDER_STATUSES).optional(),
});

export const createInvoiceSchema = baseDocumentSchema.extend({
  /** Defaults true server-side — see createInvoice. */
  confirm: z.boolean().optional(),
  status: z.enum(['Draft']).optional(),
});

// Update omits `status`: a status is moved by the endpoint that owns the
// transition (confirm, convert, cancel), never by a blind PATCH that could
// mark an invoice Paid without a payment behind it.
export const updateQuotationSchema = createQuotationSchema.omit({ status: true }).partial();
export const updateSalesOrderSchema = createSalesOrderSchema.omit({ status: true }).partial();
export const updateInvoiceSchema = createInvoiceSchema
  .omit({ status: true, confirm: true })
  .partial();

export const quotationStatusSchema = z.object({
  status: z.enum(QUOTATION_STATUSES),
});
export const salesOrderStatusSchema = z.object({
  status: z.enum(SALES_ORDER_STATUSES),
});

export const convertSchema = z.object({
  dueDate: z.coerce.date().optional(),
  expectedDeliveryDate: z.coerce.date().optional(),
  confirm: z.boolean().optional(),
});

export const paymentSchema = z.object({
  amount: z.coerce.number().positive('Payment amount must be positive'),
  date: z.coerce.date().optional(),
  narration: z.string().trim().max(240).optional(),
});

export const cancelSchema = z.object({
  reason: z.string().trim().min(3, 'Give a reason for the cancellation').max(240),
});

const statusFilter = z.union([
  z.enum(QUOTATION_STATUSES),
  z.enum(SALES_ORDER_STATUSES),
  z.enum(INVOICE_STATUSES),
]);

export const listQuerySchema = z.object({
  status: statusFilter.optional(),
  customerId: objectId.optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  search: z.string().trim().max(120).optional(),
  page: z.coerce.number().int().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
});

/* ------------------------------------------------------------------ *
 * Phase 10 — POS, payments, returns, challans
 * ------------------------------------------------------------------ */


/**
 * A payment now REQUIRES a mode. Phase 9's placeholder did not have one, which
 * made "how much cash is in the till" unanswerable — the question a shop asks
 * every single evening.
 */
export const recordPaymentSchema = z.object({
  amount: z.coerce.number().positive('Payment amount must be positive').max(100_000_000),
  mode: z.enum(PAYMENT_MODES),
  date: z.coerce.date().optional(),
  referenceNumber: z.string().trim().max(64).nullable().optional(),
  notes: z.string().trim().max(240).nullable().optional(),
});

export const posCheckoutSchema = z.object({
  // Deliberately not the full line-item schema: the till sends a cart, and
  // every amount is computed server-side from the product master.
  lines: z
    .array(
      z.object({
        productId: objectId,
        quantity: z.coerce.number().positive().max(1_000_000),
        unitPrice: z.coerce.number().min(0).max(100_000_000).optional(),
        discountPercent: z.coerce.number().min(0).max(100).optional(),
      })
    )
    .min(1, 'The cart is empty'),
  /** Omit for a walk-in sale — the server resolves the counter customer. */
  customerId: objectId.nullable().optional(),
  payment: z.object({
    mode: z.enum(PAYMENT_MODES),
    /** Omit to charge the full total. */
    amount: z.coerce.number().min(0).max(100_000_000).optional(),
    referenceNumber: z.string().trim().max(64).nullable().optional(),
    /** Display-only, for computing change. Never stored. */
    tendered: z.coerce.number().min(0).max(100_000_000).optional(),
  }),
  warehouseId: objectId.nullable().optional(),
  notes: z.string().trim().max(500).nullable().optional(),
});

export const createReturnSchema = z.object({
  invoiceId: objectId,
  lines: z
    .array(
      z.object({
        lineItemId: objectId,
        quantity: z.coerce.number().positive('Return quantity must be positive'),
      })
    )
    .min(1, 'Select at least one item to return'),
  reason: z.enum(RETURN_REASONS),
  reasonNotes: z.string().trim().max(500).nullable().optional(),
  warehouseId: objectId.nullable().optional(),
  restock: z.boolean().optional(),
  refundAmount: z.coerce.number().min(0).max(100_000_000).optional(),
  refundMode: z.enum(PAYMENT_MODES).optional(),
  date: z.coerce.date().optional(),
});

export const createChallanSchema = baseDocumentSchema.extend({
  vehicleNumber: z.string().trim().max(32).nullable().optional(),
  status: z.enum(CHALLAN_STATUSES).optional(),
});

export const updateChallanSchema = createChallanSchema.omit({ status: true }).partial();

export const listReturnsQuerySchema = z.object({
  invoiceId: objectId.optional(),
  customerId: objectId.optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  page: z.coerce.number().int().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
});

export const paymentSummaryQuerySchema = z.object({
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
});

export const quickProductsQuerySchema = z.object({
  search: z.string().trim().max(120).optional(),
  categoryId: objectId.optional(),
  limit: z.coerce.number().int().min(1).max(60).optional(),
});
