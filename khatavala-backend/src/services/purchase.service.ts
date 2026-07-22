import mongoose, { Types, type ClientSession } from 'mongoose';
import { ApiError } from '../utils/ApiError.js';
import { PurchaseOrderModel } from '../models/PurchaseOrder.js';
import { GoodsReceiptNoteModel, RECEIVED_STATUSES } from '../models/GoodsReceiptNote.js';
import {
  PurchaseInvoiceModel,
  POSTED_PURCHASE_STATUSES,
} from '../models/PurchaseInvoice.js';
import { SupplierModel } from '../models/Supplier.js';
import { WarehouseModel } from '../models/Warehouse.js';
import * as stockService from './stock.service.js';
import * as supplierLedger from './supplierLedger.service.js';
import * as journalService from './journal.service.js';
import {
  createTradeDocumentService,
  round2,
  type CreateDocumentInput,
} from './tradeDocument.factory.js';
import { tenantFilter, type TenantContext } from '../middlewares/tenantScope.js';

/**
 * PURCHASE — order → receipt → bill.
 *
 * The structural mirror of sales.service, on the shared trade-document engine.
 * Two things are genuinely different on the buying side, and both matter:
 *
 * 1. WHICH DOCUMENT MOVES STOCK.
 *    Sales:    the INVOICE moves stock out (goods leave when billed), unless a
 *              delivery challan already dispatched them.
 *    Purchase: the GRN moves stock in (goods arrive when received), and the
 *              bill that follows moves none.
 *
 *    That asymmetry is real, not an inconsistency: on the selling side the
 *    common case is bill-and-hand-over together; on the buying side goods
 *    arrive on a lorry days before the supplier's bill does. Each side attaches
 *    the movement to the document that actually coincides with the goods.
 *
 *    A standalone bill with no GRN behind it (`receivesStock: true`) is the
 *    exception and takes the goods in itself — see postPurchaseInvoice.
 *
 * 2. LEDGER DIRECTION. A supplier is a creditor, so a bill CREDITS them and
 *    increases the payable. Booking it as a debit would be plain wrong
 *    double-entry — see ledger.factory.ts.
 *
 * Like every other module here, this one never writes StockLedgerEntry or
 * SupplierLedgerEntry itself.
 */

const SUPPLIER_PARTY_CONFIG = {
  model: SupplierModel,
  field: 'supplierId',
  nameField: 'supplierName',
  label: 'Supplier',
};

export const purchaseOrderService = createTradeDocumentService({
  model: PurchaseOrderModel,
  label: 'Purchase order',
  numbering: { key: 'PurchaseOrder', prefix: 'PO' },
  editableStatuses: ['Draft', 'Sent', 'Confirmed'],
  party: SUPPLIER_PARTY_CONFIG,
});

export const grnService = createTradeDocumentService({
  model: GoodsReceiptNoteModel,
  label: 'Goods receipt',
  numbering: { key: 'GoodsReceiptNote', prefix: 'GRN' },
  // Editable only before the goods are taken in. After that the stock movement
  // exists and the paperwork must match it.
  editableStatuses: ['Draft'],
  party: SUPPLIER_PARTY_CONFIG,
});

export const purchaseInvoiceService = createTradeDocumentService({
  model: PurchaseInvoiceModel,
  label: 'Purchase invoice',
  numbering: { key: 'PurchaseInvoice', prefix: 'PINV' },
  editableStatuses: ['Draft'],
  party: SUPPLIER_PARTY_CONFIG,
});

/* ------------------------------------------------------------------ *
 * Warehouse resolution
 * ------------------------------------------------------------------ */

async function resolveWarehouse(
  tenant: TenantContext,
  preferred: Types.ObjectId | string | null | undefined,
  session: ClientSession
): Promise<Types.ObjectId> {
  if (preferred) return new Types.ObjectId(String(preferred));

  const fallback = await WarehouseModel.findOne(
    tenantFilter(tenant, { isDefault: true, isActive: true })
  )
    .session(session)
    .lean();
  if (!fallback) {
    throw ApiError.badRequest(
      'No default warehouse is set for this company. Create one before receiving goods.'
    );
  }
  return fallback._id;
}

