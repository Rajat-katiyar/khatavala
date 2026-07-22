import { CustomerModel } from '../models/Customer.js';
import { CustomerLedgerEntryModel } from '../models/CustomerLedgerEntry.js';
import { ApiError } from '../utils/ApiError.js';
import { seedOpeningBalance } from './customerLedger.service.js';
import {
  tenantById,
  tenantFilter,
  tenantStamp,
  type TenantContext,
} from '../middlewares/tenantScope.js';

/**
 * Follows the tenant-scoping pattern documented in middlewares/tenantScope.ts:
 * `tenant` first, reads through `tenantFilter`, writes through `tenantStamp`,
 * single-document access through `tenantById`.
 */

export interface CustomerAddress {
  line1?: string;
  line2?: string;
  city?: string;
  state?: string;
  pincode?: string;
}

export interface CustomerInput {
  name: string;
  phone: string;
  email?: string;
  gstNumber?: string;
  pan?: string;
  billingAddress?: CustomerAddress;
  shippingAddress?: CustomerAddress;
  creditLimit?: number;
  openingBalance?: number;
  isActive?: boolean;
}

const SORTABLE = ['name', 'phone', 'currentBalance', 'creditLimit', 'createdAt'] as const;
export type CustomerSortField = (typeof SORTABLE)[number];

export interface ListCustomersQuery {
  search?: string;
  sortBy?: string;
  sortDir?: 'asc' | 'desc';
  page?: number;
  limit?: number;
  isActive?: boolean;
  /** Only customers who currently owe money. Backs the "Outstanding" filter. */
  hasDues?: boolean;
}

/** Escapes a user string so it cannot smuggle regex metacharacters into a query. */
const escapeRegex = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Builds the search clause. Deliberately regex and not `$text`:
 *
 * A text index tokenises on word boundaries, so it can match "Sharma" but never
 * "shar", and it cannot match a partial phone or GST number at all — which is
 * how people actually search a customer list (typing digits until the row they
 * want appears). Regex gives that incremental behaviour on all three fields.
 * `name` is unanchored so mid-name matches work; `phone`/`gstNumber` are
 * anchored so they can use the index rather than scanning the collection.
 */
function searchClause(search: string) {
  const term = escapeRegex(search.trim());
  return {
    $or: [
      { name: { $regex: term, $options: 'i' } },
      { phone: { $regex: `^${term}`, $options: 'i' } },
      { gstNumber: { $regex: `^${term}`, $options: 'i' } },
    ],
  };
}

export async function listCustomers(tenant: TenantContext, query: ListCustomersQuery = {}) {
  const page = Math.max(1, query.page ?? 1);
  const limit = Math.min(200, Math.max(1, query.limit ?? 25));

  const sortBy = (SORTABLE as readonly string[]).includes(query.sortBy ?? '')
    ? (query.sortBy as CustomerSortField)
    : 'name';
  const sortDir = query.sortDir === 'desc' ? -1 : 1;

  const filter = tenantFilter(tenant, {
    ...(query.search ? searchClause(query.search) : {}),
    ...(query.isActive !== undefined && { isActive: query.isActive }),
    ...(query.hasDues && { currentBalance: { $gt: 0 } }),
  });

  const [customers, total] = await Promise.all([
    CustomerModel.find(filter)
      .sort({ [sortBy]: sortDir, _id: 1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .lean(),
    CustomerModel.countDocuments(filter),
  ]);

  return {
    customers,
    pagination: { page, limit, total, pages: Math.ceil(total / limit) || 1 },
  };
}

/** Typeahead-shaped search, for the customer picker on an invoice screen. */
export async function searchCustomers(tenant: TenantContext, search: string, limit = 10) {
  if (!search.trim()) return [];
  return CustomerModel.find(tenantFilter(tenant, { isActive: true, ...searchClause(search) }))
    .select('name phone gstNumber currentBalance creditLimit')
    .limit(Math.min(50, limit))
    .lean();
}

export async function createCustomer(tenant: TenantContext, input: CustomerInput) {
  const existing = await CustomerModel.findOne(
    tenantFilter(tenant, { phone: input.phone })
  ).lean();
  if (existing) throw ApiError.badRequest('A customer with that phone number already exists');

  const opening = input.openingBalance ?? 0;

  const customer = await CustomerModel.create(
    // currentBalance starts at 0, not at openingBalance: seedOpeningBalance
    // moves it via the ledger, so the balance and the ledger agree. Setting
    // both here would double-count the opening amount.
    tenantStamp(tenant, { ...input, openingBalance: opening, currentBalance: 0 })
  );

  await seedOpeningBalance(tenant, customer._id, opening);

  // Re-read: seedOpeningBalance moved currentBalance behind this document's back.
  return CustomerModel.findById(customer._id).lean();
}

export async function getCustomer(tenant: TenantContext, id: string) {
  const customer = await CustomerModel.findOne(tenantById(tenant, id)).lean();
  // Another tenant's customer reads as "not found" — never as "forbidden",
  // which would confirm the id exists.
  if (!customer) throw ApiError.notFound('Customer not found');
  return customer;
}

export async function updateCustomer(
  tenant: TenantContext,
  id: string,
  input: Partial<CustomerInput>
) {
  // openingBalance and currentBalance are ledger-owned. The validator strips
  // them from the request body; this is the belt-and-braces half of that, so a
  // future internal caller cannot desync the balance by passing them directly.
  const { openingBalance: _o, ...safe } = input as Partial<CustomerInput> & {
    currentBalance?: number;
  };
  delete (safe as { currentBalance?: number }).currentBalance;

  if (safe.phone) {
    const clash = await CustomerModel.findOne(
      tenantFilter(tenant, { phone: safe.phone, _id: { $ne: id } })
    ).lean();
    if (clash) throw ApiError.badRequest('Another customer already uses that phone number');
  }

  const customer = await CustomerModel.findOneAndUpdate(
    tenantById(tenant, id),
    { $set: safe },
    { new: true, runValidators: true }
  );
  if (!customer) throw ApiError.notFound('Customer not found');
  return customer;
}

/**
 * Deactivates rather than deletes once a customer has ledger history.
 *
 * A hard delete would orphan every ledger entry and silently drop the
 * receivable from the books — and the entries are append-only by design, so
 * they cannot be cleaned up either. Customers with no history are genuinely
 * removable (a typo'd entry created a minute ago), so those we do delete.
 */
export async function deleteCustomer(tenant: TenantContext, id: string) {
  const customer = await CustomerModel.findOne(tenantById(tenant, id)).lean();
  if (!customer) throw ApiError.notFound('Customer not found');

  const entries = await CustomerLedgerEntryModel.countDocuments(
    tenantFilter(tenant, { customerId: customer._id })
  );

  if (entries > 0) {
    await CustomerModel.updateOne(tenantById(tenant, id), { $set: { isActive: false } });
    return { deleted: false, deactivated: true };
  }

  await CustomerModel.deleteOne(tenantById(tenant, id));
  return { deleted: true, deactivated: false };
}
