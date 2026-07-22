import crypto from 'node:crypto';
import jwt, { type SignOptions } from 'jsonwebtoken';
import { env } from '../config/env.js';
import { RefreshTokenModel } from '../models/RefreshToken.js';
import type { UserDocument } from '../models/User.js';
import { ApiError } from '../utils/ApiError.js';

export interface AccessTokenPayload {
  sub: string;
  email: string;
  role: string;

  // Active-tenant claims. Absent until the user activates a company; present
  // and signed thereafter, which is what lets `resolveTenant` trust them
  // without a per-request membership lookup. See docs/TENANCY.md.
  companyId?: string;
  /**
   * Role NAME, for display only. Neither the role id nor its permissions are
   * claimed here: a token is immutable until it expires, so anything
   * authorization-bearing baked into it goes stale the moment an admin changes
   * a role — see services/permission.service.ts.
   */
  companyRole?: string;
  branchId?: string | null;
  warehouseId?: string | null;
}

export interface TenantClaims {
  companyId: string;
  companyRole: string;
  branchId?: string | null;
  warehouseId?: string | null;
}

export interface RefreshTokenPayload {
  sub: string;
  tokenVersion: number;
  jti: string;
}

export const sha256 = (value: string) =>
  crypto.createHash('sha256').update(value).digest('hex');

// `tenant` embeds the active company so downstream requests carry their scope
// in the token itself. Company-switch tokens are deliberately short-lived
// (JWT_ACTIVE_COMPANY_EXPIRES_IN) so that a membership revoked in the database
// stops being honoured quickly.
export function signAccessToken(user: UserDocument, tenant?: TenantClaims): string {
  const payload: AccessTokenPayload = {
    sub: String(user._id),
    email: user.email,
    role: user.role,
    ...(tenant && {
      companyId: tenant.companyId,
      companyRole: tenant.companyRole,
      branchId: tenant.branchId ?? null,
      warehouseId: tenant.warehouseId ?? null,
    }),
  };
  return jwt.sign(payload, env.JWT_ACCESS_SECRET, {
    expiresIn: tenant
      ? env.JWT_ACTIVE_COMPANY_EXPIRES_IN
      : env.JWT_ACCESS_EXPIRES_IN,
  } as SignOptions);
}

export function verifyAccessToken(token: string): AccessTokenPayload {
  try {
    return jwt.verify(token, env.JWT_ACCESS_SECRET) as AccessTokenPayload;
  } catch {
    throw ApiError.unauthorized('Invalid or expired access token');
  }
}

export function verifyRefreshToken(token: string): RefreshTokenPayload {
  try {
    return jwt.verify(token, env.JWT_REFRESH_SECRET) as RefreshTokenPayload;
  } catch {
    throw ApiError.unauthorized('Invalid or expired refresh token');
  }
}

interface IssueContext {
  userAgent?: string;
  ip?: string;
}

// Signs a refresh token and records its hash so it can be revoked later.
export async function issueRefreshToken(
  user: UserDocument,
  ctx: IssueContext = {}
): Promise<string> {
  const payload: RefreshTokenPayload = {
    sub: String(user._id),
    tokenVersion: user.tokenVersion,
    jti: crypto.randomUUID(),
  };
  const token = jwt.sign(payload, env.JWT_REFRESH_SECRET, {
    expiresIn: env.JWT_REFRESH_EXPIRES_IN,
  } as SignOptions);

  const { exp } = jwt.decode(token) as { exp: number };

  await RefreshTokenModel.create({
    user: user._id,
    tokenHash: sha256(token),
    expiresAt: new Date(exp * 1000),
    userAgent: ctx.userAgent,
    ip: ctx.ip,
  });

  return token;
}

// Rotation: the presented token is revoked and pointed at its replacement.
// Presenting an already-revoked token is treated as theft — every session for
// that user is killed rather than just rejecting the single request.
export async function rotateRefreshToken(
  presentedToken: string,
  user: UserDocument,
  ctx: IssueContext = {}
): Promise<string> {
  const presentedHash = sha256(presentedToken);
  const stored = await RefreshTokenModel.findOne({ tokenHash: presentedHash });

  if (!stored) throw ApiError.unauthorized('Refresh token not recognised');

  if (stored.revoked) {
    await revokeAllForUser(String(user._id));
    throw ApiError.unauthorized('Refresh token already used — all sessions revoked');
  }

  if (stored.expiresAt.getTime() < Date.now()) {
    throw ApiError.unauthorized('Refresh token expired');
  }

  const nextToken = await issueRefreshToken(user, ctx);

  stored.revoked = true;
  stored.revokedAt = new Date();
  stored.replacedByTokenHash = sha256(nextToken);
  await stored.save();

  return nextToken;
}

export async function revokeRefreshToken(token: string): Promise<void> {
  await RefreshTokenModel.updateOne(
    { tokenHash: sha256(token), revoked: false },
    { $set: { revoked: true, revokedAt: new Date() } }
  );
}

export async function revokeAllForUser(userId: string): Promise<number> {
  const result = await RefreshTokenModel.updateMany(
    { user: userId, revoked: false },
    { $set: { revoked: true, revokedAt: new Date() } }
  );
  return result.modifiedCount;
}
