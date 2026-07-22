import { Types } from 'mongoose';
import { SupplierModel } from '../models/Supplier.js';
import {
  SupplierLedgerEntryModel,
  type SupplierLedgerEntryType,
} from '../models/SupplierLedgerEntry.js';
import { createLedgerService, type AppendEntryOptions } from './ledger.factory.js';
import { tenantFilter, type TenantContext } from '../middlewares/tenantScope.js';

/**
 * The ONLY writer of supplier ledger entries and of `Supplier.currentBalance`.
 *
 * The Purchases and Payments modules call `appendEntry` rather than touching
 * either collection themselves. Keeping a single writer is what makes the
 * invariant `currentBalance === last entry's runningBalance` hold.
 *
 * `balanceIncreasedBy: 'credit'` is the one line that differs from the customer
 * ledger, and it is the important one: a supplier is a creditor, so a purchase
 * bill credits them and increases the payable.
 */
const ledger = createLedgerService({
  entryModel: SupplierLedgerEntryModel,
  ownerModel: SupplierModel,
  ownerField: 'supplierId',
  ownerLabel: 'Supplier',
  balanceIncreasedBy: 'credit',
  ownerSummaryFields: ['name', 'phone', 'currentBalance', 'vendorRating'],
  openingReferenceModel: 'Supplier',
  openingType: 'Opening',
});

export interface AppendEntryInput {
  supplierId: string;
  type: SupplierLedgerEntryType;
  /** Reduces what we owe — a payment made, or a debit note. */
  debit?: number;
  /** Increases what we owe — a purchase bill. */
  credit?: number;
  referenceModel: 'PurchaseInvoice' | 'Payment' | 'DebitNote' | 'Supplier';
  referenceId: string | Types.ObjectId;
  date?: Date;
  narration?: string;
  /** Only meaningful on PurchaseInvoice entries; drives payment reminders. */
  dueDate?: Date;
}

export async function appendEntry(
  tenant: TenantContext,
  input: AppendEntryInput,
  options: AppendEntryOptions = {}
) {
  const { supplierId, dueDate, ...rest } = input;
  const entry = await ledger.appendEntry(tenant, { ...rest, ownerId: supplierId }, options);

  // dueDate is not part of the shared engine's shape — it is specific to the
  // payables side — so it is stamped on after the entry lands.
  if (dueDate) {
    await SupplierLedgerEntryModel.updateOne(
      { _id: entry._id },
      { $set: { dueDate } },
      options.session ? { session: options.session } : {}
    );
    entry.dueDate = dueDate;
  }
  return entry;
}

/** Materialises a non-zero opening balance as the supplier's first entry. */
export async function seedOpeningBalance(
  tenant: TenantContext,
  supplierId: string | Types.ObjectId,
  amount: number,
  date?: Date
) {
  return ledger.seedOpeningBalance(tenant, supplierId, amount, date);
}

export interface LedgerQuery {
  from?: Date;
  to?: Date;
  page?: number;
  limit?: number;
}

export async function getLedger(
  tenant: TenantContext,
  supplierId: string,
  query: LedgerQuery = {}
) {
  const { owner, ...rest } = await ledger.getLedger(tenant, supplierId, query);
  return { supplier: owner, ...rest };
}

/**
 * Payables summary for the active company.
 *
 * The mirror of the customer module's `getOutstanding`, named for what it
 * actually is on this side of the books: money we owe, not money owed to us.
 */
export async function getOutstandingPayables(tenant: TenantContext) {
  const result = await ledger.getOutstanding(tenant, [
    'name',
    'phone',
    'currentBalance',
    'vendorRating',
  ]);

  return {
    totals: {
      totalPayable: result.totalOutstanding,
      // Money we have paid ahead of billing — an asset, not a payable.
      totalAdvancePaid: result.totalAdvance,
      suppliersWithDues: result.partiesWithDues,
    },
    suppliers: result.parties,
  };
}

/** Count of a supplier's ledger entries; used to decide delete vs deactivate. */
export async function countEntries(tenant: TenantContext, supplierId: Types.ObjectId) {
  return SupplierLedgerEntryModel.countDocuments(tenantFilter(tenant, { supplierId }));
}

/**
 * Bills that are due or overdue, for the Payment Reminders tab.
 *
 * Deliberately reads `dueDate` off invoice entries rather than inferring
 * anything from the supplier's net balance: a supplier can owe us nothing on
 * net while still having one bill three weeks overdue and a credit note
 * offsetting it, and "nothing overdue" would be the wrong answer.
 *
 * Until the Purchases module sets `dueDate`, this returns an empty list rather
 * than guessing — which is the honest answer, not a broken one.
 */
export async function getPaymentReminders(
  tenant: TenantContext,
  supplierId: string,
  asOf: Date = new Date()
) {
  const supplier = await SupplierModel.findOne(
    tenantFilter(tenant, { _id: supplierId })
  ).lean();
  if (!supplier) return null;

  const bills = await SupplierLedgerEntryModel.find(
    tenantFilter(tenant, {
      supplierId: supplier._id,
      type: 'PurchaseInvoice',
      dueDate: { $ne: null },
    })
  )
    .sort({ dueDate: 1 })
    .lean();

  const dueSoonCutoff = new Date(asOf.getTime() + 7 * 24 * 60 * 60 * 1000);

  const withStatus = bills.map((bill) => {
    const due = bill.dueDate as Date;
    const daysOverdue = Math.floor((asOf.getTime() - due.getTime()) / 86_400_000);
    return {
      ...bill,
      daysOverdue: daysOverdue > 0 ? daysOverdue : 0,
      status: due < asOf ? 'overdue' : due <= dueSoonCutoff ? 'dueSoon' : 'upcoming',
    };
  });

  return {
    supplier: {
      _id: supplier._id,
      name: supplier.name,
      currentBalance: supplier.currentBalance,
    },
    bills: withStatus,
    totals: {
      overdue: withStatus.filter((b) => b.status === 'overdue').length,
      dueSoon: withStatus.filter((b) => b.status === 'dueSoon').length,
      overdueAmount: withStatus
        .filter((b) => b.status === 'overdue')
        .reduce((sum, b) => sum + (b.credit ?? 0), 0),
    },
  };
}
