import { Types, type ClientSession, type Model } from 'mongoose';
import { ApiError } from '../utils/ApiError.js';
import { ProductModel } from '../models/Product.js';
import { CustomerModel } from '../models/Customer.js';
import { CompanyModel } from '../models/Company.js';
import { GSTRateModel } from '../models/GSTRate.js';
import { nextDocumentNumber, type NumberingConfig } from './numbering.service.js';
import {
  tenantById,
  tenantFilter,
  tenantStamp,
  type TenantContext,
} from '../middlewares/tenantScope.js';

/**
 * SHARED TRADE-DOCUMENT ENGINE
 * ============================
 * Quotations, sales orders, invoices, purchase orders, GRNs and purchase bills
 * are structurally one document (see models/tradeDocument.ts). The CRUD, the
 * line-item construction and the arithmetic live here once; what differs per
 * type — statuses, side effects on confirmation, the conversion chain — lives
 * in sales.service.ts and purchase.service.ts.
 *
 * The one thing this file has to be told is WHICH PARTY the document is
 * against, because the buying side stores `supplierId` where the selling side
 * stores `customerId`, and looks it up in a different collection. Everything
 * else — the money, the snapshotting, the numbering, the paging — is identical
 * and would drift if it were copied.
 */

/* ------------------------------------------------------------------ *
 * Money
 * ------------------------------------------------------------------ */

/**
 * Money is rounded to paise at EVERY step, not just at the end.
 *
 * Without this, a 12-line invoice accumulates binary-float residue and the
 * printed grand total disagrees with the sum of the printed line totals by a
 * paisa — the single most common "the invoice is wrong" complaint there is, and
 * unarguable when a customer adds the column up by hand. Rounding each
 * intermediate keeps every figure exactly what it prints as.
 *
 * (The same reasoning as the float note in stock.service, opposite conclusion:
 * stock quantities are continuous and tolerate an epsilon, money is discrete
 * and does not.)
 */
export const round2 = (value: number): number => Math.round(value * 100) / 100;

/**
 * INTRA-STATE vs INTER-STATE DETERMINATION
 * -----------------------------------------
 * GST law: a supply is intra-state when the place of supply (the buyer's
 * state) equals the supplier's registration state. When they differ, IGST
 * applies instead of CGST + SGST.
 *
 * We derive the state from the GSTIN's first two characters (the state code)
 * when both parties have a GSTIN, otherwise fall back to the free-text state
 * field. Neither field is mandatory, so when either is unknown we default to
 * 'intra' to avoid over-reporting IGST.
 */
export type SupplyType = 'intra' | 'inter' | 'exempt';

function stateCode(gstin?: string | null, stateField?: string | null): string {
  if (gstin && gstin.length >= 2) return gstin.substring(0, 2).toUpperCase();
  return (stateField ?? '').trim().toUpperCase();
}

export function determineSupplyType(
  companyGstin: string | null | undefined,
  companyState: string | null | undefined,
  partyGstin: string | null | undefined,
  partyState: string | null | undefined
): SupplyType {
  const from = stateCode(companyGstin, companyState);
  const to = stateCode(partyGstin, partyState);
  if (!from || !to) return 'intra'; // unknown — default to intra
  return from === to ? 'intra' : 'inter';
}

export interface LineItemInput {
  productId: string;
  quantity: number;
  /** Defaults to the product's selling price when omitted. */
  unitPrice?: number;
  discountPercent?: number;
  /** Defaults to the product's GST rate when omitted. */
  gstPercent?: number;
  warehouseId?: string | null;
  batchNumber?: string | null;
  expiryDate?: Date | null;

  /**
   * MRP / tax-inclusive billing mode.
   * When true, `unitPrice` is the tax-inclusive MRP and the base price
   * is back-calculated as:  basePrice = mrp / (1 + gstRate/100)
   * This keeps the final line total equal to qty × mrp exactly.
   */
  isTaxInclusive?: boolean;

  /**
   * The line on the SOURCE document this one was copied from.
   */
  sourceLineItemId?: string | Types.ObjectId | null;
  /** GRN lines: what the order asked for, beside what arrived. */
  orderedQuantity?: number | null;
  rejectedQuantity?: number | null;
}