/* ------------------------------------------------------------------ *
 * Goods receipt — the document that moves stock IN
 * ------------------------------------------------------------------ */

/**
 * Confirms a GRN: stock in, status Received, purchase order progress updated.
 * All in one transaction.
 */
export async function receiveGrn(tenant: TenantContext, id: string) {
  if (!Types.ObjectId.isValid(id)) throw ApiError.badRequest('Not a valid receipt id');

  const session = await mongoose.startSession();
  try {
    let result: any;
    await session.withTransaction(async () => {
      const grn = (await grnService.getRaw(tenant, id, session)) as any;

      if (grn.status !== 'Draft') {
        throw ApiError.badRequest(`This receipt is already ${grn.status}`);
      }

      const warehouseId = await resolveWarehouse(tenant, grn.warehouseId, session);
      grn.warehouseId = warehouseId;

      /**
       * Pin the resolved warehouse onto every line before taking stock in.
       *
       * Same reasoning as the delivery challan: if a line kept a null
       * warehouse, cancelling the receipt later would have nowhere to take the
       * stock back FROM, and the company default may have moved on since.
       */
      for (const line of grn.lineItems) {
        if (!line.warehouseId) line.warehouseId = warehouseId;
      }

      // Positive quantities — goods arriving. `quantity` on a GRN line is the
      // ACCEPTED quantity; rejected units never enter stock at all, which is
      // the point of recording them separately.
      await stockService.recordMovements(
        tenant,
        grn.lineItems.map((line: any) => ({
          productId: line.productId,
          warehouseId: line.warehouseId,
          batchNumber: line.batchNumber,
          expiryDate: line.expiryDate ?? null,
          movementType: 'In' as const,
          quantity: line.quantity,
          referenceType: 'Purchase' as const,
          referenceId: grn._id,
          reason: `Receipt ${grn.documentNumber}`,
          timestamp: grn.date,
        })),
        { session }
      );

      grn.status = 'Received';
      grn.receivedAt = new Date();
      await grn.save({ session });

      // Move the order on, if there is one. Compared against what was ORDERED
      // across every receipt, so a second partial delivery closes the order and
      // a first one does not.
      if (grn.purchaseOrderId) {
        await updateOrderProgress(tenant, grn.purchaseOrderId, session);
      }

      result = grn.toObject();
    });
    return result;
  } finally {
    await session.endSession();
  }
}

/**
 * Recomputes a purchase order's received status from its receipts.
 *
 * Derived rather than incremented: a counter on the order would have to be
 * unwound on every cancellation, and two receipts committing concurrently would
 * both read the same starting figure. Summing the receipts inside the
 * transaction is always right.
 */
async function updateOrderProgress(
  tenant: TenantContext,
  purchaseOrderId: Types.ObjectId,
  session: ClientSession
) {
  const order = (await PurchaseOrderModel.findOne(
    tenantFilter(tenant, { _id: purchaseOrderId })
  ).session(session)) as any;
  if (!order) return;

  const receipts = (await GoodsReceiptNoteModel.find(
    tenantFilter(tenant, {
      purchaseOrderId,
      status: { $in: RECEIVED_STATUSES },
    })
  )
    .session(session)
    .lean()) as any[];

  const receivedByProduct = new Map<string, number>();
  for (const receipt of receipts) {
    for (const line of receipt.lineItems) {
      const key = String(line.sourceLineItemId ?? line.productId);
      receivedByProduct.set(key, (receivedByProduct.get(key) ?? 0) + line.quantity);
    }
  }

  const fullyReceived = order.lineItems.every((line: any) => {
    const received = receivedByProduct.get(String(line._id)) ?? 0;
    return received >= line.quantity - 0.0001;
  });
  const anythingReceived = receivedByProduct.size > 0;

  order.status = fullyReceived
    ? 'Received'
    : anythingReceived
      ? 'PartiallyReceived'
      : order.status;
  await order.save({ session });
}

