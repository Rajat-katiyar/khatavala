import mongoose, { Types, type ClientSession } from 'mongoose';
import { ApiError } from '../utils/ApiError.js';
import { logger } from '../config/logger.js';
import { AccountModel, type SystemAccountKey } from '../models/Account.js';
import {
  JournalEntryModel,
  type JournalSourceType,
} from '../models/JournalEntry.js';
import { ensureDefaultAccounts } from './account.service.js';
import { nextDocumentNumber } from './numbering.service.js';
import { round2 } from './tradeDocument.factory.js';
import {
  tenantFilter,
  tenantStamp,
  type TenantContext,
} from '../middlewares/tenantScope.js';
import type { PaymentMode } from './payment.factory.js';

/**
 * THE JOURNAL POSTING SERVICE — the only writer of JournalEntry.
 *
 * Everything that moves money calls in here, and every call happens INSIDE the
 * transaction of the operation that triggered it. That is the whole point: the
 * books cannot drift from the documents, because there is no moment where one
 * exists without the other. If the journal will not balance, the invoice does
 * not post either.
 *
 * WHY THE BALANCE CHECK LIVES HERE
 * --------------------------------
 * A mongoose validator could check it too, and the model documents the
 * invariant — but a validator can only reject a bad write. This service is what
 * makes bad writes unconstructible: every posting function below builds its
 * lines and hands them to `postJournal`, which balances or throws before
 * anything reaches the database. The check is one line; the value is that it is
 * on the ONLY path in.
 *
 * ROUNDING: money is compared with a half-paisa tolerance, never with `===`.
 * Every amount here has already been rounded to paise by the trade documents,
 * but a sum of six rounded figures can still land a hair off, and refusing to
 * post a real invoice over 0.0001 would be worse than useless.
 */

const BALANCE_TOLERANCE = 0.005;
const JOURNAL_NUMBERING = { key: 'JournalEntry', prefix: 'JV' } as const;

export interface JournalLineInput {
  accountId: Types.ObjectId | string;
  accountName?: string;
  debitAmount?: number;
  creditAmount?: number;
  description?: string | null;
}

export interface PostJournalInput {
  date?: Date;
  narration?: string | null;
  lines: JournalLineInput[];
  sourceType: JournalSourceType;
  sourceId?: Types.ObjectId | string | null;
  sourceNumber?: string | null;
}

/**
 * Validates and writes one journal entry. THE choke point.
 *
 * Always takes a session: an entry that is not part of the transaction that
 * caused it is exactly the drift this module exists to prevent.
 */
