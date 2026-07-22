import crypto from 'node:crypto';
import { env } from '../config/env.js';
import { UserModel, hashPassword, type UserDocument } from '../models/User.js';
import { ApiError } from '../utils/ApiError.js';
import { logger } from '../config/logger.js';
import { sendPasswordResetEmail } from './mail.service.js';
import {
  issueRefreshToken,
  revokeAllForUser,
  revokeRefreshToken,
  rotateRefreshToken,
  sha256,
  signAccessToken,
  verifyRefreshToken,
} from './token.service.js';
import { tenantClaimsForUser } from './company.service.js';
import type {
  ForgotPasswordInput,
  LoginInput,
  RegisterInput,
  ResetPasswordInput,
} from '../validators/auth.validators.js';

export interface RequestContext {
  userAgent?: string;
  ip?: string;
}

interface AuthResult {
  user: Record<string, unknown>;
  accessToken: string;
  refreshToken: string;
}

async function buildSession(user: UserDocument, ctx: RequestContext): Promise<AuthResult> {
  const [accessToken, refreshToken] = await Promise.all([
    signAccessToken(user),
    issueRefreshToken(user, ctx),
  ]);
  return { user: user.toJSON(), accessToken, refreshToken };
}

export async function register(
  input: RegisterInput,
  ctx: RequestContext
): Promise<AuthResult> {
  const existing = await UserModel.findOne({ email: input.email });
  if (existing) throw ApiError.badRequest('An account with that email already exists');

  const passwordHash = await hashPassword(input.password);
  const user = (await UserModel.create({
    email: input.email,
    passwordHash,
    fullName: input.fullName,
    phoneNumber: input.phoneNumber,
    role: input.role ?? 'Employee',
  })) as UserDocument;

  logger.info(`User registered: ${user.email}`);
  return buildSession(user, ctx);
}

export async function login(input: LoginInput, ctx: RequestContext): Promise<AuthResult> {
  const user = (await UserModel.findOne({ email: input.email }).select(
    '+passwordHash'
  )) as UserDocument | null;

  // Same error for unknown email and bad password — no account enumeration.
  if (!user) throw ApiError.unauthorized('Invalid email or password');

  const matches = await user.comparePassword(input.password);
  if (!matches) throw ApiError.unauthorized('Invalid email or password');

  if (!user.isActive) throw ApiError.unauthorized('Account is deactivated');

  return buildSession(user, ctx);
}

export async function refresh(
  presentedToken: string,
  ctx: RequestContext
): Promise<AuthResult> {
  const payload = verifyRefreshToken(presentedToken);

  const user = (await UserModel.findById(payload.sub)) as UserDocument | null;
  if (!user || !user.isActive) throw ApiError.unauthorized('Account unavailable');

  // Invalidated wholesale by a password reset or revoke-all.
  if (payload.tokenVersion !== user.tokenVersion) {
    throw ApiError.unauthorized('Session no longer valid');
  }

  const refreshToken = await rotateRefreshToken(presentedToken, user, ctx);

  // Carry the active company across the rotation, re-verifying membership, so
  // a refresh mid-session does not silently drop the user's tenant scope.
  const tenant = await tenantClaimsForUser(user);

  return {
    user: user.toJSON(),
    accessToken: signAccessToken(user, tenant),
    refreshToken,
  };
}

export async function logout(refreshToken: string): Promise<void> {
  await revokeRefreshToken(refreshToken);
}

export async function logoutAll(userId: string): Promise<number> {
  // Bumping tokenVersion invalidates refresh tokens that were signed but whose
  // rows might be missed, then flag the stored rows for auditability.
  await UserModel.updateOne({ _id: userId }, { $inc: { tokenVersion: 1 } });
  return revokeAllForUser(userId);
}

export async function forgotPassword(input: ForgotPasswordInput): Promise<void> {
  const user = (await UserModel.findOne({
    email: input.email,
    isActive: true,
  })) as UserDocument | null;

  // Always resolve successfully so the endpoint cannot confirm which addresses
  // are registered; only send when the account actually exists.
  if (!user) {
    logger.info(`Password reset requested for unknown email: ${input.email}`);
    return;
  }

  const rawToken = crypto.randomBytes(32).toString('hex');
  user.set('resetTokenHash', sha256(rawToken));
  user.set(
    'resetTokenExpiresAt',
    new Date(Date.now() + env.PASSWORD_RESET_TTL_MIN * 60_000)
  );
  await user.save();

  await sendPasswordResetEmail(user.email, user.fullName, rawToken);
}

export async function resetPassword(input: ResetPasswordInput): Promise<void> {
  const user = (await UserModel.findOne({
    resetTokenHash: sha256(input.token),
    resetTokenExpiresAt: { $gt: new Date() },
  }).select('+passwordHash +resetTokenHash +resetTokenExpiresAt')) as UserDocument | null;

  if (!user) throw ApiError.badRequest('Reset token is invalid or has expired');

  user.passwordHash = input.password; // re-hashed by the pre-save hook
  user.set('resetTokenHash', undefined);
  user.set('resetTokenExpiresAt', undefined);
  user.tokenVersion += 1; // force every existing session to re-authenticate
  await user.save();

  await revokeAllForUser(String(user._id));
  logger.info(`Password reset completed: ${user.email}`);
}