/**
 * Cancels a receipt, taking the stock back out if it had been received.
 *
 * Refused once billed: at that point the bill is the live document, and the
 * goods have been accepted into the books against a supplier's invoice.
 */
export async function cancelGrn(tenant: TenantContext, id: string, reason?: string) {
  const session = await mongoose.startSession();
  try {
    let result: any;
    await session.withTransaction(async () => {
      const grn = (await grnService.getRaw(tenant, id, session)) as any;

      if (grn.purchaseInvoiceId) {
        throw ApiError.badRequest(
          'This receipt has been billed. Cancel the purchase invoice first.'
        );
      }
      if (grn.status === 'Cancelled') {
        throw ApiError.badRequest('This receipt is already cancelled');
      }

      if (RECEIVED_STATUSES.includes(grn.status)) {
        // Taking stock back OUT can fail if it has since been sold — and it
        // should. Cancelling a receipt for goods already gone is a mistake the
        // negative-stock guard is there to catch.
        await stockService.recordMovements(
          tenant,
          grn.lineItems.map((line: any) => ({
            productId: line.productId,
            warehouseId: line.warehouseId,
            batchNumber: line.batchNumber,
            movementType: 'Out' as const,
            quantity: -line.quantity,
            referenceType: 'Purchase' as const,
            referenceId: grn._id,
            reason: `Cancelled receipt ${grn.documentNumber}`,
          })),
          { session }
        );
      }

      grn.status = 'Cancelled';
      if (reason) {
        grn.notes = [grn.notes, `Cancelled: ${reason}`].filter(Boolean).join('\n');
      }
      await grn.save({ session });

      if (grn.purchaseOrderId) {
        await updateOrderProgress(tenant, grn.purchaseOrderId, session);
      }

      result = grn.toObject();
    });
    return result;
  } finally {
    await session.endSession();
  }
}

/* ------------------------------------------------------------------ *
 * Purchase invoice — the document that posts the payable
 * ------------------------------------------------------------------ */

/**
 * Applies a purchase bill's side effects inside the caller's transaction.
 *
 * Posts the supplier ledger, and takes stock in ONLY for a standalone bill with
 * no receipt behind it. When a GRN already brought the goods in, billing them
 * again would count the same delivery twice — the buying-side twin of the
 * delivery-challan trap on the selling side.
 */
async function postPurchaseInvoice(
  tenant: TenantContext,
  invoice: any,
  session: ClientSession
): Promise<void> {
  if (invoice.receivesStock && !invoice.grnId) {
    const warehouseId = await resolveWarehouse(tenant, invoice.warehouseId, session);
    for (const line of invoice.lineItems) {
      if (!line.warehouseId) line.warehouseId = warehouseId;
    }

    await stockService.recordMovements(
      tenant,
      invoice.lineItems.map((line: any) => ({
        productId: line.productId,
        warehouseId: line.warehouseId,
        batchNumber: line.batchNumber,
        movementType: 'In' as const,
        quantity: line.quantity,
        referenceType: 'Purchase' as const,
        referenceId: invoice._id,
        reason: `Purchase bill ${invoice.documentNumber}`,
        timestamp: invoice.date,
      })),
      { session }
    );
  }

  // A supplier is a creditor: a bill CREDITS them and increases what we owe.
  await supplierLedger.appendEntry(
    tenant,
    {
      supplierId: String(invoice.supplierId),
      type: 'PurchaseInvoice',
      credit: invoice.grandTotal,
      referenceModel: 'PurchaseInvoice',
      referenceId: invoice._id,
      date: invoice.date,
      narration: `Purchase bill ${invoice.documentNumber}${
        invoice.supplierInvoiceNumber ? ` (${invoice.supplierInvoiceNumber})` : ''
      }`,
      // Drives the payment reminders Phase 6 already built.
      ...(invoice.dueDate ? { dueDate: invoice.dueDate } : {}),
    },
    { session }
  );

  // The books, in this same transaction — see journal.service.
  await journalService.postPurchaseInvoiceJournal(tenant, invoice, session);

  invoice.status = 'Unpaid';
  invoice.postedAt = new Date();
  await invoice.save({ session });
}

