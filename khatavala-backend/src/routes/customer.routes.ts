import { Router } from 'express';
import multer from 'multer';
import { asyncHandler } from '../utils/asyncHandler.js';
import { ApiError } from '../utils/ApiError.js';
import { validate } from '../middlewares/validate.js';
import { authenticate } from '../middlewares/auth.js';
import { requireTenant, resolveTenant } from '../middlewares/tenantScope.js';
import { requirePermission } from '../services/permission.service.js';
import { recordAudit } from '../services/audit.service.js';
import * as customerService from '../services/customer.service.js';
import * as ledgerService from '../services/customerLedger.service.js';
import * as importService from '../services/customerImport.service.js';
import {
  createCustomerSchema,
  updateCustomerSchema,
  listCustomersQuerySchema,
  ledgerQuerySchema,
} from '../validators/customer.validators.js';

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
 * get right. The 5 MB cap is well above a realistic customer master (~50k rows)
 * and keeps a malicious upload from exhausting the heap.
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
 * a `/customers/search` request would otherwise be handled by `/:id`
 * with id = "search" and fail as an invalid ObjectId.
 * ------------------------------------------------------------------ */

router.get(
  '/search',
  requirePermission('customers', 'view'),
  asyncHandler(async (req, res) => {
    const customers = await customerService.searchCustomers(
      req.tenant!,
      typeof req.query.q === 'string' ? req.query.q : '',
      Number(req.query.limit) || 10
    );
    res.json({ success: true, data: { customers } });
  })
);

router.get(
  '/outstanding',
  requirePermission('customers', 'view'),
  asyncHandler(async (req, res) => {
    const outstanding = await ledgerService.getOutstanding(req.tenant!);
    res.json({ success: true, data: outstanding });
  })
);

router.get(
  '/import/template',
  requirePermission('customers', 'create'),
  asyncHandler(async (_req, res) => {
    const buffer = await importService.buildTemplate();
    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    );
    res.setHeader(
      'Content-Disposition',
      'attachment; filename="khatavala-customer-import-template.xlsx"'
    );
    res.send(buffer);
  })
);

router.post(
  '/import',
  requirePermission('customers', 'create'),
  upload.single('file'),
  asyncHandler(async (req, res) => {
    if (!req.file) throw ApiError.badRequest('No file uploaded. Attach it as "file".');

    // `?dryRun=true` validates and reports without writing, so the UI can show
    // the user what will happen before they commit to it.
    const dryRun = req.query.dryRun === 'true';

    const result = await importService.importCustomers(req.tenant!, req.file.buffer, {
      dryRun,
    });

    if (!dryRun && result.imported > 0) {
      await recordAudit(req.tenant!, {
        action: 'create',
        entityName: 'Customer',
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
  requirePermission('customers', 'view'),
  validate(listCustomersQuerySchema, 'query'),
  asyncHandler(async (req, res) => {
    const result = await customerService.listCustomers(req.tenant!, req.query);
    res.json({ success: true, data: result });
  })
);

router.post(
  '/',
  requirePermission('customers', 'create'),
  validate(createCustomerSchema),
  asyncHandler(async (req, res) => {
    const customer = await customerService.createCustomer(req.tenant!, req.body);
    await recordAudit(req.tenant!, {
      action: 'create',
      entityName: 'Customer',
      entityId: String(customer!._id),
      newValue: customer,
    });
    res.status(201).json({ success: true, data: { customer } });
  })
);

router.get(
  '/:id',
  requirePermission('customers', 'view'),
  asyncHandler(async (req, res) => {
    const customer = await customerService.getCustomer(req.tenant!, req.params.id);
    res.json({ success: true, data: { customer } });
  })
);

router.get(
  '/:id/ledger',
  requirePermission('customers', 'view'),
  validate(ledgerQuerySchema, 'query'),
  asyncHandler(async (req, res) => {
    const ledger = await ledgerService.getLedger(req.tenant!, req.params.id, req.query);
    res.json({ success: true, data: ledger });
  })
);

router.patch(
  '/:id',
  requirePermission('customers', 'update'),
  validate(updateCustomerSchema),
  asyncHandler(async (req, res) => {
    const before = await customerService.getCustomer(req.tenant!, req.params.id);
    const customer = await customerService.updateCustomer(
      req.tenant!,
      req.params.id,
      req.body
    );
    await recordAudit(req.tenant!, {
      action: 'update',
      entityName: 'Customer',
      entityId: req.params.id,
      oldValue: before,
      newValue: customer,
    });
    res.json({ success: true, data: { customer } });
  })
);

router.delete(
  '/:id',
  requirePermission('customers', 'delete'),
  asyncHandler(async (req, res) => {
    const before = await customerService.getCustomer(req.tenant!, req.params.id);
    const result = await customerService.deleteCustomer(req.tenant!, req.params.id);
    await recordAudit(req.tenant!, {
      // A customer with ledger history is deactivated, not deleted — the audit
      // trail records which actually happened.
      action: result.deleted ? 'delete' : 'update',
      entityName: 'Customer',
      entityId: req.params.id,
      oldValue: before,
      ...(result.deactivated && { newValue: { ...before, isActive: false } }),
    });
    res.json({ success: true, data: result });
  })
);

export default router;