export async function postJournal(
  tenant: TenantContext,
  input: PostJournalInput,
  session: ClientSession
) {
  const lines = input.lines
    .map((line) => ({
      accountId: new Types.ObjectId(String(line.accountId)),
      accountName: line.accountName ?? '',
      debitAmount: round2(line.debitAmount ?? 0),
      creditAmount: round2(line.creditAmount ?? 0),
      description: line.description ?? null,
    }))
    // A zero/zero line is noise — it happens naturally when an invoice has no
    // discount or no round-off, and printing it would clutter every entry.
    .filter((line) => line.debitAmount > 0 || line.creditAmount > 0);

  if (lines.length < 2) {
    throw ApiError.badRequest('A journal entry needs at least two lines');
  }

  for (const line of lines) {
    if (line.debitAmount > 0 && line.creditAmount > 0) {
      throw ApiError.badRequest(
        `A journal line cannot be both a debit and a credit (${line.accountName})`
      );
    }
    if (line.debitAmount < 0 || line.creditAmount < 0) {
      throw ApiError.badRequest('Journal amounts cannot be negative');
    }
  }

  const totalDebit = round2(lines.reduce((sum, line) => sum + line.debitAmount, 0));
  const totalCredit = round2(lines.reduce((sum, line) => sum + line.creditAmount, 0));

  if (Math.abs(totalDebit - totalCredit) > BALANCE_TOLERANCE) {
    // Deliberately loud and specific: an unbalanced entry means the posting
    // rule that built it is wrong, and the difference is the clue to which leg
    // is missing.
    throw ApiError.badRequest(
      `Journal entry does not balance: debits ${totalDebit} vs credits ${totalCredit}`,
      { totalDebit, totalCredit, difference: round2(totalDebit - totalCredit) }
    );
  }

  // Fill in any names the caller did not supply, so the entry is readable
  // without a join even if the account is renamed later.
  const unnamed = lines.filter((line) => !line.accountName);
  if (unnamed.length > 0) {
    const accounts = await AccountModel.find(
      tenantFilter(tenant, { _id: { $in: unnamed.map((line) => line.accountId) } })
    )
      .select('accountName')
      .session(session)
      .lean();
    const byId = new Map(accounts.map((a) => [String(a._id), a.accountName]));
    for (const line of unnamed) {
      line.accountName = byId.get(String(line.accountId)) ?? 'Unknown account';
    }
  }

  const date = input.date ?? new Date();
  const documentNumber = await nextDocumentNumber(tenant, JOURNAL_NUMBERING, {
    session,
    date,
  });

  const [entry] = await JournalEntryModel.create(
    [
      tenantStamp(tenant, {
        documentNumber,
        date,
        narration: input.narration ?? null,
        lines,
        totalDebit,
        totalCredit,
        sourceType: input.sourceType,
        sourceId: input.sourceId ? new Types.ObjectId(String(input.sourceId)) : null,
        sourceNumber: input.sourceNumber ?? null,
        createdBy: tenant.actor?.userId ?? null,
      }),
    ],
    { session }
  );

  return entry;
}

/** Cash for cash; everything else settles through the bank. */
function accountKeyForMode(mode: PaymentMode): SystemAccountKey {
  return mode === 'Cash' ? 'CASH' : 'BANK';
}

/* ------------------------------------------------------------------ *
 * Automatic postings
 * ------------------------------------------------------------------ */

/**
 * SALES INVOICE
 *
 *   Dr Accounts Receivable   grandTotal      (the customer owes us)
 *     Cr Sales                 net of tax    (income earned)
 *     Cr GST Payable           tax           (collected FOR the government)
 *     ± Round Off              rounding      (whichever side balances)
 *
 * The GST leg is why a sales invoice is not simply "income = total": the tax
 * was never ours. Booking it as income overstates profit and understates the
 * liability by the same amount.
 */
export async function postSalesInvoiceJournal(
  tenant: TenantContext,
  invoice: any,
  session: ClientSession
) {
  const accounts = await ensureDefaultAccounts(tenant, session);

  const taxable = round2(invoice.subTotal - invoice.totalDiscount);
  const lines: JournalLineInput[] = [
    {
      accountId: accounts.get('ACCOUNTS_RECEIVABLE')!._id,
      accountName: accounts.get('ACCOUNTS_RECEIVABLE')!.accountName,
      debitAmount: invoice.grandTotal,
      description: invoice.customerName,
    },
    {
      accountId: accounts.get('SALES')!._id,
      accountName: accounts.get('SALES')!.accountName,
      creditAmount: taxable,
    },
    {
      accountId: accounts.get('GST_OUTPUT')!._id,
      accountName: accounts.get('GST_OUTPUT')!.accountName,
      creditAmount: invoice.totalTax,
    },
  ];

  // grandTotal = taxable + tax + roundOff, so a positive round-off is extra
  // income (credit) and a negative one is a cost (debit).
  if (invoice.roundOff !== 0) {
    const roundOff = accounts.get('ROUND_OFF')!;
    lines.push({
      accountId: roundOff._id,
      accountName: roundOff.accountName,
      ...(invoice.roundOff > 0
        ? { creditAmount: invoice.roundOff }
        : { debitAmount: Math.abs(invoice.roundOff) }),
    });
  }

  return postJournal(
    tenant,
    {
      date: invoice.date,
      narration: `Sales invoice ${invoice.documentNumber} — ${invoice.customerName}`,
      lines,
      sourceType: 'SalesInvoice',
      sourceId: invoice._id,
      sourceNumber: invoice.documentNumber,
    },
    session
  );
}

