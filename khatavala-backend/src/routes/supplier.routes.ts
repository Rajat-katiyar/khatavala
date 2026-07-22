import { Router } from 'express';
import multer from 'multer';
import { asyncHandler } from '../utils/asyncHandler.js';
import { ApiError } from '../utils/ApiError.js';
import { validate } from '../middlewares/validate.js';
import { authenticate } from '../middlewares/auth.js';
import { requireTenant, resolveTenant } from '../middlewares/tenantScope.js';
import { requirePermission } from '../services/permission.service.js';
import { recordAudit } from '../services/audit.service.js';
import * as supplierService from '../services/supplier.service.js';
import * as ledgerService from '../services/supplierLedger.service.js';
import * as importService from '../services/supplierImport.service.js';
import {
  createSupplierSchema,
  updateSupplierSchema,
  listSuppliersQuerySchema,
  ledgerQuerySchema,
} from '../validators/supplier.validators.js';

const router = Router();

// The standard tenant-scoped stack, plus a permission gate on every route.
router.use(authenticate, resolveTenant, requireTenant);

const XLSX_MIME = [
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-excel',
  'application/octet-stream', // what some browsers send for .xlsx
];

/**
 * Memory storage, not disk: the workbook is parsed and discarded within the
 * request, so writing it to the filesystem would only add cleanup we'd have to
 * get right. The 5 MB cap keeps a malicious upload from exhausting the heap.
 */
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024, files: 1 },
  fileFilter: (_req, file, cb) => {
    const looksRight =
      XLSX_MIME.includes(file.mimetype) || /\.xlsx$/i.test(file.originalname);
    if (!looksRight) {
      return cb(ApiError.badRequest('Upload an .xlsx file exported from the template'));
    }
    cb(null, true);
  },
});

/* ------------------------------------------------------------------ *
 * Static paths are declared BEFORE `/:id`. Express matches in order, so
 * a `/suppliers/search` request would otherwise be handled by `/:id`
 * with id = "search" and fail as an invalid ObjectId.
 * ------------------------------------------------------------------ */

router.get(
  '/search',
  requirePermission('suppliers', 'view'),
  asyncHandler(async (req, res) => {
    const suppliers = await supplierService.searchSuppliers(
      req.tenant!,
      typeof req.query.q === 'string' ? req.query.q : '',
      Number(req.query.limit) || 10
    );
    res.json({ success: true, data: { suppliers } });
  })
);

router.get(
  '/outstanding',
  requirePermission('suppliers', 'view'),
  asyncHandler(async (req, res) => {
    const payables = await ledgerService.getOutstandingPayables(req.tenant!);
    res.json({ success: true, data: payables });
  })
);

router.get(
  '/import/template',
  requirePermission('suppliers', 'create'),
  asyncHandler(async (_req, res) => {
    const buffer = await importService.buildTemplate();
    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    );
    res.setHeader(
      'Content-Disposition',
      'attachment; filename="khatavala-supplier-import-template.xlsx"'
    );
    res.send(buffer);
  })
);

router.post(
  '/import',
  requirePermission('suppliers', 'create'),
  upload.single('file'),
  asyncHandler(async (req, res) => {
    if (!req.file) throw ApiError.badRequest('No file uploaded. Attach it as "file".');

    // `?dryRun=true` validates and reports without writing, so the UI can show
    // the user what will happen before they commit to it.
    const dryRun = req.query.dryRun === 'true';

    const result = await importService.importSuppliers(req.tenant!, req.file.buffer, {
      dryRun,
    });

    if (!dryRun && result.imported > 0) {
      await recordAudit(req.tenant!, {
        action: 'create',
        entityName: 'Supplier',
        entityId: 'bulk-import',
        newValue: {
          imported: result.imported,
          failed: result.failed,
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

/* ------------------------------- CRUD ------------------------------ */

router.get(
  '/',
  requirePermission('suppliers', 'view'),
  validate(listSuppliersQuerySchema, 'query'),
  asyncHandler(async (req, res) => {
    const result = await supplierService.listSuppliers(req.tenant!, req.query);
    res.json({ success: true, data: result });
  })
);

router.post(
  '/',
  requirePermission('suppliers', 'create'),
  validate(createSupplierSchema),
  asyncHandler(async (req, res) => {
    const supplier = await supplierService.createSupplier(req.tenant!, req.body);
    await recordAudit(req.tenant!, {
      action: 'create',
      entityName: 'Supplier',
      entityId: String(supplier!._id),
      newValue: supplier,
    });
    res.status(201).json({ success: true, data: { supplier } });
  })
);

router.get(
  '/:id',
  requirePermission('suppliers', 'view'),
  asyncHandler(async (req, res) => {
    const supplier = await supplierService.getSupplier(req.tenant!, req.params.id);
    res.json({ success: true, data: { supplier } });
  })
);

router.get(
  '/:id/ledger',
  requirePermission('suppliers', 'view'),
  validate(ledgerQuerySchema, 'query'),
  asyncHandler(async (req, res) => {
    const ledger = await ledgerService.getLedger(req.tenant!, req.params.id, req.query);
    res.json({ success: true, data: ledger });
  })
);

router.get(
  '/:id/reminders',
  requirePermission('suppliers', 'view'),
  asyncHandler(async (req, res) => {
    const reminders = await ledgerService.getPaymentReminders(req.tenant!, req.params.id);
    if (!reminders) throw ApiError.notFound('Supplier not found');
    res.json({ success: true, data: reminders });
  })
);

router.patch(
  '/:id',
  requirePermission('suppliers', 'update'),
  validate(updateSupplierSchema),
  asyncHandler(async (req, res) => {
    const before = await supplierService.getSupplier(req.tenant!, req.params.id);
    const supplier = await supplierService.updateSupplier(
      req.tenant!,
      req.params.id,
      req.body
    );
    await recordAudit(req.tenant!, {
      action: 'update',
      entityName: 'Supplier',
      entityId: req.params.id,
      oldValue: before,
      newValue: supplier,
    });
    res.json({ success: true, data: { supplier } });
  })
);

router.delete(
  '/:id',
  requirePermission('suppliers', 'delete'),
  asyncHandler(async (req, res) => {
    const before = await supplierService.getSupplier(req.tenant!, req.params.id);
    const result = await supplierService.deleteSupplier(req.tenant!, req.params.id);
    await recordAudit(req.tenant!, {
      // A supplier with ledger history is deactivated, not deleted — the audit
      // trail records which actually happened.
      action: result.deleted ? 'delete' : 'update',
      entityName: 'Supplier',
      entityId: req.params.id,
      oldValue: before,
      ...(result.deactivated && { newValue: { ...before, isActive: false } }),
    });
    res.json({ success: true, data: result });
  })
);

export default router;
