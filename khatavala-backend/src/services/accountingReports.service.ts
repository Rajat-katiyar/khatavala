import { Types, type PipelineStage } from 'mongoose';
import { ApiError } from '../utils/ApiError.js';
import { AccountModel, normalBalanceOf, type AccountType } from '../models/Account.js';
import { JournalEntryModel } from '../models/JournalEntry.js';
import { ensureDefaultAccounts } from './account.service.js';
import { round2 } from './tradeDocument.factory.js';
import { tenantFilter, type TenantContext } from '../middlewares/tenantScope.js';

/**
 * LEDGER READS — account ledger, cash book, bank book, trial balance.
 *
 * All of them are the same shape: unwind the journal lines, keep the ones
 * touching the accounts in question, order them, and run a balance down the
 * column. That is done in ONE aggregation rather than by loading entries and
 * summing in Node, because an account with a year of postings is tens of
 * thousands of lines and the running balance has to start from an opening
 * figure the page does not contain.
 *
 * THE OPENING BALANCE IS THE PART THAT IS EASY TO GET WRONG. A date-filtered
 * ledger whose first row starts from zero is not a ledger — it silently claims
 * the account was empty on the "from" date. So every read below computes the
 * balance BEFORE the period separately and carries it in.
 */

interface LedgerQuery {
  from?: Date;
  to?: Date;
  page?: number;
  limit?: number;
}

/** The `$unwind` + `$match` prefix every one of these reads shares. */
function linesForAccounts(
  tenant: TenantContext,
  accountIds: Types.ObjectId[],
  dateFilter: Record<string, Date> = {}
): PipelineStage[] {
  return [
    {
      $match: tenantFilter(tenant, {
        'lines.accountId': { $in: accountIds },
        ...(Object.keys(dateFilter).length > 0 ? { date: dateFilter } : {}),
      }),
    },
    { $unwind: '$lines' },
    // Re-applied AFTER the unwind: the entry matched because SOME line touched
    // the account, but the others belong to different accounts entirely.
    { $match: { 'lines.accountId': { $in: accountIds } } },
  ];
}

/** Net movement (signed toward the account's normal side) before a date. */
async function openingBalanceFor(
  tenant: TenantContext,
  accountIds: Types.ObjectId[],
  normalBalance: 'debit' | 'credit',
  before?: Date
): Promise<number> {
  if (!before) return 0;

  const [result] = await JournalEntryModel.aggregate([
    ...linesForAccounts(tenant, accountIds, { $lt: before }),
    {
      $group: {
        _id: null,
        debit: { $sum: '$lines.debitAmount' },
        credit: { $sum: '$lines.creditAmount' },
      },
    },
  ]);

  if (!result) return 0;
  return round2(
    normalBalance === 'debit' ? result.debit - result.credit : result.credit - result.debit
  );
}

interface LedgerRow {
  entryId: Types.ObjectId;
  documentNumber: string;
  date: Date;
  narration: string | null;
  sourceType: string;
  sourceNumber: string | null;
  accountId: Types.ObjectId;
  accountName: string;
  description: string | null;
  debit: number;
  credit: number;
}

/**
 * The shared ledger read. `accountIds` is a list so the cash book can span
 * every cash account and the bank book every bank account.
 */
async function buildLedger(
  tenant: TenantContext,
  accountIds: Types.ObjectId[],
  normalBalance: 'debit' | 'credit',
  query: LedgerQuery
) {
  const page = Math.max(1, query.page ?? 1);
  const limit = Math.min(500, Math.max(1, query.limit ?? 100));

  const dateFilter: Record<string, Date> = {};
  if (query.from) dateFilter.$gte = query.from;
  if (query.to) dateFilter.$lte = query.to;

  const [opening, result] = await Promise.all([
    openingBalanceFor(tenant, accountIds, normalBalance, query.from),
    JournalEntryModel.aggregate([
      ...linesForAccounts(tenant, accountIds, dateFilter),
      {
        $project: {
          _id: 0,
          entryId: '$_id',
          documentNumber: 1,
          date: 1,
          narration: 1,
          sourceType: 1,
          sourceNumber: 1,
          accountId: '$lines.accountId',
          accountName: '$lines.accountName',
          description: '$lines.description',
          debit: '$lines.debitAmount',
          credit: '$lines.creditAmount',
        },
      },
      // `_id` after `date` so lines posted in the same millisecond hold a
      // stable order — otherwise the running balance column appears to jump
      // between two loads of the same page.
      { $sort: { date: 1, entryId: 1 } },
      {
        $facet: {
          rows: [{ $skip: (page - 1) * limit }, { $limit: limit }],
          totals: [
            {
              $group: {
                _id: null,
                debit: { $sum: '$debit' },
                credit: { $sum: '$credit' },
                count: { $sum: 1 },
              },
            },
          ],
        },
      },
    ]),
  ]);

  const facet = result[0] ?? { rows: [], totals: [] };
  const rows: LedgerRow[] = facet.rows ?? [];
  const totals = facet.totals[0] ?? { debit: 0, credit: 0, count: 0 };

  /**
   * The running balance is computed HERE rather than in the pipeline.
   *
   * `$setWindowFields` could do it server-side, but it would have to run over
   * the whole period before paging — and the figure a reader wants on page 3 is
   * the balance carried forward from page 2, not a recomputation from the start
   * of time. Carrying `opening` in and accumulating over the page gives exactly
   * that, at the cost of one number the client already has.
   */
  let balance = opening;
  const entries = rows.map((row) => {
    const movement =
      normalBalance === 'debit' ? row.debit - row.credit : row.credit - row.debit;
    balance = round2(balance + movement);
    return { ...row, runningBalance: balance };
  });

  return {
    opening,
    entries,
    totals: {
      debit: round2(totals.debit),
      credit: round2(totals.credit),
      // The period's net movement, signed toward the normal side.
      net: round2(
        normalBalance === 'debit'
          ? totals.debit - totals.credit
          : totals.credit - totals.debit
      ),
    },
    closing: balance,
    pagination: {
      page,
      limit,
      total: totals.count,
      pages: Math.ceil(totals.count / limit) || 1,
    },
  };
}

