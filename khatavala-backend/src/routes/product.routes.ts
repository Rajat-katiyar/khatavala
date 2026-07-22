import { Router } from 'express';
import multer from 'multer';
import { asyncHandler } from '../utils/asyncHandler.js';
import { ApiError } from '../utils/ApiError.js';
import { validate } from '../middlewares/validate.js';
import { authenticate } from '../middlewares/auth.js';
import { requireTenant, resolveTenant, tenantFilter } from '../middlewares/tenantScope.js';
import { requirePermission } from '../services/permission.service.js';
import { recordAudit } from '../services/audit.service.js';
import * as productService from '../services/product.service.js';
import * as importService from '../services/productImport.service.js';
import * as barcodeService from '../services/barcode.service.js';
import * as storage from '../services/storage.service.js';
import { ProductModel } from '../models/Product.js';
import {
  createProductSchema,
  updateProductSchema,
  listProductsQuerySchema,
  barcodeQuerySchema,
  barcodeSheetSchema,
} from '../validators/product.validators.js';

const router = Router();

// The standard tenant-scoped stack, plus a permission gate on every route.
router.use(authenticate, resolveTenant, requireTenant);

const XLSX_MIME = [
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-excel',
  'application/octet-stream',
];

const uploadSheet = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024, files: 1 },
  fileFilter: (_req, file, cb) => {
    const looksRight = XLSX_MIME.includes(file.mimetype) || /\.xlsx$/i.test(file.originalname);
    if (!looksRight) {
      return cb(ApiError.badRequest('Upload an .xlsx file exported from the template'));
    }
    cb(null, true);
  },
});

const uploadImage = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024, files: 1 },
  fileFilter: (_req, file, cb) => {
    if (!file.mimetype.startsWith('image/')) {
      return cb(ApiError.badRequest('Upload a JPEG, PNG, WebP or GIF image'));
    }
    cb(null, true);
  },
});

/* ------------------------------------------------------------------ *
 * Static paths are declared BEFORE `/:id`. Express matches in order, so
 * `/products/search` would otherwise be handled by `/:id` with
 * id = "search" and fail as an invalid ObjectId.
 * ------------------------------------------------------------------ */

router.get(
  '/search',
  requirePermission('products', 'view'),
  asyncHandler(async (req, res) => {
    const products = await productService.searchProducts(
      req.tenant!,
      typeof req.query.q === 'string' ? req.query.q : '',
      Number(req.query.limit) || 10
    );
    res.json({ success: true, data: { products } });
  })
);

router.get(
  '/stats',
  requirePermission('products', 'view'),
  asyncHandler(async (req, res) => {
    res.json({ success: true, data: await productService.getProductStats(req.tenant!) });
  })
);

router.get(
  '/import/template',
  requirePermission('products', 'create'),
  asyncHandler(async (req, res) => {
    const buffer = await importService.buildTemplate(req.tenant!);
    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    );
    res.setHeader(
      'Content-Disposition',
      'attachment; filename="khatavala-product-import-template.xlsx"'
    );
    res.send(buffer);
  })
);

router.post(
  '/import',
  requirePermission('products', 'create'),
  uploadSheet.single('file'),
  asyncHandler(async (req, res) => {
    if (!req.file) throw ApiError.badRequest('No file uploaded. Attach it as "file".');

    const dryRun = req.query.dryRun === 'true';
    const result = await importService.importProducts(req.tenant!, req.file.buffer, { dryRun });

    if (!dryRun && result.imported > 0) {
      await recordAudit(req.tenant!, {
        action: 'create',
        entityName: 'Product',
        entityId: 'bulk-import',
        newValue: {
          imported: result.imported,
          failed: result.failed,
          createdCategories: result.createdCategories,
          createdBrands: result.createdBrands,
          fileName: req.file.originalname,
        },
      });
    }

    res.status(result.failed > 0 && result.imported === 0 ? 422 : 200).json({
      success: result.imported > 0 || result.failed === 0,
      data: result,
    });
  })
);

router.get(
  '/export',
  requirePermission('products', 'view'),
  validate(listProductsQuerySchema, 'query'),
  asyncHandler(async (req, res) => {
    const buffer = await importService.exportProducts(req.tenant!, req.query);
    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    );
    res.setHeader('Content-Disposition', 'attachment; filename="khatavala-products.xlsx"');
    res.send(buffer);
  })
);

/**
 * Printable label sheet. POST rather than GET because the selection can be
 * hundreds of ids with per-product quantities, which does not belong in a URL.
 */
