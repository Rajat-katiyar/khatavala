import { Types, type Model } from 'mongoose';
import { BrandModel, CategoryModel, UnitModel } from '../models/Catalog.js';
import { ProductModel } from '../models/Product.js';
import { ApiError } from '../utils/ApiError.js';
import {
  tenantById,
  tenantFilter,
  tenantStamp,
  type TenantContext,
} from '../middlewares/tenantScope.js';

/**
 * CRUD for the three product masters. One implementation, three configs —
 * they are the same company-scoped named lookup and would otherwise be three
 * files that drift.
 *
 * The interesting part is delete: a master that products still reference
 * cannot simply vanish, or every product pointing at it renders a blank
 * category forever. See `remove` below.
 */

interface MasterConfig {
  model: Model<any>;
  label: string;
  /** Field on Product that points back here, for the in-use check. */
  productField: 'categoryId' | 'brandId' | 'primaryUnitId';
  /** Extra fields this master accepts beyond name/description/isActive. */
  extraFields: string[];
}

const CONFIGS = {
  category: {
    model: CategoryModel,
    label: 'Category',
    productField: 'categoryId',
    extraFields: ['parentId'],
  },
  brand: {
    model: BrandModel,
    label: 'Brand',
    productField: 'brandId',
    extraFields: [],
  },
  unit: {
    model: UnitModel,
    label: 'Unit',
    productField: 'primaryUnitId',
    extraFields: ['symbol', 'allowsDecimal'],
  },
} satisfies Record<string, MasterConfig>;

export type MasterKind = keyof typeof CONFIGS;

const configFor = (kind: MasterKind): MasterConfig => CONFIGS[kind];

/** Escapes a user string so it cannot smuggle regex metacharacters into a query. */
const escapeRegex = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export async function list(
  tenant: TenantContext,
  kind: MasterKind,
  query: { search?: string; isActive?: boolean } = {}
) {
  const { model } = configFor(kind);
  const filter = tenantFilter(tenant, {
    ...(query.search && {
      name: { $regex: escapeRegex(query.search.trim()), $options: 'i' },
    }),
    ...(query.isActive !== undefined && { isActive: query.isActive }),
  });
  return model.find(filter).sort({ name: 1 }).lean();
}

/**
 * Every master plus how many products use it.
 *
 * The count is what makes the settings page honest: it tells the user why a
 * delete will be refused before they click it, rather than after.
 */
export async function listWithUsage(tenant: TenantContext, kind: MasterKind) {
  const { model, productField } = configFor(kind);

  const [items, usage] = await Promise.all([
    model.find(tenantFilter(tenant)).sort({ name: 1 }).lean(),
    ProductModel.aggregate([
      { $match: { companyId: tenant.companyId } },
      { $group: { _id: `$${productField}`, count: { $sum: 1 } } },
    ]),
  ]);

  const counts = new Map(usage.map((row) => [String(row._id), row.count as number]));
  return (items as any[]).map((item) => ({
    ...item,
    productCount: counts.get(String(item._id)) ?? 0,
  }));
}

export async function getOne(tenant: TenantContext, kind: MasterKind, id: string) {
  const { model, label } = configFor(kind);
  const item = await model.findOne(tenantById(tenant, id)).lean();
  // Another tenant's row reads as "not found" — never "forbidden", which would
  // confirm the id exists.
  if (!item) throw ApiError.notFound(`${label} not found`);
  return item;
}

function pickFields(kind: MasterKind, input: Record<string, unknown>) {
  const { extraFields } = configFor(kind);
  const allowed = ['name', 'description', 'isActive', ...extraFields];
  return Object.fromEntries(
    Object.entries(input).filter(([key]) => allowed.includes(key))
  );
}

