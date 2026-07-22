import type { NextFunction, Request, Response } from 'express';
import { Types } from 'mongoose';
import { RoleModel, expandPermissions } from '../models/Role.js';
import { UserCompanyRoleModel } from '../models/UserCompanyRole.js';
import { ApiError } from '../utils/ApiError.js';
import { logger } from '../config/logger.js';
import type { TenantContext } from '../middlewares/tenantScope.js';

/**
 * PERMISSION RESOLUTION
 * =====================
 * Permissions live on a Role document, not in the JWT. Two reasons:
 *
 *  1. STALENESS. A token is immutable until it expires. Baking permissions into
 *     it means revoking someone's `accounting.delete` does nothing until their
 *     token rotates — the exact window an admin is trying to close when they
 *     hit "revoke".
 *  2. SIZE. A permission array grows with the product; a JWT travels on every
 *     request and is capped by header limits.
 *
 * The cost is a lookup per authorized request, which this cache absorbs. The
 * cache is per-process and short-lived, and every writer of a Role calls
 * `invalidateRole`, so a permission change is visible immediately on the node
 * that made it and within ROLE_CACHE_TTL_MS everywhere else.
 *
 * NOTE for a multi-instance deployment: this is a process-local Map. With N app
 * instances behind a load balancer, an instance that did not serve the write
 * keeps serving stale permissions for up to the TTL. That is bounded and small,
 * but if it ever needs to be zero, this cache moves to Redis (already a
 * dependency — see config/redis.ts) with a pub/sub invalidation channel.
 */

const ROLE_CACHE_TTL_MS = 30_000;
const MEMBERSHIP_CACHE_TTL_MS = 30_000;

interface CachedRole {
  name: string;
  permissions: string[];
  expandedPermissions: Set<string>;
  expiresAt: number;
}

const roleCache = new Map<string, CachedRole>();

/**
 * WHICH role a user holds is cached separately from WHAT that role can do,
 * because the two change independently: editing a role's permissions and
 * reassigning a user to a different role are different admin actions, and each
 * must invalidate only its own entry.
 *
 * This lookup deliberately does NOT trust a `roleId` claim in the JWT. An
 * earlier revision carried one, which reintroduced the exact staleness this
 * module exists to avoid — reassigning someone's role did nothing until their
 * token rotated, and role reassignment is the single most common reason an
 * admin touches permissions at all. The tenancy claim is still trusted (see
 * tenantScope.ts); only the role behind it is re-read.
 */
interface CachedMembership {
  roleIds: string[];
  expiresAt: number;
}

const membershipCache = new Map<string, CachedMembership>();

const membershipKey = (userId: string, companyId: string) => `${userId}:${companyId}`;

export function invalidateRole(roleId: string | Types.ObjectId): void {
  roleCache.delete(String(roleId));
}

/** Call after assigning a role or revoking access, so the change is instant. */
export function invalidateMembership(
  userId: string | Types.ObjectId,
  companyId: string | Types.ObjectId
): void {
  membershipCache.delete(membershipKey(String(userId), String(companyId)));
}

export function invalidateAllRoles(): void {
  roleCache.clear();
  membershipCache.clear();
}

async function loadRole(roleId: string): Promise<CachedRole | null> {
  const cached = roleCache.get(roleId);
  if (cached && cached.expiresAt > Date.now()) return cached;

  const role = await RoleModel.findById(roleId).lean();
  if (!role) {
    roleCache.delete(roleId);
    return null;
  }

  const entry: CachedRole = {
    name: role.name,
    permissions: role.permissions,
    // Wildcards are expanded once, at cache time, so the hot path is a Set
    // lookup rather than a prefix match per permission per request.
    expandedPermissions: new Set(expandPermissions(role.permissions)),
    expiresAt: Date.now() + ROLE_CACHE_TTL_MS,
  };
  roleCache.set(roleId, entry);
  return entry;
}

/**
 * Finds all Roles backing the caller's membership in the active company.
 */
async function resolveRoles(
  tenant: TenantContext,
  userId: string
): Promise<{ name: string; permissions: string[]; expandedPermissions: Set<string> } | null> {
  const key = membershipKey(userId, String(tenant.companyId));
  const cached = membershipCache.get(key);

  let roleIds = cached && cached.expiresAt > Date.now() ? cached.roleIds : undefined;

  if (roleIds === undefined) {
    const membership = await UserCompanyRoleModel.findOne({
      userId,
      companyId: tenant.companyId,
      isActive: true,
    })
      .select('roleId roleIds')
      .lean();

    if (!membership) {
      roleIds = [];
    } else if (membership.roleIds && membership.roleIds.length > 0) {
      roleIds = membership.roleIds.map((id) => String(id));
    } else if (membership.roleId) {
      roleIds = [String(membership.roleId)];
    } else {
      roleIds = [];
    }
    membershipCache.set(key, { roleIds, expiresAt: Date.now() + MEMBERSHIP_CACHE_TTL_MS });
  }

  if (roleIds.length === 0) return null;

  tenant.roleId = new Types.ObjectId(roleIds[0]); // memoize primary role for this request

  const loadedRoles = (await Promise.all(roleIds.map((id) => loadRole(id)))).filter(
    (r): r is CachedRole => r !== null
  );

  if (loadedRoles.length === 0) return null;

  const names = Array.from(new Set(loadedRoles.map((r) => r.name))).join(', ');
  const allPermissions = Array.from(new Set(loadedRoles.flatMap((r) => r.permissions)));
  const combinedExpanded = new Set<string>();
  for (const r of loadedRoles) {
    for (const perm of r.expandedPermissions) {
      combinedExpanded.add(perm);
    }
  }

  return {
    name: names,
    permissions: allPermissions,
    expandedPermissions: combinedExpanded,
  };
}

