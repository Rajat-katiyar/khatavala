import crypto from 'node:crypto';
import { Types } from 'mongoose';
import { env } from '../config/env.js';
import { InviteModel } from '../models/Invite.js';
import { RoleModel } from '../models/Role.js';
import { UserCompanyRoleModel } from '../models/UserCompanyRole.js';
import { UserModel, hashPassword, type UserDocument } from '../models/User.js';
import { CompanyModel } from '../models/Company.js';
import { ApiError } from '../utils/ApiError.js';
import { logger } from '../config/logger.js';
import { tenantFilter } from '../middlewares/tenantScope.js';
import type { TenantContext } from '../middlewares/tenantScope.js';
import { sendInviteEmail } from './mail.service.js';
import { sha256 } from './token.service.js';
import { invalidateMembership } from './permission.service.js';
import { recordAudit, withAudit, type AuditTenant } from './audit.service.js';

/**
 * Company user management. Note the scoping rule differs from product.service:
 * User is a *global* collection (one account, many companies), so the tenant
 * boundary here is the UserCompanyRole join, not a companyId on User. Every
 * query below therefore filters memberships by company and only then reaches
 * through to the user document.
 */

const INVITE_TTL_HOURS = 72;

/** Loads a role and proves it belongs to the active company. */
async function requireCompanyRoleDoc(tenant: TenantContext, roleId: string) {
  if (!Types.ObjectId.isValid(roleId)) throw ApiError.badRequest('Invalid role id');
  // tenantFilter is what stops a caller from assigning one of *another*
  // company's roles — including an Owner role — to a user in theirs.
  const role = await RoleModel.findOne(tenantFilter(tenant, { _id: roleId })).lean();
  if (!role) throw ApiError.notFound('Role not found in this company');
  return role;
}

/**
 * Guards the last-Owner invariant. A company whose final Owner is demoted or
 * revoked can never be administered again — no one left holds `users.*` or
 * `roles.*`, and there is no platform-level "make me an owner" path.
 */
async function assertNotLastOwner(tenant: TenantContext, membershipUserId: string) {
  const ownerRole = await RoleModel.findOne(
    tenantFilter(tenant, { name: 'Owner', isSystem: true })
  ).lean();
  if (!ownerRole) return;

  const isOwner = await UserCompanyRoleModel.exists({
    companyId: tenant.companyId,
    userId: membershipUserId,
    roleId: ownerRole._id,
    isActive: true,
  });
  if (!isOwner) return;

  const owners = await UserCompanyRoleModel.countDocuments({
    companyId: tenant.companyId,
    roleId: ownerRole._id,
    isActive: true,
  });
  if (owners <= 1) {
    throw ApiError.badRequest(
      'This is the last Owner of the company. Promote someone else to Owner first.'
    );
  }
}

export interface InviteInput {
  email: string;
  roleId: string;
}

/**
 * Creates a pending invite and emails a signup link.
 *
 * The invite is stored, and only its SHA-256 hash kept, before the mail is
 * sent — if SMTP fails the invite still exists and can be resent, rather than
 * the admin believing they invited someone they did not.
 */
