import mongoose, { Types, type ClientSession } from 'mongoose';
import { ApiError } from '../utils/ApiError.js';
import { QuotationModel } from '../models/Quotation.js';
import { SalesOrderModel } from '../models/SalesOrder.js';
import { SalesInvoiceModel, POSTED_STATUSES } from '../models/SalesInvoice.js';
import { WarehouseModel } from '../models/Warehouse.js';
import * as stockService from './stock.service.js';
import * as customerLedger from './customerLedger.service.js';
import * as journalService from './journal.service.js';
import {
  createSalesDocumentService,
  round2,
  type CreateDocumentInput,
  type SalesDocumentService,
} from './tradeDocument.factory.js';
import { tenantFilter, type TenantContext } from '../middlewares/tenantScope.js';

/**
 * SALES — quotation → order → invoice.
 *
 * The shared CRUD and arithmetic live in salesDocument.factory.ts. This file
 * owns the two things that are genuinely per-type: the CONVERSION CHAIN, and
 * the SIDE EFFECTS of confirming an invoice.
 *
 * THE INVOICE TRANSACTION
 * -----------------------
 * Confirming an invoice does three things that must all happen or none:
 *
 *   1. the invoice document is written / marked posted,
 *   2. stock is deducted for every line (stock.service),
 *   3. the customer is debited (customerLedger.service).
 *
 * Any of them can fail for an ordinary business reason — insufficient stock is
 * the obvious one — and a partial application is corruption, not an error: sold
 * goods with no receivable, or a receivable for goods that never left. So all
 * three run in ONE MongoDB transaction, opened here and passed down. Both
 * downstream services already accept a session for exactly this (see the
 * headers of stock.service.ts and ledger.factory.ts); neither commits, and the
 * abort undoes all three.
 *
 * Note that this module never writes StockLedgerEntry or CustomerLedgerEntry
 * itself. Those collections have a single writer each, and Sales is a caller
 * like any other.
 */

/* ------------------------------------------------------------------ *
 * The three document services
 * ------------------------------------------------------------------ */

export const quotationService = createSalesDocumentService({
  model: QuotationModel,
  label: 'Quotation',
  numbering: { key: 'Quotation', prefix: 'QTN' },
  // A quotation is editable until it has been turned into something else.
  editableStatuses: ['Draft', 'Sent', 'Accepted', 'Rejected', 'Expired'],
});

export const salesOrderService = createSalesDocumentService({
  model: SalesOrderModel,
  label: 'Sales order',
  numbering: { key: 'SalesOrder', prefix: 'SO' },
  editableStatuses: ['Draft', 'Confirmed'],
});

export const invoiceService = createSalesDocumentService({
  model: SalesInvoiceModel,
  label: 'Invoice',
  numbering: { key: 'SalesInvoice', prefix: 'INV' },
  // ONLY a draft. Once posted, the invoice has moved stock and hit the ledger;
  // editing it would leave both stating something it no longer says.
  editableStatuses: ['Draft'],
});

/* ------------------------------------------------------------------ *
 * Invoice posting
 * ------------------------------------------------------------------ */

/**
 * Resolves which warehouse each line ships from.
 *
 * A line may name its own (a multi-godown shop picking stock deliberately);
 * otherwise everything ships from the company default. Resolved ONCE up front
 * rather than per line, and a company with no default is an error here rather
 * than a null warehouseId reaching the stock service.
 */
async function resolveWarehouses(
  tenant: TenantContext,
  lines: { warehouseId?: Types.ObjectId | null }[],
  session: ClientSession
): Promise<Types.ObjectId[]> {
  const needsDefault = lines.some((line) => !line.warehouseId);

  let defaultWarehouseId: Types.ObjectId | null = null;
  if (needsDefault) {
    const fallback = await WarehouseModel.findOne(
      tenantFilter(tenant, { isDefault: true, isActive: true })
    )
      .session(session)
      .lean();
    if (!fallback) {
      throw ApiError.badRequest(
        'No default warehouse is set for this company. Create one before invoicing.'
      );
    }
    defaultWarehouseId = fallback._id;
  }

  return lines.map((line) => line.warehouseId ?? defaultWarehouseId!);
}

/**
 * Applies an invoice's side effects. Runs INSIDE the caller's transaction —
 * it never opens or commits one of its own.
 */
