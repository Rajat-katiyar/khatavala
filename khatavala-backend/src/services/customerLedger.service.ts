import { Types } from 'mongoose';
import { CustomerModel } from '../models/Customer.js';
import {
  CustomerLedgerEntryModel,
  type LedgerEntryType,
} from '../models/CustomerLedgerEntry.js';
import { createLedgerService, type AppendEntryOptions } from './ledger.factory.js';
import { tenantFilter, type TenantContext } from '../middlewares/tenantScope.js';

/**
 * The ONLY writer of customer ledger entries and of `Customer.currentBalance`.
 *
 * The Sales, Payments and Credit Note modules call `appendEntry` rather than
 * touching either collection themselves. Keeping a single writer is what makes
 * the invariant `currentBalance === last entry's runningBalance` hold.
 *
 * The mechanics live in ledger.factory.ts, shared with suppliers. What is
 * customer-specific is the DIRECTION: a customer is a debtor, so a debit (a
 * sales invoice) increases what they owe us.
 */
const ledger = createLedgerService({
  entryModel: CustomerLedgerEntryModel,
  ownerModel: CustomerModel,
  ownerField: 'customerId',
  ownerLabel: 'Customer',
  balanceIncreasedBy: 'debit',
  ownerSummaryFields: ['name', 'phone', 'currentBalance', 'creditLimit'],
  openingReferenceModel: 'Customer',
  openingType: 'Opening',
});

export interface AppendEntryInput {
  customerId: string;
  type: LedgerEntryType;
  /** Increases what the customer owes. Mutually exclusive with `credit`. */
  debit?: number;
  /** Decreases what the customer owes. Mutually exclusive with `debit`. */
  credit?: number;
  referenceModel: 'Invoice' | 'Payment' | 'CreditNote' | 'Customer';
  referenceId: string | Types.ObjectId;
  date?: Date;
  narration?: string;
}

export async function appendEntry(
  tenant: TenantContext,
  input: AppendEntryInput,
  options: AppendEntryOptions = {}
) {
  const { customerId, ...rest } = input;
  return ledger.appendEntry(tenant, { ...rest, ownerId: customerId }, options);
}

/** Materialises a non-zero opening balance as the customer's first entry. */
export async function seedOpeningBalance(
  tenant: TenantContext,
  customerId: string | Types.ObjectId,
  amount: number,
  date?: Date
) {
  return ledger.seedOpeningBalance(tenant, customerId, amount, date);
}

export interface LedgerQuery {
  from?: Date;
  to?: Date;
  page?: number;
  limit?: number;
}

export async function getLedger(
  tenant: TenantContext,
  customerId: string,
  query: LedgerQuery = {}
) {
  const { owner, ...rest } = await ledger.getLedger(tenant, customerId, query);
  return { customer: owner, ...rest };
}

/**
 * Receivables summary for the active company.
 */
export async function getOutstanding(tenant: TenantContext) {
  const result = await ledger.getOutstanding(
    tenant,
    ['name', 'phone', 'currentBalance', 'creditLimit'],
    {
      // Customer-specific: nobody has a credit limit on the supplier side.
      overLimit: {
        $sum: {
          $cond: [
            {
              $and: [
                { $gt: ['$creditLimit', 0] },
                { $gt: ['$currentBalance', '$creditLimit'] },
              ],
            },
            1,
            0,
          ],
        },
      },
    }
  );

  return {
    totals: {
      totalReceivable: result.totalOutstanding,
      totalAdvance: result.totalAdvance,
      customersWithDues: result.partiesWithDues,
      customersOverCreditLimit: result.summary.overLimit ?? 0,
    },
    customers: result.parties,
  };
}

/** Count of a customer's ledger entries; used to decide delete vs deactivate. */
export async function countEntries(tenant: TenantContext, customerId: Types.ObjectId) {
  return CustomerLedgerEntryModel.countDocuments(tenantFilter(tenant, { customerId }));
}
