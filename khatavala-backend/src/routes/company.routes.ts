import { Router } from 'express';
import { asyncHandler } from '../utils/asyncHandler.js';
import { validate } from '../middlewares/validate.js';
import { authenticate } from '../middlewares/auth.js';
import { requireTenant, resolveTenant } from '../middlewares/tenantScope.js';
import * as companyController from '../controllers/company.controller.js';
import {
  companyIdSchema,
  createCompanySchema,
  updateCompanySchema,
} from '../validators/company.validators.js';

const router = Router();

// The company registry is cross-tenant by nature — you must be able to see all
// your companies in order to choose one — so these routes authenticate but do
// not require an active tenant.
router.use(authenticate);

router.post('/', validate(createCompanySchema), asyncHandler(companyController.create));
router.get('/', asyncHandler(companyController.list));
router.get(
  '/:id',
  validate(companyIdSchema, 'params'),
  asyncHandler(companyController.getById)
);

// Issues a new short-lived access token with the companyId claim embedded.
router.post(
  '/:id/activate',
  validate(companyIdSchema, 'params'),
  asyncHandler(companyController.activate)
);

// Editing acts on the ACTIVE company, so this route does need a tenant.
router.patch(
  '/:id',
  validate(companyIdSchema, 'params'),
  validate(updateCompanySchema),
  resolveTenant,
  requireTenant,
  asyncHandler(companyController.update)
);

export default router;