export interface ComputedLineItem {
  productId: Types.ObjectId;
  name: string;
  sku: string;
  hsnCode: string | null;
  quantity: number;
  unitPrice: number;
  discountPercent: number;
  gstPercent: number;
  cgstPercent: number;
  sgstPercent: number;
  igstPercent: number;
  cessPercent: number;
  discountAmount: number;
  taxableAmount: number;
  taxAmount: number;
  cgstAmount: number;
  sgstAmount: number;
  igstAmount: number;
  cessAmount: number;
  lineTotal: number;
  warehouseId: Types.ObjectId | null;
  batchNumber: string | null;
  expiryDate: Date | null;
  sourceLineItemId: Types.ObjectId | null;
  orderedQuantity: number | null;
  rejectedQuantity: number;
}

/**
 * Turns client line input into stored lines, snapshotting the product.
 *
 * Prices and GST rates default from the product but are ACCEPTED from the
 * client when given: a shop negotiates, and an invoice that silently overwrote
 * an agreed price with the list price would be wrong. What is never taken from
 * the client is the arithmetic — every amount below is computed here.
 *
 * When `supplyType` is provided, the combined gstPercent is split into
 * CGST+SGST (intra-state) or IGST (inter-state) and stored per-line. The
 * GSTRate master is consulted per HSN code when available, so the split is
 * correct even for non-standard rates (e.g. differential CESS).
 */
export async function buildLineItems(
  tenant: TenantContext,
  lines: LineItemInput[],
  supplyType: SupplyType = 'intra'
): Promise<ComputedLineItem[]> {
  if (!lines || lines.length === 0) {
    throw ApiError.badRequest('Add at least one line item');
  }

  const productIds = lines.map((line) => {
    if (!Types.ObjectId.isValid(line.productId)) {
      throw ApiError.badRequest(`'${line.productId}' is not a valid product id`);
    }
    return new Types.ObjectId(line.productId);
  });

  // One query for every line rather than one per line.
  const products = await ProductModel.find(
    tenantFilter(tenant, { _id: { $in: productIds } })
  )
    .select('name sku hsnCode sellingPrice gstPercentage')
    .lean();

  const byId = new Map(products.map((product) => [String(product._id), product]));

  // Pre-fetch GST rates for all HSN codes present on the lines, so we can
  // split the combined rate into components without an N+1 loop.
  const hsnCodes = [...new Set(products.map((p) => p.hsnCode).filter(Boolean))] as string[];
  const gstRates = hsnCodes.length
    ? await GSTRateModel.find(
        tenantFilter(tenant, { hsnCode: { $in: hsnCodes }, isActive: true })
      )
        .select('hsnCode cgstPercent sgstPercent igstPercent cessPercent')
        .lean()
    : [];
  const rateByHsn = new Map(
    gstRates.map((r) => [
      r.hsnCode.toUpperCase(),
      { cgst: r.cgstPercent, sgst: r.sgstPercent, igst: r.igstPercent, cess: r.cessPercent },
    ])
  );

  return lines.map((line) => {
    const product = byId.get(line.productId);
    if (!product) throw ApiError.notFound(`Product ${line.productId} not found`);

    if (!(line.quantity > 0)) {
      throw ApiError.badRequest(`Quantity for ${product.name} must be greater than zero`);
    }

    const rawUnitPrice = round2(line.unitPrice ?? product.sellingPrice ?? 0);
    const discountPercent = line.discountPercent ?? 0;
    const gstPercent = line.gstPercent ?? product.gstPercentage ?? 0;

    /**
     * MRP tax-inclusive back-calculation
     * -----------------------------------
     * When isTaxInclusive is true the caller supplies the MRP (tax-included).
     * We derive the base (ex-tax) unit price so that:
     *   basePrice × (1 + gstRate/100) ≈ mrp
     * The line total stays exactly qty × mrp — no rounding surprise on the
     * printed receipt.
     *
     * Example:  MRP = ₹118, GST = 18%
     *   basePrice = 118 / 1.18 = ₹100.00
     *   taxAmount = 100 × 18% = ₹18.00
     *   lineTotal = 100 + 18  = ₹118.00  ✓
     */
    const unitPrice = line.isTaxInclusive
      ? round2(rawUnitPrice / (1 + gstPercent / 100))
      : rawUnitPrice;

    const gross = round2(line.quantity * unitPrice);
    const discountAmount = round2((gross * discountPercent) / 100);
    const taxableAmount = round2(gross - discountAmount);
    const taxAmount = round2((taxableAmount * gstPercent) / 100);

    // Resolve GST component rates. Use the GSTRate master when available;
    // fall back to a simple 50/50 CGST/SGST split of the combined rate.
    const hsnKey = product.hsnCode?.toUpperCase() ?? '';
    const masterRate = rateByHsn.get(hsnKey);

    let cgstPercent: number, sgstPercent: number, igstPercent: number, cessPercent: number;

    if (masterRate) {
      cgstPercent = masterRate.cgst;
      sgstPercent = masterRate.sgst;
      igstPercent = masterRate.igst;
      cessPercent = masterRate.cess;
    } else {
      // Derive from combined rate: split 50/50 for intra, full for inter.
      const halfRate = round2(gstPercent / 2);
      cgstPercent = halfRate;
      sgstPercent = halfRate;
      igstPercent = gstPercent;
      cessPercent = 0;
    }

    // Compute amounts based on supply type.
    let cgstAmount = 0, sgstAmount = 0, igstAmount = 0, cessAmount = 0;
    if (supplyType === 'intra') {
      cgstAmount = round2((taxableAmount * cgstPercent) / 100);
      sgstAmount = round2((taxableAmount * sgstPercent) / 100);
      cessAmount = round2((taxableAmount * cessPercent) / 100);
    } else if (supplyType === 'inter') {
      igstAmount = round2((taxableAmount * igstPercent) / 100);
      cessAmount = round2((taxableAmount * cessPercent) / 100);
    }

    return {
      productId: new Types.ObjectId(line.productId),
      name: product.name,
      sku: product.sku,
      hsnCode: product.hsnCode ?? null,
      quantity: line.quantity,
      unitPrice,
      discountPercent,
      gstPercent,
      cgstPercent: supplyType === 'intra' ? cgstPercent : 0,
      sgstPercent: supplyType === 'intra' ? sgstPercent : 0,
      igstPercent: supplyType === 'inter' ? igstPercent : 0,
      cessPercent,
      discountAmount,
      taxableAmount,
      taxAmount,
      cgstAmount,
      sgstAmount,
      igstAmount,
      cessAmount,
      lineTotal: round2(taxableAmount + taxAmount + cessAmount),
      warehouseId: line.warehouseId ? new Types.ObjectId(line.warehouseId) : null,
      batchNumber: line.batchNumber?.trim() || null,
      expiryDate: line.expiryDate ?? null,
      sourceLineItemId: line.sourceLineItemId
        ? new Types.ObjectId(String(line.sourceLineItemId))
        : null,
      orderedQuantity: line.orderedQuantity ?? null,
      rejectedQuantity: line.rejectedQuantity ?? 0,
    };
  });
}

