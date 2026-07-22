import { Router, type Request, type Response, type NextFunction } from 'express';
import { authenticate } from '../middlewares/auth.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { ApiError } from '../utils/ApiError.js';
import * as adminService from '../services/admin.service.js';

const router = Router();

router.use(authenticate);

function requireSuperAdmin(req: Request, _res: Response, next: NextFunction) {
  const user = (req as any).user;
  if (!user || (user.role !== 'SuperAdmin' && user.role !== 'Owner')) {
    throw new ApiError(403, 'Access denied: SuperAdmin role required');
  }
  next();
}

router.use(requireSuperAdmin);

router.get(
  '/metrics',
  asyncHandler(async (_req, res) => {
    const metrics = await adminService.getPlatformMetrics();
    res.json({ success: true, data: metrics });
  })
);

router.get(
  '/companies',
  asyncHandler(async (_req, res) => {
    const companies = await adminService.listAllCompanies();
    res.json({ success: true, data: companies });
  })
);

router.post(
  '/companies/:id/extend',
  asyncHandler(async (req, res) => {
    const { days } = req.body;
    const result = await adminService.extendSubscription(req.params.id, Number(days || 30));
    res.json({ success: true, data: result });
  })
);

router.post(
  '/companies/:id/toggle-status',
  asyncHandler(async (req, res) => {
    const result = await adminService.toggleCompanyStatus(req.params.id);
    res.json({ success: true, data: result });
  })
);

export default router;
