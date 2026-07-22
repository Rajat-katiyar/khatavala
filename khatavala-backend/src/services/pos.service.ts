import mongoose, { Types } from 'mongoose';
import { ApiError } from '../utils/ApiError.js';
import { SalesInvoiceModel } from '../models/SalesInvoice.js';
import { ProductModel } from '../models/Product.js';
import { CustomerModel } from '../models/Customer.js';
import { CompanyModel } from '../models/Company.js';
import * as paymentService from './payment.service.js';
import * as salesService from './sales.service.js';
import { round2 } from './tradeDocument.factory.js';
import { tenantFilter, type TenantContext } from '../middlewares/tenantScope.js';
import type { PaymentMode } from '../models/Payment.js';

/**
 * POS CHECKOUT — one call, one transaction.
 *
 * The counter screen posts a cart and gets back a finished sale. Everything
 * that would otherwise be three or four round trips (create invoice → confirm →
 * take payment → read back) happens server-side in a single transaction:
 *
 *   invoice created + posted → stock deducted → customer debited → payment
 *   recorded → customer credited
 *
 * WHY ONE CALL RATHER THAN REUSING THE EXISTING ENDPOINTS
 * ------------------------------------------------------
 * Not for tidiness — for correctness under the conditions a counter actually
 * runs in. Split across calls, a dropped connection between "confirm" and "take
 * payment" leaves an unpaid invoice for goods the customer has already walked
 * out with, and the operator has no way to tell whether to re-charge. One call
 * has one outcome: the whole sale, or none of it.
 *
 * It is also the difference between one network round trip and four on a till
 * that may be on a shop's mobile connection.
 *
 * This service composes the existing writers rather than reimplementing them —
 * `sales.service.createInvoice` for the invoice and its side effects,
 * `payment.service.applyPayment` for the money. POS is a faster front door to
 * the same machinery, not a second implementation of it.
 */

export interface PosCartLine {
  productId: string;
  quantity: number;
  /** Overrides the product's selling price — the counter can discount. */
  unitPrice?: number;
  discountPercent?: number;
}

export interface PosCheckoutInput {
  lines: PosCartLine[];
  /**
   * Optional. A walk-in cash sale has no named customer, so the till falls back
   * to the company's counter customer (created on demand — see below). Without
   * that fallback every anonymous sale would need a fake customer typed in.
   */
  customerId?: string | null;
  payment: {
    mode: PaymentMode;
    /**
     * Defaults to the full total. Passing less leaves the invoice
     * PartiallyPaid, which is a legitimate counter case (part cash, rest on
     * account) — but the sale still completes.
     */
    amount?: number;
    referenceNumber?: string | null;
    /** Cash tendered, for computing change. Not stored — display only. */
    tendered?: number;
  };
  warehouseId?: string | null;
  notes?: string | null;
}

/** The name used for the walk-in customer every till needs. */
const COUNTER_CUSTOMER_NAME = 'Walk-in Customer';

/**
 * Finds or creates the company's walk-in customer.
 *
 * One shared row rather than a new customer per anonymous sale: thousands of
 * empty customer records would make the customer master unusable, and none of
 * them would ever be looked up again. The ledger still balances — the walk-in
 * account is debited by the sale and credited by the payment in the same
 * transaction, netting to zero for a fully paid cash sale.
 */
async function resolveCounterCustomer(tenant: TenantContext, session: mongoose.ClientSession) {
  const existing = await CustomerModel.findOne(
    tenantFilter(tenant, { name: COUNTER_CUSTOMER_NAME })
  ).session(session);
  if (existing) return existing;

  // Phone is required and unique per company on the customer master, so the
  // placeholder is derived from the company id — unique per tenant, and
  // obviously not a real number to anyone reading it.
  const placeholderPhone = `0000${String(tenant.companyId).slice(-6)}`;

  const [created] = await CustomerModel.create(
    [
      {
        companyId: tenant.companyId,
        name: COUNTER_CUSTOMER_NAME,
        phone: placeholderPhone,
        notes: 'Auto-created for counter sales with no named customer.',
      },
    ],
    { session }
  );
  return created;
}

