import { Types, type ClientSession } from 'mongoose';
import { PaymentModel } from '../models/Payment.js';
import { SalesInvoiceModel, POSTED_STATUSES } from '../models/SalesInvoice.js';
import * as customerLedger from './customerLedger.service.js';
import * as journalService from './journal.service.js';
import {
  createPaymentEngine,
  type RecordPaymentInput,
  type PaymentMode,
} from './payment.factory.js';
import type { TenantContext } from '../middlewares/tenantScope.js';

export type { RecordPaymentInput, PaymentMode };

/**
 * THE ONLY WRITER OF CUSTOMER PAYMENTS and of `Invoice.amountPaid`.
 *
 * The mechanics moved to payment.factory.ts in Phase 11, shared with the
 * supplier side. What is customer-specific is the DIRECTION: a customer is a
 * debtor, so a receipt CREDITS them and reduces what they owe.
 *
 * The exported surface is unchanged from Phase 10 — POS, the sales routes and
 * salesReturn.service all call it exactly as before.
 */
const engine = createPaymentEngine({
  paymentModel: PaymentModel,
  billModel: SalesInvoiceModel,
  billField: 'invoiceId',
  partyField: 'customerId',
  billLabel: 'Invoice',
  numbering: { key: 'Payment', prefix: 'PAY' },
  postedStatuses: POSTED_STATUSES,
  // Customer-specific. See ledger.factory.ts on why direction is a parameter
  // rather than something each caller is trusted to get right.
  direction: 'credit',
  ledgerReferenceModel: 'Payment',
  appendLedgerEntry: (tenant, input, options) =>
    customerLedger.appendEntry(tenant, input as never, options),
  ledgerPartyKey: 'customerId',
  postJournal: (tenant, payment, bill, session, options) =>
    journalService.postReceiptJournal(tenant, payment, bill, session, options),
});

export const applyPayment = engine.applyPayment;

export async function recordPayment(
  tenant: TenantContext,
  invoiceId: string,
  input: RecordPaymentInput
) {
  const { payment, bill } = await engine.recordPayment(tenant, invoiceId, input);
  // Callers since Phase 10 expect `invoice`, not the engine's neutral `bill`.
  return { payment, invoice: bill };
}

/** Cash handed back to a customer on a return. */
export async function refundPayment(
  tenant: TenantContext,
  invoice: any,
  input: RecordPaymentInput & { salesReturnId?: Types.ObjectId },
  session: ClientSession
) {
  const { salesReturnId, ...rest } = input;
  return engine.refundPayment(tenant, invoice, rest, session, {
    salesReturnId: salesReturnId ?? null,
  });
}

export async function getPaymentsForInvoice(tenant: TenantContext, invoiceId: string) {
  const { bill, payments, totals } = await engine.getPaymentsForBill(tenant, invoiceId);
  return { invoice: bill, payments, totals };
}

export const getPaymentSummary = engine.getPaymentSummary;