async function postInvoice(
  tenant: TenantContext,
  invoice: any,
  session: ClientSession
): Promise<void> {
  /**
   * 1. Stock out — UNLESS the goods already left on a delivery challan.
   *
   * A challan deducts stock at dispatch because that is when the goods
   * physically go (see models/DeliveryChallan.ts). Deducting again when the
   * invoice follows would send the same items out of the warehouse twice, and
   * the error compounds silently: nothing fails, the balance is just wrong.
   */
  if (!invoice.deliveredByChallanId) {
    const warehouseIds = await resolveWarehouses(tenant, invoice.lineItems, session);

    // Negative quantities — the sign IS the direction; see the convention in
    // models/StockLedgerEntry.ts. A line that would take the balance below zero
    // throws here and aborts the whole transaction, which is why an oversold
    // invoice never reaches the ledger.
    await stockService.recordMovements(
      tenant,
      invoice.lineItems.map((line: any, index: number) => ({
        productId: line.productId,
        warehouseId: warehouseIds[index],
        batchNumber: line.batchNumber,
        movementType: 'Out' as const,
        quantity: -line.quantity,
        referenceType: 'Sale' as const,
        referenceId: invoice._id,
        reason: `Invoice ${invoice.documentNumber}`,
        timestamp: invoice.date,
      })),
      { session }
    );
  }

  // 2. Debit the customer. A customer is a debtor, so an invoice DEBITS them
  //    and increases what they owe — see ledger.factory.ts on why the direction
  //    is a property of the ledger rather than of the caller.
  await customerLedger.appendEntry(
    tenant,
    {
      customerId: String(invoice.customerId),
      type: 'Invoice',
      debit: invoice.grandTotal,
      referenceModel: 'Invoice',
      referenceId: invoice._id,
      date: invoice.date,
      narration: `Invoice ${invoice.documentNumber}`,
    },
    { session }
  );

  // 3. The books. Posted in THIS transaction, so accounting can never drift
  //    from the documents: if the journal will not balance, the invoice does
  //    not post either. See journal.service.
  await journalService.postSalesInvoiceJournal(tenant, invoice, session);

  // 4. Mark it posted. Written last so that if any of the above throws, this
  //    never runs — though the abort would undo it anyway.
  invoice.status = 'Unpaid';
  invoice.postedAt = new Date();
  await invoice.save({ session });
}

export interface CreateInvoiceInput extends CreateDocumentInput {
  /**
   * Post stock and the ledger immediately. Default TRUE: the counter screen
   * raises an invoice for goods walking out of the door, and a draft that
   * silently moved no stock is the wrong default for the common case. Pass
   * false to park a draft.
   */
  confirm?: boolean;
}

/**
 * Builds and posts an invoice inside a CALLER'S transaction, returning the
 * hydrated document.
 *
 * Extracted so POS can create the invoice and take the payment as one atomic
 * act, and so it gets the document itself rather than a plain object — the
 * payment step needs something it can `.save()`. See pos.service.
 */
export async function createInvoiceInSession(
  tenant: TenantContext,
  input: CreateInvoiceInput,
  session: ClientSession
) {
  const { confirm = true, ...rest } = input;

  const payload = await invoiceService.buildPayload(tenant, rest, { session });
  const [invoice] = await SalesInvoiceModel.create([payload], { session });

  if (confirm) await postInvoice(tenant, invoice, session);

  return invoice;
}

/**
 * Creates an invoice and — unless explicitly drafted — posts it, all in one
 * transaction.
 *
 * The document number is allocated inside the transaction too, so an aborted
 * invoice does not burn a number and leave a gap in the GST series. See
 * models/Counter.ts.
 */
export async function createInvoice(tenant: TenantContext, input: CreateInvoiceInput) {
  const session = await mongoose.startSession();
  try {
    let result: any;
    await session.withTransaction(async () => {
      const invoice = await createInvoiceInSession(tenant, input, session);
      result = invoice.toObject();
    });
    return result;
  } finally {
    await session.endSession();
  }
}

/** Posts an existing draft. Same transaction, same three steps. */
export async function confirmInvoice(tenant: TenantContext, id: string) {
  const session = await mongoose.startSession();
  try {
    let result: any;
    await session.withTransaction(async () => {
      const invoice = await invoiceService.getRaw(tenant, id, session);

      if (invoice.status !== 'Draft') {
        throw ApiError.badRequest(`This invoice is already ${invoice.status}`);
      }

      await postInvoice(tenant, invoice, session);
      result = invoice.toObject();
    });
    return result;
  } finally {
    await session.endSession();
  }
}

/**
 * Cancels a posted invoice by REVERSING it, never by deleting it.
 *
 * Stock goes back with compensating movements and the customer is credited with
 * a contra entry. Both ledgers are append-only, so "undo" means writing the
 * opposite, which is also what leaves an auditor able to see that an invoice
 * was raised and then cancelled — deletion would erase the fact.
 */