export interface DocumentTotals {
  subTotal: number;
  totalDiscount: number;
  totalTax: number;
  roundOff: number;
  grandTotal: number;
}

/**
 * Totals for a set of lines.
 *
 * `subTotal` is the gross before discount, so the printed block reads
 * subtotal − discount + tax ± round-off = grand total, which is the order an
 * Indian invoice states it in.
 *
 * `roundOff` carries the difference to the nearest rupee. Stored as its own
 * visible line rather than silently absorbed, because a customer who adds up
 * the lines must be able to see where the last 40 paise went.
 */
export function computeTotals(lines: ComputedLineItem[]): DocumentTotals {
  const subTotal = round2(
    lines.reduce((sum, line) => sum + line.quantity * line.unitPrice, 0)
  );
  const totalDiscount = round2(lines.reduce((sum, line) => sum + line.discountAmount, 0));
  const totalTax = round2(lines.reduce((sum, line) => sum + line.taxAmount, 0));
  const beforeRounding = round2(lines.reduce((sum, line) => sum + line.lineTotal, 0));

  const grandTotal = Math.round(beforeRounding);
  return {
    subTotal,
    totalDiscount,
    totalTax,
    roundOff: round2(grandTotal - beforeRounding),
    grandTotal,
  };
}

/* ------------------------------------------------------------------ *
 * Shared CRUD
 * ------------------------------------------------------------------ */

export interface TradeDocumentConfig {
  model: Model<any>;
  /** Label used in errors, e.g. 'Quotation'. */
  label: string;
  numbering: NumberingConfig;
  /** Statuses in which the document may still be edited or deleted. */
  editableStatuses: readonly string[];
  /**
   * The party this document is against. Defaults to the customer/selling side
   * so every Phase 9/10 call site is unchanged; purchase passes the supplier.
   */
  party?: {
    model: Model<any>;
    /** e.g. 'customerId' / 'supplierId'. */
    field: string;
    /** e.g. 'customerName' / 'supplierName'. */
    nameField: string;
    /** Used in error messages, e.g. 'Customer' / 'Supplier'. */
    label: string;
  };
}

export interface ListQuery {
  status?: string;
  customerId?: string;
  supplierId?: string;
  from?: Date;
  to?: Date;
  search?: string;
  page?: number;
  limit?: number;
}

