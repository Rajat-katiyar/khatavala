import { Types } from 'mongoose';
import { AuditLogModel } from '../models/AuditLog.js';
import { logger } from '../config/logger.js';
import { tenantFilter, type TenantContext } from '../middlewares/tenantScope.js';

/**
 * WHY AN EXPLICIT WRAPPER AND NOT MONGOOSE HOOKS
 * ==============================================
 * A `post('save')` hook can see a document change, but it cannot produce the
 * log rows this schema requires:
 *
 *  1. NO ACTOR. A hook's `this` is the document. It has no access to the
 *     request, so it cannot know `userId` — the single most important column in
 *     an audit log. Smuggling the actor in via AsyncLocalStorage or a mutable
 *     module global works until two requests interleave, and then it silently
 *     attributes one user's deletion to another. That failure is invisible.
 *  2. HALF THE WRITES SKIP IT. `save` hooks do not fire for
 *     `findOneAndUpdate`, `updateOne`, `updateMany`, `deleteOne` or
 *     `bulkWrite` — which is most of this codebase's service layer (see
 *     product.service.ts, every function). Query-middleware equivalents exist
 *     but are separate hooks with different `this`, and `updateMany` cannot
 *     report per-document before/after values at all.
 *  3. NO `oldValue`. A post-save hook sees only the saved state. Capturing the
 *     prior state needs a read *before* the write — which is control flow the
 *     service owns, not the model.
 *  4. LOGGING FIRES ON EVERY WRITE, INCLUDING ONES THAT SHOULD NOT BE AUDITED
 *     (a token-rotation bump, a lastSeenAt touch). Auditing is a policy
 *     decision per operation; hooks make it a property of the collection.
 *
 * So the audit boundary lives here, at the service call, where the tenant, the
 * actor and both versions of the row are all in scope at once.
 *
 * Usage — wrap the operation, do not scatter log-writes through it:
 *
 *   export const updateProduct = (tenant, id, input) =>
 *     withAudit(
 *       { tenant, action: 'update', entityName: 'Product', entityId: id,
 *         before: () => ProductModel.findOne(tenantById(tenant, id)).lean() },
 *       async () => { ...the actual update...; return product; }
 *     );
 */

export interface AuditActor {
  userId: string;
  ip?: string | null;
  userAgent?: string | null;
}

/**
 * The actor travels on TenantContext so that every service already receiving a
 * tenant (which is all of them, by the Phase 3 rule) can audit without a new
 * parameter threaded through every signature.
 */
export type AuditTenant = TenantContext & { actor?: AuditActor };

export interface AuditOptions<T> {
  tenant: AuditTenant;
  action: string;
  entityName: string;
  entityId?: string | null;

  /** Loads the pre-change state. Omit for creates. */
  before?: () => Promise<unknown>;

  /** Derives `newValue` from the operation's result. Defaults to the result. */
  after?: (result: T) => unknown;

  /** Derives `entityId` from the result — for creates, where the id is new. */
  entityIdFrom?: (result: T) => string | null;
}

/**
 * Fields that must never reach the audit collection. An audit log is read by
 * more people than the source table, so it is a genuine secondary exposure
 * point for anything sensitive.
 */
const REDACTED = new Set([
  'passwordHash',
  'password',
  'resetTokenHash',
  'resetTokenExpiresAt',
  'tokenHash',
  'refreshToken',
  'accessToken',
  '__v',
]);

/** Deep-copies a value for storage, dropping secrets and Mongoose internals. */
function sanitize(value: unknown, depth = 0): unknown {
  if (value == null || depth > 6) return null;
  if (value instanceof Types.ObjectId || value instanceof Date) return String(value);
  if (Array.isArray(value)) return value.map((item) => sanitize(item, depth + 1));

  if (typeof value === 'object') {
    // Hydrated documents carry a large amount of internal state; take the
    // plain object view when one is available.
    const source =
      typeof (value as { toObject?: () => object }).toObject === 'function'
        ? (value as { toObject: () => object }).toObject()
        : value;

    const out: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(source as Record<string, unknown>)) {
      if (REDACTED.has(key)) continue;
      out[key] = sanitize(val, depth + 1);
    }
    return out;
  }
  return value;
}

/**
 * Narrows an update log to the fields that actually moved. Storing both full
 * documents on every edit makes the activity page unreadable and the collection
 * grow far faster than the data it describes.
 */
function diff(
  before: Record<string, unknown> | null,
  after: Record<string, unknown> | null
): { oldValue: unknown; newValue: unknown } {
  if (!before || !after) return { oldValue: before, newValue: after };

  const oldValue: Record<string, unknown> = {};
  const newValue: Record<string, unknown> = {};

  for (const key of new Set([...Object.keys(before), ...Object.keys(after)])) {
    if (key === '_id' || key === 'createdAt' || key === 'updatedAt') continue;
    if (JSON.stringify(before[key]) === JSON.stringify(after[key])) continue;
    oldValue[key] = before[key] ?? null;
    newValue[key] = after[key] ?? null;
  }

  // No observable change — record the operation, but with empty payloads
  // rather than two identical copies of the document.
  return { oldValue, newValue };
}

