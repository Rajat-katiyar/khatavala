import mongoose, { Types, type ClientSession } from 'mongoose';
import { ApiError } from '../utils/ApiError.js';
import { logger } from '../config/logger.js';
import { ExpenseCategoryModel } from '../models/ExpenseCategory.js';
import { ExpenseModel } from '../models/Expense.js';
import { AccountModel } from '../models/Account.js';
import { ensureDefaultAccounts } from './account.service.js';
import { postJournal } from './journal.service.js';
import { nextDocumentNumber } from './numbering.service.js';
import { round2 } from './tradeDocument.factory.js';
import {
  tenantFilter,
  tenantStamp,
  type TenantContext,
} from '../middlewares/tenantScope.js';
import type { PaymentMode } from './payment.factory.js';

/**
 * EXPENSE SERVICE — Phase 15
 *
 * Expense categories are lazily seeded (like default accounts). Creating an
 * expense auto-posts a journal entry in the same transaction, so the books
 * cannot lag behind the spending records.
 *
 * JOURNAL POSTING:
 *   Dr  [Category Account]   amount   (expense incurred)
 *     Cr Cash / Bank           amount (money paid out)
 *
 * The credit side uses the CASH system account for Cash mode, BANK for all
 * others. This matches the payment.factory.ts pattern already used everywhere.
 */

/* ------------------------------------------------------------------ *
 * Default expense categories
 * ------------------------------------------------------------------ */

interface DefaultCategory {
  key: string;
  name: string;
  description: string;
  accountName: string;
}

const DEFAULT_CATEGORIES: DefaultCategory[] = [
  { key: 'SALARY', name: 'Salary & Wages', description: 'Employee salaries and wages', accountName: 'Salary & Wages' },
  { key: 'RENT', name: 'Rent', description: 'Office, shop or warehouse rent', accountName: 'Rent' },
  { key: 'ELECTRICITY', name: 'Electricity', description: 'Utility bills — electricity', accountName: 'Electricity' },
  { key: 'FUEL', name: 'Fuel', description: 'Petrol, diesel and CNG', accountName: 'Fuel' },
  { key: 'TRANSPORT', name: 'Transport', description: 'Freight and logistics', accountName: 'Transport & Freight' },
  { key: 'OFFICE', name: 'Office Expenses', description: 'Stationery, printing and miscellaneous', accountName: 'Office Expenses' },
  { key: 'REPAIRS', name: 'Repairs & Maintenance', description: 'Equipment and premises maintenance', accountName: 'Repairs & Maintenance' },
  { key: 'MARKETING', name: 'Marketing & Advertising', description: 'Promotions and advertisements', accountName: 'Marketing & Advertising' },
];

const EXPENSE_NUMBERING = { key: 'Expense', prefix: 'EXP' } as const;

/**
 * Lazily seeds default expense categories and their linked COA accounts.
 * Returns a map of systemKey → { categoryId, accountId }.
 */
async function ensureDefaultCategories(
  tenant: TenantContext,
  session?: ClientSession
): Promise<Map<string, { categoryId: Types.ObjectId; accountId: Types.ObjectId }>> {
  const existing = await ExpenseCategoryModel.find(
    tenantFilter(tenant, { systemKey: { $type: 'string' } })
  )
    .select('systemKey accountId')
    .session(session ?? null)
    .lean();

  const found = new Map<string, { categoryId: Types.ObjectId; accountId: Types.ObjectId }>(
    existing
      .filter((c) => c.accountId != null)
      .map((c) => [
        c.systemKey as string,
        { categoryId: c._id, accountId: c.accountId as Types.ObjectId },
      ])
  );

  const missing = DEFAULT_CATEGORIES.filter((c) => !found.has(c.key));
  if (missing.length === 0) return found;

  // Ensure "Indirect Expenses" group exists.
  const groupAccount = await AccountModel.findOneAndUpdate(
    tenantFilter(tenant, { accountName: 'Indirect Expenses' }),
    { $setOnInsert: tenantStamp(tenant, { accountName: 'Indirect Expenses', accountType: 'Expense', code: '5500', isSystem: true, parentAccountId: null }) },
    { new: true, upsert: true, ...(session ? { session } : {}) }
  );

  for (const cat of missing) {
    // Create the COA account for this category.
    const acct = await AccountModel.findOneAndUpdate(
      tenantFilter(tenant, { accountName: cat.accountName }),
      {
        $setOnInsert: tenantStamp(tenant, {
          accountName: cat.accountName,
          accountType: 'Expense',
          code: null,
          isSystem: false,
          parentAccountId: groupAccount._id,
        }),
      },
      { new: true, upsert: true, ...(session ? { session } : {}) }
    );

    // Create the category linked to that account.
    const category = await ExpenseCategoryModel.findOneAndUpdate(
      tenantFilter(tenant, { systemKey: cat.key }),
      {
        $setOnInsert: tenantStamp(tenant, {
          name: cat.name,
          description: cat.description,
          accountId: acct._id,
          systemKey: cat.key,
          isActive: true,
        }),
      },
      { new: true, upsert: true, ...(session ? { session } : {}) }
    );

    found.set(cat.key, { categoryId: category._id, accountId: acct._id });
  }

  return found;
}

