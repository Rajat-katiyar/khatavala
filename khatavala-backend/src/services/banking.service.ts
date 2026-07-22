import mongoose, { Types } from 'mongoose';
import ExcelJS from 'exceljs';
import { ApiError } from '../utils/ApiError.js';
import { logger } from '../config/logger.js';
import { BankAccountModel } from '../models/BankAccount.js';
import { BankTransactionModel } from '../models/BankTransaction.js';
import { BankStatementEntryModel } from '../models/BankStatementEntry.js';
import { round2 } from './tradeDocument.factory.js';
import { cellText, cellNumber } from './excelImport.service.js';
import {
  tenantFilter,
  tenantStamp,
  type TenantContext,
} from '../middlewares/tenantScope.js';
import type { TransactionMode, TransactionStatus } from '../models/BankTransaction.js';

/**
 * BANKING SERVICE — Phase 15
 *
 * Three concerns:
 *  1. Bank account master (CRUD, balance maintenance)
 *  2. Transaction register (record cheque/NEFT/UPI movements)
 *  3. Statement reconciliation (import CSV/Excel, match vs system transactions)
 *
 * BALANCE MAINTENANCE
 * -------------------
 * `currentBalance` on BankAccount is updated atomically with each transaction
 * write using `$inc`, so it always reflects the sum of all recorded transactions
 * plus the opening balance. It is not recalculated on every read.
 *
 * RECONCILIATION
 * --------------
 * The user uploads a CSV or Excel file. Each data row becomes a
 * BankStatementEntry. Auto-match then links entries to system transactions by:
 *   - Same amount (±0.01)
 *   - Date within 3 calendar days
 *   - Same type (debit/credit)
 * Manual match/unmatch are also available for edge cases.
 */

/* ------------------------------------------------------------------ *
 * Bank Account CRUD
 * ------------------------------------------------------------------ */

export async function listBankAccounts(tenant: TenantContext) {
  return BankAccountModel.find(tenantFilter(tenant, {}))
    .sort({ accountName: 1 })
    .lean();
}

export async function getBankAccount(tenant: TenantContext, bankAccountId: string) {
  const account = await BankAccountModel.findOne(
    tenantFilter(tenant, { _id: new Types.ObjectId(bankAccountId) })
  ).lean();
  if (!account) throw ApiError.notFound('Bank account not found');
  return account;
}

export async function createBankAccount(
  tenant: TenantContext,
  input: {
    accountName: string;
    bankName: string;
    accountNumber: string;
    ifscCode?: string;
    branchName?: string;
    openingBalance?: number;
    currency?: string;
    notes?: string;
  }
) {
  const openingBalance = round2(input.openingBalance ?? 0);
  const account = await BankAccountModel.create(
    tenantStamp(tenant, {
      accountName: input.accountName,
      bankName: input.bankName,
      accountNumber: input.accountNumber,
      ifscCode: input.ifscCode ?? null,
      branchName: input.branchName ?? null,
      openingBalance,
      currentBalance: openingBalance,
      currency: input.currency ?? 'INR',
      notes: input.notes ?? null,
      isActive: true,
    })
  );
  return account;
}

export async function updateBankAccount(
  tenant: TenantContext,
  bankAccountId: string,
  input: {
    accountName?: string;
    bankName?: string;
    ifscCode?: string;
    branchName?: string;
    notes?: string;
    isActive?: boolean;
  }
) {
  const account = await BankAccountModel.findOneAndUpdate(
    tenantFilter(tenant, { _id: new Types.ObjectId(bankAccountId) }),
    { $set: input },
    { new: true }
  );
  if (!account) throw ApiError.notFound('Bank account not found');
  return account;
}

export async function deleteBankAccount(tenant: TenantContext, bankAccountId: string) {
  const account = await BankAccountModel.findOne(
    tenantFilter(tenant, { _id: new Types.ObjectId(bankAccountId) })
  );
  if (!account) throw ApiError.notFound('Bank account not found');
  const hasTransactions = await BankTransactionModel.exists(
    tenantFilter(tenant, { bankAccountId: account._id })
  );
  if (hasTransactions) {
    throw ApiError.badRequest('Cannot delete a bank account that has transactions');
  }
  await account.deleteOne();
}

/* ------------------------------------------------------------------ *
 * Transaction Register
 * ------------------------------------------------------------------ */

