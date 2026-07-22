import { Types, type PipelineStage } from 'mongoose';
import { ApiError } from '../utils/ApiError.js';
import { AccountModel, normalBalanceOf, type AccountType } from '../models/Account.js';
import { JournalEntryModel } from '../models/JournalEntry.js';
import { ensureDefaultAccounts } from './account.service.js';
import { round2 } from './tradeDocument.factory.js';
import { tenantFilter, type TenantContext } from '../middlewares/tenantScope.js';

/**
 * FINANCIAL STATEMENTS — trial balance, P&L, balance sheet, day book.
 *
 * All four are the same aggregation with different grouping: unwind the journal
 * lines, bucket them by account, and net each bucket toward its account's
 * normal side. Doing that once (`accountBalances`) is what makes the reports
 * agree with each other — three hand-written pipelines would drift the first
 * time someone changed how a contra account is treated.
 *
 * THE IDENTITY THEY ALL REST ON
 * -----------------------------
 * Because every journal entry balances (enforced in journal.service), summing
 * every line gives total debits === total credits. Writing A for assets, L for
 * liabilities, E for equity, I for income and X for expenses — each netted
 * toward its own normal side — that identity rearranges to:
 *
 *     A + X = L + E + I        (debit-normal totals = credit-normal totals)
 *     A     = L + E + (I − X)
 *     A     = L + E + Profit
 *
 * So the balance sheet balances *because* the trial balance does, and retained
 * earnings is not a stored figure to be maintained — it is the P&L result to
 * date. That is why nothing here "closes the books": closing would move the
 * same number into equity and give two places for it to disagree.
 */

/* ------------------------------------------------------------------ *
 * Shared balance computation
 * ------------------------------------------------------------------ */

export interface AccountBalance {
  accountId: Types.ObjectId;
  accountName: string;
  accountType: AccountType;
  code: string | null;
  systemKey: string | null;
  debit: number;
  credit: number;
  /** Netted toward the account's normal side. */
  balance: number;
  normalBalance: 'debit' | 'credit';
  /** How many journal entries contributed — the drill-down's row count. */
  entryCount: number;
}

function dateMatch(from?: Date, to?: Date): Record<string, Date> {
  const filter: Record<string, Date> = {};
  if (from) filter.$gte = from;
  if (to) filter.$lte = to;
  return filter;
}

/**
 * Net movement per account over a period.
 *
 * The `$lookup` is on the ACCOUNT rather than trusting `lines.accountName`,
 * because the report needs the account's TYPE to know which way to net it, and
 * the snapshotted name on the line is deliberately frozen at posting time.
 */
async function accountBalances(
  tenant: TenantContext,
  options: { from?: Date; to?: Date } = {}
): Promise<AccountBalance[]> {
  const period = dateMatch(options.from, options.to);

  const pipeline: PipelineStage[] = [
    {
      $match: tenantFilter(
        tenant,
        Object.keys(period).length > 0 ? { date: period } : {}
      ),
    },
    { $unwind: '$lines' },
    {
      $group: {
        _id: '$lines.accountId',
        accountName: { $first: '$lines.accountName' },
        debit: { $sum: '$lines.debitAmount' },
        credit: { $sum: '$lines.creditAmount' },
        // Distinct entries, not lines: one entry can touch an account twice.
        entryIds: { $addToSet: '$_id' },
      },
    },
    {
      $lookup: {
        from: AccountModel.collection.name,
        localField: '_id',
        foreignField: '_id',
        as: 'account',
        pipeline: [{ $project: { accountType: 1, code: 1, systemKey: 1, accountName: 1 } }],
      },
    },
    { $unwind: { path: '$account', preserveNullAndEmptyArrays: true } },
    { $sort: { 'account.code': 1, accountName: 1 } },
  ];

  const rows = await JournalEntryModel.aggregate(pipeline);

  return rows.map((row) => {
    const accountType = (row.account?.accountType ?? 'Asset') as AccountType;
    const normalBalance = normalBalanceOf(accountType);
    const debit = round2(row.debit);
    const credit = round2(row.credit);
    return {
      accountId: row._id,
      // The live name, so a renamed account reads correctly on a new report
      // while old journal entries keep the name they were posted under.
      accountName: row.account?.accountName ?? row.accountName,
      accountType,
      code: row.account?.code ?? null,
      systemKey: row.account?.systemKey ?? null,
      debit,
      credit,
      balance: round2(normalBalance === 'debit' ? debit - credit : credit - debit),
      normalBalance,
      entryCount: row.entryIds.length,
    };
  });
}