/* ------------------------------------------------------------------ *
 * Journal posting
 * ------------------------------------------------------------------ */

async function postExpenseJournal(
  tenant: TenantContext,
  expense: {
    _id: Types.ObjectId;
    documentNumber: string;
    categoryName: string;
    amount: number;
    date: Date;
    paymentMode: PaymentMode;
  },
  expenseAccountId: Types.ObjectId,
  session: ClientSession
) {
  const systemAccounts = await ensureDefaultAccounts(tenant, session);
  const creditAccountKey = expense.paymentMode === 'Cash' ? 'CASH' : 'BANK';
  const creditAccount = systemAccounts.get(creditAccountKey)!;

  return postJournal(
    tenant,
    {
      date: expense.date,
      narration: `Expense: ${expense.categoryName}`,
      sourceType: 'Expense',
      sourceId: expense._id,
      sourceNumber: expense.documentNumber,
      lines: [
        {
          accountId: expenseAccountId,
          debitAmount: expense.amount,
          description: expense.categoryName,
        },
        {
          accountId: creditAccount._id,
          accountName: creditAccount.accountName,
          creditAmount: expense.amount,
          description: expense.categoryName,
        },
      ],
    },
    session
  );
}

/* ------------------------------------------------------------------ *
 * Category CRUD
 * ------------------------------------------------------------------ */

export async function listCategories(tenant: TenantContext) {
  await ensureDefaultCategories(tenant);
  return ExpenseCategoryModel.find(tenantFilter(tenant, { isActive: true }))
    .populate('accountId', 'accountName accountType')
    .sort({ name: 1 })
    .lean();
}

export async function createCategory(
  tenant: TenantContext,
  input: { name: string; description?: string }
) {
  // Ensure a COA account exists for this category.
  const groupAccount = await AccountModel.findOne(
    tenantFilter(tenant, { accountName: 'Indirect Expenses' })
  ).lean();

  const acct = await AccountModel.findOneAndUpdate(
    tenantFilter(tenant, { accountName: input.name }),
    {
      $setOnInsert: tenantStamp(tenant, {
        accountName: input.name,
        accountType: 'Expense',
        code: null,
        isSystem: false,
        parentAccountId: groupAccount?._id ?? null,
      }),
    },
    { new: true, upsert: true }
  );

  const category = await ExpenseCategoryModel.create(
    tenantStamp(tenant, {
      name: input.name,
      description: input.description ?? '',
      accountId: acct._id,
      isActive: true,
    })
  );
  return category;
}

export async function updateCategory(
  tenant: TenantContext,
  categoryId: string,
  input: { name?: string; description?: string; isActive?: boolean }
) {
  const cat = await ExpenseCategoryModel.findOneAndUpdate(
    tenantFilter(tenant, { _id: new Types.ObjectId(categoryId) }),
    { $set: input },
    { new: true }
  );
  if (!cat) throw ApiError.notFound('Expense category not found');
  return cat;
}

export async function deleteCategory(tenant: TenantContext, categoryId: string) {
  const cat = await ExpenseCategoryModel.findOne(
    tenantFilter(tenant, { _id: new Types.ObjectId(categoryId) })
  );
  if (!cat) throw ApiError.notFound('Expense category not found');
  if (cat.systemKey) throw ApiError.badRequest('System categories cannot be deleted');
  const inUse = await ExpenseModel.exists(
    tenantFilter(tenant, { categoryId: new Types.ObjectId(categoryId) })
  );
  if (inUse) throw ApiError.badRequest('Category has posted expenses and cannot be deleted');
  await cat.deleteOne();
}

/* ------------------------------------------------------------------ *
 * Expense CRUD + posting
 * ------------------------------------------------------------------ */

export interface CreateExpenseInput {
  categoryId: string;
  amount: number;
  date?: Date;
  paymentMode: PaymentMode;
  description?: string;
  referenceNumber?: string;
  isRecurring?: boolean;
  recurrenceFrequency?: string;
}

