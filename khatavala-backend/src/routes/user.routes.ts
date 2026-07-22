import { Router } from 'express';
import { asyncHandler } from '../utils/asyncHandler.js';
import { validate } from '../middlewares/validate.js';
import { authenticate } from '../middlewares/auth.js';
import { requireTenant, resolveTenant } from '../middlewares/tenantScope.js';
import { requirePermission } from '../services/permission.service.js';
import * as permissionService from '../services/permission.service.js';
import * as userService from '../services/user.service.js';
import {
  inviteIdParamSchema,
  inviteUserSchema,
  updateUserRoleSchema,
  userIdParamSchema,
} from '../validators/rbac.validators.js';

const router = Router();

// The Phase 3 stack, unchanged — RBAC layers on top of tenancy, it does not
// replace it. `requirePermission` runs per route because different actions on
// the same resource need different permissions.
router.use(authenticate, resolveTenant, requireTenant);

/**
 * The caller's own permissions in the active company. Deliberately NOT gated:
 * every authenticated member must be able to ask what they can do, and this is
 * what the frontend uses to hide UI it would be denied on anyway.
 */
router.get(
  '/me/permissions',
  asyncHandler(async (req, res) => {
    const data = await permissionService.getEffectivePermissions(
      req.tenant!,
      req.user!.id
    );
    res.json({ success: true, data });
  })
);

router.get(
  '/',
  requirePermission('users', 'view'),
  asyncHandler(async (req, res) => {
    const data = await userService.listCompanyUsers(req.tenant!);
    res.json({ success: true, data });
  })
);

router.post(
  '/invite',
  requirePermission('users', 'invite'),
  validate(inviteUserSchema),
  asyncHandler(async (req, res) => {
    const invite = await userService.inviteUser(req.tenant!, req.body);
    res.status(201).json({ success: true, data: { invite } });
  })
);

router.patch(
  '/:userId/role',
  requirePermission('users', 'update'),
  validate(userIdParamSchema, 'params'),
  validate(updateUserRoleSchema),
  asyncHandler(async (req, res) => {
    const membership = await userService.updateUserRole(
      req.tenant!,
      req.params.userId,
      req.body.roleIds ?? req.body.roleId
    );
    res.json({ success: true, data: { membership } });
  })
);

router.delete(
  '/:userId',
  requirePermission('users', 'revoke'),
  validate(userIdParamSchema, 'params'),
  asyncHandler(async (req, res) => {
    const data = await userService.revokeAccess(req.tenant!, req.params.userId);
    res.json({ success: true, data });
  })
);

// Two segments, so this never shadows `DELETE /:userId` above.
router.delete(
  '/invites/:inviteId',
  requirePermission('users', 'invite'),
  validate(inviteIdParamSchema, 'params'),
  asyncHandler(async (req, res) => {
    const data = await userService.revokeInvite(req.tenant!, req.params.inviteId);
    res.json({ success: true, data });
  })
);

export default router;
