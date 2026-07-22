import { Router } from 'express';
import { asyncHandler } from '../utils/asyncHandler.js';
import { validate } from '../middlewares/validate.js';
import { authenticate } from '../middlewares/auth.js';
import { requireTenant, resolveTenant } from '../middlewares/tenantScope.js';
import { requirePermission } from '../services/permission.service.js';
import * as expense from '../services/expense.service.js';
import {
  createCategorySchema,
  updateCategorySchema,
  createExpenseSchema,
  listExpensesSchema,
  expenseSummarySchema,
} from '../validators/expense.validators.js';

/**
 * Phase 15 — Expense routes.
 *
 * All routes are tenant-scoped and gated on the `expenses` permission module.
 *
 * Layout:
 *   /expenses/categories         — category master CRUD
 *   /expenses                    — expense CRUD + list
 *   /expenses/summary            — category totals for dashboard
 *   /expenses/recurring/process  — manual trigger (admin/testing)
 */

const router = Router();
router.use(authenticate, resolveTenant, requireTenant);

/* ------------------------------------------------------------------ *
 * Categories
 * ------------------------------------------------------------------ */

router.get(
  '/categories',
  requirePermission('expenses', 'view'),
  asyncHandler(async (req, res) => {
    const categories = await expense.listCategories(req.tenant!);
    res.json({ success: true, data: categories });
  })
);

router.post(
  '/categories',
  requirePermission('expenses', 'create'),
  validate(createCategorySchema),
  asyncHandler(async (req, res) => {
    const cat = await expense.createCategory(req.tenant!, req.body);
    res.status(201).json({ success: true, data: cat });
  })
);

router.put(
  '/categories/:id',
  requirePermission('expenses', 'update'),
  validate(updateCategorySchema),
  asyncHandler(async (req, res) => {
    const cat = await expense.updateCategory(req.tenant!, req.params.id, req.body);
    res.json({ success: true, data: cat });
  })
);

router.delete(
  '/categories/:id',
  requirePermission('expenses', 'delete'),
  asyncHandler(async (req, res) => {
    await expense.deleteCategory(req.tenant!, req.params.id);
    res.json({ success: true, message: 'Category deleted' });
  })
);

/* ------------------------------------------------------------------ *
 * Expenses
 * ------------------------------------------------------------------ */

router.get(
  '/',
  requirePermission('expenses', 'view'),
  validate(listExpensesSchema, 'query'),
  asyncHandler(async (req, res) => {
    const q = req.query as any;
    const result = await expense.listExpenses(req.tenant!, {
      categoryId: q.categoryId,
      from: q.from ? new Date(q.from as string) : undefined,
      to: q.to ? new Date(q.to as string) : undefined,
      isRecurring: q.isRecurring,
      status: q.status,
      page: q.page,
      limit: q.limit,
    });
    res.json({ success: true, ...result });
  })
);

router.post(
  '/',
  requirePermission('expenses', 'create'),
  validate(createExpenseSchema),
  asyncHandler(async (req, res) => {
    const ex = await expense.createExpense(req.tenant!, {
      ...req.body,
      date: req.body.date ? new Date(req.body.date) : undefined,
    });
    res.status(201).json({ success: true, data: ex });
  })
);

router.get(
  '/summary',
  requirePermission('expenses', 'view'),
  validate(expenseSummarySchema, 'query'),
  asyncHandler(async (req, res) => {
    const q = req.query as any;
    const now = new Date();
    const from = q.from ? new Date(q.from as string) : new Date(now.getFullYear(), now.getMonth(), 1);
    const to = q.to ? new Date(q.to as string) : now;
    const summary = await expense.getExpenseSummary(req.tenant!, from, to);
    res.json({ success: true, data: summary });
  })
);

router.get(
  '/:id',
  requirePermission('expenses', 'view'),
  asyncHandler(async (req, res) => {
    const ex = await expense.getExpense(req.tenant!, req.params.id);
    res.json({ success: true, data: ex });
  })
);

router.delete(
  '/:id',
  requirePermission('expenses', 'delete'),
  asyncHandler(async (req, res) => {
    await expense.deleteExpense(req.tenant!, req.params.id);
    res.json({ success: true, message: 'Expense deleted' });
  })
);

/**
 * Manual trigger for the recurring processor — useful for admin testing
 * without waiting for the daily cron. Gated on expenses.create.
 */
router.post(
  '/recurring/process',
  requirePermission('expenses', 'create'),
  asyncHandler(async (req, res) => {
    const generated = await expense.processRecurringExpenses(new Date());
    res.json({ success: true, data: { generated } });
  })
);

export default router;