export interface CreatePurchaseInvoiceInput extends CreateDocumentInput {
  confirm?: boolean;
}

/** Builds and posts a purchase bill inside a caller's transaction. */
export async function createPurchaseInvoiceInSession(
  tenant: TenantContext,
  input: CreatePurchaseInvoiceInput,
  session: ClientSession
) {
  const { confirm = true, ...rest } = input;

  /**
   * Rejected, not silently ignored. A bill that names a GRN *and* claims to
   * receive stock is a caller that believes the goods will be taken in twice —
   * quietly doing one of the two would leave them with a stock figure they
   * cannot explain. Better to fail at the boundary and say why.
   */
  if (rest.receivesStock && rest.grnId) {
    throw ApiError.badRequest(
      'A bill raised against a goods receipt cannot also receive stock — the receipt already took it in.'
    );
  }

  const payload = await purchaseInvoiceService.buildPayload(tenant, rest, { session });
  const [invoice] = await PurchaseInvoiceModel.create([payload], { session });

  if (confirm) await postPurchaseInvoice(tenant, invoice, session);

  return invoice;
}

export async function createPurchaseInvoice(
  tenant: TenantContext,
  input: CreatePurchaseInvoiceInput
) {
  const session = await mongoose.startSession();
  try {
    let result: any;
    await session.withTransaction(async () => {
      const invoice = await createPurchaseInvoiceInSession(tenant, input, session);
      result = invoice.toObject();
    });
    return result;
  } finally {
    await session.endSession();
  }
}

/** Posts an existing draft bill. */
export async function confirmPurchaseInvoice(tenant: TenantContext, id: string) {
  const session = await mongoose.startSession();
  try {
    let result: any;
    await session.withTransaction(async () => {
      const invoice = (await purchaseInvoiceService.getRaw(tenant, id, session)) as any;
      if (invoice.status !== 'Draft') {
        throw ApiError.badRequest(`This bill is already ${invoice.status}`);
      }
      await postPurchaseInvoice(tenant, invoice, session);
      result = invoice.toObject();
    });
    return result;
  } finally {
    await session.endSession();
  }
}

/**
 * Cancels a posted bill by reversing it: a contra ledger entry, and stock back
 * out only if this bill was what brought it in.
 */
export async function cancelPurchaseInvoice(
  tenant: TenantContext,
  id: string,
  reason?: string
) {
  const session = await mongoose.startSession();
  try {
    let result: any;
    await session.withTransaction(async () => {
      const invoice = (await purchaseInvoiceService.getRaw(tenant, id, session)) as any;

      if (invoice.status === 'Cancelled') {
        throw ApiError.badRequest('This bill is already cancelled');
      }
      if (invoice.amountPaid > 0) {
        throw ApiError.badRequest(
          'This bill has payments against it. Reverse them before cancelling.'
        );
      }

      if (POSTED_PURCHASE_STATUSES.includes(invoice.status)) {
        if (invoice.receivesStock && !invoice.grnId) {
          await stockService.recordMovements(
            tenant,
            invoice.lineItems.map((line: any) => ({
              productId: line.productId,
              warehouseId: line.warehouseId,
              batchNumber: line.batchNumber,
              movementType: 'Out' as const,
              quantity: -line.quantity,
              referenceType: 'PurchaseReturn' as const,
              referenceId: invoice._id,
              reason: `Cancelled bill ${invoice.documentNumber}`,
            })),
            { session }
          );
        }

        // Contra entry: a debit reduces the payable, undoing the bill's credit.
        await supplierLedger.appendEntry(
          tenant,
          {
            supplierId: String(invoice.supplierId),
            type: 'DebitNote',
            debit: invoice.grandTotal,
            referenceModel: 'PurchaseInvoice',
            referenceId: invoice._id,
            narration: `Cancelled bill ${invoice.documentNumber}${
              reason ? ` — ${reason}` : ''
            }`,
          },
          { session }
        );

        await journalService.reverseJournalsFor(
          tenant,
          'PurchaseInvoice',
          invoice._id,
          session,
          `Cancelled bill ${invoice.documentNumber}`
        );

        invoice.reversedAt = new Date();
      }

      invoice.status = 'Cancelled';
      if (reason) {
        invoice.notes = [invoice.notes, `Cancelled: ${reason}`].filter(Boolean).join('\n');
      }
      await invoice.save({ session });

      // Free the receipt so a corrected bill can be raised against it.
      if (invoice.grnId) {
        await GoodsReceiptNoteModel.updateOne(
          tenantFilter(tenant, { _id: invoice.grnId }),
          { $set: { purchaseInvoiceId: null } },
          { session }
        );
      }

      result = invoice.toObject();
    });
    return result;
  } finally {
    await session.endSession();
  }
}

