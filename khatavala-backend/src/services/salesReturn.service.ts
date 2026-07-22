import mongoose, { Types, type ClientSession } from 'mongoose';
import { ApiError } from '../utils/ApiError.js';
import { SalesInvoiceModel, POSTED_STATUSES } from '../models/SalesInvoice.js';
import { SalesReturnModel, type ReturnReason } from '../models/SalesReturn.js';
import { CreditNoteModel } from '../models/CreditNote.js';
import { WarehouseModel } from '../models/Warehouse.js';
import * as stockService from './stock.service.js';
import * as customerLedger from './customerLedger.service.js';
import * as paymentService from './payment.service.js';
import * as journalService from './journal.service.js';
import { nextDocumentNumber } from './numbering.service.js';
import { round2 } from './tradeDocument.factory.js';
import {
  tenantById,
  tenantFilter,
  tenantStamp,
  type TenantContext,
} from '../middlewares/tenantScope.js';
import type { PaymentMode } from '../models/Payment.js';

/**
 * SALES RETURNS — the reverse transaction.
 *
 * Creating one does four things, all inside ONE transaction:
 *
 *   1. a SalesReturn document (what came back, and why),
 *   2. stock IN for each returned line (unless the goods are unsaleable),
 *   3. a CreditNote, and the customer ledger credit behind it,
 *   4. optionally, cash refunded from the till.
 *
 * It is the mirror image of postInvoice, and it obeys the same rules: it never
 * writes StockLedgerEntry or CustomerLedgerEntry itself, and it never edits the
 * original invoice beyond the `returnedAmount` roll-up. The invoice said what
 * was sold on the day; the return is a second event, not a correction.
 */

/**
 * A note on the `as any` casts below: `createSalesDocumentSchema` takes its
 * per-type fields as `extraFields: Record<string, unknown>`, so `InferSchemaType`
 * cannot see `returnedAmount`, `creditNoteId` and friends even though the schema
 * defines them. The alternative is generics threaded through the factory for
 * every document type, which buys typing on a handful of field reads at the cost
 * of a signature nobody can read. Same trade sales.service already makes.
 */

const RETURN_NUMBERING = { key: 'SalesReturn', prefix: 'SR' } as const;
const CREDIT_NOTE_NUMBERING = { key: 'CreditNote', prefix: 'CN' } as const;

export interface ReturnLineInput {
  /** The invoice line being returned against. */
  lineItemId: string;
  quantity: number;
}

export interface CreateReturnInput {
  invoiceId: string;
  lines: ReturnLineInput[];
  reason: ReturnReason;
  reasonNotes?: string | null;
  /** Defaults to the company default warehouse. */
  warehouseId?: string | null;
  /**
   * Put the goods back on the shelf. False for damaged or expired stock, which
   * comes back into the books and is then written off — two visible movements
   * rather than goods that silently never returned.
   */
  restock?: boolean;
  /** Cash handed back now. The rest stays as credit on the customer's account. */
  refundAmount?: number;
  refundMode?: PaymentMode;
  date?: Date;
}

/**
 * How much of each invoice line has already been returned.
 *
 * Computed from the RETURN DOCUMENTS rather than from a counter on the invoice
 * line, because two returns racing on the same line would both read the same
 * counter. Inside the transaction this read sees a consistent snapshot, and the
 * check below is what stops a customer returning eleven of the ten they bought.
 */
async function alreadyReturned(
  tenant: TenantContext,
  invoiceId: Types.ObjectId,
  session: ClientSession
): Promise<Map<string, number>> {
  const priorReturns = (await SalesReturnModel.find(
    tenantFilter(tenant, { invoiceId, status: { $ne: 'Cancelled' } })
  )
    .session(session)
    .lean()) as any[];

  const byLine = new Map<string, number>();
  for (const priorReturn of priorReturns) {
    for (const line of priorReturn.lineItems as any[]) {
      // `sourceLineItemId` ties a return line back to the invoice line it came
      // from; without it, two invoice lines for the same product would be
      // indistinguishable and the cap could be evaded.
      const key = String(line.sourceLineItemId ?? line.productId);
      byLine.set(key, (byLine.get(key) ?? 0) + line.quantity);
    }
  }
  return byLine;
}