export async function checkout(tenant: TenantContext, input: PosCheckoutInput) {
  if (!input.lines || input.lines.length === 0) {
    throw ApiError.badRequest('The cart is empty');
  }

  const session = await mongoose.startSession();
  try {
    let result: any;
    await session.withTransaction(async () => {
      const customer = input.customerId
        ? await CustomerModel.findOne(
            tenantFilter(tenant, { _id: new Types.ObjectId(input.customerId) })
          ).session(session)
        : await resolveCounterCustomer(tenant, session);

      if (!customer) throw ApiError.notFound('Customer not found');

      // The invoice is built and posted by the shared path, so POS gets the
      // same arithmetic, the same stock deduction and the same gapless
      // numbering as any other invoice — inside OUR session.
      const invoice: any = await salesService.createInvoiceInSession(
        tenant,
        {
          customerId: String(customer._id),
          lineItems: input.lines.map((line) => ({
            productId: line.productId,
            quantity: line.quantity,
            unitPrice: line.unitPrice,
            discountPercent: line.discountPercent,
            warehouseId: input.warehouseId ?? null,
          })),
          notes: input.notes ?? null,
          channel: 'POS',
          confirm: true,
        },
        session
      );

      const amount = input.payment.amount ?? invoice.grandTotal;

      let payment = null;
      if (amount > 0) {
        payment = await paymentService.applyPayment(
          tenant,
          invoice,
          {
            amount,
            mode: input.payment.mode,
            referenceNumber: input.payment.referenceNumber ?? null,
          },
          session
        );
      }

      result = {
        invoice: invoice.toObject(),
        payment: payment ? payment.toObject() : null,
        // Change is computed, never stored: the till drawer is not a ledger,
        // and what the operator handed back is not a fact the books need.
        change:
          input.payment.tendered && input.payment.tendered > amount
            ? round2(input.payment.tendered - amount)
            : 0,
      };
    });
    return result;
  } finally {
    await session.endSession();
  }
}

/**
 * The product grid for the touch UI: the fast-moving items an operator taps
 * rather than scans.
 *
 * Ordered by what is actually selling — a grid sorted alphabetically puts
 * whatever begins with 'A' in front of the operator all day. Falls back to
 * recently-created products for a shop with no sales history yet.
 */
export async function getQuickProducts(
  tenant: TenantContext,
  query: { search?: string; categoryId?: string; limit?: number } = {}
) {
  const limit = Math.min(60, Math.max(1, query.limit ?? 24));

  const filter: Record<string, unknown> = { isActive: true };
  if (query.categoryId) filter.categoryId = new Types.ObjectId(query.categoryId);
  if (query.search) {
    const rx = new RegExp(query.search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
    filter.$or = [{ name: rx }, { sku: rx }, { barcode: rx }];
  }

  const products = await ProductModel.find(tenantFilter(tenant, filter))
    .select('name sku barcode sellingPrice gstPercentage currentStock imageUrl')
    .sort({ currentStock: -1, name: 1 })
    .limit(limit)
    .lean();

  return { products };
}

/**
 * Everything the till needs to render a receipt, in one call: the sale, the
 * shop's own details and the payment.
 */
export async function getReceipt(tenant: TenantContext, invoiceId: string) {
  if (!Types.ObjectId.isValid(invoiceId)) {
    throw ApiError.badRequest('Not a valid invoice id');
  }

  const [invoice, company, payments] = await Promise.all([
    SalesInvoiceModel.findOne(
      tenantFilter(tenant, { _id: new Types.ObjectId(invoiceId) })
    ).lean(),
    CompanyModel.findById(tenant.companyId)
      .select('name address state gstNumber invoicePrefix currency')
      .lean(),
    paymentService.getPaymentsForInvoice(tenant, invoiceId),
  ]);

  if (!invoice) throw ApiError.notFound('Invoice not found');

  return { invoice, company, payments: payments.payments, totals: payments.totals };
}
