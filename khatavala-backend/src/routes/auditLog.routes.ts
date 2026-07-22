import { Router } from 'express';
import { asyncHandler } from '../utils/asyncHandler.js';
import { validate } from '../middlewares/validate.js';
import { authenticate } from '../middlewares/auth.js';
import { requireTenant, resolveTenant } from '../middlewares/tenantScope.js';
import { requirePermission } from '../services/permission.service.js';
import * as auditService from '../services/audit.service.js';
import { auditQuerySchema } from '../validators/rbac.validators.js';

const router = Router();

router.use(authenticate, resolveTenant, requireTenant);

// Read-only by design. There is no write, update or delete endpoint for the
// audit log anywhere in this codebase — an audit trail an admin can edit
// answers no question worth asking. Rows are written only by
// services/audit.service.ts, in-process.
router.get(
  '/',
  requirePermission('audit', 'view'),
  validate(auditQuerySchema, 'query'),
  asyncHandler(async (req, res) => {
    const data = await auditService.listAuditLogs(req.tenant!, req.query);
    res.json({ success: true, data });
  })
);

/** Distinct actions and entities present, for the filter dropdowns. */
router.get(
  '/filters',
  requirePermission('audit', 'view'),
  asyncHandler(async (req, res) => {
    const data = await auditService.auditFilterOptions(req.tenant!);
    res.json({ success: true, data });
  })
);

export default router;