/**
 * PURCHASE INVOICE — the mirror, with every side flipped.
 *
 *   Dr Purchases             net of tax
 *   Dr GST Receivable        tax            (reclaimable, so an ASSET)
 *     Cr Accounts Payable      grandTotal   (we owe the supplier)
 */
export async function postPurchaseInvoiceJournal(
  tenant: TenantContext,
  invoice: any,
  session: ClientSession
) {
  const accounts = await ensureDefaultAccounts(tenant, session);

  const taxable = round2(invoice.subTotal - invoice.totalDiscount);
  const lines: JournalLineInput[] = [
    {
      accountId: accounts.get('PURCHASE')!._id,
      accountName: accounts.get('PURCHASE')!.accountName,
      debitAmount: taxable,
    },
    {
      accountId: accounts.get('GST_INPUT')!._id,
      accountName: accounts.get('GST_INPUT')!.accountName,
      debitAmount: invoice.totalTax,
    },
    {
      accountId: accounts.get('ACCOUNTS_PAYABLE')!._id,
      accountName: accounts.get('ACCOUNTS_PAYABLE')!.accountName,
      creditAmount: invoice.grandTotal,
      description: invoice.supplierName,
    },
  ];

  if (invoice.roundOff !== 0) {
    const roundOff = accounts.get('ROUND_OFF')!;
    lines.push({
      accountId: roundOff._id,
      accountName: roundOff.accountName,
      // Payable = taxable + tax + roundOff. A positive round-off means we owe
      // slightly more than the goods cost — an expense.
      ...(invoice.roundOff > 0
        ? { debitAmount: invoice.roundOff }
        : { creditAmount: Math.abs(invoice.roundOff) }),
    });
  }

  return postJournal(
    tenant,
    {
      date: invoice.date,
      narration: `Purchase bill ${invoice.documentNumber} — ${invoice.supplierName}`,
      lines,
      sourceType: 'PurchaseInvoice',
      sourceId: invoice._id,
      sourceNumber: invoice.documentNumber,
    },
    session
  );
}

/**
 * CUSTOMER RECEIPT
 *
 *   Dr Cash / Bank              (money in)
 *     Cr Accounts Receivable    (they owe us less)
 *
 * No income leg: the sale was already recognised when the invoice was raised.
 * Booking income again here would double-count every credit sale — the classic
 * cash-vs-accrual error.
 */
export async function postReceiptJournal(
  tenant: TenantContext,
  payment: any,
  bill: any,
  session: ClientSession,
  options: { isRefund?: boolean } = {}
) {
  const accounts = await ensureDefaultAccounts(tenant, session);
  const money = accounts.get(accountKeyForMode(payment.mode))!;
  const receivable = accounts.get('ACCOUNTS_RECEIVABLE')!;

  // A refund is the same entry backwards: money out, and the customer owes us
  // that much again (their credit note discharged, not doubled).
  const refund = options.isRefund ?? false;

  return postJournal(
    tenant,
    {
      date: payment.date,
      narration: refund
        ? `Refund ${payment.documentNumber} against ${bill.documentNumber}`
        : `Receipt ${payment.documentNumber} against ${bill.documentNumber}`,
      lines: [
        {
          accountId: money._id,
          accountName: money.accountName,
          ...(refund
            ? { creditAmount: payment.amount }
            : { debitAmount: payment.amount }),
        },
        {
          accountId: receivable._id,
          accountName: receivable.accountName,
          ...(refund
            ? { debitAmount: payment.amount }
            : { creditAmount: payment.amount }),
          description: bill.customerName,
        },
      ],
      sourceType: 'CustomerReceipt',
      sourceId: payment._id,
      sourceNumber: payment.documentNumber,
    },
    session
  );
}

/**
 * SUPPLIER PAYMENT
 *
 *   Dr Accounts Payable      (we owe them less)
 *     Cr Cash / Bank         (money out)
 */