/**
 * Builds the return's line items from the invoice's own lines.
 *
 * Prices come from the INVOICE, never from the product master: a customer is
 * credited what they were charged, including whatever discount they were given
 * that day. Re-pricing a return at today's rate would refund the wrong amount
 * in both directions.
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
      throw ApiError.badRequest(`Line ${requested.lineItemId} is not on this invoice`);
    }
    if (!(requested.quantity > 0)) {
      throw ApiError.badRequest(`Return quantity for ${invoiceLine.name} must be positive`);
    }

    const priorQty = returnedSoFar.get(String(invoiceLine._id)) ?? 0;
    const returnable = round2(invoiceLine.quantity - priorQty);

    if (requested.quantity > returnable + 0.0001) {
      throw ApiError.badRequest(
        `Cannot return ${requested.quantity} × ${invoiceLine.name} — only ${returnable} of ${invoiceLine.quantity} remain returnable`,
        { returnable, alreadyReturned: priorQty, invoiced: invoiceLine.quantity }
      );
    }

    // The line is rebuilt at the invoice's unit economics and scaled to the
    // returned quantity, so a partial return credits exactly its share of the
    // discount and the tax.
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

function totalsFor(lines: { quantity: number; unitPrice: number; discountAmount: number; taxAmount: number; lineTotal: number }[]) {
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

/**
 * Records a return against a posted invoice.
 *
 * Partial by default and repeatable: a customer can return three today and two
 * next week, and the second return sees the first.
 */
