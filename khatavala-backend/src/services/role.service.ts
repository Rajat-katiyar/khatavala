import { Types, type ClientSession } from 'mongoose';
import {
  PERMISSION_MODULES,
  RoleModel,
  SYSTEM_ROLE_TEMPLATES,
  expandPermissions,
  isValidPermission,
  type RoleDocument,
} from '../models/Role.js';
import { UserCompanyRoleModel } from '../models/UserCompanyRole.js';
import { ApiError } from '../utils/ApiError.js';
import { logger } from '../config/logger.js';
import { tenantById, tenantFilter, tenantStamp } from '../middlewares/tenantScope.js';
import type { TenantContext } from '../middlewares/tenantScope.js';
import { invalidateRole, invalidateAllRoles } from './permission.service.js';
import { withAudit, type AuditTenant } from './audit.service.js';

/**
 * Seeds the system roles for a company. Called once, when the company is
 * created — a company with no roles has no way to make its owner an Owner.
 *
 * Idempotent: re-running skips roles that already exist, so it doubles as the
 * backfill path for companies created before Phase 4 (see scripts/seedRoles.ts).
 */
export async function seedSystemRoles(
  companyId: Types.ObjectId,
  session?: ClientSession
): Promise<Map<string, RoleDocument>> {
  const existing = await RoleModel.find({ companyId })
    .session(session ?? null)
    .exec();
  const byName = new Map(existing.map((role) => [role.name, role]));

  const missing = SYSTEM_ROLE_TEMPLATES.filter((tpl) => !byName.has(tpl.name)).map(
    (tpl) => ({
      companyId,
      name: tpl.name,
      description: tpl.description,
      permissions: tpl.permissions,
      isSystem: true,
      isDefault: tpl.isDefault ?? false,
    })
  );

  if (missing.length > 0) {
    // `ordered: true` is required, not optional: Mongoose refuses a multi-document
    // create() inside a session without it, which is exactly the path company
    // creation takes.
    const created = await RoleModel.create(
      missing,
      session ? { session, ordered: true } : {}
    );
    created.forEach((role) => byName.set(role.name, role));
    logger.info(`Seeded ${created.length} system role(s) for company ${companyId}`);
  }

  /**
   * Reconcile the permissions of system roles that already exist.
   *
   * Creating only the MISSING roles is not enough. Permissions are code
   * (see the catalog note in models/Role.ts), so shipping a new module —
   * `suppliers` in Phase 6 — adds keys to these templates that no existing
   * company's Manager or Accountant would ever receive. Their role would sit
   * permanently one release behind the deployed code, and the only symptom is
   * a 403 nobody can explain.
   *
   * Safe to overwrite because system roles are strictly immutable: updateRole
   * and deleteRole both reject `isSystem`, so there is no admin customisation
   * here to stomp. Custom roles are untouched — those ARE user data.
   */
  const drifted = SYSTEM_ROLE_TEMPLATES.flatMap((tpl) => {
    const role = byName.get(tpl.name);
    if (!role || !role.isSystem) return [];
    const same =
      role.permissions.length === tpl.permissions.length &&
      tpl.permissions.every((permission) => role.permissions.includes(permission));
    return same ? [] : [{ role, tpl }];
  });

  for (const { role, tpl } of drifted) {
    role.permissions = tpl.permissions;
    role.description = tpl.description;
    await role.save({ session: session ?? undefined });
    // The permission cache keys off the role id, so a stale entry would keep
    // denying the new module for up to its TTL after this update.
    invalidateRole(role._id);
  }

  if (drifted.length > 0) {
    logger.info(
      `Reconciled ${drifted.length} system role(s) to the current catalog for company ${companyId}`
    );
  }

  return byName;
}

/** The Role a company's Owner should hold. Used at company-creation time. */
export async function ownerRoleFor(
  companyId: Types.ObjectId,
  session?: ClientSession
): Promise<RoleDocument> {
  const roles = await seedSystemRoles(companyId, session);
  const owner = roles.get('Owner');
  if (!owner) throw new Error(`Owner role missing for company ${companyId}`);
  return owner;
}

/** Resolves a role by id within the active company, or 404s. */
export async function getRole(tenant: TenantContext, roleId: string) {
  if (!Types.ObjectId.isValid(roleId)) throw ApiError.badRequest('Invalid role id');
  const role = await RoleModel.findOne(tenantById(tenant, roleId)).lean();
  // Another company's role reads as "not found", never "forbidden" — same
  // reasoning as products: a 403 would confirm the id exists.
  if (!role) throw ApiError.notFound('Role not found');
  return role;
}

/** Every role in the active company, with usage counts for the roles page. */
export async function listRoles(tenant: TenantContext) {
  const roles = await RoleModel.find(tenantFilter(tenant)).sort({ isSystem: -1, name: 1 }).lean();

  // One grouped count rather than a query per role.
  const counts = await UserCompanyRoleModel.aggregate<{ _id: Types.ObjectId; n: number }>([
    { $match: { companyId: tenant.companyId, isActive: true } },
    { $group: { _id: '$roleId', n: { $sum: 1 } } },
  ]);
  const byRole = new Map(counts.map((c) => [String(c._id), c.n]));

  return roles.map((role) => ({
    ...role,
    _id: String(role._id),
    effectivePermissions: expandPermissions(role.permissions),
    userCount: byRole.get(String(role._id)) ?? 0,
  }));
}