/* ------------------------------------------------------------------ *
 * Conversions
 * ------------------------------------------------------------------ */

/**
 * Purchase order → goods receipt.
 *
 * Lines are copied at the ORDERED quantity as a starting point, and
 * `orderedQuantity` is stamped on each so the receiving screen can show what
 * was expected beside what the user types as actually arrived. The receipt is
 * left as a DRAFT: nothing has been checked in yet, and confirming it is the
 * act that moves stock.
 */
export async function convertOrderToGrn(
  tenant: TenantContext,
  orderId: string,
  overrides: { warehouseId?: string; supplierDocumentNumber?: string } = {}
) {
  const order = (await purchaseOrderService.getRaw(tenant, orderId)) as any;

  if (['Cancelled', 'Received'].includes(order.status)) {
    throw ApiError.badRequest(
      `A purchase order that is ${order.status} cannot be received against`
    );
  }

  // What is still outstanding on the order, so a second delivery does not
  // default to the full quantity again.
  const priorReceipts = (await GoodsReceiptNoteModel.find(
    tenantFilter(tenant, {
      purchaseOrderId: order._id,
      status: { $in: RECEIVED_STATUSES },
    })
  ).lean()) as any[];

  const receivedByLine = new Map<string, number>();
  for (const receipt of priorReceipts) {
    for (const line of receipt.lineItems) {
      const key = String(line.sourceLineItemId ?? line.productId);
      receivedByLine.set(key, (receivedByLine.get(key) ?? 0) + line.quantity);
    }
  }

  const lineItems = order.lineItems
    .map((line: any) => {
      const outstanding = round2(
        line.quantity - (receivedByLine.get(String(line._id)) ?? 0)
      );
      return { line, outstanding };
    })
    .filter((entry: any) => entry.outstanding > 0)
    .map(({ line, outstanding }: any) => ({
      productId: String(line.productId),
      quantity: outstanding,
      unitPrice: line.unitPrice,
      discountPercent: line.discountPercent,
      gstPercent: line.gstPercent,
      warehouseId: overrides.warehouseId ?? null,
      sourceLineItemId: line._id,
      orderedQuantity: line.quantity,
    }));

  if (lineItems.length === 0) {
    throw ApiError.badRequest('Every line on this order has already been received');
  }

  const grn = await grnService.create(tenant, {
    supplierId: String(order.supplierId),
    lineItems,
    date: new Date(),
    purchaseOrderId: order._id,
    purchaseOrderNumber: order.documentNumber,
    warehouseId: overrides.warehouseId ?? order.warehouseId ?? null,
    supplierDocumentNumber: overrides.supplierDocumentNumber ?? null,
    sourceDocumentId: order._id,
    sourceDocumentModel: 'PurchaseOrder',
    notes: order.notes,
  } as never);

  return grn;
}

/**
 * Goods receipt → purchase bill.
 *
 * The bill carries `grnId`, which is what tells `postPurchaseInvoice` the stock
 * is already in and must not be taken in twice.
 */
