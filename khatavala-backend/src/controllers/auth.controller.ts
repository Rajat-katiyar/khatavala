import type { Request, Response } from 'express';
import * as authService from '../services/auth.service.js';
import { UserModel } from '../models/User.js';
import { ApiError } from '../utils/ApiError.js';

const contextFrom = (req: Request) => ({
  userAgent: req.get('user-agent') ?? undefined,
  ip: req.ip,
});

export async function register(req: Request, res: Response) {
  const data = await authService.register(req.body, contextFrom(req));
  res.status(201).json({ success: true, data });
}

export async function login(req: Request, res: Response) {
  const data = await authService.login(req.body, contextFrom(req));
  res.json({ success: true, data });
}

export async function refreshToken(req: Request, res: Response) {
  const data = await authService.refresh(req.body.refreshToken, contextFrom(req));
  res.json({ success: true, data });
}

export async function logout(req: Request, res: Response) {
  if (req.body.allSessions) {
    if (!req.user) throw ApiError.unauthorized('Sign in to revoke all sessions');
    const revoked = await authService.logoutAll(req.user.id);
    return res.json({ success: true, data: { revoked, allSessions: true } });
  }

  await authService.logout(req.body.refreshToken);
  res.json({ success: true, data: { revoked: 1, allSessions: false } });
}

export async function forgotPassword(req: Request, res: Response) {
  await authService.forgotPassword(req.body);
  // Deliberately identical whether or not the address exists.
  res.json({
    success: true,
    data: { message: 'If that email is registered, a reset link is on its way.' },
  });
}

export async function resetPassword(req: Request, res: Response) {
  await authService.resetPassword(req.body);
  res.json({
    success: true,
    data: { message: 'Password updated. Please sign in with your new password.' },
  });
}

export async function me(req: Request, res: Response) {
  const user = await UserModel.findById(req.user!.id);
  if (!user) throw ApiError.notFound('User not found');
  res.json({ success: true, data: { user: user.toJSON() } });
}
