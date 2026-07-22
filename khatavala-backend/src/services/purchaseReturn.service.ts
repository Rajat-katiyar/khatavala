import mongoose, { Types, type ClientSession } from 'mongoose';
import { ApiError } from '../utils/ApiError.js';
import {
  PurchaseInvoiceModel,
  POSTED_PURCHASE_STATUSES,
} from '../models/PurchaseInvoice.js';
import { DebitNoteModel, type PurchaseReturnReason } from '../models/DebitNote.js';
import { WarehouseModel } from '../models/Warehouse.js';
import * as stockService from './stock.service.js';
import * as supplierLedger from './supplierLedger.service.js';
import * as supplierPaymentService from './supplierPayment.service.js';
import * as journalService from './journal.service.js';
import { nextDocumentNumber } from './numbering.service.js';
import { round2 } from './tradeDocument.factory.js';
import {
  tenantById,
  tenantFilter,
  tenantStamp,
  type TenantContext,
} from '../middlewares/tenantScope.js';
import type { PaymentMode } from './payment.factory.js';

/**
 * PURCHASE RETURNS — goods going back to the supplier.
 *
 * The mirror of salesReturn.service with both directions flipped:
 *
 *   Sales return:    stock IN,  customer CREDITED.
 *   Purchase return: stock OUT, supplier DEBITED (a debit note reduces what we
 *                    owe them).
 *
 * One document rather than two — see models/DebitNote.ts on why the buying side
 * does not need the SalesReturn/CreditNote split.
 *
 * The same casts-and-why note as salesReturn.service applies: `extraFields` is
 * `Record<string, unknown>` on the shared schema factory, so `InferSchemaType`
 * cannot see the per-type fields.
 */

const DEBIT_NOTE_NUMBERING = { key: 'DebitNote', prefix: 'DN' } as const;

export interface ReturnLineInput {
  lineItemId: string;
  quantity: number;
}

export interface CreatePurchaseReturnInput {
  purchaseInvoiceId: string;
  lines: ReturnLineInput[];
  reason: PurchaseReturnReason;
  reasonNotes?: string | null;
  warehouseId?: string | null;
  /**
   * False for a purely financial debit note — a rate correction where no goods
   * move. The supplier is still debited.
   */
  returnsStock?: boolean;
  /** Cash the supplier actually refunded, if any. */
  refundAmount?: number;
  refundMode?: PaymentMode;
  date?: Date;
}

/**
 * How much of each bill line has already gone back.
 *
 * Summed from the debit notes rather than a counter on the line: two returns
 * racing would both read the same counter. Keyed per bill LINE via
 * `sourceLineItemId`, because one bill can carry the same product twice at
 * different rates and `productId` alone cannot tell them apart.
 */
async function alreadyReturned(
  tenant: TenantContext,
  purchaseInvoiceId: Types.ObjectId,
  session?: ClientSession
): Promise<Map<string, number>> {
  const query = DebitNoteModel.find(
    tenantFilter(tenant, { purchaseInvoiceId, status: { $ne: 'Cancelled' } })
  );
  if (session) query.session(session);
  const priorNotes = (await query.lean()) as any[];

  const byLine = new Map<string, number>();
  for (const note of priorNotes) {
    for (const line of note.lineItems) {
      const key = String(line.sourceLineItemId ?? line.productId);
      byLine.set(key, (byLine.get(key) ?? 0) + line.quantity);
    }
  }
  return byLine;
}

/**
 * Builds the debit note's lines from the bill's own.
 *
 * Rates come from the BILL, never the product master: we debit the supplier
 * what they charged us, not what the item is worth today.
 */
function buildReturnLines(
  invoice: any,
  lines: ReturnLineInput[],
  returnedSoFar: Map<string, number>
) {
  if (!lines || lines.length === 0) {
    throw ApiError.badRequest('Select at least one item to return');
  }

  return lines.map((requested) => {
    const invoiceLine = invoice.lineItems.id(requested.lineItemId);
    if (!invoiceLine) {
      throw ApiError.badRequest(`Line ${requested.lineItemId} is not on this bill`);
    }
    if (!(requested.quantity > 0)) {
      throw ApiError.badRequest(`Return quantity for ${invoiceLine.name} must be positive`);
    }

    const priorQty = returnedSoFar.get(String(invoiceLine._id)) ?? 0;
    const returnable = round2(invoiceLine.quantity - priorQty);

    if (requested.quantity > returnable + 0.0001) {
      throw ApiError.badRequest(
        `Cannot return ${requested.quantity} × ${invoiceLine.name} — only ${returnable} of ${invoiceLine.quantity} remain returnable`,
        { returnable, alreadyReturned: priorQty, billed: invoiceLine.quantity }
      );
    }

    const gross = round2(requested.quantity * invoiceLine.unitPrice);
    const discountAmount = round2((gross * invoiceLine.discountPercent) / 100);
    const taxableAmount = round2(gross - discountAmount);
    const taxAmount = round2((taxableAmount * invoiceLine.gstPercent) / 100);

    return {
      productId: invoiceLine.productId,
      sourceLineItemId: invoiceLine._id,
      name: invoiceLine.name,
      sku: invoiceLine.sku,
      hsnCode: invoiceLine.hsnCode,
      quantity: requested.quantity,
      unitPrice: invoiceLine.unitPrice,
      discountPercent: invoiceLine.discountPercent,
      gstPercent: invoiceLine.gstPercent,
      discountAmount,
      taxableAmount,
      taxAmount,
      lineTotal: round2(taxableAmount + taxAmount),
      warehouseId: invoiceLine.warehouseId,
      batchNumber: invoiceLine.batchNumber,
    };
  });
}

