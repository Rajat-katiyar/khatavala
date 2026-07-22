import ExcelJS from 'exceljs';
import { Types } from 'mongoose';
import { ProductModel } from '../models/Product.js';
import { BrandModel, CategoryModel, UnitModel } from '../models/Catalog.js';
import {
  buildTemplate as buildTemplateFor,
  runImport,
  type ColumnSpec,
  type ImportResult,
  type ImportSpec,
  type RowContext,
} from './excelImport.service.js';
import { tenantFilter, tenantStamp, type TenantContext } from '../middlewares/tenantScope.js';
import { listProducts } from './product.service.js';

export type { ImportResult, ImportRowError } from './excelImport.service.js';

/**
 * Product bulk import/export on the shared engine from Phase 5
 * (excelImport.service.ts), which already owns template rendering, header
 * matching, uniqueness, dry runs and the per-row error report.
 *
 * What is genuinely new here: products reference three MASTERS, and a
 * spreadsheet holds their names, not their ObjectIds. Nobody types
 * "6a5b88647f09e1c4306f90c0" into a Category column. So the import resolves
 * names to ids, and — for categories and brands — CREATES the ones it has not
 * seen. Rejecting a 400-row sheet because row 12 mentions a new brand would
 * make the feature useless for its actual purpose, which is onboarding a shop
 * that already has a catalog.
 *
 * Units are deliberately NOT auto-created: a unit carries a decimal rule that
 * cannot be inferred from a name, and silently inventing "Kilo" alongside an
 * existing "Kilogram" corrupts every quantity that follows.
 */

const COLUMNS: ColumnSpec[] = [
  { header: 'Name*', key: 'name', width: 32, note: 'Required' },
  { header: 'SKU*', key: 'sku', width: 18, note: 'Required, unique per company' },
  { header: 'Barcode', key: 'barcode', width: 18 },
  { header: 'Category', key: 'category', width: 20, note: 'Created if new' },
  { header: 'Brand', key: 'brand', width: 20, note: 'Created if new' },
  { header: 'Unit*', key: 'unit', width: 14, note: 'Must already exist — name or symbol' },
  { header: 'Secondary Unit', key: 'secondaryUnit', width: 16 },
  { header: 'Conversion Factor', key: 'conversionFactor', width: 16, note: 'Primary units per secondary' },
  { header: 'HSN Code', key: 'hsnCode', width: 14 },
  { header: 'GST %', key: 'gstPercentage', width: 10 },
  { header: 'Purchase Price', key: 'purchasePrice', width: 15 },
  { header: 'Selling Price', key: 'sellingPrice', width: 15 },
  { header: 'MRP', key: 'mrp', width: 12 },
  { header: 'Wholesale Price', key: 'wholesalePrice', width: 15 },
  { header: 'Opening Stock', key: 'openingStock', width: 14 },
  { header: 'Min Stock Level', key: 'minStockLevel', width: 15 },
  { header: 'Max Stock Level', key: 'maxStockLevel', width: 15 },
  { header: 'Track Batch', key: 'trackBatch', width: 12, note: 'Yes / No' },
  { header: 'Track Expiry', key: 'trackExpiry', width: 12, note: 'Yes / No' },
  { header: 'Track Serial', key: 'trackSerial', width: 12, note: 'Yes / No' },
];

/** Accepts the many ways a spreadsheet spells a boolean. */
const truthy = (value: string) => /^(y|yes|true|1|✓)$/i.test(value.trim());

/**
 * Per-import caches of the master lists, keyed by lower-cased name.
 *
 * Built once per import rather than queried per row: a 500-row sheet would
 * otherwise issue 1500 lookups. `pendingCategories`/`pendingBrands` collect
 * names to create, so a new brand appearing on 80 rows is created once.
 */
interface MasterCaches {
  categories: Map<string, Types.ObjectId>;
  brands: Map<string, Types.ObjectId>;
  units: Map<string, Types.ObjectId>;
  newCategories: Set<string>;
  newBrands: Set<string>;
}