export async function postSupplierPaymentJournal(
  tenant: TenantContext,
  payment: any,
  bill: any,
  session: ClientSession,
  options: { isRefund?: boolean } = {}
) {
  const accounts = await ensureDefaultAccounts(tenant, session);
  const money = accounts.get(accountKeyForMode(payment.mode))!;
  const payable = accounts.get('ACCOUNTS_PAYABLE')!;
  const refund = options.isRefund ?? false;

  return postJournal(
    tenant,
    {
      date: payment.date,
      narration: refund
        ? `Refund received ${payment.documentNumber} against ${bill.documentNumber}`
        : `Payment ${payment.documentNumber} against ${bill.documentNumber}`,
      lines: [
        {
          accountId: payable._id,
          accountName: payable.accountName,
          ...(refund
            ? { creditAmount: payment.amount }
            : { debitAmount: payment.amount }),
          description: bill.supplierName,
        },
        {
          accountId: money._id,
          accountName: money.accountName,
          ...(refund
            ? { debitAmount: payment.amount }
            : { creditAmount: payment.amount }),
        },
      ],
      sourceType: 'SupplierPayment',
      sourceId: payment._id,
      sourceNumber: payment.documentNumber,
    },
    session
  );
}

/**
 * CREDIT NOTE (sales return)
 *
 *   Dr Sales Returns         net of tax   (revenue given back)
 *   Dr GST Payable           tax          (we owe the government less)
 *     Cr Accounts Receivable   total      (they owe us less)
 */
export async function postCreditNoteJournal(
  tenant: TenantContext,
  creditNote: any,
  session: ClientSession
) {
  const accounts = await ensureDefaultAccounts(tenant, session);
  const taxable = round2(creditNote.subTotal - creditNote.totalDiscount);

  const lines: JournalLineInput[] = [
    {
      accountId: accounts.get('SALES_RETURN')!._id,
      accountName: accounts.get('SALES_RETURN')!.accountName,
      debitAmount: taxable,
    },
    {
      accountId: accounts.get('GST_OUTPUT')!._id,
      accountName: accounts.get('GST_OUTPUT')!.accountName,
      debitAmount: creditNote.totalTax,
    },
    {
      accountId: accounts.get('ACCOUNTS_RECEIVABLE')!._id,
      accountName: accounts.get('ACCOUNTS_RECEIVABLE')!.accountName,
      creditAmount: creditNote.grandTotal,
      description: creditNote.customerName,
    },
  ];

  if (creditNote.roundOff !== 0) {
    const roundOff = accounts.get('ROUND_OFF')!;
    lines.push({
      accountId: roundOff._id,
      accountName: roundOff.accountName,
      ...(creditNote.roundOff > 0
        ? { debitAmount: creditNote.roundOff }
        : { creditAmount: Math.abs(creditNote.roundOff) }),
    });
  }

  return postJournal(
    tenant,
    {
      date: creditNote.date,
      narration: `Credit note ${creditNote.documentNumber} — ${creditNote.customerName}`,
      lines,
      sourceType: 'CreditNote',
      sourceId: creditNote._id,
      sourceNumber: creditNote.documentNumber,
    },
    session
  );
}

/**
 * DEBIT NOTE (purchase return)
 *
 *   Dr Accounts Payable      total        (we owe the supplier less)
 *     Cr Purchase Returns      net of tax (cost given back)
 *     Cr GST Receivable        tax        (less input credit to reclaim)
 */
