import { Types, type ClientSession, type Model } from 'mongoose';
import { ApiError } from '../utils/ApiError.js';
import {
  tenantById,
  tenantFilter,
  tenantStamp,
  type TenantContext,
} from '../middlewares/tenantScope.js';

/**
 * SHARED LEDGER ENGINE
 * ====================
 * Customers and suppliers keep structurally identical books — an append-only
 * list of debits and credits with a denormalised running balance, and a
 * denormalised `currentBalance` on the party. They differ in exactly one thing:
 * WHICH COLUMN INCREASES THE BALANCE.
 *
 *   Customer (a receivable / debtor): a sales invoice DEBITS them. Positive
 *     balance = they owe us.
 *   Supplier (a payable / creditor):  a purchase bill CREDITS them. Positive
 *     balance = we owe them.
 *
 * That is not a cosmetic flip. Booking a purchase bill as a debit would be
 * plain wrong double-entry, and would make the payables total read as negative.
 * So the direction is a required parameter of this factory rather than
 * something each caller remembers to get right.
 *
 * Everything else — atomic balance movement, compensation on failure, opening
 * balances, statement pagination, the outstanding rollup — lives here once.
 */

export type BalanceDirection = 'debit' | 'credit';

export interface LedgerConfig {
  /** The append-only entry collection. */
  entryModel: Model<any>;
  /** The party collection carrying the denormalised `currentBalance`. */
  ownerModel: Model<any>;
  /** Name of the entry field pointing at the party, e.g. 'customerId'. */
  ownerField: string;
  /** Human label used in error messages, e.g. 'Customer'. */
  ownerLabel: string;
  /** Which column increases this party's balance. See the note above. */
  balanceIncreasedBy: BalanceDirection;
  /** Party fields echoed back with a statement. */
  ownerSummaryFields: string[];
  /** `referenceModel` used for the synthetic opening-balance entry. */
  openingReferenceModel: string;
  /** `type` used for the synthetic opening-balance entry. */
  openingType: string;
}

export interface AppendEntryInput {
  ownerId: string | Types.ObjectId;
  type: string;
  debit?: number;
  credit?: number;
  referenceModel: string;
  referenceId: string | Types.ObjectId;
  date?: Date;
  narration?: string;
}

export interface AppendEntryOptions {
  /**
   * Join a caller's transaction. Phase 9 (Sales) opens one transaction covering
   * the invoice, the stock movements and this ledger entry, so that a failure
   * in any of the three rolls back all of them.
   *
   * When a session is supplied the manual compensation below is SKIPPED — the
   * transaction is what undoes a partial write, and compensating on top of it
   * would double-reverse the balance on abort.
   */
  session?: ClientSession;
}

export interface LedgerQuery {
  from?: Date;
  to?: Date;
  page?: number;
  limit?: number;
}

