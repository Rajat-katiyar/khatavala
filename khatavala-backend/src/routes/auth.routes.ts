import { Router } from 'express';
import { asyncHandler } from '../utils/asyncHandler.js';
import { validate } from '../middlewares/validate.js';
import { authenticate, optionalAuthenticate, roleMiddleware } from '../middlewares/auth.js';
import * as authController from '../controllers/auth.controller.js';
import * as userService from '../services/user.service.js';
import { acceptInviteSchema } from '../validators/rbac.validators.js';
import {
  forgotPasswordSchema,
  loginSchema,
  logoutSchema,
  refreshTokenSchema,
  registerSchema,
  resetPasswordSchema,
} from '../validators/auth.validators.js';

const router = Router();

router.post('/register', validate(registerSchema), asyncHandler(authController.register));
router.post('/login', validate(loginSchema), asyncHandler(authController.login));
router.post(
  '/refresh-token',
  validate(refreshTokenSchema),
  asyncHandler(authController.refreshToken)
);
router.post(
  '/logout',
  optionalAuthenticate,
  validate(logoutSchema),
  asyncHandler(authController.logout)
);
router.post(
  '/forgot-password',
  validate(forgotPasswordSchema),
  asyncHandler(authController.forgotPassword)
);
router.post(
  '/reset-password',
  validate(resetPasswordSchema),
  asyncHandler(authController.resetPassword)
);

router.get('/me', authenticate, asyncHandler(authController.me));

/**
 * Invitation acceptance. Public by necessity — the invitee has no session, and
 * may have no account at all. The invite token IS the credential, which is why
 * only its hash is stored and why it expires in 72 hours.
 */
router.get(
  '/invites/:token',
  asyncHandler(async (req, res) => {
    const invite = await userService.previewInvite(req.params.token);
    res.json({ success: true, data: { invite } });
  })
);

router.post(
  '/accept-invite',
  validate(acceptInviteSchema),
  asyncHandler(async (req, res) => {
    const data = await userService.acceptInvite(req.body);
    res.status(201).json({ success: true, data });
  })
);

// Demonstrates roleMiddleware; extend with real admin handlers as they land.
router.get(
  '/admin-check',
  authenticate,
  roleMiddleware('SuperAdmin', 'Owner'),
  asyncHandler(async (req, res) => {
    res.json({ success: true, data: { message: `Welcome, ${req.user!.role}` } });
  })
);

export default router;