export async function postDebitNoteJournal(
  tenant: TenantContext,
  debitNote: any,
  session: ClientSession
) {
  const accounts = await ensureDefaultAccounts(tenant, session);
  const taxable = round2(debitNote.subTotal - debitNote.totalDiscount);

  const lines: JournalLineInput[] = [
    {
      accountId: accounts.get('ACCOUNTS_PAYABLE')!._id,
      accountName: accounts.get('ACCOUNTS_PAYABLE')!.accountName,
      debitAmount: debitNote.grandTotal,
      description: debitNote.supplierName,
    },
    {
      accountId: accounts.get('PURCHASE_RETURN')!._id,
      accountName: accounts.get('PURCHASE_RETURN')!.accountName,
      creditAmount: taxable,
    },
    {
      accountId: accounts.get('GST_INPUT')!._id,
      accountName: accounts.get('GST_INPUT')!.accountName,
      creditAmount: debitNote.totalTax,
    },
  ];

  if (debitNote.roundOff !== 0) {
    const roundOff = accounts.get('ROUND_OFF')!;
    lines.push({
      accountId: roundOff._id,
      accountName: roundOff.accountName,
      ...(debitNote.roundOff > 0
        ? { creditAmount: debitNote.roundOff }
        : { debitAmount: Math.abs(debitNote.roundOff) }),
    });
  }

  return postJournal(
    tenant,
    {
      date: debitNote.date,
      narration: `Debit note ${debitNote.documentNumber} — ${debitNote.supplierName}`,
      lines,
      sourceType: 'DebitNote',
      sourceId: debitNote._id,
      sourceNumber: debitNote.documentNumber,
    },
    session
  );
}

/**
 * Reverses every entry a document produced.
 *
 * Used when an invoice or bill is cancelled. Writes the mirror image as a NEW
 * entry rather than deleting the original — the books are append-only, and an
 * auditor has to be able to see that something was posted and then undone.
 */
export async function reverseJournalsFor(
  tenant: TenantContext,
  sourceType: JournalSourceType,
  sourceId: Types.ObjectId | string,
  session: ClientSession,
  narration?: string
) {
  const originals = await JournalEntryModel.find(
    tenantFilter(tenant, {
      sourceType,
      sourceId: new Types.ObjectId(String(sourceId)),
      reversedByEntryId: null,
    })
  )
    .session(session)
    .lean();

  const reversals = [];
  for (const original of originals) {
    const reversal = await postJournal(
      tenant,
      {
        narration: narration ?? `Reversal of ${original.documentNumber}`,
        // Debits become credits and vice versa. Balanced by construction, since
        // the original balanced.
        lines: original.lines.map((line: any) => ({
          accountId: line.accountId,
          accountName: line.accountName,
          debitAmount: line.creditAmount,
          creditAmount: line.debitAmount,
          description: line.description,
        })),
        sourceType: 'Reversal',
        sourceId: original._id,
        sourceNumber: original.documentNumber,
      },
      session
    );

    reversal.reversesEntryId = original._id;
    await reversal.save({ session });

    await JournalEntryModel.updateOne(
      tenantFilter(tenant, { _id: original._id }),
      { $set: { reversedByEntryId: reversal._id } },
      { session }
    );

    reversals.push(reversal);
  }

  if (originals.length === 0) {
    // Not an error: a draft that was never posted has nothing to reverse. Worth
    // a line in the log so a genuinely missing entry is visible.
    logger.debug(`No journal entries to reverse for ${sourceType} ${String(sourceId)}`);
  }

  return reversals;
}

/* ------------------------------------------------------------------ *
 * Manual entries
 * ------------------------------------------------------------------ */

export interface ManualJournalInput {
  date?: Date;
  narration?: string | null;
  lines: Array<{
    accountId: string;
    debitAmount?: number;
    creditAmount?: number;
    description?: string | null;
  }>;
}

/** A user-entered journal. Same balance rule, its own transaction. */
export async function createManualJournalEntry(
  tenant: TenantContext,
  input: ManualJournalInput
) {
  const session = await mongoose.startSession();
  try {
    let result: any;
    await session.withTransaction(async () => {
      // Every account must exist and belong to this tenant — a journal line
      // pointing at another company's account would be a cross-tenant leak.
      const ids = input.lines.map((line) => new Types.ObjectId(line.accountId));
      const accounts = await AccountModel.find(
        tenantFilter(tenant, { _id: { $in: ids } })
      )
        .session(session)
        .lean();
      if (accounts.length !== new Set(ids.map(String)).size) {
        throw ApiError.badRequest('One or more accounts do not exist');
      }

      const entry = await postJournal(
        tenant,
        {
          date: input.date,
          narration: input.narration ?? null,
          lines: input.lines,
          sourceType: 'Manual',
        },
        session
      );
      result = entry.toObject();
    });
    return result;
  } finally {
    await session.endSession();
  }
}