async function loadMasters(tenant: TenantContext): Promise<MasterCaches> {
  const [categories, brands, units] = await Promise.all([
    CategoryModel.find(tenantFilter(tenant)).select('name').lean(),
    BrandModel.find(tenantFilter(tenant)).select('name').lean(),
    UnitModel.find(tenantFilter(tenant)).select('name symbol').lean(),
  ]);

  const unitMap = new Map<string, Types.ObjectId>();
  for (const unit of units as any[]) {
    // Units resolve by name OR symbol — a sheet is as likely to say "kg" as
    // "Kilogram", and both should land on the same unit.
    unitMap.set(String(unit.name).toLowerCase(), unit._id);
    if (unit.symbol) unitMap.set(String(unit.symbol).toLowerCase(), unit._id);
  }

  return {
    categories: new Map((categories as any[]).map((c) => [String(c.name).toLowerCase(), c._id])),
    brands: new Map((brands as any[]).map((b) => [String(b.name).toLowerCase(), b._id])),
    units: unitMap,
    newCategories: new Set(),
    newBrands: new Set(),
  };
}

function buildSpec(tenant: TenantContext, masters: MasterCaches): ImportSpec {
  const validateRow = (ctx: RowContext) => {
    const name = ctx.text('Name');
    const sku = ctx.text('SKU').toUpperCase();

    if (!name) return 'Name is required';
    if (!sku) return 'SKU is required';

    const unitName = ctx.text('Unit');
    if (!unitName) return 'Unit is required';
    const unitId = masters.units.get(unitName.toLowerCase());
    if (!unitId) {
      return `Unit "${unitName}" does not exist. Create it under Products → Units first, then re-import.`;
    }

    const secondaryName = ctx.text('Secondary Unit');
    const conversionFactor = ctx.number('Conversion Factor');
    let secondaryUnitId: Types.ObjectId | null = null;

    if (secondaryName) {
      const found = masters.units.get(secondaryName.toLowerCase());
      if (!found) return `Secondary unit "${secondaryName}" does not exist`;
      if (String(found) === String(unitId)) {
        return 'The secondary unit must differ from the primary unit';
      }
      if (!conversionFactor || conversionFactor <= 0) {
        return `"${secondaryName}" needs a conversion factor greater than zero`;
      }
      secondaryUnitId = found;
    } else if (conversionFactor) {
      return 'A conversion factor needs a secondary unit';
    }

    const gst = ctx.number('GST %');
    if (gst !== null && (gst < 0 || gst > 100)) return 'GST % must be between 0 and 100';

    const negatives: Array<[string, number | null]> = [
      ['Purchase Price', ctx.number('Purchase Price')],
      ['Selling Price', ctx.number('Selling Price')],
      ['MRP', ctx.number('MRP')],
      ['Wholesale Price', ctx.number('Wholesale Price')],
      ['Min Stock Level', ctx.number('Min Stock Level')],
      ['Max Stock Level', ctx.number('Max Stock Level')],
    ];
    for (const [label, value] of negatives) {
      if (value !== null && value < 0) return `${label} cannot be negative`;
    }

    // Category/brand resolve to an existing id or get queued for creation.
    const categoryName = ctx.text('Category');
    let categoryId: Types.ObjectId | null = null;
    if (categoryName) {
      categoryId = masters.categories.get(categoryName.toLowerCase()) ?? null;
      if (!categoryId) masters.newCategories.add(categoryName);
    }

    const brandName = ctx.text('Brand');
    let brandId: Types.ObjectId | null = null;
    if (brandName) {
      brandId = masters.brands.get(brandName.toLowerCase()) ?? null;
      if (!brandId) masters.newBrands.add(brandName);
    }

    const openingStock = ctx.number('Opening Stock') ?? 0;

    return {
      opening: openingStock,
      doc: {
        name,
        sku,
        barcode: ctx.text('Barcode') || null,
        // Names are carried through so writeRow can resolve ids created after
        // validation; the ids above are used when already known.
        __categoryName: categoryName || null,
        __brandName: brandName || null,
        categoryId,
        brandId,
        primaryUnitId: unitId,
        secondaryUnitId,
        conversionFactor: secondaryUnitId ? conversionFactor : null,
        hsnCode: ctx.text('HSN Code').toUpperCase() || null,
        gstPercentage: gst ?? 0,
        purchasePrice: ctx.number('Purchase Price') ?? 0,
        sellingPrice: ctx.number('Selling Price') ?? 0,
        mrp: ctx.number('MRP') ?? 0,
        wholesalePrice: ctx.number('Wholesale Price') ?? 0,
        openingStock,
        currentStock: openingStock,
        minStockLevel: ctx.number('Min Stock Level') ?? 0,
        maxStockLevel: ctx.number('Max Stock Level') ?? 0,
        trackBatch: truthy(ctx.text('Track Batch')),
        trackExpiry: truthy(ctx.text('Track Expiry')),
        trackSerial: truthy(ctx.text('Track Serial')),
      },
    };
  };

  return {
    sheetName: 'Products',
    columns: COLUMNS,
    requiredHeaders: ['Name', 'SKU', 'Unit'],
    uniqueHeader: 'SKU',
    uniqueLabel: 'product',
    // SKUs are stored upper-cased with hyphens intact.
    normalizeUnique: (raw) => raw.trim().toUpperCase(),
    templateTitle: 'Khatavala — product import template',
    templateNotes: [
      'Fill in the "Products" sheet, one product per row, then upload it.',
      'Row 2 is a sample — replace or delete it.',
      '',
      'Name, SKU and Unit are required. Every other column may be left blank.',
      'SKU must be unique within your company; rows whose SKU already exists are reported as errors and skipped.',
      'Unit must already exist — use the unit name ("Kilogram") or its symbol ("kg"). Create missing units under Products → Units first.',
      'Category and Brand are created automatically if they do not exist yet.',
      'Secondary Unit and Conversion Factor go together: the factor is how many PRIMARY units make one secondary unit (a case of 24 bottles = 24).',
      'Track Batch / Expiry / Serial accept Yes or No.',
      'Prices and stock must be plain numbers — no currency symbols or thousands separators.',
      'Do not rename, reorder or remove the header row; columns are matched by header name.',
    ],
    sampleRow: {
      name: 'Basmati Rice 5kg',
      sku: 'RICE-BAS-5KG',
      barcode: '8901234567890',
      category: 'Groceries',
      brand: 'India Gate',
      unit: 'Packet',
      hsnCode: '10063020',
      gstPercentage: 5,
      purchasePrice: 420,
      sellingPrice: 499,
      mrp: 550,
      wholesalePrice: 465,
      openingStock: 40,
      minStockLevel: 10,
      maxStockLevel: 200,
      trackBatch: 'No',
      trackExpiry: 'Yes',
      trackSerial: 'No',
    },
    validateRow,
    loadTakenKeys: async (t) => {
      const existing = await ProductModel.find(tenantFilter(t)).select('sku').lean();
      return new Set(existing.map((p) => p.sku));
    },
    writeRow: async (t, doc) => {
      // Resolve any category/brand created during the flush below.
      const categoryName = doc.__categoryName as string | null;
      const brandName = doc.__brandName as string | null;
      const payload = { ...doc };
      delete payload.__categoryName;
      delete payload.__brandName;

      if (categoryName && !payload.categoryId) {
        payload.categoryId = masters.categories.get(categoryName.toLowerCase()) ?? null;
      }
      if (brandName && !payload.brandId) {
        payload.brandId = masters.brands.get(brandName.toLowerCase()) ?? null;
      }

      await ProductModel.create(tenantStamp(t, payload));
    },
  };
}

