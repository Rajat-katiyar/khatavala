import { z } from 'zod';
import { PURCHASE_ORDER_STATUSES } from '../models/PurchaseOrder.js';
import { GRN_STATUSES } from '../models/GoodsReceiptNote.js';
import { PURCHASE_INVOICE_STATUSES } from '../models/PurchaseInvoice.js';
import { PURCHASE_RETURN_REASONS } from '../models/DebitNote.js';
import { PAYMENT_MODES } from '../services/payment.factory.js';

const objectId = z
  .string()
  .trim()
  .regex(/^[0-9a-fA-F]{24}$/, 'Not a valid id');

/**
 * Purchase line items, as the CLIENT may state them.
 *
 * `unitPrice` is REQUIRED here, unlike on the sales side where it defaults to
 * the product's selling price. There is no equivalent default when buying: the
 * product master's `purchasePrice` is what we paid LAST time, and silently
 * billing this order at last quarter's rate would be wrong far more often than
 * it would be right. The supplier's rate is on their quotation and has to be
 * typed.
 *
 * Everything computed — line totals, tax, grand total — is absent for the same
 * reason as on the sales side: the server derives it and ignores any figure the
 * client sends.
 */
const lineItemSchema = z.object({
  productId: objectId,
  quantity: z.coerce
    .number()
    .positive('Quantity must be greater than zero')
    .max(1_000_000, 'Quantity looks unreasonably large'),
  unitPrice: z.coerce.number().min(0).max(100_000_000),
  discountPercent: z.coerce.number().min(0).max(100).optional(),
  gstPercent: z.coerce.number().min(0).max(100).optional(),
  warehouseId: objectId.nullable().optional(),
  batchNumber: z.string().trim().max(64).nullable().optional(),
  expiryDate: z.coerce.date().nullable().optional(),
});

const baseDocumentSchema = z.object({
  supplierId: objectId,
  lineItems: z.array(lineItemSchema).min(1, 'Add at least one line item'),
  date: z.coerce.date().optional(),
  dueDate: z.coerce.date().nullable().optional(),
  notes: z.string().trim().max(2000).nullable().optional(),
  termsAndConditions: z.string().trim().max(2000).nullable().optional(),
});

export const createPurchaseOrderSchema = baseDocumentSchema.extend({
  expectedDate: z.coerce.date().nullable().optional(),
  warehouseId: objectId.nullable().optional(),
  status: z.enum(PURCHASE_ORDER_STATUSES).optional(),
});

export const updatePurchaseOrderSchema = createPurchaseOrderSchema
  .omit({ status: true })
  .partial();

/**
 * A GRN's line quantities are what was ACCEPTED. `orderedQuantity` and
 * `rejectedQuantity` are accepted from the client because the receiving clerk
 * is the one who counts them — but they are recorded, not trusted: nothing
 * downstream computes from them, and stock moves on `quantity` alone.
 */
export const createGrnSchema = baseDocumentSchema.extend({
  lineItems: z
    .array(
      lineItemSchema.extend({
        sourceLineItemId: objectId.nullable().optional(),
        orderedQuantity: z.coerce.number().min(0).nullable().optional(),
        rejectedQuantity: z.coerce.number().min(0).optional(),
      })
    )
    .min(1, 'Add at least one line item'),
  purchaseOrderId: objectId.nullable().optional(),
  purchaseOrderNumber: z.string().trim().max(64).nullable().optional(),
  warehouseId: objectId.nullable().optional(),
  supplierDocumentNumber: z.string().trim().max(64).nullable().optional(),
  vehicleNumber: z.string().trim().max(32).nullable().optional(),
  status: z.enum(GRN_STATUSES).optional(),
});

export const updateGrnSchema = createGrnSchema.omit({ status: true }).partial();

export const createPurchaseInvoiceSchema = baseDocumentSchema.extend({
  purchaseOrderId: objectId.nullable().optional(),
  grnId: objectId.nullable().optional(),
  supplierInvoiceNumber: z.string().trim().max(64).nullable().optional(),
  supplierInvoiceDate: z.coerce.date().nullable().optional(),
  /**
   * Whether THIS document brings the goods in. Defaults false: the normal path
   * is a GRN that already did. Setting it true on a bill that has a `grnId` is
   * rejected server-side — that would take the same delivery into stock twice.
   */
  receivesStock: z.boolean().optional(),
  warehouseId: objectId.nullable().optional(),
  confirm: z.boolean().optional(),
  status: z.enum(['Draft']).optional(),
});

export const updatePurchaseInvoiceSchema = createPurchaseInvoiceSchema
  .omit({ status: true, confirm: true })
  .partial();

export const purchaseOrderStatusSchema = z.object({
  status: z.enum(PURCHASE_ORDER_STATUSES),
});

export const convertToGrnSchema = z.object({
  warehouseId: objectId.optional(),
  supplierDocumentNumber: z.string().trim().max(64).optional(),
});

export const convertToPurchaseInvoiceSchema = z.object({
  confirm: z.boolean().optional(),
  dueDate: z.coerce.date().optional(),
  supplierInvoiceNumber: z.string().trim().max(64).optional(),
  supplierInvoiceDate: z.coerce.date().optional(),
  /** Only meaningful converting an ORDER straight to a bill (services, freight). */
  receivesStock: z.boolean().optional(),
});

export const createPurchaseReturnSchema = z.object({
  purchaseInvoiceId: objectId,
  lines: z
    .array(
      z.object({
        lineItemId: objectId,
        quantity: z.coerce.number().positive('Return quantity must be positive'),
      })
    )
    .min(1, 'Select at least one item to return'),
  reason: z.enum(PURCHASE_RETURN_REASONS),
  reasonNotes: z.string().trim().max(500).nullable().optional(),
  warehouseId: objectId.nullable().optional(),
  returnsStock: z.boolean().optional(),
  refundAmount: z.coerce.number().min(0).max(100_000_000).optional(),
  refundMode: z.enum(PAYMENT_MODES).optional(),
  date: z.coerce.date().optional(),
});

export const recordSupplierPaymentSchema = z.object({
  amount: z.coerce.number().positive('Payment amount must be positive').max(100_000_000),
  mode: z.enum(PAYMENT_MODES),
  date: z.coerce.date().optional(),
  referenceNumber: z.string().trim().max(64).nullable().optional(),
  notes: z.string().trim().max(240).nullable().optional(),
});

export const cancelSchema = z.object({
  reason: z.string().trim().min(3, 'Give a reason for the cancellation').max(240),
});

const statusFilter = z.union([
  z.enum(PURCHASE_ORDER_STATUSES),
  z.enum(GRN_STATUSES),
  z.enum(PURCHASE_INVOICE_STATUSES),
]);

export const listQuerySchema = z.object({
  status: statusFilter.optional(),
  supplierId: objectId.optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  search: z.string().trim().max(120).optional(),
  page: z.coerce.number().int().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
});

export const listReturnsQuerySchema = z.object({
  purchaseInvoiceId: objectId.optional(),
  supplierId: objectId.optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  page: z.coerce.number().int().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
});

export const paymentSummaryQuerySchema = z.object({
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
});