router.post(
  '/barcodes/sheet',
  requirePermission('products', 'view'),
  validate(barcodeSheetSchema),
  asyncHandler(async (req, res) => {
    const { items, ...options } = req.body as {
      items: Array<{ productId: string; quantity?: number }>;
      symbology?: barcodeService.Symbology;
      columns?: number;
      showPrice?: boolean;
      showName?: boolean;
    };

    // One query for the whole selection, scoped to the tenant. Fetching per id
    // would be N round trips and — more importantly — easy to get wrong on
    // scoping.
    const ids = items.map((item) => item.productId);
    const products = await ProductModel.find(tenantFilter(req.tenant!, { _id: { $in: ids } }))
      .select('name sku barcode sellingPrice')
      .lean();

    const byId = new Map(products.map((product) => [String(product._id), product]));

    const labels = items.flatMap((item) => {
      const product = byId.get(item.productId);
      // Silently skipping an id that belongs to another tenant is right: it
      // reads as "not found", never confirming the id exists elsewhere.
      if (!product) return [];
      return [
        {
          // Prefer the real barcode; fall back to the SKU so a product without
          // a printed barcode still gets a scannable label.
          code: product.barcode || product.sku,
          name: product.name,
          sku: product.sku,
          price: product.sellingPrice ?? 0,
          quantity: item.quantity ?? 1,
        },
      ];
    });

    if (labels.length === 0) throw ApiError.notFound('None of those products were found');

    const svg = await barcodeService.renderSheetSvg(labels, options);
    res.setHeader('Content-Type', 'image/svg+xml');
    res.send(svg);
  })
);

/* ------------------------------- CRUD ------------------------------ */

router.get(
  '/',
  requirePermission('products', 'view'),
  validate(listProductsQuerySchema, 'query'),
  asyncHandler(async (req, res) => {
    const result = await productService.listProducts(req.tenant!, req.query);
    res.json({ success: true, data: result });
  })
);

router.post(
  '/',
  requirePermission('products', 'create'),
  validate(createProductSchema),
  asyncHandler(async (req, res) => {
    const product = await productService.createProduct(req.tenant!, req.body);
    await recordAudit(req.tenant!, {
      action: 'create',
      entityName: 'Product',
      entityId: String(product._id),
      newValue: product,
    });
    res.status(201).json({ success: true, data: { product } });
  })
);

router.get(
  '/:id',
  requirePermission('products', 'view'),
  asyncHandler(async (req, res) => {
    const product = await productService.getProduct(req.tenant!, req.params.id);
    res.json({ success: true, data: { product } });
  })
);

/** One product's barcode as a PNG, for the product page and label printers. */
router.get(
  '/:id/barcode',
  requirePermission('products', 'view'),
  validate(barcodeQuerySchema, 'query'),
  asyncHandler(async (req, res) => {
    const product = await productService.getProduct(req.tenant!, req.params.id);
    const code = (product.barcode || product.sku) as string;

    const png = await barcodeService.renderBarcode(code, req.query);
    res.setHeader('Content-Type', 'image/png');
    res.setHeader('Cache-Control', 'private, max-age=300');
    res.send(png);
  })
);

router.post(
  '/:id/image',
  requirePermission('products', 'update'),
  uploadImage.single('image'),
  asyncHandler(async (req, res) => {
    if (!req.file) throw ApiError.badRequest('No image uploaded. Attach it as "image".');
    storage.assertImage(req.file);

    // 404s before writing anything if the product is not this tenant's.
    const existing = await productService.getProduct(req.tenant!, req.params.id);

    const stored = await storage.uploadImage(
      req.file.buffer,
      req.file.mimetype,
      String(req.tenant!.companyId)
    );

    const product = await productService.updateProduct(req.tenant!, req.params.id, {
      imageUrl: stored.url,
    });

    // Replacing an image orphans the old file. Deleted after the update lands,
    // so a failed write never loses the image that is still referenced.
    await storage.deleteImageByUrl(existing.imageUrl as string | null);

    res.status(201).json({ success: true, data: { product, driver: stored.driver } });
  })
);

router.delete(
  '/:id/image',
  requirePermission('products', 'update'),
  asyncHandler(async (req, res) => {
    const existing = await productService.getProduct(req.tenant!, req.params.id);
    const product = await productService.updateProduct(req.tenant!, req.params.id, {
      imageUrl: null,
    });
    await storage.deleteImageByUrl(existing.imageUrl as string | null);
    res.json({ success: true, data: { product } });
  })
);

router.patch(
  '/:id',
  requirePermission('products', 'update'),
  validate(updateProductSchema),
  asyncHandler(async (req, res) => {
    const before = await productService.getProduct(req.tenant!, req.params.id);
    const product = await productService.updateProduct(req.tenant!, req.params.id, req.body);
    await recordAudit(req.tenant!, {
      action: 'update',
      entityName: 'Product',
      entityId: req.params.id,
      oldValue: before,
      newValue: product,
    });
    res.json({ success: true, data: { product } });
  })
);

router.delete(
  '/:id',
  requirePermission('products', 'delete'),
  asyncHandler(async (req, res) => {
    const before = await productService.getProduct(req.tenant!, req.params.id);
    const result = await productService.deleteProduct(req.tenant!, req.params.id);

    if (result.deleted) await storage.deleteImageByUrl(before.imageUrl as string | null);

    await recordAudit(req.tenant!, {
      // A product still holding stock is deactivated, not deleted — the audit
      // trail records which actually happened.
      action: result.deleted ? 'delete' : 'update',
      entityName: 'Product',
      entityId: req.params.id,
      oldValue: before,
      ...(result.deactivated && { newValue: { ...before, isActive: false } }),
    });
    res.json({ success: true, data: result });
  })
);

export default router;