export async function convertGrnToInvoice(
  tenant: TenantContext,
  grnId: string,
  options: {
    confirm?: boolean;
    dueDate?: Date;
    supplierInvoiceNumber?: string;
    supplierInvoiceDate?: Date;
  } = {}
) {
  const session = await mongoose.startSession();
  try {
    let result: any;
    await session.withTransaction(async () => {
      const grn = (await grnService.getRaw(tenant, grnId, session)) as any;

      if (!RECEIVED_STATUSES.includes(grn.status)) {
        throw ApiError.badRequest(
          `Only a received GRN can be billed — this one is ${grn.status}`
        );
      }
      if (grn.purchaseInvoiceId) {
        throw ApiError.badRequest('This receipt has already been billed', {
          purchaseInvoiceId: String(grn.purchaseInvoiceId),
        });
      }

      const invoice = await createPurchaseInvoiceInSession(
        tenant,
        {
          supplierId: String(grn.supplierId),
          // Billed for what was ACCEPTED, not what was ordered — rejected units
          // were never taken into stock and must not be paid for.
          lineItems: grn.lineItems.map((line: any) => ({
            productId: String(line.productId),
            quantity: line.quantity,
            unitPrice: line.unitPrice,
            discountPercent: line.discountPercent,
            gstPercent: line.gstPercent,
            warehouseId: line.warehouseId ? String(line.warehouseId) : null,
            batchNumber: line.batchNumber,
          })),
          date: new Date(),
          grnId: grn._id,
          purchaseOrderId: grn.purchaseOrderId,
          supplierInvoiceNumber: options.supplierInvoiceNumber ?? null,
          supplierInvoiceDate: options.supplierInvoiceDate ?? null,
          // The receipt already took the goods in.
          receivesStock: false,
          sourceDocumentId: grn._id,
          sourceDocumentModel: 'GoodsReceiptNote',
          notes: grn.notes,
          ...(options.dueDate ? { dueDate: options.dueDate } : {}),
          confirm: options.confirm ?? true,
        } as never,
        session
      );

      grn.purchaseInvoiceId = invoice._id;
      grn.convertedToId = invoice._id;
      grn.convertedToModel = 'PurchaseInvoice';
      await grn.save({ session });

      result = invoice.toObject();
    });
    return result;
  } finally {
    await session.endSession();
  }
}

/**
 * Purchase order → bill directly, skipping the receipt.
 *
 * For services and expenses that have no goods at all — freight, commission —
 * where forcing a GRN through would create a stock movement for something that
 * was never stocked. `receivesStock` defaults false for exactly that reason.
 */
export async function convertOrderToInvoice(
  tenant: TenantContext,
  orderId: string,
  options: { confirm?: boolean; dueDate?: Date; receivesStock?: boolean } = {}
) {
  const order = (await purchaseOrderService.getRaw(tenant, orderId)) as any;

  if (order.convertedToId) {
    throw ApiError.badRequest('This purchase order has already been billed');
  }
  if (order.status === 'Cancelled') {
    throw ApiError.badRequest('A cancelled purchase order cannot be billed');
  }

  const invoice = await createPurchaseInvoice(tenant, {
    supplierId: String(order.supplierId),
    lineItems: order.lineItems.map((line: any) => ({
      productId: String(line.productId),
      quantity: line.quantity,
      unitPrice: line.unitPrice,
      discountPercent: line.discountPercent,
      gstPercent: line.gstPercent,
    })),
    date: new Date(),
    purchaseOrderId: order._id,
    receivesStock: options.receivesStock ?? false,
    sourceDocumentId: order._id,
    sourceDocumentModel: 'PurchaseOrder',
    notes: order.notes,
    ...(options.dueDate ? { dueDate: options.dueDate } : {}),
    confirm: options.confirm ?? true,
  } as never);

  order.status = 'Converted';
  order.convertedToId = invoice._id;
  order.convertedToModel = 'PurchaseInvoice';
  await order.save();

  return invoice;
}
