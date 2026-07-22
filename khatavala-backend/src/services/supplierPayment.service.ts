import { Types, type ClientSession } from 'mongoose';
import { SupplierPaymentModel } from '../models/SupplierPayment.js';
import {
  PurchaseInvoiceModel,
  POSTED_PURCHASE_STATUSES,
} from '../models/PurchaseInvoice.js';
import * as supplierLedger from './supplierLedger.service.js';
import * as journalService from './journal.service.js';
import { createPaymentEngine, type RecordPaymentInput } from './payment.factory.js';
import type { TenantContext } from '../middlewares/tenantScope.js';

/**
 * THE ONLY WRITER OF SUPPLIER PAYMENTS and of `PurchaseInvoice.amountPaid`.
 *
 * The exact mirror of payment.service, sharing payment.factory.ts. The ONE
 * substantive difference is the direction:
 *
 *   Customer (a debtor):   a receipt CREDITS them — they owe us less.
 *   Supplier (a creditor): a payment DEBITS them — we owe them less.
 *
 * That is not cosmetic. Crediting a supplier when we pay them would INCREASE
 * the payable and make every ageing report read inverted — which is exactly why
 * the direction is a parameter of the shared engine rather than a line each
 * service writes for itself.
 */
const engine = createPaymentEngine({
  paymentModel: SupplierPaymentModel,
  billModel: PurchaseInvoiceModel,
  billField: 'purchaseInvoiceId',
  partyField: 'supplierId',
  billLabel: 'Purchase invoice',
  numbering: { key: 'SupplierPayment', prefix: 'SPAY' },
  postedStatuses: POSTED_PURCHASE_STATUSES,
  direction: 'debit',
  ledgerReferenceModel: 'SupplierPayment',
  appendLedgerEntry: (tenant, input, options) =>
    supplierLedger.appendEntry(tenant, input as never, options),
  ledgerPartyKey: 'supplierId',
  postJournal: (tenant, payment, bill, session, options) =>
    journalService.postSupplierPaymentJournal(tenant, payment, bill, session, options),
});

export const applyPayment = engine.applyPayment;

export async function recordPayment(
  tenant: TenantContext,
  purchaseInvoiceId: string,
  input: RecordPaymentInput
) {
  const { payment, bill } = await engine.recordPayment(tenant, purchaseInvoiceId, input);
  return { payment, purchaseInvoice: bill };
}

/** Money refunded BY the supplier against a debit note. */
export async function refundPayment(
  tenant: TenantContext,
  purchaseInvoice: any,
  input: RecordPaymentInput & { debitNoteId?: Types.ObjectId },
  session: ClientSession
) {
  const { debitNoteId, ...rest } = input;
  return engine.refundPayment(tenant, purchaseInvoice, rest, session, {
    debitNoteId: debitNoteId ?? null,
  });
}

export async function getPaymentsForInvoice(
  tenant: TenantContext,
  purchaseInvoiceId: string
) {
  const { bill, payments, totals } = await engine.getPaymentsForBill(
    tenant,
    purchaseInvoiceId
  );
  return { purchaseInvoice: bill, payments, totals };
}

/** What we paid out, by mode, over a period. */
export const getPaymentSummary = engine.getPaymentSummary;
