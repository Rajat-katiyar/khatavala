import { Types, type ClientSession } from 'mongoose';
import { ApiError } from '../utils/ApiError.js';
import {
  AccountModel,
  type AccountType,
  type SystemAccountKey,
} from '../models/Account.js';
import { JournalEntryModel } from '../models/JournalEntry.js';
import {
  tenantById,
  tenantFilter,
  tenantStamp,
  type TenantContext,
} from '../middlewares/tenantScope.js';

/**
 * The chart of accounts: CRUD, the hierarchy, and the default set.
 */

interface DefaultAccount {
  key: SystemAccountKey;
  name: string;
  type: AccountType;
  code: string;
  /** Groups the account sits under, created as plain parents. */
  group: string;
}

/**
 * THE DEFAULT CHART.
 *
 * Deliberately small. A shop that sells and buys needs these twelve to produce
 * a correct trial balance; anything else is a preference, and a fifty-account
 * default chart is one nobody reads and everybody works around. Users add their
 * own beneath these groups.
 *
 * GST is split into OUTPUT (collected on sales — a liability, we owe it to the
 * government) and INPUT (paid on purchases — an asset, it offsets what we owe).
 * Netting them into one account is the single most common mistake in a small
 * accounting build: the two are reported separately on every GST return, and
 * once merged they cannot be separated again.
 */
const DEFAULT_ACCOUNTS: DefaultAccount[] = [
  { key: 'CASH', name: 'Cash', type: 'Asset', code: '1010', group: 'Current Assets' },
  { key: 'BANK', name: 'Bank', type: 'Asset', code: '1020', group: 'Current Assets' },
  {
    key: 'ACCOUNTS_RECEIVABLE',
    name: 'Accounts Receivable',
    type: 'Asset',
    code: '1100',
    group: 'Current Assets',
  },
  {
    key: 'GST_INPUT',
    name: 'GST Receivable (Input)',
    type: 'Asset',
    code: '1200',
    group: 'Current Assets',
  },
  {
    key: 'ACCOUNTS_PAYABLE',
    name: 'Accounts Payable',
    type: 'Liability',
    code: '2100',
    group: 'Current Liabilities',
  },
  {
    key: 'GST_OUTPUT',
    name: 'GST Payable (Output)',
    type: 'Liability',
    code: '2200',
    group: 'Current Liabilities',
  },
  {
    key: 'OPENING_BALANCE_EQUITY',
    name: 'Opening Balance Equity',
    type: 'Equity',
    code: '3000',
    group: 'Equity',
  },
  { key: 'SALES', name: 'Sales', type: 'Income', code: '4000', group: 'Income' },
  {
    key: 'SALES_RETURN',
    name: 'Sales Returns',
    // A contra-income account. Typed as Expense so a debit increases it, which
    // is what a return does — the alternative is a negative-income account, and
    // negative balances read as errors on every report.
    type: 'Expense',
    code: '4100',
    group: 'Income',
  },
  {
    key: 'PURCHASE',
    name: 'Purchases',
    type: 'Expense',
    code: '5000',
    group: 'Direct Expenses',
  },
  {
    key: 'PURCHASE_RETURN',
    name: 'Purchase Returns',
    // Contra-expense: a credit increases it, reducing net purchases.
    type: 'Income',
    code: '5100',
    group: 'Direct Expenses',
  },
  {
    key: 'ROUND_OFF',
    name: 'Rounding Difference',
    type: 'Expense',
    code: '5900',
    group: 'Indirect Expenses',
  },
];

/** The parent groups, and where each sits in the type hierarchy. */
const DEFAULT_GROUPS: { name: string; type: AccountType; code: string }[] = [
  { name: 'Current Assets', type: 'Asset', code: '1000' },
  { name: 'Current Liabilities', type: 'Liability', code: '2000' },
  { name: 'Equity', type: 'Equity', code: '3000' },
  { name: 'Income', type: 'Income', code: '4000' },
  { name: 'Direct Expenses', type: 'Expense', code: '5000' },
  { name: 'Indirect Expenses', type: 'Expense', code: '5500' },
];