/** Creates the categories and brands the sheet referenced but did not have. */
async function flushNewMasters(tenant: TenantContext, masters: MasterCaches) {
  if (masters.newCategories.size > 0) {
    const created = await CategoryModel.insertMany(
      [...masters.newCategories].map((name) => tenantStamp(tenant, { name })),
      { ordered: false }
    );
    created.forEach((doc: any) => masters.categories.set(String(doc.name).toLowerCase(), doc._id));
  }

  if (masters.newBrands.size > 0) {
    const created = await BrandModel.insertMany(
      [...masters.newBrands].map((name) => tenantStamp(tenant, { name })),
      { ordered: false }
    );
    created.forEach((doc: any) => masters.brands.set(String(doc.name).toLowerCase(), doc._id));
  }
}

export async function buildTemplate(tenant: TenantContext): Promise<Buffer> {
  const masters = await loadMasters(tenant);
  return buildTemplateFor(buildSpec(tenant, masters));
}

export async function importProducts(
  tenant: TenantContext,
  fileBuffer: Buffer,
  options: { dryRun?: boolean } = {}
): Promise<ImportResult & { createdCategories: string[]; createdBrands: string[] }> {
  const masters = await loadMasters(tenant);
  const spec = buildSpec(tenant, masters);

  // Pass 1 — validate only. This populates newCategories/newBrands as a side
  // effect, so we know what to create before writing a single product.
  const preview = await runImport(tenant, fileBuffer, spec, { dryRun: true });

  const createdCategories = [...masters.newCategories];
  const createdBrands = [...masters.newBrands];

  if (options.dryRun) {
    return { ...preview, createdCategories, createdBrands };
  }

  await flushNewMasters(tenant, masters);

  // Pass 2 — the real write, with every master now resolvable.
  const result = await runImport(tenant, fileBuffer, spec, { dryRun: false });
  return { ...result, createdCategories, createdBrands };
}