export interface CreateDocumentInput {
  /** The party id. Named for the selling side; purchase passes `supplierId`. */
  customerId?: string;
  supplierId?: string;
  lineItems: LineItemInput[];
  date?: Date;
  dueDate?: Date | null;
  notes?: string | null;
  termsAndConditions?: string | null;
  status?: string;
  [key: string]: unknown;
}

export function createTradeDocumentService(config: TradeDocumentConfig) {
  const { model, label, numbering, editableStatuses } = config;
  const party = config.party ?? {
    model: CustomerModel,
    field: 'customerId',
    nameField: 'customerName',
    label: 'Customer',
  };

  async function list(tenant: TenantContext, query: ListQuery = {}) {
    const page = Math.max(1, query.page ?? 1);
    const limit = Math.min(200, Math.max(1, query.limit ?? 25));

    const filter: Record<string, unknown> = {};
    if (query.status) filter.status = query.status;
    const partyId = query.customerId ?? query.supplierId;
    if (partyId) filter[party.field] = new Types.ObjectId(partyId);
    if (query.from || query.to) {
      filter.date = {
        ...(query.from ? { $gte: query.from } : {}),
        ...(query.to ? { $lte: query.to } : {}),
      };
    }
    if (query.search) {
      const rx = new RegExp(query.search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
      // Customer name is matched against the SNAPSHOT on the document, not
      // through a join — it is what the document says, and it is indexed here.
      filter.$or = [{ documentNumber: rx }, { [party.nameField]: rx }];
    }

    const scoped = tenantFilter(tenant, filter);

    const [documents, total, summary] = await Promise.all([
      model
        .find(scoped)
        .sort({ date: -1, _id: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean(),
      model.countDocuments(scoped),
      // The totals strip above the list. Computed over the FILTERED set, not
      // the page — "₹40,000 outstanding" must not change when you turn the page.
      model.aggregate([
        { $match: scoped },
        {
          $group: {
            _id: null,
            value: { $sum: '$grandTotal' },
            count: { $sum: 1 },
          },
        },
      ]),
    ]);

    return {
      documents,
      summary: {
        count: summary[0]?.count ?? 0,
        value: round2(summary[0]?.value ?? 0),
      },
      pagination: { page, limit, total, pages: Math.ceil(total / limit) || 1 },
    };
  }

  async function getById(tenant: TenantContext, id: string) {
    if (!Types.ObjectId.isValid(id)) throw ApiError.badRequest(`Not a valid ${label} id`);
    const document = await model
      .findOne(tenantById(tenant, id))
      .populate(party.field, 'name phone email gstNumber billingAddress shippingAddress address')
      .lean();
    if (!document) throw ApiError.notFound(`${label} not found`);
    return document;
  }

  /** The raw document, unpopulated — for internal callers that will mutate it. */
  async function getRaw(tenant: TenantContext, id: string, session?: ClientSession) {
    if (!Types.ObjectId.isValid(id)) throw ApiError.badRequest(`Not a valid ${label} id`);
    const query = model.findOne(tenantById(tenant, id));
    if (session) query.session(session);
    const document = await query;
    if (!document) throw ApiError.notFound(`${label} not found`);
    return document;
  }

  /**
   * Builds the full document payload — lines, totals, number, customer
   * snapshot — without writing it. Split out so the transactional invoice path
   * can assemble a document inside its own session.
   */
  async function buildPayload(
    tenant: TenantContext,
    input: CreateDocumentInput,
    options: { session?: ClientSession } = {}
  ) {
    /**
     * These reads MUST join the caller's session.
     *
     * Outside it they see the pre-transaction snapshot, so a customer created
     * earlier in the same transaction is invisible — which is exactly what POS
     * does when it creates the walk-in customer and immediately invoices it.
     * The failure is a confusing "Customer not found" on a customer that
     * demonstrably exists.
     */
    const partyId = input[party.field] as string | undefined;
    if (!partyId) throw ApiError.badRequest(`${party.label} is required`);

    const partyDoc = (await (party.model as Model<any>)
      .findOne(tenantById(tenant, partyId))
      .session(options.session ?? null)
      .lean()) as { _id: unknown; name: string; gstNumber?: string; billingAddress?: { state?: string }; address?: { state?: string } } | null;
    if (!partyDoc) throw ApiError.notFound(`${party.label} not found`);

    const partyGstin = partyDoc.gstNumber ?? null;
    const partyState =
      partyDoc.billingAddress?.state ??
      partyDoc.address?.state ??
      null;

    // Resolve company info for supply-type determination.
    const companyFull = await CompanyModel.findById(tenant.companyId)
      .select('financialYearStart gstNumber state')
      .session(options.session ?? null)
      .lean();

    const supplyType = determineSupplyType(
      companyFull?.gstNumber ?? null,
      companyFull?.state ?? null,
      partyGstin,
      partyState
    );

    const lineItems = await buildLineItems(tenant, input.lineItems, supplyType);
    const totals = computeTotals(lineItems);

    const date = input.date ?? new Date();
    const documentNumber = await nextDocumentNumber(tenant, numbering, {
      session: options.session,
      date,
      financialYearStart: companyFull?.financialYearStart ?? 4,
    });

    const { lineItems: _ignored, customerId: _c, supplierId: _s, ...rest } = input;

    return tenantStamp(tenant, {
      ...rest,
      documentNumber,
      [party.field]: partyDoc._id,
      [party.nameField]: partyDoc.name,
      partyGstin,
      supplyType,
      date,
      lineItems,
      ...totals,
      createdBy: tenant.actor?.userId ?? null,
    });
  }

  async function create(tenant: TenantContext, input: CreateDocumentInput) {
    const payload = await buildPayload(tenant, input);
    const created = await model.create(payload);
    return created.toObject();
  }

  /**
   * Edits are refused once the document has moved on.
   *
   * A converted quotation is the source of an order that already copied its
   * lines; a posted invoice has already moved stock and hit the ledger. Editing
   * either would leave the downstream document stating something the upstream
   * one no longer says. Amend by issuing the next document, or cancel and
   * reissue — the same reasoning that makes the ledgers append-only.
   */
  async function update(
    tenant: TenantContext,
    id: string,
    input: Partial<CreateDocumentInput>
  ) {
    const existing = await getRaw(tenant, id);

    if (!editableStatuses.includes(existing.status)) {
      throw ApiError.badRequest(
        `This ${label.toLowerCase()} is ${existing.status} and can no longer be edited`
      );
    }

    const newPartyId = input[party.field] as string | undefined;
    if (newPartyId) {
      const partyDoc = (await (party.model as Model<any>)
        .findOne(tenantById(tenant, newPartyId))
        .lean()) as { _id: unknown; name: string } | null;
      if (!partyDoc) throw ApiError.notFound(`${party.label} not found`);
      existing[party.field] = partyDoc._id;
      existing[party.nameField] = partyDoc.name;
    }

    if (input.lineItems) {
      // Re-determine supply type in case the party changed.
      const existingSupplyType: string = (existing as any).supplyType ?? 'intra';
      const lineItems = await buildLineItems(
        tenant,
        input.lineItems,
        existingSupplyType as 'intra' | 'inter' | 'exempt'
      );
      existing.lineItems = lineItems;
      Object.assign(existing, computeTotals(lineItems));
    }

    for (const [key, value] of Object.entries(input)) {
      // Everything the client may not set directly: identity, the money, and
      // the conversion chain. Totals are recomputed above, never assigned.
      if (
        [
          'lineItems',
          'customerId',
          'supplierId',
          'documentNumber',
          'companyId',
          'subTotal',
          'totalDiscount',
          'totalTax',
          'roundOff',
          'grandTotal',
          'sourceDocumentId',
          'sourceDocumentModel',
          'convertedToId',
          'convertedToModel',
        ].includes(key)
      ) {
        continue;
      }
      (existing as Record<string, unknown>)[key] = value;
    }

    await existing.save();
    return existing.toObject();
  }

  async function remove(tenant: TenantContext, id: string) {
    const existing = await getRaw(tenant, id);
    if (!editableStatuses.includes(existing.status)) {
      throw ApiError.badRequest(
        `This ${label.toLowerCase()} is ${existing.status} and cannot be deleted. Cancel it instead.`
      );
    }
    await model.deleteOne(tenantById(tenant, id));
    return { deleted: true };
  }

  async function setStatus(tenant: TenantContext, id: string, status: string) {
    const existing = await getRaw(tenant, id);
    existing.status = status;
    await existing.save();
    return existing.toObject();
  }

  return { list, getById, getRaw, buildPayload, create, update, remove, setStatus, model, label };
}

export type TradeDocumentService = ReturnType<typeof createTradeDocumentService>;

/**
 * Phase 9/10 names, kept so those call sites read unchanged. New code should
 * prefer the trade-neutral names.
 */
export const createSalesDocumentService = createTradeDocumentService;
export type SalesDocumentService = TradeDocumentService;