export function createLedgerService(config: LedgerConfig) {
  const {
    entryModel,
    ownerModel,
    ownerField,
    ownerLabel,
    balanceIncreasedBy,
    ownerSummaryFields,
    openingReferenceModel,
    openingType,
  } = config;

  /** Signed effect of an entry on this party's balance. */
  const balanceDelta = (debit: number, credit: number) =>
    balanceIncreasedBy === 'debit' ? debit - credit : credit - debit;

  /**
   * Appends one entry and moves the party's balance by the same amount.
   *
   * The `$inc` + `new: true` findOneAndUpdate is doing real work: it makes the
   * read-modify-write of `currentBalance` a single atomic operation and hands
   * back the post-update value to use as this entry's `runningBalance`. Reading
   * the balance and then writing balance+delta would let two concurrent bills
   * for the same party both read the same starting figure and lose one amount.
   */
  async function appendEntry(
    tenant: TenantContext,
    input: AppendEntryInput,
    options: AppendEntryOptions = {}
  ) {
    const debit = input.debit ?? 0;
    const credit = input.credit ?? 0;

    if (debit < 0 || credit < 0) {
      throw ApiError.badRequest('Ledger amounts cannot be negative');
    }
    if (debit === 0 && credit === 0) {
      throw ApiError.badRequest('A ledger entry needs either a debit or a credit');
    }
    if (debit > 0 && credit > 0) {
      throw ApiError.badRequest('A ledger entry cannot be both a debit and a credit');
    }

    const delta = balanceDelta(debit, credit);

    const session = options.session;

    const owner = await ownerModel.findOneAndUpdate(
      tenantById(tenant, String(input.ownerId)),
      { $inc: { currentBalance: delta } },
      { new: true, ...(session ? { session } : {}) }
    );
    if (!owner) throw ApiError.notFound(`${ownerLabel} not found`);

    try {
      // `create` takes an array when given a session — the single-document
      // form silently ignores the option and would write outside the
      // transaction, which is worse than not using one at all.
      const [created] = await entryModel.create(
        [tenantStamp(tenant, {
          [ownerField]: owner._id,
          date: input.date ?? new Date(),
          type: input.type,
          debit,
          credit,
          runningBalance: owner.currentBalance,
          referenceModel: input.referenceModel,
          referenceId: new Types.ObjectId(String(input.referenceId)),
          narration: input.narration,
        })],
        session ? { session } : {}
      );
      return created;
    } catch (err) {
      // Inside a transaction the abort is the rollback. Compensating here as
      // well would reverse the balance twice.
      if (session) throw err;

      // The balance moved but the entry did not land. Put it back, or
      // `currentBalance` permanently states a figure with no line item behind
      // it. (A replica-set deployment should promote this pair to a real
      // transaction; this compensation is the correct behaviour on standalone.)
      await ownerModel.updateOne(tenantById(tenant, String(input.ownerId)), {
        $inc: { currentBalance: -delta },
      });
      throw err;
    }
  }

  /**
   * Materialises a non-zero opening balance as the party's first entry.
   *
   * A positive amount always means "the normal direction for this party" — the
   * customer owes us, or we owe the supplier — so it lands on whichever column
   * increases the balance. A negative amount is the reverse position (a
   * customer in credit, or an advance we have already paid a supplier).
   */
  async function seedOpeningBalance(
    tenant: TenantContext,
    ownerId: string | Types.ObjectId,
    amount: number,
    date?: Date,
    options: AppendEntryOptions = {}
  ) {
    if (!amount) return null;

    const onIncreasingSide = amount > 0;
    const column =
      onIncreasingSide === (balanceIncreasedBy === 'debit') ? 'debit' : 'credit';

    return appendEntry(tenant, {
      ownerId,
      type: openingType,
      [column]: Math.abs(amount),
      referenceModel: openingReferenceModel,
      referenceId: ownerId,
      date: date ?? new Date(),
      narration: 'Opening balance',
    }, options);
  }

  /**
   * A party's statement of account, oldest first.
   *
   * Also returns `openingForPeriod` — the balance just before `from`. Without
   * it a date-filtered statement is unreadable: the first visible row's
   * `runningBalance` would seem to appear from nowhere.
   */
  async function getLedger(tenant: TenantContext, ownerId: string, query: LedgerQuery = {}) {
    // `.lean()` on a loosely-typed Model widens to a document-or-array union;
    // findOne only ever yields one, so narrow it here rather than at each use.
    const owner = (await ownerModel
      .findOne(tenantById(tenant, ownerId))
      .select(ownerSummaryFields.join(' '))
      .lean()) as Record<string, any> | null;
    if (!owner) throw ApiError.notFound(`${ownerLabel} not found`);

    const page = Math.max(1, query.page ?? 1);
    const limit = Math.min(200, Math.max(1, query.limit ?? 50));

    const dateFilter: Record<string, Date> = {};
    if (query.from) dateFilter.$gte = query.from;
    if (query.to) dateFilter.$lte = query.to;

    const entryFilter = tenantFilter(tenant, {
      [ownerField]: owner._id,
      ...(Object.keys(dateFilter).length > 0 && { date: dateFilter }),
    });

    const [entries, total, openingForPeriod] = await Promise.all([
      entryModel
        .find(entryFilter)
        .sort({ date: 1, _id: 1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean(),
      entryModel.countDocuments(entryFilter),
      query.from
        ? entryModel
            .findOne(
              tenantFilter(tenant, { [ownerField]: owner._id, date: { $lt: query.from } })
            )
            .sort({ date: -1, _id: -1 })
            .select('runningBalance')
            .lean()
            .then((prior: any) => prior?.runningBalance ?? 0)
        : Promise.resolve(0),
    ]);

    const totals = (entries as any[]).reduce(
      (acc, entry) => ({
        debit: acc.debit + (entry.debit ?? 0),
        credit: acc.credit + (entry.credit ?? 0),
      }),
      { debit: 0, credit: 0 }
    );

    return {
      owner,
      entries,
      openingForPeriod,
      totals,
      pagination: { page, limit, total, pages: Math.ceil(total / limit) || 1 },
    };
  }

  /**
   * Rollup of what is outstanding across the active company.
   *
   * `parties` lists only non-zero balances — a list of everyone, mostly zeroes,
   * is not what "outstanding" means to whoever is chasing or paying money.
   *
   * @param extraGroup additional `$group` accumulators, for party-specific
   *   metrics (e.g. customers over their credit limit).
   */
  async function getOutstanding(
    tenant: TenantContext,
    listFields: string[],
    extraGroup: Record<string, unknown> = {}
  ) {
    const [summary] = await ownerModel.aggregate([
      { $match: { companyId: tenant.companyId, isActive: true } },
      {
        $group: {
          _id: null,
          totalOutstanding: {
            $sum: { $cond: [{ $gt: ['$currentBalance', 0] }, '$currentBalance', 0] },
          },
          totalAdvance: {
            $sum: { $cond: [{ $lt: ['$currentBalance', 0] }, '$currentBalance', 0] },
          },
          partiesWithDues: {
            $sum: { $cond: [{ $gt: ['$currentBalance', 0] }, 1, 0] },
          },
          ...extraGroup,
        },
      },
    ]);

    const parties = await ownerModel
      .find(tenantFilter(tenant, { isActive: true, currentBalance: { $ne: 0 } }))
      .select(listFields.join(' '))
      .sort({ currentBalance: -1 })
      .lean();

    return {
      summary: summary ?? {},
      totalOutstanding: summary?.totalOutstanding ?? 0,
      // Stored negative; reported as a positive "this much sits in advances".
      totalAdvance: Math.abs(summary?.totalAdvance ?? 0),
      partiesWithDues: summary?.partiesWithDues ?? 0,
      parties,
    };
  }

  return { appendEntry, seedOpeningBalance, getLedger, getOutstanding, balanceDelta };
}