function totalsFor(
  lines: { quantity: number; unitPrice: number; discountAmount: number; taxAmount: number; lineTotal: number }[]
) {
  const subTotal = round2(lines.reduce((sum, l) => sum + l.quantity * l.unitPrice, 0));
  const totalDiscount = round2(lines.reduce((sum, l) => sum + l.discountAmount, 0));
  const totalTax = round2(lines.reduce((sum, l) => sum + l.taxAmount, 0));
  const beforeRounding = round2(lines.reduce((sum, l) => sum + l.lineTotal, 0));
  const grandTotal = Math.round(beforeRounding);
  return {
    subTotal,
    totalDiscount,
    totalTax,
    roundOff: round2(grandTotal - beforeRounding),
    grandTotal,
  };
}

/** Records a purchase return against a posted bill. */
export async function createPurchaseReturn(
  tenant: TenantContext,
  input: CreatePurchaseReturnInput
) {
  if (!Types.ObjectId.isValid(input.purchaseInvoiceId)) {
    throw ApiError.badRequest('Not a valid purchase invoice id');
  }

  const session = await mongoose.startSession();
  try {
    let result: any;
    await session.withTransaction(async () => {
      const invoice = (await PurchaseInvoiceModel.findOne(
        tenantById(tenant, input.purchaseInvoiceId)
      ).session(session)) as any;
      if (!invoice) throw ApiError.notFound('Purchase invoice not found');

      if (!POSTED_PURCHASE_STATUSES.includes(invoice.status)) {
        throw ApiError.badRequest(
          `Cannot return against a ${String(invoice.status).toLowerCase()} bill`
        );
      }

      const returnedSoFar = await alreadyReturned(tenant, invoice._id, session);
      const lineItems = buildReturnLines(invoice, input.lines, returnedSoFar);
      const totals = totalsFor(lineItems);
      const date = input.date ?? new Date();
      const returnsStock = input.returnsStock ?? true;

      let warehouseId: Types.ObjectId | null = null;
      if (returnsStock) {
        if (input.warehouseId) {
          warehouseId = new Types.ObjectId(input.warehouseId);
        } else {
          // Default to where the goods actually sit — the line's own warehouse
          // if the bill recorded one, otherwise the company default.
          const lineWarehouse = lineItems.find((line) => line.warehouseId)?.warehouseId;
          if (lineWarehouse) {
            warehouseId = lineWarehouse as Types.ObjectId;
          } else {
            const fallback = await WarehouseModel.findOne(
              tenantFilter(tenant, { isDefault: true, isActive: true })
            )
              .session(session)
              .lean();
            if (!fallback) {
              throw ApiError.badRequest('No default warehouse is set for this company.');
            }
            warehouseId = fallback._id;
          }
        }
      }

      const documentNumber = await nextDocumentNumber(tenant, DEBIT_NOTE_NUMBERING, {
        session,
        date,
      });

      const [debitNote] = (await DebitNoteModel.create(
        [
          tenantStamp(tenant, {
            documentNumber,
            purchaseInvoiceId: invoice._id,
            purchaseInvoiceNumber: invoice.documentNumber,
            supplierId: invoice.supplierId,
            supplierName: invoice.supplierName,
            date,
            lineItems,
            ...totals,
            reason: input.reason,
            reasonNotes: input.reasonNotes ?? null,
            warehouseId,
            returnsStock,
            status: 'Issued',
            postedAt: new Date(),
            createdBy: tenant.actor?.userId ?? null,
          }),
        ],
        { session }
      )) as any[];

      // 1. Stock OUT — the goods leave. Negative quantities, and the balance
      //    guard applies: returning more than is on hand aborts the whole
      //    transaction, which is right.
      if (returnsStock) {
        await stockService.recordMovements(
          tenant,
          lineItems.map((line) => ({
            productId: line.productId,
            warehouseId: warehouseId!,
            batchNumber: line.batchNumber,
            movementType: 'Out' as const,
            quantity: -line.quantity,
            referenceType: 'PurchaseReturn' as const,
            referenceId: debitNote._id,
            reason: `Return ${documentNumber} against ${invoice.documentNumber}`,
            timestamp: date,
          })),
          { session }
        );
      }

      // 2. Debit the supplier — reduces what we owe, the reverse of the bill's
      //    credit.
      await supplierLedger.appendEntry(
        tenant,
        {
          supplierId: String(invoice.supplierId),
          type: 'DebitNote',
          debit: totals.grandTotal,
          referenceModel: 'DebitNote',
          referenceId: debitNote._id,
          date,
          narration: `Debit note ${documentNumber} against ${invoice.documentNumber}`,
        },
        { session }
      );

      // The books, same transaction.
      await journalService.postDebitNoteJournal(tenant, debitNote, session);

      // 3. Money actually refunded by the supplier, if any.
      if (input.refundAmount && input.refundAmount > 0) {
        if (input.refundAmount > totals.grandTotal + 0.005) {
          throw ApiError.badRequest(
            `Refund cannot exceed the debit note value of ${totals.grandTotal}`
          );
        }
        await supplierPaymentService.refundPayment(
          tenant,
          invoice,
          {
            amount: input.refundAmount,
            mode: input.refundMode ?? 'Cash',
            date,
            notes: `Refund for return ${documentNumber}`,
            debitNoteId: debitNote._id,
          },
          session
        );
        debitNote.refundedAmount = round2(input.refundAmount);
        await debitNote.save({ session });
      }

      invoice.returnedAmount = round2(invoice.returnedAmount + totals.grandTotal);
      await invoice.save({ session });

      result = { debitNote: debitNote.toObject() };
    });
    return result;
  } finally {
    await session.endSession();
  }
}