export async function create(
  tenant: TenantContext,
  kind: MasterKind,
  input: Record<string, unknown>
) {
  const { model, label } = configFor(kind);
  const payload = pickFields(kind, input);

  const clash = await model.findOne(tenantFilter(tenant, { name: payload.name })).lean();
  if (clash) throw ApiError.badRequest(`A ${label.toLowerCase()} with that name already exists`);

  // A category's parent must belong to the same company — otherwise a guessed
  // ObjectId would graft another tenant's tree onto this one.
  if (kind === 'category' && payload.parentId) {
    const parent = await model
      .findOne(tenantById(tenant, String(payload.parentId)))
      .lean();
    if (!parent) throw ApiError.badRequest('That parent category does not exist');
  }

  return model.create(tenantStamp(tenant, payload));
}

export async function update(
  tenant: TenantContext,
  kind: MasterKind,
  id: string,
  input: Record<string, unknown>
) {
  const { model, label } = configFor(kind);
  const payload = pickFields(kind, input);

  if (payload.name) {
    const clash = await model
      .findOne(tenantFilter(tenant, { name: payload.name, _id: { $ne: id } }))
      .lean();
    if (clash) {
      throw ApiError.badRequest(`Another ${label.toLowerCase()} already uses that name`);
    }
  }

  if (kind === 'category' && payload.parentId) {
    // A category that is its own parent makes the two-level listing infinite.
    if (String(payload.parentId) === String(id)) {
      throw ApiError.badRequest('A category cannot be its own parent');
    }
    const parent = await model.findOne(tenantById(tenant, String(payload.parentId))).lean();
    if (!parent) throw ApiError.badRequest('That parent category does not exist');
  }

  const item = await model.findOneAndUpdate(
    tenantById(tenant, id),
    { $set: payload },
    { new: true, runValidators: true }
  );
  if (!item) throw ApiError.notFound(`${label} not found`);
  return item;
}

/**
 * Deletes a master, or deactivates it when products still point at it.
 *
 * Hard-deleting an in-use category would leave every product referencing an id
 * that resolves to nothing — the product list would show a blank column and
 * the category filter would silently return zero rows. Deactivating keeps the
 * name resolvable for existing products while removing it from the pickers for
 * new ones, which is what "delete" actually means to the user here.
 */
export async function remove(tenant: TenantContext, kind: MasterKind, id: string) {
  const { model, label, productField } = configFor(kind);

  const item = await model.findOne(tenantById(tenant, id)).lean();
  if (!item) throw ApiError.notFound(`${label} not found`);

  const inUse = await ProductModel.countDocuments(
    tenantFilter(tenant, { [productField]: new Types.ObjectId(id) })
  );

  // A category may also be a parent; orphaning children is the same problem.
  const childCount =
    kind === 'category'
      ? await model.countDocuments(tenantFilter(tenant, { parentId: new Types.ObjectId(id) }))
      : 0;

  if (inUse > 0 || childCount > 0) {
    await model.updateOne(tenantById(tenant, id), { $set: { isActive: false } });
    return { deleted: false, deactivated: true, productCount: inUse, childCount };
  }

  await model.deleteOne(tenantById(tenant, id));
  return { deleted: true, deactivated: false, productCount: 0, childCount: 0 };
}

/**
 * Seeds the units every Indian retail company needs on day one.
 *
 * Without this, creating the very first product means first creating a unit,
 * which reads as a bug to someone who just wants to add a bag of rice. Called
 * from the products list endpoint when the company has no units at all.
 */
export async function seedDefaultUnits(tenant: TenantContext) {
  const existing = await UnitModel.countDocuments(tenantFilter(tenant));
  if (existing > 0) return [];

  const defaults = [
    { name: 'Piece', symbol: 'pcs', allowsDecimal: false },
    { name: 'Kilogram', symbol: 'kg', allowsDecimal: true },
    { name: 'Gram', symbol: 'g', allowsDecimal: true },
    { name: 'Litre', symbol: 'ltr', allowsDecimal: true },
    { name: 'Metre', symbol: 'm', allowsDecimal: true },
    { name: 'Box', symbol: 'box', allowsDecimal: false },
    { name: 'Packet', symbol: 'pkt', allowsDecimal: false },
    { name: 'Dozen', symbol: 'dzn', allowsDecimal: false },
  ];

  return UnitModel.insertMany(defaults.map((unit) => tenantStamp(tenant, unit)));
}