/** One account's ledger. */
export async function getAccountLedger(
  tenant: TenantContext,
  accountId: string,
  query: LedgerQuery = {}
) {
  if (!Types.ObjectId.isValid(accountId)) {
    throw ApiError.badRequest('Not a valid account id');
  }

  const account = await AccountModel.findOne(
    tenantFilter(tenant, { _id: new Types.ObjectId(accountId) })
  ).lean();
  if (!account) throw ApiError.notFound('Account not found');

  const normalBalance = normalBalanceOf(account.accountType as AccountType);
  const ledger = await buildLedger(
    tenant,
    [account._id],
    normalBalance,
    query
  );

  return {
    account: {
      _id: account._id,
      accountName: account.accountName,
      accountType: account.accountType,
      normalBalance,
    },
    ...ledger,
  };
}

/**
 * Cash book and bank book.
 *
 * Both are "the ledger of the accounts of this kind", so they share everything
 * with the account ledger except which accounts they span. Resolved by SYSTEM
 * KEY plus descendants, so a company that adds "HDFC Current A/c" under Bank
 * sees it in the bank book without configuring anything.
 */
async function bookFor(
  tenant: TenantContext,
  systemKey: 'CASH' | 'BANK',
  query: LedgerQuery
) {
  const accounts = await ensureDefaultAccounts(tenant);
  const root = accounts.get(systemKey)!;

  // One level of children is enough for a chart of this shape; deeper nesting
  // under Cash/Bank is not a structure this module creates.
  const children = await AccountModel.find(
    tenantFilter(tenant, { parentAccountId: root._id })
  )
    .select('_id')
    .lean();

  const accountIds = [root._id, ...children.map((child) => child._id)];
  const ledger = await buildLedger(tenant, accountIds, 'debit', query);

  return {
    book: systemKey === 'CASH' ? 'Cash book' : 'Bank book',
    accountIds,
    ...ledger,
  };
}

export const getCashBook = (tenant: TenantContext, query: LedgerQuery = {}) =>
  bookFor(tenant, 'CASH', query);

export const getBankBook = (tenant: TenantContext, query: LedgerQuery = {}) =>
  bookFor(tenant, 'BANK', query);

/**
 * TRIAL BALANCE — every account with a balance, and the proof that the books
 * balance overall.
 *
 * Not asked for, but it is four lines on top of what is already here and it is
 * the one report that says whether the whole system is sound: if total debits
 * do not equal total credits, something has posted an unbalanced entry and
 * every other report is suspect.
 */
export async function getTrialBalance(
  tenant: TenantContext,
  query: { from?: Date; to?: Date } = {}
) {
  const dateFilter: Record<string, Date> = {};
  if (query.from) dateFilter.$gte = query.from;
  if (query.to) dateFilter.$lte = query.to;

  const rows = await JournalEntryModel.aggregate([
    {
      $match: tenantFilter(
        tenant,
        Object.keys(dateFilter).length > 0 ? { date: dateFilter } : {}
      ),
    },
    { $unwind: '$lines' },
    {
      $group: {
        _id: '$lines.accountId',
        accountName: { $first: '$lines.accountName' },
        debit: { $sum: '$lines.debitAmount' },
        credit: { $sum: '$lines.creditAmount' },
      },
    },
    {
      $lookup: {
        from: AccountModel.collection.name,
        localField: '_id',
        foreignField: '_id',
        as: 'account',
        pipeline: [{ $project: { accountType: 1, code: 1 } }],
      },
    },
    { $unwind: { path: '$account', preserveNullAndEmptyArrays: true } },
    { $sort: { 'account.code': 1, accountName: 1 } },
  ]);

  const accounts = rows.map((row) => {
    const type = (row.account?.accountType ?? 'Asset') as AccountType;
    const normalBalance = normalBalanceOf(type);
    const balance = round2(
      normalBalance === 'debit' ? row.debit - row.credit : row.credit - row.debit
    );
    return {
      accountId: row._id,
      accountName: row.accountName,
      accountType: type,
      code: row.account?.code ?? null,
      debit: round2(row.debit),
      credit: round2(row.credit),
      normalBalance,
      balance,
    };
  });

  const totalDebit = round2(accounts.reduce((sum, a) => sum + a.debit, 0));
  const totalCredit = round2(accounts.reduce((sum, a) => sum + a.credit, 0));

  return {
    accounts,
    totals: {
      debit: totalDebit,
      credit: totalCredit,
      difference: round2(totalDebit - totalCredit),
      // The health check. Anything but true means an unbalanced entry exists,
      // which postJournal is supposed to make impossible.
      balanced: Math.abs(totalDebit - totalCredit) < 0.005,
    },
  };
}