export async function cancelInvoice(tenant: TenantContext, id: string, reason?: string) {
  const session = await mongoose.startSession();
  try {
    let result: any;
    await session.withTransaction(async () => {
      const invoice = await invoiceService.getRaw(tenant, id, session);

      if (invoice.status === 'Cancelled') {
        throw ApiError.badRequest('This invoice is already cancelled');
      }
      if (invoice.amountPaid > 0) {
        throw ApiError.badRequest(
          'This invoice has payments against it. Refund them before cancelling.'
        );
      }

      // A draft never posted anything, so there is nothing to reverse.
      if (POSTED_STATUSES.includes(invoice.status)) {
        // Stock only comes back if this invoice took it out. When a challan
        // dispatched the goods, cancelling the invoice cancels the BILL, not
        // the dispatch — the goods are still with the customer, and the challan
        // has to be cancelled separately to bring them back.
        if (!invoice.deliveredByChallanId) {
          const warehouseIds = await resolveWarehouses(tenant, invoice.lineItems, session);

          await stockService.recordMovements(
            tenant,
            invoice.lineItems.map((line: any, index: number) => ({
              productId: line.productId,
              warehouseId: warehouseIds[index],
              batchNumber: line.batchNumber,
              movementType: 'In' as const,
              quantity: line.quantity,
              referenceType: 'SalesReturn' as const,
              referenceId: invoice._id,
              reason: `Cancelled invoice ${invoice.documentNumber}`,
            })),
            { session }
          );
        }

        await customerLedger.appendEntry(
          tenant,
          {
            customerId: String(invoice.customerId),
            type: 'CreditNote',
            credit: invoice.grandTotal,
            referenceModel: 'Invoice',
            referenceId: invoice._id,
            narration: `Cancelled invoice ${invoice.documentNumber}${
              reason ? ` — ${reason}` : ''
            }`,
          },
          { session }
        );

        // The books are append-only: cancelling writes the mirror image
        // rather than deleting what was posted.
        await journalService.reverseJournalsFor(
          tenant,
          'SalesInvoice',
          invoice._id,
          session,
          `Cancelled invoice ${invoice.documentNumber}`
        );

        invoice.reversedAt = new Date();
      }

      invoice.status = 'Cancelled';
      if (reason) invoice.notes = [invoice.notes, `Cancelled: ${reason}`].filter(Boolean).join('\n');
      await invoice.save({ session });
      result = invoice.toObject();
    });
    return result;
  } finally {
    await session.endSession();
  }
}

/**
 * Payments moved out to payment.service in Phase 10, which is now the only
 * writer of `amountPaid` and of the Payment collection. Re-exported so that
 * `salesService.recordPayment` — the name the routes and Phase 9 callers
 * already use — keeps working against the real implementation.
 */
export { recordPayment, getPaymentsForInvoice } from './payment.service.js';

/* ------------------------------------------------------------------ *
 * Conversion chain
 * ------------------------------------------------------------------ */

interface ConversionConfig {
  from: SalesDocumentService;
  fromModelName: 'Quotation' | 'SalesOrder' | 'Invoice';
  to: SalesDocumentService;
  toModelName: 'Quotation' | 'SalesOrder' | 'Invoice';
  /** Statuses the source must be in to convert. */
  convertibleStatuses: readonly string[];
}

/**
 * Copies a document forward, links the two, and closes the source.
 *
 * Lines are copied as they stood on the SOURCE — not re-priced from the product
 * master. A customer who accepted a quotation at last month's price is entitled
 * to that price; silently re-pricing at conversion is how a shop loses an
 * argument it should win.
 *
 * The link is stored on both sides: the new document points back via
 * `sourceDocumentId`, and the source points forward via `convertedToId` and
 * flips to `Converted`. One direction alone would make "what became of this
 * quotation?" a collection scan.
 */