export async function inviteUser(tenant: AuditTenant, input: InviteInput) {
  const email = input.email.toLowerCase().trim();
  const role = await requireCompanyRoleDoc(tenant, input.roleId);

  // Already a member? Nothing to invite — say so plainly. This is not account
  // enumeration: the caller can already list every member of their company.
  const existingUser = await UserModel.findOne({ email }).lean();
  if (existingUser) {
    const membership = await UserCompanyRoleModel.findOne({
      userId: existingUser._id,
      companyId: tenant.companyId,
      isActive: true,
    }).lean();
    if (membership) {
      throw ApiError.badRequest('That person is already a member of this company');
    }
  }

  // Re-inviting replaces the outstanding invite rather than adding a second
  // working link; the partial unique index enforces this too.
  await InviteModel.updateMany(
    { companyId: tenant.companyId, email, status: 'pending' },
    { $set: { status: 'revoked' } }
  );

  const rawToken = crypto.randomBytes(32).toString('hex');
  const company = await CompanyModel.findById(tenant.companyId).lean();

  const invite = await InviteModel.create({
    companyId: tenant.companyId,
    email,
    roleId: role._id,
    roleName: role.name,
    tokenHash: sha256(rawToken),
    expiresAt: new Date(Date.now() + INVITE_TTL_HOURS * 3_600_000),
    invitedBy: tenant.actor?.userId,
    status: 'pending',
  });

  await recordAudit(tenant, {
    action: 'user.invite',
    entityName: 'Invite',
    entityId: String(invite._id),
    newValue: { email, roleName: role.name, expiresAt: invite.expiresAt },
  });

  let emailSent = true;
  let emailError: string | null = null;

  try {
    await sendInviteEmail({
      to: email,
      companyName: company?.name ?? 'a company',
      roleName: role.name,
      rawToken,
      hasAccount: Boolean(existingUser),
      expiresInHours: INVITE_TTL_HOURS,
    });
  } catch (err) {
    emailSent = false;
    emailError = err instanceof Error ? err.message : 'Failed to send invitation email';
    logger.warn(`Invite created for ${email}, but email sending failed: ${emailError}`);
  }

  return {
    _id: String(invite._id),
    email,
    roleName: role.name,
    roleId: String(role._id),
    status: invite.status,
    expiresAt: invite.expiresAt,
    emailSent,
    emailError,
    rawToken,
    inviteLink: `${env.APP_URL}/accept-invite?token=${rawToken}`,
  };
}

/** Members of the active company, plus outstanding invites, for the users table. */
export async function listCompanyUsers(tenant: TenantContext) {
  const memberships = await UserCompanyRoleModel.find({
    companyId: tenant.companyId,
  })
    .populate<{ userId: UserDocument | null }>('userId', 'fullName email phoneNumber isActive createdAt')
    .populate<{ roleId: { _id: Types.ObjectId; name: string; isSystem: boolean } | null }>(
      'roleId',
      'name isSystem'
    )
    .populate<{ roleIds: { _id: Types.ObjectId; name: string; isSystem: boolean }[] }>(
      'roleIds',
      'name isSystem'
    )
    .sort({ createdAt: 1 })
    .lean();

  const users = memberships
    .filter((m) => m.userId)
    .map((m) => {
      const activeRoles =
        m.roleIds && m.roleIds.length > 0
          ? m.roleIds
          : m.roleId
          ? [m.roleId]
          : [];

      const roleNames = activeRoles.map((r) => r.name);
      const combinedRoleName = roleNames.length > 0 ? roleNames.join(', ') : m.role;
      const primaryRoleId = activeRoles[0]?._id ? String(activeRoles[0]._id) : m.roleId ? String(m.roleId._id) : null;
      const allRoleIds = activeRoles.map((r) => String(r._id));

      return {
        membershipId: String(m._id),
        userId: String(m.userId!._id),
        fullName: m.userId!.fullName,
        email: m.userId!.email,
        phoneNumber: m.userId!.phoneNumber ?? null,
        roleId: primaryRoleId,
        roleIds: allRoleIds,
        roleName: combinedRoleName,
        roleNames: roleNames.length > 0 ? roleNames : [m.role],
        isSystemRole: activeRoles.some((r) => r.isSystem),
        isActive: m.isActive,
        accountActive: m.userId!.isActive,
        joinedAt: (m as { createdAt?: Date }).createdAt ?? null,
      };
    });

  const invites = await InviteModel.find({
    companyId: tenant.companyId,
    status: 'pending',
    expiresAt: { $gt: new Date() },
  })
    .sort({ createdAt: -1 })
    .lean();

  return {
    users,
    invites: invites.map((i) => ({
      _id: String(i._id),
      email: i.email,
      roleId: String(i.roleId),
      roleName: i.roleName,
      expiresAt: i.expiresAt,
      createdAt: (i as { createdAt?: Date }).createdAt ?? null,
    })),
  };
}