/** The drill-down key every report line carries. See the header of getDrillDown. */
const drillDownFor = (
  balance: AccountBalance,
  from?: Date,
  to?: Date
) => ({
  accountId: String(balance.accountId),
  from: from ? from.toISOString() : null,
  to: to ? to.toISOString() : null,
  entryCount: balance.entryCount,
});

/* ------------------------------------------------------------------ *
 * Trial balance
 * ------------------------------------------------------------------ */

export async function getTrialBalance(
  tenant: TenantContext,
  query: { from?: Date; to?: Date } = {}
) {
  await ensureDefaultAccounts(tenant);
  const balances = await accountBalances(tenant, query);

  const accounts = balances.map((balance) => ({
    accountId: balance.accountId,
    accountName: balance.accountName,
    accountType: balance.accountType,
    code: balance.code,
    debit: balance.debit,
    credit: balance.credit,
    normalBalance: balance.normalBalance,
    balance: balance.balance,
    drillDown: drillDownFor(balance, query.from, query.to),
  }));

  const totalDebit = round2(accounts.reduce((sum, a) => sum + a.debit, 0));
  const totalCredit = round2(accounts.reduce((sum, a) => sum + a.credit, 0));

  return {
    period: { from: query.from ?? null, to: query.to ?? null },
    accounts,
    totals: {
      debit: totalDebit,
      credit: totalCredit,
      difference: round2(totalDebit - totalCredit),
      // If this is ever false, something bypassed journal.service.postJournal
      // and every other report on this page is suspect.
      balanced: Math.abs(totalDebit - totalCredit) < 0.005,
    },
  };
}

/* ------------------------------------------------------------------ *
 * Profit & loss
 * ------------------------------------------------------------------ */

/**
 * Contra accounts, which is the part of a P&L that is easy to get wrong.
 *
 * `Sales Returns` is TYPED as an Expense so that a debit increases it (see
 * account.service on why), and `Purchase Returns` is typed as Income for the
 * mirror reason. Grouping the statement naively by account type would therefore
 * print purchase returns as revenue and sales returns as an operating cost —
 * both wrong, and both plausible enough to go unnoticed.
 *
 * So the statement is built by ROLE: revenue is netted against sales returns,
 * and cost of goods against purchase returns. The bottom line is identical
 * either way — this only changes which section each figure is reported in,
 * which is exactly what a reader relies on.
 */
const SALES_RETURN_KEY = 'SALES_RETURN';
const PURCHASE_RETURN_KEY = 'PURCHASE_RETURN';
const COGS_KEYS = new Set(['PURCHASE', PURCHASE_RETURN_KEY]);

export async function getProfitAndLoss(
  tenant: TenantContext,
  query: { from?: Date; to?: Date } = {}
) {
  await ensureDefaultAccounts(tenant);
  const balances = await accountBalances(tenant, query);

  const line = (balance: AccountBalance, amount: number) => ({
    accountId: balance.accountId,
    accountName: balance.accountName,
    code: balance.code,
    amount: round2(amount),
    drillDown: drillDownFor(balance, query.from, query.to),
  });

  const revenue: ReturnType<typeof line>[] = [];
  const costOfSales: ReturnType<typeof line>[] = [];
  const otherIncome: ReturnType<typeof line>[] = [];
  const expenses: ReturnType<typeof line>[] = [];

  for (const balance of balances) {
    if (balance.accountType !== 'Income' && balance.accountType !== 'Expense') continue;
    // A zero-movement account is noise on a statement.
    if (Math.abs(balance.balance) < 0.005) continue;

    if (balance.systemKey === 'SALES') {
      revenue.push(line(balance, balance.balance));
    } else if (balance.systemKey === SALES_RETURN_KEY) {
      // Shown in revenue as a deduction, not as an expense.
      revenue.push(line(balance, -balance.balance));
    } else if (balance.systemKey && COGS_KEYS.has(balance.systemKey)) {
      costOfSales.push(
        line(balance, balance.systemKey === PURCHASE_RETURN_KEY ? -balance.balance : balance.balance)
      );
    } else if (balance.accountType === 'Income') {
      otherIncome.push(line(balance, balance.balance));
    } else {
      expenses.push(line(balance, balance.balance));
    }
  }

  const sum = (rows: { amount: number }[]) =>
    round2(rows.reduce((total, row) => total + row.amount, 0));

  const netRevenue = sum(revenue);
  const totalCostOfSales = sum(costOfSales);
  const grossProfit = round2(netRevenue - totalCostOfSales);
  const totalOtherIncome = sum(otherIncome);
  const totalExpenses = sum(expenses);
  const netProfit = round2(grossProfit + totalOtherIncome - totalExpenses);

  return {
    period: { from: query.from ?? null, to: query.to ?? null },
    sections: {
      revenue: { lines: revenue, total: netRevenue },
      costOfSales: { lines: costOfSales, total: totalCostOfSales },
      otherIncome: { lines: otherIncome, total: totalOtherIncome },
      expenses: { lines: expenses, total: totalExpenses },
    },
    totals: {
      netRevenue,
      costOfSales: totalCostOfSales,
      grossProfit,
      otherIncome: totalOtherIncome,
      expenses: totalExpenses,
      netProfit,
      // Margin on net revenue. Null rather than 0 when there is no revenue —
      // "0%" would read as a real, terrible margin rather than "not applicable".
      grossMarginPercent:
        netRevenue > 0 ? round2((grossProfit / netRevenue) * 100) : null,
      netMarginPercent: netRevenue > 0 ? round2((netProfit / netRevenue) * 100) : null,
    },
  };
}

