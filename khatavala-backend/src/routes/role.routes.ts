import { Router } from 'express';
import { asyncHandler } from '../utils/asyncHandler.js';
import { validate } from '../middlewares/validate.js';
import { authenticate } from '../middlewares/auth.js';
import { requireTenant, resolveTenant } from '../middlewares/tenantScope.js';
import { requirePermission } from '../services/permission.service.js';
import * as roleService from '../services/role.service.js';
import {
  createRoleSchema,
  duplicateRoleSchema,
  idParamSchema,
  updateRoleSchema,
} from '../validators/rbac.validators.js';

const router = Router();

router.use(authenticate, resolveTenant, requireTenant);

/**
 * The permission catalog, grouped by module — the data behind the matrix UI.
 * Static application data, so no tenant read is involved, but it is still
 * gated: the catalog describes the whole product surface, including modules a
 * given company may not have enabled.
 *
 * Declared before `/:id` so "permissions" is never parsed as a role id.
 */
router.get(
  '/permissions',
  requirePermission('roles', 'view'),
  asyncHandler(async (_req, res) => {
    res.json({ success: true, data: roleService.listAvailablePermissions() });
  })
);

router.get(
  '/',
  requirePermission('roles', 'view'),
  asyncHandler(async (req, res) => {
    const roles = await roleService.listRoles(req.tenant!);
    res.json({ success: true, data: { roles } });
  })
);

router.post(
  '/',
  requirePermission('roles', 'create'),
  validate(createRoleSchema),
  asyncHandler(async (req, res) => {
    const role = await roleService.createRole(req.tenant!, req.body);
    res.status(201).json({ success: true, data: { role } });
  })
);

router.get(
  '/:id',
  requirePermission('roles', 'view'),
  validate(idParamSchema, 'params'),
  asyncHandler(async (req, res) => {
    const role = await roleService.getRole(req.tenant!, req.params.id);
    res.json({ success: true, data: { role } });
  })
);

// Duplicating is how a built-in role gets customised — see updateRole for why
// system roles are not editable in place.
router.post(
  '/:id/duplicate',
  requirePermission('roles', 'create'),
  validate(idParamSchema, 'params'),
  validate(duplicateRoleSchema),
  asyncHandler(async (req, res) => {
    const role = await roleService.duplicateRole(
      req.tenant!,
      req.params.id,
      req.body.name
    );
    res.status(201).json({ success: true, data: { role } });
  })
);

router.patch(
  '/:id',
  requirePermission('roles', 'update'),
  validate(idParamSchema, 'params'),
  validate(updateRoleSchema),
  asyncHandler(async (req, res) => {
    const role = await roleService.updateRole(req.tenant!, req.params.id, req.body);
    res.json({ success: true, data: { role } });
  })
);

router.delete(
  '/:id',
  requirePermission('roles', 'delete'),
  validate(idParamSchema, 'params'),
  asyncHandler(async (req, res) => {
    await roleService.deleteRole(req.tenant!, req.params.id);
    res.json({ success: true, data: { deleted: true } });
  })
);

export default router;
