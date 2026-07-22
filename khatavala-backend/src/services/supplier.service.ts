import { SupplierModel } from '../models/Supplier.js';
import { ApiError } from '../utils/ApiError.js';
import { countEntries, seedOpeningBalance } from './supplierLedger.service.js';
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

export interface SupplierAddress {
  line1?: string;
  line2?: string;
  city?: string;
  state?: string;
  pincode?: string;
}

export interface SupplierInput {
  name: string;
  phone: string;
  email?: string;
  gstNumber?: string;
  pan?: string;
  address?: SupplierAddress;
  openingBalance?: number;
  vendorRating?: number | null;
  isActive?: boolean;
}

const SORTABLE = ['name', 'phone', 'currentBalance', 'vendorRating', 'createdAt'] as const;
export type SupplierSortField = (typeof SORTABLE)[number];

export interface ListSuppliersQuery {
  search?: string;
  sortBy?: string;
  sortDir?: 'asc' | 'desc';
  page?: number;
  limit?: number;
  isActive?: boolean;
  /** Only suppliers we currently owe. Backs the "Payable" filter. */
  hasDues?: boolean;
  /** Minimum vendor rating, for shortlisting good suppliers. */
  minRating?: number;
}

/** Escapes a user string so it cannot smuggle regex metacharacters into a query. */
const escapeRegex = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Builds the search clause. Regex rather than the `$text` index, for the same
 * reason as customers: a text index tokenises on word boundaries, so it can
 * never match a partial phone or GST number — which is how people actually
 * search a party list. `name` is unanchored; `phone`/`gstNumber` are anchored
 * so they can use the index rather than scanning.
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

export async function listSuppliers(tenant: TenantContext, query: ListSuppliersQuery = {}) {
  const page = Math.max(1, query.page ?? 1);
  const limit = Math.min(200, Math.max(1, query.limit ?? 25));

  const sortBy = (SORTABLE as readonly string[]).includes(query.sortBy ?? '')
    ? (query.sortBy as SupplierSortField)
    : 'name';
  const sortDir = query.sortDir === 'desc' ? -1 : 1;

  const filter = tenantFilter(tenant, {
    ...(query.search ? searchClause(query.search) : {}),
    ...(query.isActive !== undefined && { isActive: query.isActive }),
    ...(query.hasDues && { currentBalance: { $gt: 0 } }),
    ...(query.minRating && { vendorRating: { $gte: query.minRating } }),
  });

  const [suppliers, total] = await Promise.all([
    SupplierModel.find(filter)
      .sort({ [sortBy]: sortDir, _id: 1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .lean(),
    SupplierModel.countDocuments(filter),
  ]);

  return {
    suppliers,
    pagination: { page, limit, total, pages: Math.ceil(total / limit) || 1 },
  };
}

/** Typeahead-shaped search, for the supplier picker on a purchase bill screen. */
export async function searchSuppliers(tenant: TenantContext, search: string, limit = 10) {
  if (!search.trim()) return [];
  return SupplierModel.find(tenantFilter(tenant, { isActive: true, ...searchClause(search) }))
    .select('name phone gstNumber currentBalance vendorRating')
    .limit(Math.min(50, limit))
    .lean();
}

export async function createSupplier(tenant: TenantContext, input: SupplierInput) {
  const existing = await SupplierModel.findOne(
    tenantFilter(tenant, { phone: input.phone })
  ).lean();
  if (existing) throw ApiError.badRequest('A supplier with that phone number already exists');

  const opening = input.openingBalance ?? 0;

  const supplier = await SupplierModel.create(
    // currentBalance starts at 0, not at openingBalance: seedOpeningBalance
    // moves it via the ledger, so the balance and the ledger agree. Setting
    // both here would double-count the opening amount.
    tenantStamp(tenant, { ...input, openingBalance: opening, currentBalance: 0 })
  );

  await seedOpeningBalance(tenant, supplier._id, opening);

  // Re-read: seedOpeningBalance moved currentBalance behind this document's back.
  return SupplierModel.findById(supplier._id).lean();
}

export async function getSupplier(tenant: TenantContext, id: string) {
  const supplier = await SupplierModel.findOne(tenantById(tenant, id)).lean();
  // Another tenant's supplier reads as "not found" — never as "forbidden",
  // which would confirm the id exists.
  if (!supplier) throw ApiError.notFound('Supplier not found');
  return supplier;
}

export async function updateSupplier(
  tenant: TenantContext,
  id: string,
  input: Partial<SupplierInput>
) {
  // openingBalance and currentBalance are ledger-owned. The validator strips
  // them from the request body; this is the belt-and-braces half of that, so a
  // future internal caller cannot desync the balance by passing them directly.
  const { openingBalance: _o, ...safe } = input as Partial<SupplierInput> & {
    currentBalance?: number;
  };
  delete (safe as { currentBalance?: number }).currentBalance;

  if (safe.phone) {
    const clash = await SupplierModel.findOne(
      tenantFilter(tenant, { phone: safe.phone, _id: { $ne: id } })
    ).lean();
    if (clash) throw ApiError.badRequest('Another supplier already uses that phone number');
  }

  const supplier = await SupplierModel.findOneAndUpdate(
    tenantById(tenant, id),
    { $set: safe },
    { new: true, runValidators: true }
  );
  if (!supplier) throw ApiError.notFound('Supplier not found');
  return supplier;
}

/**
 * Deactivates rather than deletes once a supplier has ledger history.
 *
 * A hard delete would orphan every ledger entry and silently drop the payable
 * from the books — and the entries are append-only by design, so they cannot be
 * cleaned up either. Suppliers with no history are genuinely removable.
 */
export async function deleteSupplier(tenant: TenantContext, id: string) {
  const supplier = await SupplierModel.findOne(tenantById(tenant, id)).lean();
  if (!supplier) throw ApiError.notFound('Supplier not found');

  const entries = await countEntries(tenant, supplier._id);

  if (entries > 0) {
    await SupplierModel.updateOne(tenantById(tenant, id), { $set: { isActive: false } });
    return { deleted: false, deactivated: true };
  }

  await SupplierModel.deleteOne(tenantById(tenant, id));
  return { deleted: true, deactivated: false };
}