/* ------------------------------------------------------------------ *
 * Balance sheet
 * ------------------------------------------------------------------ */

/**
 * Assets, liabilities and equity as at a date.
 *
 * RETAINED EARNINGS IS COMPUTED, NOT STORED: it is every income account less
 * every expense account, from the beginning of time to `asOf`. Nothing closes
 * the books into an equity account, because that would create a second place
 * for the same number to live and a way for the two to disagree.
 *
 * The consequence is the reconciliation this phase exists to prove: the P&L for
 * a period and the movement in retained earnings over that period are the same
 * figure BY CONSTRUCTION, not by agreement.
 */
export async function getBalanceSheet(tenant: TenantContext, asOf?: Date) {
  await ensureDefaultAccounts(tenant);
  const balances = await accountBalances(tenant, { to: asOf });

  const line = (balance: AccountBalance) => ({
    accountId: balance.accountId,
    accountName: balance.accountName,
    code: balance.code,
    amount: balance.balance,
    drillDown: drillDownFor(balance, undefined, asOf),
  });

  const material = balances.filter((balance) => Math.abs(balance.balance) >= 0.005);

  const assets = material.filter((b) => b.accountType === 'Asset').map(line);
  const liabilities = material.filter((b) => b.accountType === 'Liability').map(line);
  const equity = material.filter((b) => b.accountType === 'Equity').map(line);

  // Income and expense do not appear on a balance sheet — they roll into
  // retained earnings, which is what makes it balance.
  const income = round2(
    material
      .filter((b) => b.accountType === 'Income')
      .reduce((sum, b) => sum + b.balance, 0)
  );
  const expenses = round2(
    material
      .filter((b) => b.accountType === 'Expense')
      .reduce((sum, b) => sum + b.balance, 0)
  );
  const retainedEarnings = round2(income - expenses);

  const sum = (rows: { amount: number }[]) =>
    round2(rows.reduce((total, row) => total + row.amount, 0));

  const totalAssets = sum(assets);
  const totalLiabilities = sum(liabilities);
  const totalEquity = round2(sum(equity) + retainedEarnings);

  return {
    asOf: asOf ?? null,
    sections: {
      assets: { lines: assets, total: totalAssets },
      liabilities: { lines: liabilities, total: totalLiabilities },
      equity: {
        lines: equity,
        /**
         * Retained earnings is presented as an equity LINE with no account
         * behind it, so its drill-down is the P&L for the same period rather
         * than a ledger. Flagged `isComputed` so the UI does not offer a
         * ledger link that cannot exist.
         */
        retainedEarnings: {
          accountName: 'Retained Earnings (profit to date)',
          amount: retainedEarnings,
          isComputed: true,
          breakdown: { income, expenses },
        },
        total: totalEquity,
      },
    },
    totals: {
      assets: totalAssets,
      liabilities: totalLiabilities,
      equity: totalEquity,
      liabilitiesAndEquity: round2(totalLiabilities + totalEquity),
      difference: round2(totalAssets - (totalLiabilities + totalEquity)),
      balanced:
        Math.abs(totalAssets - (totalLiabilities + totalEquity)) < 0.005,
    },
  };
}

/* ------------------------------------------------------------------ *
 * Day book
 * ------------------------------------------------------------------ */

/**
 * Every journal entry for one day, in the order they were posted.
 *
 * Whole entries rather than unwound lines: a day book is read as a sequence of
 * transactions, and splitting an entry across rows loses the pairing that makes
 * each one legible.
 */