export interface ContraInput {
  fromAccountId: string;
  toAccountId: string;
  amount: number;
  date?: Date;
  narration?: string | null;
}

/**
 * A CONTRA entry — money moving between the company's own cash and bank.
 *
 * Given its own endpoint rather than left to the manual journal because it is
 * frequent, always two lines, and easy to enter backwards. Restricted to asset
 * accounts: "contra" means the money never left the business, and a contra to
 * an income account would be someone mis-recording a sale.
 */
export async function createContraEntry(tenant: TenantContext, input: ContraInput) {
  if (!(input.amount > 0)) throw ApiError.badRequest('Amount must be positive');
  if (input.fromAccountId === input.toAccountId) {
    throw ApiError.badRequest('Choose two different accounts');
  }

  const session = await mongoose.startSession();
  try {
    let result: any;
    await session.withTransaction(async () => {
      const [from, to] = await Promise.all([
        AccountModel.findOne(tenantFilter(tenant, { _id: input.fromAccountId }))
          .session(session)
          .lean(),
        AccountModel.findOne(tenantFilter(tenant, { _id: input.toAccountId }))
          .session(session)
          .lean(),
      ]);
      if (!from || !to) throw ApiError.notFound('Account not found');

      if (from.accountType !== 'Asset' || to.accountType !== 'Asset') {
        throw ApiError.badRequest(
          'A contra entry moves money between your own cash and bank accounts — both sides must be asset accounts'
        );
      }

      const entry = await postJournal(
        tenant,
        {
          date: input.date,
          narration:
            input.narration ?? `Contra — ${from.accountName} to ${to.accountName}`,
          lines: [
            // Money arrives in `to` (debit increases an asset) and leaves `from`.
            { accountId: to._id, accountName: to.accountName, debitAmount: input.amount },
            {
              accountId: from._id,
              accountName: from.accountName,
              creditAmount: input.amount,
            },
          ],
          sourceType: 'Contra',
        },
        session
      );
      result = entry.toObject();
    });
    return result;
  } finally {
    await session.endSession();
  }
}

/* ------------------------------------------------------------------ *
 * Reads
 * ------------------------------------------------------------------ */

export interface JournalListQuery {
  from?: Date;
  to?: Date;
  sourceType?: JournalSourceType;
  accountId?: string;
  page?: number;
  limit?: number;
}

export async function listJournalEntries(
  tenant: TenantContext,
  query: JournalListQuery = {}
) {
  const page = Math.max(1, query.page ?? 1);
  const limit = Math.min(200, Math.max(1, query.limit ?? 25));

  const filter: Record<string, unknown> = {};
  if (query.sourceType) filter.sourceType = query.sourceType;
  if (query.accountId) filter['lines.accountId'] = new Types.ObjectId(query.accountId);
  if (query.from || query.to) {
    filter.date = {
      ...(query.from ? { $gte: query.from } : {}),
      ...(query.to ? { $lte: query.to } : {}),
    };
  }

  const scoped = tenantFilter(tenant, filter);
  const [entries, total] = await Promise.all([
    JournalEntryModel.find(scoped)
      .sort({ date: -1, _id: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .lean(),
    JournalEntryModel.countDocuments(scoped),
  ]);

  return {
    entries,
    pagination: { page, limit, total, pages: Math.ceil(total / limit) || 1 },
  };
}

export async function getJournalEntry(tenant: TenantContext, id: string) {
  const entry = await JournalEntryModel.findOne(
    tenantFilter(tenant, { _id: new Types.ObjectId(id) })
  ).lean();
  if (!entry) throw ApiError.notFound('Journal entry not found');
  return entry;
}