/** Changes a member's role(s). Keeps roleId, roleIds, role, and roles in step. */
export async function updateUserRole(
  tenant: AuditTenant,
  targetUserId: string,
  roleIdsInput: string | string[]
) {
  if (!Types.ObjectId.isValid(targetUserId)) {
    throw ApiError.badRequest('Invalid user id');
  }

  const idsToFetch = Array.isArray(roleIdsInput) ? roleIdsInput : [roleIdsInput];
  if (idsToFetch.length === 0) throw ApiError.badRequest('At least one role is required');

  for (const id of idsToFetch) {
    if (!Types.ObjectId.isValid(id)) throw ApiError.badRequest('Invalid role id');
  }

  const roles = await RoleModel.find(tenantFilter(tenant, { _id: { $in: idsToFetch } })).lean();
  if (roles.length === 0) throw ApiError.notFound('Role(s) not found in this company');

  const membership = await UserCompanyRoleModel.findOne({
    userId: targetUserId,
    companyId: tenant.companyId,
  });
  if (!membership) throw ApiError.notFound('That user is not a member of this company');

  // Demoting the last Owner is the same lockout as revoking them.
  const isAssigningOwner = roles.some((r) => r.name === 'Owner');
  if (!isAssigningOwner) {
    await assertNotLastOwner(tenant, targetUserId);
  }

  const combinedRoleName = roles.map((r) => r.name).join(', ');

  return withAudit(
    {
      tenant,
      action: 'update',
      entityName: 'UserCompanyRole',
      entityId: String(membership._id),
      before: async () => ({ role: membership.role, roleId: String(membership.roleId) }),
      after: () => ({
        role: combinedRoleName,
        roleId: String(roles[0]._id),
      }),
    },
    async () => {
      membership.roleId = roles[0]._id;
      membership.roleIds = roles.map((r) => r._id);
      membership.role = combinedRoleName;
      membership.roles = roles.map((r) => r.name);
      await membership.save();

      // Drop the cached membership so the new role(s) apply on this user's very next request
      invalidateMembership(targetUserId, tenant.companyId);

      logger.info(
        `Role(s) for user ${targetUserId} in company ${String(tenant.companyId)} set to ${combinedRoleName}`
      );
      return membership;
    }
  );
}

/**
 * Revokes a member's access. A soft revoke (`isActive: false`), not a delete:
 * the row is what every audit entry and historical document points at, and
 * removing it would orphan them.
 */
export async function revokeAccess(tenant: AuditTenant, targetUserId: string) {
  if (!Types.ObjectId.isValid(targetUserId)) throw ApiError.badRequest('Invalid user id');

  if (targetUserId === tenant.actor?.userId) {
    throw ApiError.badRequest('You cannot revoke your own access');
  }

  const membership = await UserCompanyRoleModel.findOne({
    userId: targetUserId,
    companyId: tenant.companyId,
    isActive: true,
  });
  if (!membership) throw ApiError.notFound('That user is not an active member');

  await assertNotLastOwner(tenant, targetUserId);

  await withAudit(
    {
      tenant,
      action: 'user.revoke',
      entityName: 'UserCompanyRole',
      entityId: String(membership._id),
      before: async () => ({ isActive: true, role: membership.role }),
      after: () => ({ isActive: false, role: membership.role }),
    },
    async () => {
      membership.isActive = false;
      await membership.save();
      invalidateMembership(targetUserId, tenant.companyId);
      return membership;
    }
  );

  // The revoked user may still hold an access token carrying this company's
  // claim, so `resolveTenant` will keep admitting them until it expires. But
  // `resolveRole` filters on `isActive: true` and its cache was just dropped,
  // so every permission-gated route now denies them immediately. The next
  // token refresh drops their tenant scope entirely.
  logger.info(
    `Access revoked for user ${targetUserId} in company ${String(tenant.companyId)}`
  );
  return { revoked: true };
}