export async function listTransactions(
  tenant: TenantContext,
  bankAccountId: string,
  query: {
    from?: Date;
    to?: Date;
    status?: TransactionStatus;
    mode?: TransactionMode;
    page?: number;
    limit?: number;
  }
) {
  await getBankAccount(tenant, bankAccountId); // access check
  const filter: Record<string, unknown> = tenantFilter(tenant, {
    bankAccountId: new Types.ObjectId(bankAccountId),
  });
  if (query.status) filter['status'] = query.status;
  if (query.mode) filter['mode'] = query.mode;
  if (query.from || query.to) {
    filter['transactionDate'] = {};
    if (query.from) (filter['transactionDate'] as any)['$gte'] = query.from;
    if (query.to) (filter['transactionDate'] as any)['$lte'] = query.to;
  }

  const page = Math.max(1, query.page ?? 1);
  const limit = Math.min(100, query.limit ?? 50);
  const skip = (page - 1) * limit;

  const [rows, total] = await Promise.all([
    BankTransactionModel.find(filter)
      .sort({ transactionDate: -1, _id: -1 })
      .skip(skip)
      .limit(limit)
      .lean(),
    BankTransactionModel.countDocuments(filter),
  ]);

  return { data: rows, pagination: { page, limit, total, pages: Math.ceil(total / limit) } };
}

export async function recordTransaction(
  tenant: TenantContext,
  bankAccountId: string,
  input: {
    transactionDate: Date;
    valueDate?: Date;
    amount: number;
    type: 'Credit' | 'Debit';
    mode: TransactionMode;
    referenceNumber?: string;
    chequeNumber?: string;
    description?: string;
  }
) {
  await getBankAccount(tenant, bankAccountId); // access check
  const session = await mongoose.startSession();
  session.startTransaction();
  try {
    const amount = round2(input.amount);
    const delta = input.type === 'Credit' ? amount : -amount;

    const [txn] = await BankTransactionModel.create(
      [
        tenantStamp(tenant, {
          bankAccountId: new Types.ObjectId(bankAccountId),
          transactionDate: input.transactionDate,
          valueDate: input.valueDate ?? null,
          amount,
          type: input.type,
          mode: input.mode,
          referenceNumber: input.referenceNumber ?? null,
          chequeNumber: input.chequeNumber ?? null,
          description: input.description ?? '',
          status: 'Pending',
          createdBy: tenant.actor?.userId ? new Types.ObjectId(tenant.actor.userId) : null,
        }),
      ],
      { session }
    );

    await BankAccountModel.updateOne(
      tenantFilter(tenant, { _id: new Types.ObjectId(bankAccountId) }),
      { $inc: { currentBalance: delta } },
      { session }
    );

    await session.commitTransaction();
    return txn;
  } catch (err) {
    await session.abortTransaction();
    throw err;
  } finally {
    await session.endSession();
  }
}

export async function updateTransactionStatus(
  tenant: TenantContext,
  transactionId: string,
  status: TransactionStatus
) {
  const txn = await BankTransactionModel.findOneAndUpdate(
    tenantFilter(tenant, { _id: new Types.ObjectId(transactionId) }),
    { $set: { status } },
    { new: true }
  );
  if (!txn) throw ApiError.notFound('Transaction not found');
  return txn;
}

/* ------------------------------------------------------------------ *
 * Bank Statement Import
 * ------------------------------------------------------------------ */

interface ParsedStatementRow {
  date: Date;
  description: string;
  reference: string | null;
  debit: number;
  credit: number;
  balance: number | null;
}

/**
 * Detects the column layout of a bank statement by scanning the header row.
 * Supports Indian bank formats (SBI, HDFC, ICICI, Axis, Kotak common layouts).
 */
function detectColumns(headers: string[]): {
  date: number;
  description: number;
  reference: number;
  debit: number;
  credit: number;
  balance: number;
} | null {
  const h = headers.map((s) => s.toLowerCase().trim());
  const idx = (patterns: string[]) =>
    h.findIndex((col) =>
      patterns.some((p) => {
        if (p === 'cr' || p === 'dr') return col === p || new RegExp(`\\b\${p}\\b`).test(col);
        return col.includes(p);
      })
    );

  const date = idx(['date', 'txn date', 'value date', 'transaction date']);
  const description = idx(['description', 'narration', 'particulars', 'remarks', 'details']);
  const reference = idx(['ref', 'reference', 'cheque', 'utr', 'txn id', 'transaction id']);
  const debit = idx(['debit', 'withdrawal', 'dr', 'amount (dr)']);
  const credit = idx(['credit', 'deposit', 'cr', 'amount (cr)']);
  const balance = idx(['balance', 'closing', 'avl bal', 'available balance']);

  if (date === -1 || (debit === -1 && credit === -1)) return null;
  return { date, description, reference, debit, credit, balance };
}

