import { Router } from 'express';
import { asyncHandler } from '../utils/asyncHandler.js';
import { validate } from '../middlewares/validate.js';
import { authenticate } from '../middlewares/auth.js';
import { requireTenant, resolveTenant } from '../middlewares/tenantScope.js';
import { requirePermission } from '../services/permission.service.js';
import * as reports from '../services/reports.service.js';
import { exportReport, type ReportKind } from '../services/reportExport.service.js';
import {
  asOfSchema,
  dateRangeSchema,
  dayBookQuerySchema,
  drillDownQuerySchema,
  exportQuerySchema,
} from '../validators/reports.validators.js';

/**
 * Phase 13 — financial statements.
 *
 * Read-only, all of it. These reports derive everything from posted journal
 * entries; there is nothing here that writes, and no way to "adjust" a report
 * without posting a journal that explains the adjustment.
 *
 * Gated on `reports.view` rather than `accounting.view`: a manager who should
 * see the P&L does not necessarily need access to the chart of accounts, and
 * the `reports` module has existed in the permission catalog since Phase 4.
 * Exports take `reports.export`, so "can read on screen" and "can take a copy
 * out of the building" are separable.
 */

const router = Router();
router.use(authenticate, resolveTenant, requireTenant);

router.get(
  '/trial-balance',
  requirePermission('reports', 'view'),
  validate(dateRangeSchema, 'query'),
  asyncHandler(async (req, res) => {
    const report = await reports.getTrialBalance(req.tenant!, req.query);
    res.json({ success: true, data: report });
  })
);

router.get(
  '/profit-loss',
  requirePermission('reports', 'view'),
  validate(dateRangeSchema, 'query'),
  asyncHandler(async (req, res) => {
    const report = await reports.getProfitAndLoss(req.tenant!, req.query);
    res.json({ success: true, data: report });
  })
);

router.get(
  '/balance-sheet',
  requirePermission('reports', 'view'),
  validate(asOfSchema, 'query'),
  asyncHandler(async (req, res) => {
    const report = await reports.getBalanceSheet(req.tenant!, req.query.to as Date | undefined);
    res.json({ success: true, data: report });
  })
);

router.get(
  '/day-book',
  requirePermission('reports', 'view'),
  validate(dayBookQuerySchema, 'query'),
  asyncHandler(async (req, res) => {
    const report = await reports.getDayBook(req.tenant!, req.query);
    res.json({ success: true, data: report });
  })
);

/** The transactions behind one report line. See reports.service.getDrillDown. */
router.get(
  '/drill-down',
  requirePermission('reports', 'view'),
  validate(drillDownQuerySchema, 'query'),
  asyncHandler(async (req, res) => {
    const result = await reports.getDrillDown(req.tenant!, req.query as never);
    res.json({ success: true, data: result });
  })
);

/**
 * PDF and Excel for every report, from one endpoint.
 *
 * `:kind` is validated against the known set rather than passed through — an
 * unchecked value would reach a switch that falls through to the day book, so
 * a typo would silently return the wrong statement.
 */
const EXPORTABLE: ReportKind[] = [
  'trial-balance',
  'profit-loss',
  'balance-sheet',
  'day-book',
];

router.get(
  '/:kind/export',
  requirePermission('reports', 'export'),
  validate(exportQuerySchema, 'query'),
  asyncHandler(async (req, res) => {
    const kind = req.params.kind as ReportKind;
    if (!EXPORTABLE.includes(kind)) {
      res.status(404).json({
        success: false,
        error: { code: 'NOT_FOUND', message: `No report called '${req.params.kind}'` },
      });
      return;
    }

    // `validate` has already replaced req.query with the parsed result; the
    // Express types still describe it as ParsedQs, hence the double assertion.
    const { format, ...query } = req.query as unknown as {
      format: 'pdf' | 'xlsx';
      from?: Date;
      to?: Date;
      date?: Date;
    };

    const { buffer, fileName, contentType } = await exportReport(
      req.tenant!,
      kind,
      format,
      query
    );

    res.setHeader('Content-Type', contentType);
    res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
    res.setHeader('Content-Length', String(buffer.length));
    res.send(buffer);
  })
);

export default router;