export interface EffectivePermissions {
  roleName: string;
  /** As stored on the Role, wildcards intact. */
  permissions: string[];
  /** Concrete `module.action` keys — what the UI should gate on. */
  effectivePermissions: string[];
}

/** The caller's permissions in the active company. Powers the frontend gate. */
export async function getEffectivePermissions(
  tenant: TenantContext,
  userId: string
): Promise<EffectivePermissions> {
  const role = await resolveRoles(tenant, userId);
  if (!role) return { roleName: tenant.role, permissions: [], effectivePermissions: [] };

  return {
    roleName: role.name,
    permissions: role.permissions,
    effectivePermissions: [...role.expandedPermissions],
  };
}

/**
 * THE AUTHORIZATION PRIMITIVE.
 */
export async function checkPermission(
  user: { id: string } | undefined,
  tenant: TenantContext | undefined,
  module: string,
  action: string
): Promise<boolean> {
  if (!user || !tenant) return false;

  const role = await resolveRoles(tenant, user.id);
  if (!role) return false;

  return role.expandedPermissions.has(`${module}.${action}`);
}

/**
 * Express middleware form. Mount after `authenticate → resolveTenant →
 * requireTenant`:
 *
 *   router.post('/', requirePermission('sales', 'create'), handler)
 *
 * Denials are 403 with a machine-readable code and the missing permission, so
 * the frontend can distinguish "you are logged out" (401) from "your role does
 * not cover this" (403) and show the right thing.
 */
/** Reads back the permissions a middleware enforces — see docs/openapi.ts. */
export const PERMISSION_META = Symbol.for('khatavala.permissionMeta');

export function requirePermission(module: string, action: string) {
  const middleware = async (req: Request, _res: Response, next: NextFunction) => {
    try {
      if (!req.user) return next(ApiError.unauthorized('Authentication required'));
      if (!req.tenant) {
        return next(
          new ApiError(400, 'No active company selected', 'NO_ACTIVE_COMPANY')
        );
      }

      const allowed = await checkPermission(req.user, req.tenant, module, action);
      if (!allowed) {
        logger.warn(
          `Permission denied: user ${req.user.id} lacks ${module}.${action} in company ${String(req.tenant.companyId)}`
        );
        return next(
          new ApiError(
            403,
            `Your role does not permit ${module}.${action}`,
            'FORBIDDEN',
            { required: `${module}.${action}` }
          )
        );
      }
      next();
    } catch (err) {
      next(err);
    }
  };

  /**
   * Stamped on the middleware so the OpenAPI document can state which
   * permission each endpoint needs without a second list to keep in step.
   */
  (middleware as any)[PERMISSION_META] = [`${module}.${action}`];
  return middleware;
}

/** Passes if the caller holds ANY of the listed permissions. */
export function requireAnyPermission(...pairs: [string, string][]) {
  const middleware = async (req: Request, _res: Response, next: NextFunction) => {
    try {
      if (!req.user) return next(ApiError.unauthorized('Authentication required'));
      if (!req.tenant) {
        return next(new ApiError(400, 'No active company selected', 'NO_ACTIVE_COMPANY'));
      }

      for (const [module, action] of pairs) {
        if (await checkPermission(req.user, req.tenant, module, action)) return next();
      }

      return next(
        new ApiError(403, 'Your role does not permit this action', 'FORBIDDEN', {
          requiredAny: pairs.map(([m, a]) => `${m}.${a}`),
        })
      );
    } catch (err) {
      next(err);
    }
  };

  (middleware as any)[PERMISSION_META] = pairs.map(([m, a]) => `${m}.${a}`);
  return middleware;
}

/** Throws instead of calling `next` — for use inside a service. */
export async function assertPermission(
  user: { id: string } | undefined,
  tenant: TenantContext | undefined,
  module: string,
  action: string
): Promise<void> {
  if (!(await checkPermission(user, tenant, module, action))) {
    throw new ApiError(403, `Your role does not permit ${module}.${action}`, 'FORBIDDEN', {
      required: `${module}.${action}`,
    });
  }
}