/**
 * Exports the current catalog as a workbook.
 *
 * Deliberately the SAME column layout as the import template, so an export can
 * be edited and fed straight back in. A separate "report" format would be a
 * trap: the obvious workflow is export → edit → re-import, and that only works
 * if the shapes match.
 */
export async function exportProducts(
  tenant: TenantContext,
  query: Parameters<typeof listProducts>[1] = {}
): Promise<Buffer> {
  const { products } = await listProducts(tenant, { ...query, page: 1, limit: 200 });

  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Khatavala';
  const sheet = workbook.addWorksheet('Products');

  sheet.columns = COLUMNS.map((c) => ({ header: c.header, key: c.key, width: c.width }));
  const header = sheet.getRow(1);
  header.font = { bold: true };
  header.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE8EEF7' } };
  sheet.views = [{ state: 'frozen', ySplit: 1 }];

  const yesNo = (value: unknown) => (value ? 'Yes' : 'No');

  for (const product of products as any[]) {
    sheet.addRow({
      name: product.name,
      sku: product.sku,
      barcode: product.barcode ?? '',
      category: product.categoryId?.name ?? '',
      brand: product.brandId?.name ?? '',
      unit: product.primaryUnitId?.name ?? '',
      secondaryUnit: product.secondaryUnitId?.name ?? '',
      conversionFactor: product.conversionFactor ?? '',
      hsnCode: product.hsnCode ?? '',
      gstPercentage: product.gstPercentage ?? 0,
      purchasePrice: product.purchasePrice ?? 0,
      sellingPrice: product.sellingPrice ?? 0,
      mrp: product.mrp ?? 0,
      wholesalePrice: product.wholesalePrice ?? 0,
      // Exports CURRENT stock into the Opening Stock column: re-importing this
      // file into a fresh company should open with what is on the shelf today,
      // not what it was when the catalog was first loaded.
      openingStock: product.currentStock ?? 0,
      minStockLevel: product.minStockLevel ?? 0,
      maxStockLevel: product.maxStockLevel ?? 0,
      trackBatch: yesNo(product.trackBatch),
      trackExpiry: yesNo(product.trackExpiry),
      trackSerial: yesNo(product.trackSerial),
    });
  }

  const buffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(buffer as ArrayBuffer);
}