/**
 * Creates any missing default accounts. IDEMPOTENT — safe to call on every
 * posting, which is exactly what the posting service does.
 *
 * WHY ON EVERY POSTING RATHER THAN ONCE AT SIGNUP
 * ----------------------------------------------
 * Because a company created before this phase existed has no chart, and the
 * first sale after deploying must not fail with "no such account". Seeding
 * lazily inside the posting transaction means accounting starts working for
 * every existing tenant the moment they next transact, with no migration and no
 * window where an invoice is rejected for a bookkeeping reason the user cannot
 * act on.
 *
 * The cost is one indexed query per posting, and upserts only on the first.
 */
export async function ensureDefaultAccounts(
  tenant: TenantContext,
  session?: ClientSession
): Promise<Map<SystemAccountKey, { _id: Types.ObjectId; accountName: string; accountType: AccountType }>> {
  const query = AccountModel.find(
    tenantFilter(tenant, { systemKey: { $type: 'string' } })
  ).select('systemKey accountName accountType');
  if (session) query.session(session);
  const existing = await query.lean();

  const found = new Map(
    existing.map((account) => [
      account.systemKey as SystemAccountKey,
      {
        _id: account._id,
        accountName: account.accountName,
        accountType: account.accountType as AccountType,
      },
    ])
  );

  const missing = DEFAULT_ACCOUNTS.filter((account) => !found.has(account.key));
  if (missing.length === 0) return found;

  // Groups first — a child needs its parent's id.
  const groupIds = new Map<string, Types.ObjectId>();
  for (const group of DEFAULT_GROUPS) {
    const parent = await AccountModel.findOneAndUpdate(
      tenantFilter(tenant, { accountName: group.name }),
      {
        $setOnInsert: tenantStamp(tenant, {
          accountName: group.name,
          accountType: group.type,
          code: group.code,
          isSystem: true,
          parentAccountId: null,
        }),
      },
      { new: true, upsert: true, ...(session ? { session } : {}) }
    );
    groupIds.set(group.name, parent._id);
  }

  for (const account of missing) {
    const created = await AccountModel.findOneAndUpdate(
      tenantFilter(tenant, { systemKey: account.key }),
      {
        $setOnInsert: tenantStamp(tenant, {
          accountName: account.name,
          accountType: account.type,
          code: account.code,
          systemKey: account.key,
          isSystem: true,
          parentAccountId: groupIds.get(account.group) ?? null,
        }),
      },
      { new: true, upsert: true, ...(session ? { session } : {}) }
    );
    found.set(account.key, {
      _id: created._id,
      accountName: created.accountName,
      accountType: created.accountType as AccountType,
    });
  }

  return found;
}

/* ------------------------------------------------------------------ *
 * CRUD
 * ------------------------------------------------------------------ */

export async function listAccounts(
  tenant: TenantContext,
  query: { type?: AccountType; includeInactive?: boolean } = {}
) {
  const filter: Record<string, unknown> = {};
  if (query.type) filter.accountType = query.type;
  if (!query.includeInactive) filter.isActive = true;

  return AccountModel.find(tenantFilter(tenant, filter))
    .sort({ code: 1, accountName: 1 })
    .lean();
}

export interface AccountNode {
  _id: Types.ObjectId;
  accountName: string;
  accountType: AccountType;
  code: string | null;
  systemKey: string | null;
  isSystem: boolean;
  isActive: boolean;
  children: AccountNode[];
}

/**
 * The chart as a tree.
 *
 * Assembled in one pass in memory rather than with a recursive `$graphLookup`:
 * a chart of accounts is tens of rows, not thousands, and the aggregation would
 * cost more than the loop. Orphans — a child whose parent was deactivated and
 * filtered out — are attached at the root rather than dropped, because a
 * missing account in a chart of accounts is worse than an untidy one.
 */
export async function getAccountTree(tenant: TenantContext, includeInactive = false) {
  const accounts = await listAccounts(tenant, { includeInactive });

  const nodes = new Map<string, AccountNode>();
  for (const account of accounts) {
    nodes.set(String(account._id), {
      _id: account._id,
      accountName: account.accountName,
      accountType: account.accountType as AccountType,
      code: account.code ?? null,
      systemKey: account.systemKey ?? null,
      isSystem: account.isSystem,
      isActive: account.isActive,
      children: [],
    });
  }

  const roots: AccountNode[] = [];
  for (const account of accounts) {
    const node = nodes.get(String(account._id))!;
    const parent = account.parentAccountId
      ? nodes.get(String(account.parentAccountId))
      : null;
    if (parent) parent.children.push(node);
    else roots.push(node);
  }

  return roots;
}