async function convertDocument(
  tenant: TenantContext,
  sourceId: string,
  config: ConversionConfig,
  overrides: Record<string, unknown> = {},
  options: { confirm?: boolean } = {}
) {
  const source = await config.from.getRaw(tenant, sourceId);

  if (source.convertedToId) {
    throw ApiError.badRequest(
      `This ${config.from.label.toLowerCase()} has already been converted`,
      { convertedToId: String(source.convertedToId), convertedToModel: source.convertedToModel }
    );
  }
  if (!config.convertibleStatuses.includes(source.status)) {
    throw ApiError.badRequest(
      `A ${config.from.label.toLowerCase()} that is ${source.status} cannot be converted`
    );
  }

  // Line inputs rebuilt from the stored lines. `buildLineItems` re-snapshots
  // the product name and re-derives the amounts, but the PRICES come from the
  // source, so the arithmetic is re-verified without the terms changing.
  const lineItems = source.lineItems.map((line: any) => ({
    productId: String(line.productId),
    quantity: line.quantity,
    unitPrice: line.unitPrice,
    discountPercent: line.discountPercent,
    gstPercent: line.gstPercent,
    warehouseId: line.warehouseId ? String(line.warehouseId) : null,
    batchNumber: line.batchNumber,
  }));

  const input = {
    customerId: String(source.customerId),
    lineItems,
    date: new Date(),
    notes: source.notes,
    termsAndConditions: source.termsAndConditions,
    sourceDocumentId: source._id,
    sourceDocumentModel: config.fromModelName,
    ...overrides,
  } as CreateDocumentInput;

  // An invoice goes through createInvoice so that conversion gets the same
  // transaction — converting an order into an invoice must move stock and post
  // the ledger exactly as raising one directly does.
  const created =
    config.toModelName === 'Invoice'
      ? await createInvoice(tenant, { ...input, confirm: options.confirm ?? true })
      : await config.to.create(tenant, input);

  source.status = 'Converted';
  source.convertedToId = created._id;
  source.convertedToModel = config.toModelName;
  await source.save();

  return created;
}

export async function convertQuotationToOrder(
  tenant: TenantContext,
  quotationId: string,
  overrides: { expectedDeliveryDate?: Date } = {}
) {
  return convertDocument(
    tenant,
    quotationId,
    {
      from: quotationService,
      fromModelName: 'Quotation',
      to: salesOrderService,
      toModelName: 'SalesOrder',
      // A rejected or expired quotation is not a basis for an order. Reviving
      // one means reissuing it, which is a decision someone should make
      // explicitly rather than have a convert button make for them.
      convertibleStatuses: ['Draft', 'Sent', 'Accepted'],
    },
    { status: 'Confirmed', ...overrides }
  );
}

export async function convertOrderToInvoice(
  tenant: TenantContext,
  orderId: string,
  options: { confirm?: boolean; dueDate?: Date } = {}
) {
  return convertDocument(
    tenant,
    orderId,
    {
      from: salesOrderService,
      fromModelName: 'SalesOrder',
      to: invoiceService,
      toModelName: 'Invoice',
      convertibleStatuses: ['Draft', 'Confirmed', 'PartiallyDelivered', 'Delivered'],
    },
    { ...(options.dueDate ? { dueDate: options.dueDate } : {}) },
    { confirm: options.confirm }
  );
}

/**
 * Quotation straight to invoice, skipping the order.
 *
 * A counter sale quoted and paid in the same visit has no order stage, and
 * forcing an empty one through would litter the order list with documents
 * nobody asked for.
 */
export async function convertQuotationToInvoice(
  tenant: TenantContext,
  quotationId: string,
  options: { confirm?: boolean; dueDate?: Date } = {}
) {
  return convertDocument(
    tenant,
    quotationId,
    {
      from: quotationService,
      fromModelName: 'Quotation',
      to: invoiceService,
      toModelName: 'Invoice',
      convertibleStatuses: ['Draft', 'Sent', 'Accepted'],
    },
    { ...(options.dueDate ? { dueDate: options.dueDate } : {}) },
    { confirm: options.confirm }
  );
}

/**
 * The full chain behind one document, for the detail page: what it came from
 * and what it became.
 */
export async function getDocumentChain(
  tenant: TenantContext,
  service: SalesDocumentService,
  id: string
) {
  const document = await service.getRaw(tenant, id);

  const modelFor = (name: string | null) =>
    name === 'Quotation'
      ? QuotationModel
      : name === 'SalesOrder'
        ? SalesOrderModel
        : name === 'Invoice'
          ? SalesInvoiceModel
          : null;

  const sourceModel = modelFor(document.sourceDocumentModel);
  const targetModel = modelFor(document.convertedToModel);

  const [source, target] = await Promise.all([
    sourceModel && document.sourceDocumentId
      ? sourceModel
          .findOne(tenantFilter(tenant, { _id: document.sourceDocumentId }))
          .select('documentNumber status date grandTotal')
          .lean()
      : null,
    targetModel && document.convertedToId
      ? targetModel
          .findOne(tenantFilter(tenant, { _id: document.convertedToId }))
          .select('documentNumber status date grandTotal')
          .lean()
      : null,
  ]);

  return {
    source: source ? { ...source, model: document.sourceDocumentModel } : null,
    target: target ? { ...target, model: document.convertedToModel } : null,
  };
}