export async function createExpense(tenant: TenantContext, input: CreateExpenseInput) {
  const session = await mongoose.startSession();
  session.startTransaction();
  try {
    // Resolve category + account.
    const category = await ExpenseCategoryModel.findOne(
      tenantFilter(tenant, { _id: new Types.ObjectId(input.categoryId) })
    )
      .session(session)
      .lean();
    if (!category) throw ApiError.notFound('Expense category not found');
    if (!category.isActive) throw ApiError.badRequest('Expense category is inactive');

    // If the category has no account yet, seed defaults first.
    let accountId: Types.ObjectId;
    if (category.accountId) {
      accountId = category.accountId as Types.ObjectId;
    } else {
      const cats = await ensureDefaultCategories(tenant, session);
      const seedCat = cats.get(category.systemKey as string);
      if (seedCat) {
        accountId = seedCat.accountId;
      } else {
        throw ApiError.badRequest('Expense category has no linked account');
      }
    }

    const amount = round2(input.amount);
    const date = input.date ? new Date(input.date) : new Date();
    const documentNumber = await nextDocumentNumber(tenant, EXPENSE_NUMBERING, { session, date });

    let nextDueDate: Date | null = null;
    if (input.isRecurring && input.recurrenceFrequency) {
      nextDueDate = advanceDate(date, input.recurrenceFrequency as any);
    }

    const [expense] = await ExpenseModel.create(
      [
        tenantStamp(tenant, {
          documentNumber,
          categoryId: category._id,
          categoryName: category.name,
          accountId,
          amount,
          date,
          paymentMode: input.paymentMode as PaymentMode,
          description: input.description ?? '',
          referenceNumber: input.referenceNumber ?? null,
          isRecurring: input.isRecurring ?? false,
          recurrenceFrequency: (input.recurrenceFrequency as any) ?? null,
          nextDueDate,
          status: 'Posted',
          createdBy: tenant.actor?.userId ? new Types.ObjectId(tenant.actor.userId) : null,
        }),
      ],
      { session }
    );

    // Post journal and stamp the journalEntryId in one step.
    const entry = await postExpenseJournal(
      tenant,
      { _id: expense._id, documentNumber, categoryName: category.name, amount, date, paymentMode: input.paymentMode as PaymentMode },
      accountId,
      session
    );
    await ExpenseModel.updateOne(
      { _id: expense._id },
      { $set: { journalEntryId: entry._id } },
      { session }
    );

    await session.commitTransaction();
    return expense;
  } catch (err) {
    await session.abortTransaction();
    throw err;
  } finally {
    await session.endSession();
  }
}

export async function listExpenses(
  tenant: TenantContext,
  query: {
    categoryId?: string;
    from?: Date;
    to?: Date;
    isRecurring?: boolean;
    status?: string;
    page?: number;
    limit?: number;
  }
) {
  const filter: Record<string, unknown> = tenantFilter(tenant, {});
  if (query.categoryId) filter['categoryId'] = new Types.ObjectId(query.categoryId);
  if (query.isRecurring !== undefined) filter['isRecurring'] = query.isRecurring;
  if (query.status) filter['status'] = query.status;
  if (query.from || query.to) {
    filter['date'] = {};
    if (query.from) (filter['date'] as any)['$gte'] = query.from;
    if (query.to) (filter['date'] as any)['$lte'] = query.to;
  }

  const page = Math.max(1, query.page ?? 1);
  const limit = Math.min(100, query.limit ?? 50);
  const skip = (page - 1) * limit;

  const [rows, total] = await Promise.all([
    ExpenseModel.find(filter)
      .sort({ date: -1, _id: -1 })
      .skip(skip)
      .limit(limit)
      .populate('categoryId', 'name')
      .lean(),
    ExpenseModel.countDocuments(filter),
  ]);

  return {
    data: rows,
    pagination: { page, limit, total, pages: Math.ceil(total / limit) },
  };
}

export async function getExpense(tenant: TenantContext, expenseId: string) {
  const expense = await ExpenseModel.findOne(
    tenantFilter(tenant, { _id: new Types.ObjectId(expenseId) })
  )
    .populate('categoryId', 'name')
    .populate('journalEntryId', 'documentNumber')
    .lean();
  if (!expense) throw ApiError.notFound('Expense not found');
  return expense;
}

export async function deleteExpense(tenant: TenantContext, expenseId: string) {
  const expense = await ExpenseModel.findOne(
    tenantFilter(tenant, { _id: new Types.ObjectId(expenseId) })
  );
  if (!expense) throw ApiError.notFound('Expense not found');
  if (expense.status === 'Posted') {
    throw ApiError.badRequest(
      'A posted expense cannot be deleted. Reverse the journal entry to correct it.'
    );
  }
  await expense.deleteOne();
}

