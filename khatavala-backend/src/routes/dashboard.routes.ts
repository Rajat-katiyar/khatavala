import { Router, type Request, type Response, type NextFunction } from 'express';
import { asyncHandler } from '../utils/asyncHandler.js';
import { authenticate } from '../middlewares/auth.js';
import { resolveTenant, requireTenant, type TenantContext } from '../middlewares/tenantScope.js';
import { getDashboardMetrics, type DashboardRangeQuery } from '../services/dashboard.service.js';

export const dashboardRouter = Router();

dashboardRouter.use(authenticate, resolveTenant, requireTenant);

/**
 * GET /api/dashboard
 * Aggregated Executive Dashboard Metrics
 */
dashboardRouter.get(
  '/',
  asyncHandler(async (req: Request, res: Response, _next: NextFunction) => {
    const { range, from, to } = req.query as {
      range?: 'today' | 'week' | 'month' | 'year' | 'custom';
      from?: string;
      to?: string;
    };

    const query: DashboardRangeQuery = {
      range,
      from: from ? new Date(from) : undefined,
      to: to ? new Date(to) : undefined,
    };

    const tenant = (req as Request & { tenant?: TenantContext }).tenant!;
    const data = await getDashboardMetrics(tenant, query);

    res.json({
      success: true,
      data,
    });
  })
);