export interface AccountInput {
  accountName: string;
  accountType: AccountType;
  code?: string | null;
  parentAccountId?: string | null;
  description?: string | null;
  isActive?: boolean;
}

export async function createAccount(tenant: TenantContext, input: AccountInput) {
  if (input.parentAccountId) {
    const parent = await AccountModel.findOne(
      tenantById(tenant, input.parentAccountId)
    ).lean();
    if (!parent) throw ApiError.notFound('Parent account not found');
    if (parent.accountType !== input.accountType) {
      // An Expense nested under Income would make every subtotal in the tree
      // meaningless — a group's total is only additive if its children share
      // its type.
      throw ApiError.badRequest(
        `A ${input.accountType} account cannot sit under a ${parent.accountType} account`
      );
    }
  }

  const created = await AccountModel.create(
    tenantStamp(tenant, { ...input, isSystem: false, systemKey: null })
  );
  return created.toObject();
}

export async function updateAccount(
  tenant: TenantContext,
  id: string,
  input: Partial<AccountInput>
) {
  const existing = await AccountModel.findOne(tenantById(tenant, id));
  if (!existing) throw ApiError.notFound('Account not found');

  if (existing.isSystem && input.accountType && input.accountType !== existing.accountType) {
    // Retyping an account flips which side increases it, silently inverting
    // every figure already posted into it.
    throw ApiError.badRequest(
      'A system account cannot change type. Create a new account instead.'
    );
  }

  if (input.parentAccountId) {
    if (String(input.parentAccountId) === id) {
      throw ApiError.badRequest('An account cannot be its own parent');
    }
    const parent = await AccountModel.findOne(
      tenantById(tenant, String(input.parentAccountId))
    ).lean();
    if (!parent) throw ApiError.notFound('Parent account not found');

    // Walk up from the proposed parent: if we meet this account, the move would
    // create a cycle and the tree builder would silently drop the whole branch.
    let cursor = parent.parentAccountId;
    while (cursor) {
      if (String(cursor) === id) {
        throw ApiError.badRequest('That move would nest the account inside itself');
      }
      const next: { parentAccountId?: Types.ObjectId | null } | null =
        await AccountModel.findOne(tenantFilter(tenant, { _id: cursor }))
          .select('parentAccountId')
          .lean();
      cursor = next?.parentAccountId ?? null;
    }
  }

  Object.assign(existing, input);
  await existing.save();
  return existing.toObject();
}

/**
 * Accounts that have been posted to are DEACTIVATED, not deleted — every
 * journal line that references one would otherwise point at nothing, and a
 * ledger with a hole in it is not a ledger. Same rule the customer master
 * follows.
 */
export async function deleteAccount(tenant: TenantContext, id: string) {
  const existing = await AccountModel.findOne(tenantById(tenant, id)).lean();
  if (!existing) throw ApiError.notFound('Account not found');

  if (existing.isSystem) {
    throw ApiError.badRequest('System accounts cannot be deleted. Deactivate it instead.');
  }

  const hasChildren = await AccountModel.exists(
    tenantFilter(tenant, { parentAccountId: new Types.ObjectId(id) })
  );
  if (hasChildren) {
    throw ApiError.badRequest('Move or remove the child accounts first');
  }

  const hasPostings = await JournalEntryModel.exists(
    tenantFilter(tenant, { 'lines.accountId': new Types.ObjectId(id) })
  );
  if (hasPostings) {
    await AccountModel.updateOne(tenantById(tenant, id), { $set: { isActive: false } });
    return { deleted: false, deactivated: true };
  }

  await AccountModel.deleteOne(tenantById(tenant, id));
  return { deleted: true, deactivated: false };
}

export async function getAccount(tenant: TenantContext, id: string) {
  const account = await AccountModel.findOne(tenantById(tenant, id)).lean();
  if (!account) throw ApiError.notFound('Account not found');
  return account;
}