export async function importBankStatement(
  tenant: TenantContext,
  bankAccountId: string,
  fileBuffer: Buffer,
  originalName: string
): Promise<{ imported: number; batch: string }> {
  await getBankAccount(tenant, bankAccountId);

  const workbook = new ExcelJS.Workbook();
  const ext = originalName.split('.').pop()?.toLowerCase();

  if (ext === 'csv') {
    const { Readable } = await import('stream');
    await workbook.csv.read(Readable.from([fileBuffer]));
  } else {
    await workbook.xlsx.load(fileBuffer.buffer.slice(fileBuffer.byteOffset, fileBuffer.byteOffset + fileBuffer.byteLength) as ArrayBuffer);
  }

  const sheet = workbook.worksheets[0];
  if (!sheet) throw ApiError.badRequest('No worksheet found in the uploaded file');

  const rows: ExcelJS.Row[] = [];
  sheet.eachRow({ includeEmpty: false }, (row) => rows.push(row));
  if (rows.length < 2) throw ApiError.badRequest('Statement must have at least a header and one data row');

  const headers = (rows[0].values as ExcelJS.CellValue[])
    .slice(1)
    .map((v) => (v != null ? String(v) : ''));
  const cols = detectColumns(headers);
  if (!cols) {
    throw ApiError.badRequest(
      'Could not detect bank statement column layout. Expected columns: Date, Description/Narration, Debit, Credit.'
    );
  }

  const batch = new Date().toISOString();
  const entries: ParsedStatementRow[] = [];

  for (let i = 1; i < rows.length; i++) {
    const values = (rows[i].values as ExcelJS.CellValue[]).slice(1);
    const getCell = (idx: number) =>
      idx >= 0 ? (rows[i].getCell(idx + 1) as ExcelJS.Cell) : undefined;

    const rawDate = values[cols.date];
    if (!rawDate) continue;

    let date: Date;
    if (rawDate instanceof Date) {
      date = rawDate;
    } else {
      const parsed = new Date(String(rawDate));
      if (isNaN(parsed.getTime())) continue;
      date = parsed;
    }

    const debit = cols.debit >= 0 ? (cellNumber(getCell(cols.debit)) ?? 0) : 0;
    const credit = cols.credit >= 0 ? (cellNumber(getCell(cols.credit)) ?? 0) : 0;
    
    if (debit === 0 && credit === 0) continue;

    entries.push({
      date,
      description: cols.description >= 0 ? cellText(getCell(cols.description)) : '',
      reference: cols.reference >= 0 ? cellText(getCell(cols.reference)) || null : null,
      debit: round2(debit),
      credit: round2(credit),
      balance: cols.balance >= 0 ? (cellNumber(getCell(cols.balance)) ?? null) : null,
    });
  }

  if (entries.length === 0) throw ApiError.badRequest('No valid data rows found in the statement');

  await BankStatementEntryModel.insertMany(
    entries.map((e) =>
      tenantStamp(tenant, {
        bankAccountId: new Types.ObjectId(bankAccountId),
        importBatch: batch,
        statementDate: e.date,
        description: e.description,
        referenceNumber: e.reference,
        credit: e.credit,
        debit: e.debit,
        balance: e.balance,
        isMatched: false,
      })
    )
  );

  return { imported: entries.length, batch };
}

/* ------------------------------------------------------------------ *
 * Reconciliation
 * ------------------------------------------------------------------ */

export async function getReconciliation(
  tenant: TenantContext,
  bankAccountId: string,
  batch?: string
) {
  await getBankAccount(tenant, bankAccountId);

  const statementFilter: Record<string, unknown> = tenantFilter(tenant, {
    bankAccountId: new Types.ObjectId(bankAccountId),
  });
  if (batch) statementFilter['importBatch'] = batch;

  const [statements, transactions] = await Promise.all([
    BankStatementEntryModel.find(statementFilter).sort({ statementDate: 1 }).lean(),
    BankTransactionModel.find(
      tenantFilter(tenant, {
        bankAccountId: new Types.ObjectId(bankAccountId),
        status: { $in: ['Pending', 'Cleared'] },
      })
    ).sort({ transactionDate: 1 }).lean(),
  ]);

  const unmatched = {
    statements: statements.filter((s) => !s.isMatched),
    transactions: transactions.filter((t) => t.status === 'Pending'),
  };

  return { statements, transactions, unmatched };
}

