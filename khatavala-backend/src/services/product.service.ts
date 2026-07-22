import { Types } from 'mongoose';
import { ProductModel } from '../models/Product.js';
import { BrandModel, CategoryModel, UnitModel } from '../models/Catalog.js';
import { ApiError } from '../utils/ApiError.js';
import {
  tenantById,
  tenantFilter,
  tenantStamp,
  type TenantContext,
} from '../middlewares/tenantScope.js';

/**
 * Follows the tenant-scoping pattern in middlewares/tenantScope.ts: `tenant`
 * first, reads through `tenantFilter`, writes through `tenantStamp`,
 * single-document access through `tenantById`.
 */

export interface ProductInput {
  name: string;
  sku: string;
  barcode?: string | null;
  categoryId?: string | null;
  brandId?: string | null;
  hsnCode?: string | null;
  gstPercentage?: number;
  primaryUnitId: string;
  secondaryUnitId?: string | null;
  conversionFactor?: number | null;
  purchasePrice?: number;
  sellingPrice?: number;
  mrp?: number;
  wholesalePrice?: number;
  openingStock?: number;
  minStockLevel?: number;
  maxStockLevel?: number;
  trackBatch?: boolean;
  trackExpiry?: boolean;
  trackSerial?: boolean;
  imageUrl?: string | null;
  isActive?: boolean;
}

const SORTABLE = [
  'name',
  'sku',
  'sellingPrice',
  'purchasePrice',
  'currentStock',
  'createdAt',
] as const;
export type ProductSortField = (typeof SORTABLE)[number];

export type StockStatus = 'all' | 'low' | 'out' | 'in';

export interface ListProductsQuery {
  search?: string;
  categoryId?: string;
  brandId?: string;
  stockStatus?: StockStatus;
  isActive?: boolean;
  sortBy?: string;
  sortDir?: 'asc' | 'desc';
  page?: number;
  limit?: number;
}

const escapeRegex = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * SEARCH STRATEGY
 * ===============
 * The text index on name/sku/barcode is necessary but not sufficient. Text
 * indexes tokenise on word boundaries, so `$text` can match "Basmati" in
 * "Basmati Rice 5kg" but can NEVER match:
 *   - a partial SKU        ("RIC" against "RICE-5KG"), or
 *   - a half-typed barcode ("890123" against "8901234567890").
 *
 * Both are exactly how this box gets used: someone types SKU characters until
 * the row appears, or a scanner fires a complete barcode at it.
 *
 * So the LIST filter is a union of three clauses:
 *   1. exact barcode/SKU     — the scanner case;
 *   2. prefix on sku/barcode — the incremental-typing case, index-backed
 *      because the regex is anchored;
 *   3. substring on name     — the browsing case.
 *
 * `$text` is deliberately absent here: MongoDB will not combine `$text` with
 * `$or`, and these clauses already cover every case it would. The text index
 * still earns its place — `searchProducts` below uses it for relevance-ranked
 * typeahead, which is the one thing regex cannot do.
 */
function searchClause(search: string) {
  const term = escapeRegex(search.trim());
  const upper = term.toUpperCase();
  return {
    $or: [
      { sku: upper },
      { barcode: term },
      { sku: { $regex: `^${upper}` } },
      { barcode: { $regex: `^${term}` } },
      { name: { $regex: term, $options: 'i' } },
    ],
  };
}

function stockClause(status: StockStatus | undefined) {
  switch (status) {
    case 'out':
      return { currentStock: { $lte: 0 } };
    case 'low':
      // At or below the reorder level but NOT yet out — "out" is its own
      // status, and lumping them together hides the difference between
      // "order soon" and "cannot sell right now".
      return {
        $and: [
          { currentStock: { $gt: 0 } },
          { minStockLevel: { $gt: 0 } },
          { $expr: { $lte: ['$currentStock', '$minStockLevel'] } },
        ],
      };
    case 'in':
      return { currentStock: { $gt: 0 } };
    default:
      return {};
  }
}