/**
 * The permission catalog, grouped by module — the shape the matrix UI renders.
 * Static data, so no tenant is involved.
 */
export function listAvailablePermissions() {
  return {
    modules: Object.entries(PERMISSION_MODULES).map(([key, def]) => ({
      module: key,
      label: def.label,
      description: def.description,
      actions: def.actions.map((action) => ({
        action,
        key: `${key}.${action}`,
      })),
    })),
  };
}

/** Rejects unknown permission keys rather than silently dropping them. */
function validatePermissions(permissions: string[]): string[] {
  const invalid = permissions.filter((p) => !isValidPermission(p));
  if (invalid.length > 0) {
    throw ApiError.badRequest(`Unknown permission(s): ${invalid.join(', ')}`, { invalid });
  }
  // Deduplicate — the matrix UI can submit a module wildcard alongside its
  // members, and storing both would make the role read confusingly.
  return [...new Set(permissions)];
}

export interface RoleInput {
  name: string;
  description?: string;
  permissions: string[];
}

export async function createRole(tenant: AuditTenant, input: RoleInput) {
  const permissions = validatePermissions(input.permissions);

  const clash = await RoleModel.findOne(
    tenantFilter(tenant, { name: input.name })
  ).lean();
  if (clash) throw ApiError.badRequest('A role with that name already exists');

  return withAudit(
    { tenant, action: 'create', entityName: 'Role' },
    async () =>
      RoleModel.create(
        tenantStamp(tenant, {
          name: input.name,
          description: input.description ?? '',
          permissions,
          isSystem: false,
          isDefault: false,
        })
      )
  );
}

export async function updateRole(
  tenant: AuditTenant,
  roleId: string,
  input: Partial<RoleInput>
) {
  const existing = await RoleModel.findOne(tenantById(tenant, roleId));
  if (!existing) throw ApiError.notFound('Role not found');

  // System roles are the app's floor. Letting an admin strip `users.invite`
  // from Owner is a one-click, unrecoverable lockout of their own company.
  if (existing.isSystem && existing.name === 'Owner') {
    throw new ApiError(
      403,
      `The 'Owner' role is the system root role and cannot be modified.`,
      'ROLE_IS_SYSTEM'
    );
  }

  const permissions = input.permissions
    ? validatePermissions(input.permissions)
    : undefined;

  if (input.name && input.name !== existing.name) {
    const clash = await RoleModel.findOne(
      tenantFilter(tenant, { name: input.name, _id: { $ne: existing._id } })
    ).lean();
    if (clash) throw ApiError.badRequest('A role with that name already exists');
  }

  const updated = await withAudit(
    {
      tenant,
      action: 'update',
      entityName: 'Role',
      entityId: roleId,
      // Snapshot before the write so the log can show what actually moved.
      before: async () => RoleModel.findOne(tenantById(tenant, roleId)).lean(),
    },
    async () => {
      const role = await RoleModel.findOneAndUpdate(
        tenantById(tenant, roleId),
        {
          $set: {
            ...(input.name && { name: input.name }),
            ...(input.description !== undefined && { description: input.description }),
            ...(permissions && { permissions }),
          },
        },
        { new: true, runValidators: true }
      );
      if (!role) throw ApiError.notFound('Role not found');
      return role;
    }
  );

  // Drop the cached permission set immediately, so the change takes effect on
  // this node's very next request rather than after the cache TTL.
  invalidateRole(roleId);
  invalidateAllRoles();

  // The denormalized name on every membership has to follow the rename, or the
  // users table and the JWT claim would keep showing the old label.
  if (input.name && input.name !== existing.name) {
    await UserCompanyRoleModel.updateMany(
      { companyId: tenant.companyId, roleId: existing._id },
      { $set: { role: input.name } }
    );
  }

  return updated;
}

export async function deleteRole(tenant: AuditTenant, roleId: string) {
  const role = await RoleModel.findOne(tenantById(tenant, roleId));
  if (!role) throw ApiError.notFound('Role not found');

  if (role.isSystem) {
    throw new ApiError(403, 'Built-in roles cannot be deleted', 'ROLE_IS_SYSTEM');
  }

  // Deleting a role out from under its holders would leave memberships
  // pointing at nothing — and `resolveRole` returning null means those users
  // silently lose every permission. Make the admin reassign first.
  const inUse = await UserCompanyRoleModel.countDocuments({
    companyId: tenant.companyId,
    roleId: role._id,
    isActive: true,
  });
  if (inUse > 0) {
    throw ApiError.badRequest(
      `${inUse} user(s) still hold '${role.name}'. Reassign them before deleting it.`
    );
  }

  await withAudit(
    {
      tenant,
      action: 'delete',
      entityName: 'Role',
      entityId: roleId,
      before: async () => role.toObject(),
      after: () => null,
    },
    async () => {
      await RoleModel.deleteOne(tenantById(tenant, roleId));
      return null;
    }
  );

  invalidateRole(roleId);
}

/** Copies a role — the supported way to customise a built-in one. */
export async function duplicateRole(tenant: AuditTenant, roleId: string, name: string) {
  const source = await getRole(tenant, roleId);
  return createRole(tenant, {
    name,
    description: `Based on ${source.name}`,
    // Wildcards are expanded on copy: a custom role should be an explicit,
    // reviewable list, and must not silently widen when a new module ships.
    permissions: expandPermissions(source.permissions),
  });
}