/* ------------------------------------------------------------------ *
 * Recurring expense processor — called by the BullMQ job
 * ------------------------------------------------------------------ */

/**
 * Advances a date by one recurrence period.
 */
export function advanceDate(date: Date, frequency: 'daily' | 'weekly' | 'monthly' | 'yearly'): Date {
  const d = new Date(date);
  switch (frequency) {
    case 'daily': d.setDate(d.getDate() + 1); break;
    case 'weekly': d.setDate(d.getDate() + 7); break;
    case 'monthly': d.setMonth(d.getMonth() + 1); break;
    case 'yearly': d.setFullYear(d.getFullYear() + 1); break;
  }
  return d;
}

/**
 * Builds a minimal TenantContext for a company identified by its ObjectId.
 * Used by background jobs that must operate across all companies.
 * `actor` is null because the job is automated, not user-initiated.
 */
function buildSystemTenant(companyId: Types.ObjectId): TenantContext {
  return {
    companyId,
    role: 'system',
    roleId: null,
    branchId: null,
    warehouseId: null,
  };
}

/**
 * Generates all recurring expenses due on or before `asOf`.
 * Called by the BullMQ daily job. Must be idempotent: if the job runs twice
 * for the same day (restart, retry), expenses should not double-post.
 *
 * Idempotency is achieved by advancing `nextDueDate` inside the same
 * transaction that creates the child expense. A duplicate run finds no
 * due templates.
 */
export async function processRecurringExpenses(asOf: Date = new Date()): Promise<number> {
  // Find all recurring template expenses where nextDueDate is overdue.
  const dueExpenses = await ExpenseModel.find({
    isRecurring: true,
    status: 'Posted',
    parentExpenseId: null, // Only templates, not generated copies.
    nextDueDate: { $lte: asOf },
  }).lean();

  let generated = 0;
  for (const template of dueExpenses) {
    const session = await mongoose.startSession();
    session.startTransaction();
    try {
      const tenant = buildSystemTenant(template.companyId as Types.ObjectId);

      const category = await ExpenseCategoryModel.findById(template.categoryId).session(session).lean();
      if (!category || !category.isActive) {
        await session.abortTransaction();
        continue;
      }

      const accountId = (template.accountId ?? category.accountId) as Types.ObjectId;
      const date = new Date(template.nextDueDate!);
      const documentNumber = await nextDocumentNumber(tenant, EXPENSE_NUMBERING, { session, date });

      // Advance nextDueDate on the template BEFORE creating the child so a
      // crash-then-retry cannot create duplicates.
      const newNextDue = advanceDate(date, template.recurrenceFrequency! as any);
      await ExpenseModel.updateOne(
        { _id: template._id },
        { $set: { nextDueDate: newNextDue } },
        { session }
      );

      const [child] = await ExpenseModel.create(
        [
          tenantStamp(tenant, {
            documentNumber,
            categoryId: template.categoryId,
            categoryName: template.categoryName,
            accountId,
            amount: template.amount,
            date,
            paymentMode: template.paymentMode,
            description: template.description,
            referenceNumber: null,
            isRecurring: false,
            parentExpenseId: template._id,
            status: 'Posted',
            createdBy: null,
          }),
        ],
        { session }
      );

      const entry = await postExpenseJournal(
        tenant,
        {
          _id: child._id,
          documentNumber,
          categoryName: template.categoryName,
          amount: template.amount,
          date,
          paymentMode: template.paymentMode as PaymentMode,
        },
        accountId,
        session
      );
      await ExpenseModel.updateOne(
        { _id: child._id },
        { $set: { journalEntryId: entry._id } },
        { session }
      );

      await session.commitTransaction();
      generated++;
      logger.info(`Recurring expense generated: ${documentNumber} for company ${tenant.companyId}`);
    } catch (err) {
      await session.abortTransaction();
      logger.error('Failed to generate recurring expense', { templateId: template._id, err });
    } finally {
      await session.endSession();
    }
  }
  return generated;
}

/* ------------------------------------------------------------------ *
 * Expense summary (for dashboard widget)
 * ------------------------------------------------------------------ */

export async function getExpenseSummary(
  tenant: TenantContext,
  from: Date,
  to: Date
) {
  const result = await ExpenseModel.aggregate([
    {
      $match: tenantFilter(tenant, {
        status: 'Posted',
        date: { $gte: from, $lte: to },
      }),
    },
    {
      $group: {
        _id: '$categoryName',
        total: { $sum: '$amount' },
        count: { $sum: 1 },
      },
    },
    { $sort: { total: -1 } },
  ]);
  const grandTotal = result.reduce((s, r) => s + (r.total as number), 0);
  return { categories: result, grandTotal };
}
