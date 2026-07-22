import type { NextFunction, Request, Response } from 'express';
import { Types, type FilterQuery } from 'mongoose';
import { ApiError } from '../utils/ApiError.js';
import { UserCompanyRoleModel } from '../models/UserCompanyRole.js';

/**
 * MULTI-TENANCY: THE ONE PATTERN TO FOLLOW
 * ========================================
 * MongoDB has no row-level security. Nothing in the database stops a query for
 * `Invoice.find({ status: 'unpaid' })` from returning every tenant's invoices.
 * Isolation is therefore *entirely* a discipline of the service layer, and this
 * module is the single place that discipline is implemented.
 *
 * The rules, in order:
 *
 *  1. Every tenant-scoped collection has a required, indexed `companyId`.
 *  2. `resolveTenant` runs after `authenticate` and puts the caller's active
 *     company on `req.tenant`. It never trusts a client-supplied id blindly.
 *  3. Service functions take the resolved `TenantContext` as their FIRST
 *     argument — never a raw Request, and never an optional companyId that a
 *     caller can forget to pass.
 *  4. EVERY read wraps its filter in `tenantFilter(tenant, ...)`.
 *     EVERY write wraps its payload in `tenantStamp(tenant, ...)`.
 *     There is no exception. A query written as `Model.find({ sku })` is a
 *     cross-tenant data leak even if it looks harmless today.
 *  5. Updates and deletes filter by `{ _id, companyId }` — never `_id` alone.
 *     Filtering by `_id` alone lets a caller who guesses an ObjectId mutate
 *     another tenant's row.
 *
 * Reviewer's checklist for any new module: search the file for the model name;
 * every call site must pass through `tenantFilter` or `tenantStamp`.
 */

export interface TenantContext {
  companyId: Types.ObjectId;

  /**
   * The caller's role NAME in this company — not their platform-level
   * User.role. A display label and a coarse gate only; since Phase 4 custom
   * roles may be named anything, so it is typed `string`, not the `Role` enum.
   * Fine-grained decisions go through `checkPermission`, never through this.
   */
  role: string;

  /**
   * The Role document behind `role`. Starts null and is filled in by
   * `checkPermission` on first use — it resolves the membership fresh rather
   * than trusting a token claim, so that role changes apply immediately.
   */
  roleId: Types.ObjectId | null;

  branchId: Types.ObjectId | null;
  warehouseId: Types.ObjectId | null;

  /**
   * Who is making this request, for the audit trail. Carried on the tenant so
   * that services — which already take a TenantContext first, by the Phase 3
   * rule — can audit without a new parameter on every signature.
   */
  actor?: { userId: string; ip?: string | null; userAgent?: string | null };
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      tenant?: TenantContext;
    }
  }
}

const toObjectId = (value: unknown): Types.ObjectId | null =>
  typeof value === 'string' && Types.ObjectId.isValid(value)
    ? new Types.ObjectId(value)
    : null;

/**
 * Resolves the active company for this request.
 *
 * Two sources, in priority order:
 *   1. The `companyId` claim on the access token, put there by
 *      `POST /companies/:id/activate`. Signed by us, so it is trusted without a
 *      further lookup — the membership was verified when the token was issued,
 *      and the short access-token TTL bounds how long a revoked membership can
 *      linger.
 *   2. The `X-Company-Id` header. Client-supplied and therefore NOT trusted:
 *      membership is verified against UserCompanyRole on every request. This
 *      exists for clients that would rather not re-mint a token per switch.
 *
 * Never rejects on a missing company — some authenticated routes (listing your
 * companies, creating the first one) legitimately have no tenant yet. Use
 * `requireTenant` on routes that need one.
 */
export async function resolveTenant(req: Request, _res: Response, next: NextFunction) {
  if (!req.user) return next(ApiError.unauthorized('Authentication required'));

  const actor = {
    userId: req.user.id,
    ip: req.ip ?? null,
    userAgent: req.get('user-agent') ?? null,
  };

  const claimed = toObjectId(req.user.companyId);
  if (claimed && req.user.companyRole) {
    req.tenant = {
      companyId: claimed,
      role: req.user.companyRole,
      // Deliberately unresolved here. `checkPermission` reads the membership
      // itself (cached, ~30s) so that a role reassignment takes effect without
      // waiting for the token to rotate.
      roleId: null,
      branchId: toObjectId(req.user.branchId),
      warehouseId: toObjectId(req.user.warehouseId),
      actor,
    };
    return next();
  }

  const headerValue = req.get('x-company-id');
  if (!headerValue) return next();

  const headerId = toObjectId(headerValue);
  if (!headerId) return next(ApiError.badRequest('X-Company-Id is not a valid id'));

  try {
    const membership = await UserCompanyRoleModel.findOne({
      userId: req.user.id,
      companyId: headerId,
      isActive: true,
    }).lean();

    // Same response for "no such company" and "not a member" — a membership
    // probe must not confirm that a company id exists.
    if (!membership) {
      return next(new ApiError(403, 'No access to that company', 'FORBIDDEN'));
    }

    req.tenant = {
      companyId: headerId,
      role: membership.role,
      roleId: membership.roleId ?? null,
      branchId: membership.branchId ?? null,
      warehouseId: membership.warehouseId ?? null,
      actor,
    };
    next();
  } catch (err) {
    next(err);
  }
}

/** Rejects the request unless an active company was resolved. */
export function requireTenant(req: Request, _res: Response, next: NextFunction) {
  if (!req.tenant) {
    return next(
      new ApiError(
        400,
        'No active company selected. Activate a company first.',
        'NO_ACTIVE_COMPANY'
      )
    );
  }
  next();
}

/**
 * Restricts a route to named roles held *within the active company*.
 *
 * Kept from Phase 3 for coarse gates ("Owners only"). For anything finer, use
 * `requirePermission` from services/permission.service.ts — a role name says
 * nothing about what a custom role of that name can actually do.
 */
export function requireCompanyRole(...allowed: string[]) {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (!req.tenant) return next(ApiError.unauthorized('No active company'));
    if (!allowed.includes(req.tenant.role)) {
      return next(
        new ApiError(
          403,
          `Role '${req.tenant.role}' cannot perform this action in this company`,
          'FORBIDDEN'
        )
      );
    }
    next();
  };
}

/**
 * Wraps a query filter so it can only ever match the active tenant's rows.
 *
 *   ProductModel.find(tenantFilter(tenant, { active: true }))
 *
 * `companyId` is applied LAST so a caller-supplied `companyId` — whether a bug
 * or an injected query param — is overwritten rather than honoured.
 */
export function tenantFilter<T>(
  tenant: TenantContext,
  filter: FilterQuery<T> = {}
): FilterQuery<T> {
  return { ...filter, companyId: tenant.companyId } as FilterQuery<T>;
}

/**
 * Wraps a create/update payload so the row is written into the active tenant.
 * Same last-wins ordering as `tenantFilter`, for the same reason.
 */
export function tenantStamp<T extends object>(
  tenant: TenantContext,
  payload: T
): T & { companyId: Types.ObjectId } {
  return { ...payload, companyId: tenant.companyId };
}

/** Convenience for the `{ _id, companyId }` pattern used by update/delete. */
export function tenantById<T>(tenant: TenantContext, id: string): FilterQuery<T> {
  return { _id: id, companyId: tenant.companyId } as FilterQuery<T>;
}