export async function getDayBook(
  tenant: TenantContext,
  query: { date?: Date; from?: Date; to?: Date } = {}
) {
  // A single `date` is expanded to that whole day. Passing midnight and
  // matching on equality would return only entries posted at exactly 00:00.
  let from = query.from;
  let to = query.to;
  if (query.date) {
    from = new Date(query.date);
    from.setHours(0, 0, 0, 0);
    to = new Date(query.date);
    to.setHours(23, 59, 59, 999);
  }

  // The guard matters: with no dates, `dateMatch` returns `{}` and
  // `{ date: {} }` is cast as a Date by mongoose, which throws. An unfiltered
  // day book is exactly what the export endpoint asks for by default.
  const period = dateMatch(from, to);
  const entries = await JournalEntryModel.find(
    tenantFilter(tenant, Object.keys(period).length > 0 ? { date: period } : {})
  )
    .sort({ date: 1, _id: 1 })
    .lean();

  const totalDebit = round2(entries.reduce((sum, entry) => sum + entry.totalDebit, 0));
  const totalCredit = round2(entries.reduce((sum, entry) => sum + entry.totalCredit, 0));

  return {
    period: { from: from ?? null, to: to ?? null },
    entries: entries.map((entry) => ({
      _id: entry._id,
      documentNumber: entry.documentNumber,
      date: entry.date,
      narration: entry.narration,
      sourceType: entry.sourceType,
      // The drill-down target: from a day-book row a reader can open the
      // invoice, bill or payment that caused it.
      sourceId: entry.sourceId,
      sourceNumber: entry.sourceNumber,
      reversedByEntryId: entry.reversedByEntryId,
      lines: entry.lines,
      totalDebit: entry.totalDebit,
      totalCredit: entry.totalCredit,
    })),
    totals: {
      debit: totalDebit,
      credit: totalCredit,
      entries: entries.length,
      balanced: Math.abs(totalDebit - totalCredit) < 0.005,
    },
  };
}

/* ------------------------------------------------------------------ *
 * Drill-down
 * ------------------------------------------------------------------ */

/**
 * The transactions behind one report line.
 *
 * WHY THE REPORTS CARRY A KEY RATHER THAN A LIST OF ENTRY IDS
 * ----------------------------------------------------------
 * A Sales line on an annual P&L can be the sum of tens of thousands of entries.
 * Embedding those ids would make the summary report larger than the detail it
 * summarises, for a list the client discards unless the user clicks. So each
 * line carries `drillDown` — the account and the period that produced the
 * figure, plus the row count so the UI can say how many there are — and this
 * endpoint returns the actual transactions when asked.
 *
 * Every row includes `sourceType` / `sourceId` / `sourceNumber`, so a drill-down
 * goes all the way back to the invoice or payment, not merely to the journal.
 */
export async function getDrillDown(
  tenant: TenantContext,
  query: { accountId: string; from?: Date; to?: Date; page?: number; limit?: number }
) {
  if (!Types.ObjectId.isValid(query.accountId)) {
    throw ApiError.badRequest('Not a valid account id');
  }

  const accountId = new Types.ObjectId(query.accountId);
  const account = await AccountModel.findOne(
    tenantFilter(tenant, { _id: accountId })
  ).lean();
  if (!account) throw ApiError.notFound('Account not found');

  const page = Math.max(1, query.page ?? 1);
  const limit = Math.min(500, Math.max(1, query.limit ?? 100));
  const period = dateMatch(query.from, query.to);

  const match = tenantFilter(tenant, {
    'lines.accountId': accountId,
    ...(Object.keys(period).length > 0 ? { date: period } : {}),
  });

  const [result] = await JournalEntryModel.aggregate([
    { $match: match },
    { $unwind: '$lines' },
    // Re-applied after the unwind: the entry matched because SOME line touched
    // this account; its other lines belong elsewhere.
    { $match: { 'lines.accountId': accountId } },
    {
      $project: {
        _id: 0,
        entryId: '$_id',
        documentNumber: 1,
        date: 1,
        narration: 1,
        sourceType: 1,
        sourceId: 1,
        sourceNumber: 1,
        description: '$lines.description',
        debit: '$lines.debitAmount',
        credit: '$lines.creditAmount',
      },
    },
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
  ]);

  const rows = result?.rows ?? [];
  const totals = result?.totals?.[0] ?? { debit: 0, credit: 0, count: 0 };
  const normalBalance = normalBalanceOf(account.accountType as AccountType);

  return {
    account: {
      _id: account._id,
      accountName: account.accountName,
      accountType: account.accountType,
      normalBalance,
    },
    period: { from: query.from ?? null, to: query.to ?? null },
    rows,
    totals: {
      debit: round2(totals.debit),
      credit: round2(totals.credit),
      net: round2(
        normalBalance === 'debit'
          ? totals.debit - totals.credit
          : totals.credit - totals.debit
      ),
    },
    pagination: {
      page,
      limit,
      total: totals.count,
      pages: Math.ceil(totals.count / limit) || 1,
    },
  };
}