export async function listProducts(tenant: TenantContext, query: ListProductsQuery = {}) {
  const page = Math.max(1, query.page ?? 1);
  const limit = Math.min(200, Math.max(1, query.limit ?? 25));

  const sortBy = (SORTABLE as readonly string[]).includes(query.sortBy ?? '')
    ? (query.sortBy as ProductSortField)
    : 'name';
  const sortDir = query.sortDir === 'desc' ? -1 : 1;

  const filter = tenantFilter(tenant, {
    ...(query.search ? searchClause(query.search) : {}),
    ...(query.categoryId && { categoryId: new Types.ObjectId(query.categoryId) }),
    ...(query.brandId && { brandId: new Types.ObjectId(query.brandId) }),
    ...(query.isActive !== undefined && { isActive: query.isActive }),
    ...stockClause(query.stockStatus),
  });

  const [products, total] = await Promise.all([
    ProductModel.find(filter)
      .populate('categoryId', 'name')
      .populate('brandId', 'name')
      .populate('primaryUnitId', 'name symbol')
      .populate('secondaryUnitId', 'name symbol')
      .sort({ [sortBy]: sortDir, _id: 1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .lean(),
    ProductModel.countDocuments(filter),
  ]);

  return {
    products,
    pagination: { page, limit, total, pages: Math.ceil(total / limit) || 1 },
  };
}

/**
 * Relevance-ranked typeahead, for the product picker on an invoice.
 *
 * This is where the text index pays off: `$text` scores an SKU hit above a
 * name hit via the index weights, which a flat regex union cannot do. An exact
 * barcode/SKU is checked first and short-circuits — a scanner should land on
 * one product, not a ranked list.
 */
export async function searchProducts(tenant: TenantContext, search: string, limit = 10) {
  const term = search.trim();
  if (!term) return [];

  const exact = await ProductModel.findOne(
    tenantFilter(tenant, {
      isActive: true,
      $or: [{ barcode: term }, { sku: term.toUpperCase() }],
    })
  )
    .populate('primaryUnitId', 'name symbol')
    .lean();
  if (exact) return [exact];

  // Text search for whole words, which is what a name query usually is.
  const textHits = await ProductModel.find(
    tenantFilter(tenant, { isActive: true, $text: { $search: term } }),
    { score: { $meta: 'textScore' } }
  )
    .populate('primaryUnitId', 'name symbol')
    .sort({ score: { $meta: 'textScore' } })
    .limit(Math.min(50, limit))
    .lean();

  if (textHits.length > 0) return textHits;

  // Nothing tokenised — fall back to prefix/substring for partial input.
  return ProductModel.find(tenantFilter(tenant, { isActive: true, ...searchClause(term) }))
    .populate('primaryUnitId', 'name symbol')
    .limit(Math.min(50, limit))
    .lean();
}

/**
 * Validates that every referenced master exists IN THIS COMPANY.
 *
 * Without this a caller could pass another tenant's categoryId and quietly
 * bind their product to it — the id would resolve on populate and leak that
 * category's name across the tenant boundary.
 */
async function assertReferences(tenant: TenantContext, input: Partial<ProductInput>) {
  const requireIn = async (model: any, id: string | null | undefined, label: string) => {
    if (!id) return;
    const found = await model.findOne(tenantById(tenant, String(id))).lean();
    if (!found) throw ApiError.badRequest(`That ${label} does not exist`);
  };

  const checks: Array<Promise<void>> = [];
  if (input.categoryId) checks.push(requireIn(CategoryModel, input.categoryId, 'category'));
  if (input.brandId) checks.push(requireIn(BrandModel, input.brandId, 'brand'));
  if (input.primaryUnitId) checks.push(requireIn(UnitModel, input.primaryUnitId, 'unit'));
  if (input.secondaryUnitId) {
    checks.push(requireIn(UnitModel, input.secondaryUnitId, 'secondary unit'));
  }

  await Promise.all(checks);
}

/**
 * The secondary unit and its conversion factor are meaningless apart: a "case"
 * with no factor cannot be converted, and a factor with no unit converts to
 * nothing. Enforced here rather than in the schema so the message can say
 * which half is missing.
 */
function assertUnitPairing(
  input: Partial<ProductInput> & { primaryUnitId?: string },
  existing?: { secondaryUnitId?: unknown; conversionFactor?: unknown }
) {
  const secondary =
    input.secondaryUnitId !== undefined ? input.secondaryUnitId : existing?.secondaryUnitId;
  const factor =
    input.conversionFactor !== undefined ? input.conversionFactor : existing?.conversionFactor;

  if (secondary && !factor) {
    throw ApiError.badRequest('A secondary unit needs a conversion factor');
  }
  if (factor && !secondary) {
    throw ApiError.badRequest('A conversion factor needs a secondary unit');
  }
  if (secondary && factor && Number(factor) <= 0) {
    throw ApiError.badRequest('The conversion factor must be greater than zero');
  }
  if (
    input.secondaryUnitId &&
    input.primaryUnitId &&
    String(input.secondaryUnitId) === String(input.primaryUnitId)
  ) {
    throw ApiError.badRequest('The secondary unit must differ from the primary unit');
  }
}

export async function createProduct(tenant: TenantContext, input: ProductInput) {
  const sku = input.sku.trim().toUpperCase();

  const clash = await ProductModel.findOne(tenantFilter(tenant, { sku })).lean();
  if (clash) throw ApiError.badRequest('A product with that SKU already exists');

  if (input.barcode) {
    const barcodeClash = await ProductModel.findOne(
      tenantFilter(tenant, { barcode: input.barcode })
    ).lean();
    if (barcodeClash) throw ApiError.badRequest('A product with that barcode already exists');
  }

  await assertReferences(tenant, input);
  assertUnitPairing(input);

  const opening = input.openingStock ?? 0;

  return ProductModel.create(
    // currentStock is seeded from openingStock here and owned by Inventory
    // thereafter — the two agree exactly once, at creation.
    tenantStamp(tenant, { ...input, sku, openingStock: opening, currentStock: opening })
  );
}

export async function getProduct(tenant: TenantContext, id: string) {
  const product = await ProductModel.findOne(tenantById(tenant, id))
    .populate('categoryId', 'name')
    .populate('brandId', 'name')
    .populate('primaryUnitId', 'name symbol allowsDecimal')
    .populate('secondaryUnitId', 'name symbol allowsDecimal')
    .lean();
  // Another tenant's product reads as "not found" — never as "forbidden",
  // which would confirm the id exists.
  if (!product) throw ApiError.notFound('Product not found');
  return product;
}

export async function updateProduct(
  tenant: TenantContext,
  id: string,
  input: Partial<ProductInput>
) {
  const existing = await ProductModel.findOne(tenantById(tenant, id)).lean();
  if (!existing) throw ApiError.notFound('Product not found');

  // openingStock and currentStock are inventory-owned. The validator strips
  // them; this is the belt-and-braces half so a future internal caller cannot
  // desync stock by passing them directly.
  const { openingStock: _o, ...safe } = input as Partial<ProductInput> & {
    currentStock?: number;
  };
  delete (safe as { currentStock?: number }).currentStock;

  if (safe.sku) {
    safe.sku = safe.sku.trim().toUpperCase();
    const clash = await ProductModel.findOne(
      tenantFilter(tenant, { sku: safe.sku, _id: { $ne: id } })
    ).lean();
    if (clash) throw ApiError.badRequest('Another product already uses that SKU');
  }

  if (safe.barcode) {
    const clash = await ProductModel.findOne(
      tenantFilter(tenant, { barcode: safe.barcode, _id: { $ne: id } })
    ).lean();
    if (clash) throw ApiError.badRequest('Another product already uses that barcode');
  }

  await assertReferences(tenant, safe);
  assertUnitPairing(
    { ...safe, primaryUnitId: safe.primaryUnitId ?? String(existing.primaryUnitId) },
    existing
  );

  const product = await ProductModel.findOneAndUpdate(
    tenantById(tenant, id),
    { $set: safe },
    { new: true, runValidators: true }
  );
  if (!product) throw ApiError.notFound('Product not found');
  return product;
}

/**
 * Deactivates rather than deletes once stock has moved.
 *
 * A product with stock on hand is on a shelf somewhere; deleting it would drop
 * that value out of the inventory valuation with no trace. Once Sales and
 * Purchases land, the same reasoning extends to any product referenced by a
 * document — those checks belong here when those collections exist.
 */
export async function deleteProduct(tenant: TenantContext, id: string) {
  const product = await ProductModel.findOne(tenantById(tenant, id)).lean();
  if (!product) throw ApiError.notFound('Product not found');

  if ((product.currentStock ?? 0) !== 0) {
    await ProductModel.updateOne(tenantById(tenant, id), { $set: { isActive: false } });
    return {
      deleted: false,
      deactivated: true,
      reason: 'This product still has stock on hand',
    };
  }

  await ProductModel.deleteOne(tenantById(tenant, id));
  return { deleted: true, deactivated: false, reason: null };
}

/** Counts for the products page header — one round trip, not four. */
export async function getProductStats(tenant: TenantContext) {
  const [stats] = await ProductModel.aggregate([
    { $match: { companyId: tenant.companyId } },
    {
      $group: {
        _id: null,
        total: { $sum: 1 },
        active: { $sum: { $cond: ['$isActive', 1, 0] } },
        outOfStock: { $sum: { $cond: [{ $lte: ['$currentStock', 0] }, 1, 0] } },
        lowStock: {
          $sum: {
            $cond: [
              {
                $and: [
                  { $gt: ['$currentStock', 0] },
                  { $gt: ['$minStockLevel', 0] },
                  { $lte: ['$currentStock', '$minStockLevel'] },
                ],
              },
              1,
              0,
            ],
          },
        },
        stockValue: {
          $sum: { $multiply: ['$currentStock', { $ifNull: ['$purchasePrice', 0] }] },
        },
      },
    },
  ]);

  return {
    total: stats?.total ?? 0,
    active: stats?.active ?? 0,
    lowStock: stats?.lowStock ?? 0,
    outOfStock: stats?.outOfStock ?? 0,
    // Valued at cost, not selling price — this is what the stock is worth to
    // the business, not what it might fetch.
    stockValue: stats?.stockValue ?? 0,
  };
}