export async function manualMatch(
  tenant: TenantContext,
  bankAccountId: string,
  transactionId: string,
  statementEntryId: string
) {
  await getBankAccount(tenant, bankAccountId);

  const [txn, entry] = await Promise.all([
    BankTransactionModel.findOne(
      tenantFilter(tenant, { _id: new Types.ObjectId(transactionId), bankAccountId: new Types.ObjectId(bankAccountId) })
    ),
    BankStatementEntryModel.findOne(
      tenantFilter(tenant, { _id: new Types.ObjectId(statementEntryId), bankAccountId: new Types.ObjectId(bankAccountId) })
    ),
  ]);
  if (!txn) throw ApiError.notFound('Transaction not found');
  if (!entry) throw ApiError.notFound('Statement entry not found');
  if (entry.isMatched) throw ApiError.badRequest('Statement entry already matched');

  const now = new Date();
  await Promise.all([
    BankTransactionModel.updateOne(
      { _id: txn._id },
      { $set: { status: 'Cleared', statementEntryId: entry._id, reconciledAt: now } }
    ),
    BankStatementEntryModel.updateOne(
      { _id: entry._id },
      { $set: { isMatched: true, matchedTransactionId: txn._id, matchedAt: now } }
    ),
  ]);

  return { matched: true };
}

export async function unmatch(
  tenant: TenantContext,
  bankAccountId: string,
  transactionId: string
) {
  await getBankAccount(tenant, bankAccountId);
  const txn = await BankTransactionModel.findOne(
    tenantFilter(tenant, { _id: new Types.ObjectId(transactionId) })
  );
  if (!txn) throw ApiError.notFound('Transaction not found');
  if (txn.status !== 'Cleared') throw ApiError.badRequest('Transaction is not matched');

  const entryId = txn.statementEntryId;
  await Promise.all([
    BankTransactionModel.updateOne(
      { _id: txn._id },
      { $set: { status: 'Pending', statementEntryId: null, reconciledAt: null } }
    ),
    entryId
      ? BankStatementEntryModel.updateOne(
          { _id: entryId },
          { $set: { isMatched: false, matchedTransactionId: null, matchedAt: null } }
        )
      : Promise.resolve(),
  ]);
  return { unmatched: true };
}

/**
 * Auto-reconciles unmatched statement entries against pending system transactions.
 * Matching criterion: same type (credit/debit), amount within ±0.01, date within ±3 days.
 */
export async function autoReconcile(
  tenant: TenantContext,
  bankAccountId: string,
  batch?: string
): Promise<{ matched: number }> {
  await getBankAccount(tenant, bankAccountId);

  const statementFilter: Record<string, unknown> = tenantFilter(tenant, {
    bankAccountId: new Types.ObjectId(bankAccountId),
    isMatched: false,
  });
  if (batch) statementFilter['importBatch'] = batch;

  const [unmatched, pending] = await Promise.all([
    BankStatementEntryModel.find(statementFilter).sort({ statementDate: 1 }).lean(),
    BankTransactionModel.find(
      tenantFilter(tenant, { bankAccountId: new Types.ObjectId(bankAccountId), status: 'Pending' })
    ).lean(),
  ]);

  const usedTxnIds = new Set<string>();
  let matched = 0;

  for (const entry of unmatched) {
    const entryType = entry.credit > 0 ? 'Credit' : 'Debit';
    const entryAmount = entry.credit > 0 ? entry.credit : entry.debit;

    const candidate = pending.find((t) => {
      if (usedTxnIds.has(String(t._id))) return false;
      if (t.type !== entryType) return false;
      if (Math.abs(t.amount - entryAmount) > 0.01) return false;
      const daysDiff =
        Math.abs(new Date(t.transactionDate).getTime() - new Date(entry.statementDate).getTime()) /
        (1000 * 60 * 60 * 24);
      return daysDiff <= 3;
    });

    if (!candidate) continue;

    usedTxnIds.add(String(candidate._id));
    const now = new Date();
    await Promise.all([
      BankTransactionModel.updateOne(
        { _id: candidate._id },
        { $set: { status: 'Cleared', statementEntryId: entry._id, reconciledAt: now } }
      ),
      BankStatementEntryModel.updateOne(
        { _id: entry._id },
        { $set: { isMatched: true, matchedTransactionId: candidate._id, matchedAt: now } }
      ),
    ]);
    matched++;
  }

  logger.info(`Auto-reconcile: matched ${matched} entries for bank account ${bankAccountId}`);
  return { matched };
}

export async function listImportBatches(tenant: TenantContext, bankAccountId: string) {
  await getBankAccount(tenant, bankAccountId);
  return BankStatementEntryModel.aggregate([
    {
      $match: tenantFilter(tenant, { bankAccountId: new Types.ObjectId(bankAccountId) }),
    },
    {
      $group: {
        _id: '$importBatch',
        count: { $sum: 1 },
        matched: { $sum: { $cond: ['$isMatched', 1, 0] } },
        minDate: { $min: '$statementDate' },
        maxDate: { $max: '$statementDate' },
      },
    },
    { $sort: { _id: -1 } },
  ]);
}