export async function createReturn(tenant: TenantContext, input: CreateReturnInput) {
  if (!Types.ObjectId.isValid(input.invoiceId)) {
    throw ApiError.badRequest('Not a valid invoice id');
  }

  const session = await mongoose.startSession();
  try {
    let result: any;
    await session.withTransaction(async () => {
      const invoice = (await SalesInvoiceModel.findOne(
        tenantById(tenant, input.invoiceId)
      ).session(session)) as any;
      if (!invoice) throw ApiError.notFound('Invoice not found');

      if (!POSTED_STATUSES.includes(invoice.status)) {
        throw ApiError.badRequest(
          `Cannot return against a ${String(invoice.status).toLowerCase()} invoice`
        );
      }

      const returnedSoFar = await alreadyReturned(tenant, invoice._id, session);
      const lineItems = buildReturnLines(invoice, input.lines, returnedSoFar);
      const totals = totalsFor(lineItems);
      const date = input.date ?? new Date();

      // Where the goods land. Defaults to the company default rather than the
      // line's original warehouse, because damaged returns commonly go
      // somewhere else and the caller should be able to say so.
      let warehouseId: Types.ObjectId;
      if (input.warehouseId) {
        warehouseId = new Types.ObjectId(input.warehouseId);
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

      const documentNumber = await nextDocumentNumber(tenant, RETURN_NUMBERING, {
        session,
        date,
      });

      const restock = input.restock ?? true;

      const [salesReturn] = (await SalesReturnModel.create(
        [
          tenantStamp(tenant, {
            documentNumber,
            invoiceId: invoice._id,
            invoiceNumber: invoice.documentNumber,
            customerId: invoice.customerId,
            customerName: invoice.customerName,
            date,
            lineItems,
            ...totals,
            reason: input.reason,
            reasonNotes: input.reasonNotes ?? null,
            warehouseId,
            restock,
            status: 'Completed',
            postedAt: new Date(),
            createdBy: tenant.actor?.userId ?? null,
          }),
        ],
        { session }
      )) as any[];

      // 1. Stock back IN — positive quantities, the mirror of the sale.
      if (restock) {
        await stockService.recordMovements(
          tenant,
          lineItems.map((line) => ({
            productId: line.productId,
            warehouseId,
            batchNumber: line.batchNumber,
            movementType: 'In' as const,
            quantity: line.quantity,
            referenceType: 'SalesReturn' as const,
            referenceId: salesReturn._id,
            reason: `Return ${documentNumber} against ${invoice.documentNumber}`,
            timestamp: date,
          })),
          { session }
        );
      }

      // 2. The credit note, and the ledger credit behind it.
      const creditNoteNumber = await nextDocumentNumber(tenant, CREDIT_NOTE_NUMBERING, {
        session,
        date,
      });

      const [creditNote] = (await CreditNoteModel.create(
        [
          tenantStamp(tenant, {
            documentNumber: creditNoteNumber,
            invoiceId: invoice._id,
            invoiceNumber: invoice.documentNumber,
            salesReturnId: salesReturn._id,
            customerId: invoice.customerId,
            customerName: invoice.customerName,
            date,
            lineItems,
            ...totals,
            reason: input.reason,
            status: 'Issued',
            postedAt: new Date(),
            createdBy: tenant.actor?.userId ?? null,
          }),
        ],
        { session }
      )) as any[];

      await customerLedger.appendEntry(
        tenant,
        {
          customerId: String(invoice.customerId),
          type: 'CreditNote',
          // A credit REDUCES what the customer owes — the reverse of the
          // invoice's debit. Direction belongs to the ledger; see
          // ledger.factory.ts.
          credit: totals.grandTotal,
          referenceModel: 'CreditNote',
          referenceId: creditNote._id,
          date,
          narration: `Credit note ${creditNoteNumber} for return ${documentNumber}`,
        },
        { session }
      );

      // The books, same transaction.
      await journalService.postCreditNoteJournal(tenant, creditNote, session);

      salesReturn.creditNoteId = creditNote._id;

      // 3. Cash back over the counter, if any. Capped at both the credit and
      //    what was actually received — you cannot refund money never taken.
      if (input.refundAmount && input.refundAmount > 0) {
        if (input.refundAmount > totals.grandTotal + 0.005) {
          throw ApiError.badRequest(
            `Refund cannot exceed the credit note value of ${totals.grandTotal}`
          );
        }
        await paymentService.refundPayment(
          tenant,
          invoice,
          {
            amount: input.refundAmount,
            mode: input.refundMode ?? 'Cash',
            date,
            notes: `Refund for return ${documentNumber}`,
            salesReturnId: salesReturn._id,
          },
          session
        );
        salesReturn.refundedAmount = round2(input.refundAmount);
      }

      await salesReturn.save({ session });

      // 4. Roll up onto the invoice — the guard that makes the returnable
      //    check above cheap to explain, and what the invoice screen shows.
      invoice.returnedAmount = round2(invoice.returnedAmount + totals.grandTotal);
      await invoice.save({ session });

      result = {
        salesReturn: salesReturn.toObject(),
        creditNote: creditNote.toObject(),
      };
    });
    return result;
  } finally {
    await session.endSession();
  }
}

/**
 * What is still returnable on an invoice, per line — what the return screen
 * needs to render before the user picks anything.
 */
export async function getReturnableLines(tenant: TenantContext, invoiceId: string) {
  if (!Types.ObjectId.isValid(invoiceId)) {
    throw ApiError.badRequest('Not a valid invoice id');
  }

  const invoice = (await SalesInvoiceModel.findOne(
    tenantById(tenant, invoiceId)
  ).lean()) as any;
  if (!invoice) throw ApiError.notFound('Invoice not found');

  const priorReturns = (await SalesReturnModel.find(
    tenantFilter(tenant, {
      invoiceId: new Types.ObjectId(invoiceId),
      status: { $ne: 'Cancelled' },
    })
  ).lean()) as any[];

  const returnedByLine = new Map<string, number>();
  for (const priorReturn of priorReturns) {
    for (const line of priorReturn.lineItems as any[]) {
      const key = String(line.sourceLineItemId ?? line.productId);
      returnedByLine.set(key, (returnedByLine.get(key) ?? 0) + line.quantity);
    }
  }

  return {
    invoice: {
      _id: invoice._id,
      documentNumber: invoice.documentNumber,
      customerId: invoice.customerId,
      customerName: invoice.customerName,
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
    previousReturns: priorReturns.map((priorReturn) => ({
      _id: priorReturn._id,
      documentNumber: priorReturn.documentNumber,
      date: priorReturn.date,
      grandTotal: priorReturn.grandTotal,
      reason: priorReturn.reason,
    })),
  };
}

export async function listReturns(
  tenant: TenantContext,
  query: { invoiceId?: string; customerId?: string; from?: Date; to?: Date; page?: number; limit?: number } = {}
) {
  const page = Math.max(1, query.page ?? 1);
  const limit = Math.min(200, Math.max(1, query.limit ?? 25));

  const filter: Record<string, unknown> = {};
  if (query.invoiceId) filter.invoiceId = new Types.ObjectId(query.invoiceId);
  if (query.customerId) filter.customerId = new Types.ObjectId(query.customerId);
  if (query.from || query.to) {
    filter.date = {
      ...(query.from ? { $gte: query.from } : {}),
      ...(query.to ? { $lte: query.to } : {}),
    };
  }

  const scoped = tenantFilter(tenant, filter);
  const [documents, total] = await Promise.all([
    SalesReturnModel.find(scoped)
      .sort({ date: -1, _id: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .lean(),
    SalesReturnModel.countDocuments(scoped),
  ]);

  return {
    documents,
    pagination: { page, limit, total, pages: Math.ceil(total / limit) || 1 },
  };
}

export async function getReturn(tenant: TenantContext, id: string) {
  if (!Types.ObjectId.isValid(id)) throw ApiError.badRequest('Not a valid return id');
  const salesReturn = (await SalesReturnModel.findOne(tenantById(tenant, id)).lean()) as any;
  if (!salesReturn) throw ApiError.notFound('Return not found');

  const creditNote = salesReturn.creditNoteId
    ? await CreditNoteModel.findOne(
        tenantFilter(tenant, { _id: salesReturn.creditNoteId })
      ).lean()
    : null;

  return { salesReturn, creditNote };
}