/** Cancels an invitation that has not been accepted yet. */
export async function revokeInvite(tenant: AuditTenant, inviteId: string) {
  if (!Types.ObjectId.isValid(inviteId)) throw ApiError.badRequest('Invalid invite id');

  const invite = await InviteModel.findOneAndUpdate(
    { _id: inviteId, companyId: tenant.companyId, status: 'pending' },
    { $set: { status: 'revoked' } },
    { new: true }
  );
  if (!invite) throw ApiError.notFound('Pending invite not found');

  await recordAudit(tenant, {
    action: 'user.invite_revoked',
    entityName: 'Invite',
    entityId: inviteId,
    oldValue: { email: invite.email, status: 'pending' },
    newValue: { email: invite.email, status: 'revoked' },
  });

  return { revoked: true };
}

/**
 * Reads an invite by its raw token, for the acceptance screen. Public — the
 * token *is* the credential, so this returns only what the screen needs to
 * render (company name, role, whether an account already exists).
 */
export async function previewInvite(rawToken: string) {
  const invite = await InviteModel.findOne({
    tokenHash: sha256(rawToken),
    status: 'pending',
    expiresAt: { $gt: new Date() },
  }).lean();
  if (!invite) throw ApiError.badRequest('This invitation is invalid or has expired');

  const [company, existingUser] = await Promise.all([
    CompanyModel.findById(invite.companyId).lean(),
    UserModel.findOne({ email: invite.email }).lean(),
  ]);

  return {
    email: invite.email,
    roleName: invite.roleName,
    companyName: company?.name ?? '',
    hasAccount: Boolean(existingUser),
    expiresAt: invite.expiresAt,
  };
}

export interface AcceptInviteInput {
  token: string;
  fullName?: string;
  password?: string;
}

/**
 * Accepts an invitation: creates the account if the invitee has none, then
 * writes the membership. Public route — authorization is the token itself.
 */
export async function acceptInvite(input: AcceptInviteInput) {
  const invite = await InviteModel.findOne({
    tokenHash: sha256(input.token),
    status: 'pending',
    expiresAt: { $gt: new Date() },
  });
  if (!invite) throw ApiError.badRequest('This invitation is invalid or has expired');

  // The role could have been deleted between invite and acceptance.
  const role = await RoleModel.findOne({
    _id: invite.roleId,
    companyId: invite.companyId,
  }).lean();
  if (!role) {
    throw ApiError.badRequest('The role for this invitation no longer exists');
  }

  let user = (await UserModel.findOne({ email: invite.email })) as UserDocument | null;

  if (!user) {
    if (!input.password || !input.fullName) {
      throw ApiError.badRequest('A name and password are required to create your account');
    }
    const passwordHash = await hashPassword(input.password);
    user = (await UserModel.create({
      email: invite.email,
      passwordHash,
      fullName: input.fullName,
      // Platform-level role stays the baseline; company authority comes from
      // the membership's Role, not from User.role.
      role: 'Employee',
    })) as UserDocument;
    logger.info(`Invited user registered: ${user.email}`);
  }

  // Reactivate rather than duplicate if they were previously revoked — the
  // (userId, companyId) unique index would reject a second row anyway.
  await UserCompanyRoleModel.updateOne(
    { userId: user._id, companyId: invite.companyId },
    {
      $set: {
        roleId: role._id,
        role: role.name,
        isActive: true,
      },
    },
    { upsert: true }
  );

  // Clears any negative cache entry from a request made before acceptance.
  invalidateMembership(user._id, invite.companyId);

  invite.status = 'accepted';
  invite.acceptedAt = new Date();
  await invite.save();

  // Audited against the company the user just joined, attributed to them.
  await recordAudit(
    {
      companyId: invite.companyId,
      role: role.name,
      roleId: role._id,
      branchId: null,
      warehouseId: null,
      actor: { userId: String(user._id) },
    },
    {
      action: 'user.invite_accepted',
      entityName: 'UserCompanyRole',
      entityId: String(user._id),
      newValue: { email: user.email, roleName: role.name },
    }
  );

  logger.info(`Invite accepted: ${user.email} joined company ${String(invite.companyId)}`);

  return {
    email: user.email,
    companyId: String(invite.companyId),
    roleName: role.name,
    // The client sends them to /login; issuing a session here would mean a
    // second code path that mints tokens, which is not worth the surface.
    appUrl: env.APP_URL,
  };
}
