import type { NextFunction, Request, Response } from 'express';
import { ApiError } from '../utils/ApiError.js';
import { verifyAccessToken, type AccessTokenPayload } from '../services/token.service.js';
import type { Role } from '../models/User.js';

export interface AuthUser {
  id: string;
  email: string;
  role: Role;

  // Active-tenant claims, present once the user has activated a company.
  // Consumed by `resolveTenant`, which turns them into `req.tenant`; route
  // handlers should read `req.tenant`, not these.
  companyId?: string;
  /**
   * Role NAME in the active company, for display. Custom roles make this a
   * free string. It is NOT what permission checks read — those resolve the
   * membership fresh; see services/permission.service.ts.
   */
  companyRole?: string;
  branchId?: string | null;
  warehouseId?: string | null;
}

const toAuthUser = (payload: AccessTokenPayload): AuthUser => ({
  id: payload.sub,
  email: payload.email,
  role: payload.role as Role,
  companyId: payload.companyId,
  companyRole: payload.companyRole,
  branchId: payload.branchId ?? null,
  warehouseId: payload.warehouseId ?? null,
});

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: AuthUser;
    }
  }
}

function extractToken(req: Request): string | null {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) return null;
  const token = header.slice('Bearer '.length).trim();
  return token.length > 0 ? token : null;
}

// Verifies the access token and attaches req.user, or rejects with 401.
export function authenticate(req: Request, _res: Response, next: NextFunction) {
  const token = extractToken(req);
  if (!token) return next(ApiError.unauthorized('Missing bearer token'));

  try {
    req.user = toAuthUser(verifyAccessToken(token));
    next();
  } catch (err) {
    next(err);
  }
}

// Attaches req.user when a valid token is present but never rejects. Used by
// routes such as logout that must work for both live and expired sessions.
export function optionalAuthenticate(req: Request, _res: Response, next: NextFunction) {
  const token = extractToken(req);
  if (!token) return next();

  try {
    req.user = toAuthUser(verifyAccessToken(token));
  } catch {
    // Ignore an invalid token — the route treats the caller as anonymous.
  }
  next();
}

// Restricts a route to the listed roles. Must run after `authenticate`.
export function roleMiddleware(...allowedRoles: Role[]) {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (!req.user) return next(ApiError.unauthorized('Authentication required'));

    if (!allowedRoles.includes(req.user.role)) {
      return next(
        new ApiError(
          403,
          `Role '${req.user.role}' is not permitted to perform this action`,
          'FORBIDDEN'
        )
      );
    }
    next();
  };
}