/** Writes a log row directly. Prefer `withAudit`; use this for domain events. */
export async function recordAudit(
  tenant: AuditTenant,
  entry: {
    action: string;
    entityName: string;
    entityId?: string | null;
    oldValue?: unknown;
    newValue?: unknown;
  }
): Promise<void> {
  if (!tenant.actor?.userId) {
    // An unattributable row is worse than none: it looks like coverage while
    // answering nobody's question. Loudly skip instead.
    logger.warn(
      `Audit skipped (no actor): ${entry.action} ${entry.entityName} ${entry.entityId ?? ''}`
    );
    return;
  }

  await AuditLogModel.create({
    userId: tenant.actor.userId,
    companyId: tenant.companyId,
    action: entry.action,
    entityName: entry.entityName,
    entityId: entry.entityId ?? null,
    oldValue: sanitize(entry.oldValue ?? null),
    newValue: sanitize(entry.newValue ?? null),
    ip: tenant.actor.ip ?? null,
    userAgent: tenant.actor.userAgent ?? null,
    timestamp: new Date(),
  });
}

/**
 * Runs `operation`, then logs what it did.
 *
 * Ordering matters: the log is written AFTER the operation succeeds. A failed
 * write must not leave a log row claiming it happened. Conversely a failure of
 * the *logging* must not roll back a successful business operation — the audit
 * write is therefore best-effort and its errors are logged, not rethrown. That
 * trade-off is deliberate; if this system ever needs guaranteed-complete audit
 * (a regulated deployment), the pair has to move into a transaction together,
 * which is a schema and deployment change, not a code tweak.
 */
export async function withAudit<T>(
  options: AuditOptions<T>,
  operation: () => Promise<T>
): Promise<T> {
  const before = options.before ? await options.before() : null;

  const result = await operation();

  try {
    const rawAfter = options.after ? options.after(result) : result;
    const sanitizedBefore = sanitize(before) as Record<string, unknown> | null;
    const sanitizedAfter = sanitize(rawAfter) as Record<string, unknown> | null;

    const { oldValue, newValue } =
      options.action === 'update'
        ? diff(sanitizedBefore, sanitizedAfter)
        : { oldValue: sanitizedBefore, newValue: sanitizedAfter };

    const entityId =
      options.entityIdFrom?.(result) ??
      options.entityId ??
      (sanitizedAfter?._id ? String(sanitizedAfter._id) : null);

    await recordAudit(options.tenant, {
      action: options.action,
      entityName: options.entityName,
      entityId,
      oldValue,
      newValue,
    });
  } catch (err) {
    logger.error(
      `Audit write failed for ${options.action} ${options.entityName}: ${(err as Error).message}`
    );
  }

  return result;
}

export interface AuditQuery {
  action?: string;
  entityName?: string;
  userId?: string;
  from?: Date;
  to?: Date;
  page?: number;
  limit?: number;
}

/** Reads the activity log for the active company. Tenant-scoped, like all reads. */
export async function listAuditLogs(tenant: TenantContext, query: AuditQuery = {}) {
  const filter: Record<string, unknown> = {};
  if (query.action) filter.action = query.action;
  if (query.entityName) filter.entityName = query.entityName;
  if (query.userId) filter.userId = query.userId;
  if (query.from || query.to) {
    filter.timestamp = {
      ...(query.from && { $gte: query.from }),
      ...(query.to && { $lte: query.to }),
    };
  }

  const limit = Math.min(Math.max(query.limit ?? 50, 1), 200);
  const page = Math.max(query.page ?? 1, 1);

  const [logs, total] = await Promise.all([
    AuditLogModel.find(tenantFilter(tenant, filter))
      .populate<{ userId: { _id: Types.ObjectId; fullName: string; email: string } }>(
        'userId',
        'fullName email'
      )
      .sort({ timestamp: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .lean(),
    AuditLogModel.countDocuments(tenantFilter(tenant, filter)),
  ]);

  return {
    logs: logs.map((log) => ({
      ...log,
      _id: String(log._id),
      // A deleted user leaves a dangling ref; the log row must still render.
      user: log.userId
        ? { _id: String(log.userId._id), fullName: log.userId.fullName, email: log.userId.email }
        : null,
      userId: log.userId ? String(log.userId._id) : null,
    })),
    total,
    page,
    limit,
    pages: Math.ceil(total / limit) || 1,
  };
}

/** Distinct values powering the activity-log page's filter dropdowns. */
export async function auditFilterOptions(tenant: TenantContext) {
  const [actions, entities] = await Promise.all([
    AuditLogModel.distinct('action', tenantFilter(tenant)),
    AuditLogModel.distinct('entityName', tenantFilter(tenant)),
  ]);
  return { actions: actions.sort(), entities: entities.sort() };
}