/** What is still returnable on a bill, per line — what the return screen needs. */
export async function getReturnableLines(tenant: TenantContext, purchaseInvoiceId: string) {
  if (!Types.ObjectId.isValid(purchaseInvoiceId)) {
    throw ApiError.badRequest('Not a valid purchase invoice id');
  }

  const invoice = (await PurchaseInvoiceModel.findOne(
    tenantById(tenant, purchaseInvoiceId)
  ).lean()) as any;
  if (!invoice) throw ApiError.notFound('Purchase invoice not found');

  const returnedByLine = await alreadyReturned(tenant, invoice._id);

  const priorNotes = (await DebitNoteModel.find(
    tenantFilter(tenant, {
      purchaseInvoiceId: invoice._id,
      status: { $ne: 'Cancelled' },
    })
  ).lean()) as any[];

  return {
    purchaseInvoice: {
      _id: invoice._id,
      documentNumber: invoice.documentNumber,
      supplierId: invoice.supplierId,
      supplierName: invoice.supplierName,
      date: invoice.date,
      status: invoice.status,
      grandTotal: invoice.grandTotal,
      amountPaid: invoice.amountPaid,
      returnedAmount: invoice.returnedAmount,
    },
    lines: (invoice.lineItems as any[]).map((line) => {
      const returned = returnedByLine.get(String(line._id)) ?? 0;
      return {
        lineItemId: String(line._id),
        productId: String(line.productId),
        name: line.name,
        sku: line.sku,
        quantity: line.quantity,
        unitPrice: line.unitPrice,
        discountPercent: line.discountPercent,
        gstPercent: line.gstPercent,
        lineTotal: line.lineTotal,
        alreadyReturned: returned,
        returnable: round2(line.quantity - returned),
      };
    }),
    previousReturns: priorNotes.map((note) => ({
      _id: note._id,
      documentNumber: note.documentNumber,
      date: note.date,
      grandTotal: note.grandTotal,
      reason: note.reason,
    })),
  };
}

export async function listPurchaseReturns(
  tenant: TenantContext,
  query: {
    purchaseInvoiceId?: string;
    supplierId?: string;
    from?: Date;
    to?: Date;
    page?: number;
    limit?: number;
  } = {}
) {
  const page = Math.max(1, query.page ?? 1);
  const limit = Math.min(200, Math.max(1, query.limit ?? 25));

  const filter: Record<string, unknown> = {};
  if (query.purchaseInvoiceId) {
    filter.purchaseInvoiceId = new Types.ObjectId(query.purchaseInvoiceId);
  }
  if (query.supplierId) filter.supplierId = new Types.ObjectId(query.supplierId);
  if (query.from || query.to) {
    filter.date = {
      ...(query.from ? { $gte: query.from } : {}),
      ...(query.to ? { $lte: query.to } : {}),
    };
  }

  const scoped = tenantFilter(tenant, filter);
  const [documents, total] = await Promise.all([
    DebitNoteModel.find(scoped)
      .sort({ date: -1, _id: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .lean(),
    DebitNoteModel.countDocuments(scoped),
  ]);

  return {
    documents,
    pagination: { page, limit, total, pages: Math.ceil(total / limit) || 1 },
  };
}

export async function getPurchaseReturn(tenant: TenantContext, id: string) {
  if (!Types.ObjectId.isValid(id)) throw ApiError.badRequest('Not a valid debit note id');
  const debitNote = await DebitNoteModel.findOne(tenantById(tenant, id)).lean();
  if (!debitNote) throw ApiError.notFound('Debit note not found');
  return { debitNote };
}
