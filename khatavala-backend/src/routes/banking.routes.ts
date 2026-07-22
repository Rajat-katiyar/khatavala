import { Router } from 'express';
import multer from 'multer';
import { asyncHandler } from '../utils/asyncHandler.js';
import { validate } from '../middlewares/validate.js';
import { authenticate } from '../middlewares/auth.js';
import { requireTenant, resolveTenant } from '../middlewares/tenantScope.js';
import { requirePermission } from '../services/permission.service.js';
import * as banking from '../services/banking.service.js';
import {
  createBankAccountSchema,
  updateBankAccountSchema,
  createTransactionSchema,
  listTransactionsSchema,
  updateTransactionStatusSchema,
  manualMatchSchema,
  autoReconcileSchema,
  getReconciliationSchema,
} from '../validators/banking.validators.js';

/**
 * Phase 15 — Banking routes.
 *
 * All routes are tenant-scoped and gated on the `banking` permission module.
 *
 * Layout:
 *   /banking/accounts            — bank account master CRUD
 *   /banking/accounts/:id/transactions — transaction register
 *   /banking/accounts/:id/reconciliation — statement import + matching
 */

const router = Router();

// Every banking route requires authentication and an active company.
router.use(authenticate, resolveTenant, requireTenant);

// File upload — statement import only; keep files in memory (no disk writes).
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

/* ------------------------------------------------------------------ *
 * Bank accounts
 * ------------------------------------------------------------------ */

router.get(
  '/accounts',
  requirePermission('banking', 'view'),
  asyncHandler(async (req, res) => {
    const accounts = await banking.listBankAccounts(req.tenant!);
    res.json({ success: true, data: accounts });
  })
);

router.post(
  '/accounts',
  requirePermission('banking', 'create'),
  validate(createBankAccountSchema),
  asyncHandler(async (req, res) => {
    const account = await banking.createBankAccount(req.tenant!, req.body);
    res.status(201).json({ success: true, data: account });
  })
);

router.get(
  '/accounts/:id',
  requirePermission('banking', 'view'),
  asyncHandler(async (req, res) => {
    const account = await banking.getBankAccount(req.tenant!, req.params.id);
    res.json({ success: true, data: account });
  })
);

router.put(
  '/accounts/:id',
  requirePermission('banking', 'update'),
  validate(updateBankAccountSchema),
  asyncHandler(async (req, res) => {
    const account = await banking.updateBankAccount(req.tenant!, req.params.id, req.body);
    res.json({ success: true, data: account });
  })
);

router.delete(
  '/accounts/:id',
  requirePermission('banking', 'delete'),
  asyncHandler(async (req, res) => {
    await banking.deleteBankAccount(req.tenant!, req.params.id);
    res.json({ success: true, message: 'Bank account deleted' });
  })
);

/* ------------------------------------------------------------------ *
 * Transactions
 * ------------------------------------------------------------------ */

router.get(
  '/accounts/:id/transactions',
  requirePermission('banking', 'view'),
  validate(listTransactionsSchema, 'query'),
  asyncHandler(async (req, res) => {
    const q = req.query as any;
    const result = await banking.listTransactions(req.tenant!, req.params.id, {
      from: q.from ? new Date(q.from as string) : undefined,
      to: q.to ? new Date(q.to as string) : undefined,
      status: q.status,
      mode: q.mode,
      page: q.page,
      limit: q.limit,
    });
    res.json({ success: true, ...result });
  })
);

router.post(
  '/accounts/:id/transactions',
  requirePermission('banking', 'create'),
  validate(createTransactionSchema),
  asyncHandler(async (req, res) => {
    const txn = await banking.recordTransaction(req.tenant!, req.params.id, {
      ...req.body,
      transactionDate: new Date(req.body.transactionDate),
      valueDate: req.body.valueDate ? new Date(req.body.valueDate) : undefined,
    });
    res.status(201).json({ success: true, data: txn });
  })
);

router.patch(
  '/accounts/:accountId/transactions/:id/status',
  requirePermission('banking', 'update'),
  validate(updateTransactionStatusSchema),
  asyncHandler(async (req, res) => {
    const txn = await banking.updateTransactionStatus(req.tenant!, req.params.id, req.body.status);
    res.json({ success: true, data: txn });
  })
);

/* ------------------------------------------------------------------ *
 * Reconciliation
 * ------------------------------------------------------------------ */

router.get(
  '/accounts/:id/reconciliation',
  requirePermission('banking', 'view'),
  validate(getReconciliationSchema, 'query'),
  asyncHandler(async (req, res) => {
    const result = await banking.getReconciliation(
      req.tenant!,
      req.params.id,
      (req.query.batch as string) || undefined
    );
    res.json({ success: true, data: result });
  })
);

router.get(
  '/accounts/:id/reconciliation/batches',
  requirePermission('banking', 'view'),
  asyncHandler(async (req, res) => {
    const batches = await banking.listImportBatches(req.tenant!, req.params.id);
    res.json({ success: true, data: batches });
  })
);

router.post(
  '/accounts/:id/reconciliation/import',
  requirePermission('banking', 'reconcile'),
  upload.single('statement'),
  asyncHandler(async (req, res) => {
    if (!req.file) throw new Error('No file uploaded');
    const result = await banking.importBankStatement(
      req.tenant!,
      req.params.id,
      req.file.buffer,
      req.file.originalname
    );
    res.status(201).json({ success: true, data: result });
  })
);

router.post(
  '/accounts/:id/reconciliation/match',
  requirePermission('banking', 'reconcile'),
  validate(manualMatchSchema),
  asyncHandler(async (req, res) => {
    const result = await banking.manualMatch(
      req.tenant!,
      req.params.id,
      req.body.transactionId,
      req.body.statementEntryId
    );
    res.json({ success: true, data: result });
  })
);

router.post(
  '/accounts/:id/reconciliation/unmatch',
  requirePermission('banking', 'reconcile'),
  asyncHandler(async (req, res) => {
    const { transactionId } = req.body as { transactionId: string };
    const result = await banking.unmatch(req.tenant!, req.params.id, transactionId);
    res.json({ success: true, data: result });
  })
);

router.post(
  '/accounts/:id/reconciliation/auto-match',
  requirePermission('banking', 'reconcile'),
  validate(autoReconcileSchema),
  asyncHandler(async (req, res) => {
    const result = await banking.autoReconcile(
      req.tenant!,
      req.params.id,
      req.body.batch
    );
    res.json({ success: true, data: result });
  })
);

export default router;
