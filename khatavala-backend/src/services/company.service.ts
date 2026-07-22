import mongoose, { Types } from 'mongoose';
import { CompanyModel, type CompanyDocument } from '../models/Company.js';
import { UserCompanyRoleModel } from '../models/UserCompanyRole.js';
import { UserModel, type Role, type UserDocument } from '../models/User.js';
import { RoleModel } from '../models/Role.js';
import { ownerRoleFor } from './role.service.js';
import { assertPermission } from './permission.service.js';
import { ApiError } from '../utils/ApiError.js';
import { logger } from '../config/logger.js';
import { signAccessToken, type TenantClaims } from './token.service.js';
import type { TenantContext } from '../middlewares/tenantScope.js';
import type {
  CreateCompanyInput,
  UpdateCompanyInput,
} from '../validators/company.validators.js';

// NOTE ON SCOPING: Company and UserCompanyRole are the tenancy *registry*, not
// tenant-scoped collections themselves — a user must be able to read across
// companies here in order to pick one. So these queries scope by `userId`
// (via the membership join) rather than by `tenantFilter`. Every other
// collection uses `tenantFilter`. See docs/TENANCY.md.

export interface CompanySummary {
  company: Record<string, unknown>;
  role: Role;
  branchId: string | null;
  warehouseId: string | null;
}

/**
 * Creates a company and makes the creator its Owner. Both writes happen in a
 * transaction: a company with no membership row would be invisible to every
 * user, including the person who just created it.
 *
 * Falls back to a non-transactional path on standalone MongoDB, which has no
 * replica set and therefore no transaction support.
 */
export async function createCompany(
  userId: string,
  input: CreateCompanyInput
): Promise<CompanySummary> {
  if (input.gstNumber) {
    const clash = await CompanyModel.findOne({ gstNumber: input.gstNumber }).lean();
    if (clash) throw ApiError.badRequest('A company with that GSTIN already exists');
  }

  const ownerId = new Types.ObjectId(userId);
  let company: CompanyDocument;

  const session = await mongoose.startSession().catch(() => null);
  if (session) {
    try {
      await session.withTransaction(async () => {
        const [created] = await CompanyModel.create([{ ...input, ownerId }], { session });
        company = created;
        // Seed the company's roles inside the same transaction: a company whose
        // Owner role failed to write would have a membership pointing at a role
        // that does not exist, and therefore an owner with zero permissions.
        const ownerRole = await ownerRoleFor(created._id, session);
        await UserCompanyRoleModel.create(
          [
            {
              userId: ownerId,
              companyId: created._id,
              roleId: ownerRole._id,
              role: ownerRole.name,
            },
          ],
          { session }
        );
      });
    } catch (err) {
      // Standalone mongod rejects transactions outright; retry without one.
      if (!isTransactionUnsupported(err)) throw err;
      company = await createCompanyUnsafely(ownerId, input);
    } finally {
      await session.endSession();
    }
  } else {
    company = await createCompanyUnsafely(ownerId, input);
  }

  logger.info(`Company created: ${company!.name} (${company!._id}) by ${userId}`);
  return {
    company: company!.toJSON(),
    role: 'Owner',
    branchId: null,
    warehouseId: null,
  };
}

const isTransactionUnsupported = (err: unknown) =>
  err instanceof Error &&
  /transaction|replica set|Illegal state/i.test(err.message);

async function createCompanyUnsafely(
  ownerId: Types.ObjectId,
  input: CreateCompanyInput
): Promise<CompanyDocument> {
  const company = await CompanyModel.create({ ...input, ownerId });
  try {
    const ownerRole = await ownerRoleFor(company._id);
    await UserCompanyRoleModel.create({
      userId: ownerId,
      companyId: company._id,
      roleId: ownerRole._id,
      role: ownerRole.name,
    });
  } catch (err) {
    // Without a transaction, roll back by hand so we never leave an orphaned
    // company that nobody can reach. Seeded roles go too — otherwise a retry
    // with the same name would collide on the (companyId, name) index.
    await RoleModel.deleteMany({ companyId: company._id });
    await CompanyModel.deleteOne({ _id: company._id });
    throw err;
  }
  return company;
}

/** Every company the user is a member of, with their role in each. */
export async function listCompaniesForUser(userId: string): Promise<CompanySummary[]> {
  const memberships = await UserCompanyRoleModel.find({ userId, isActive: true })
    .populate<{ companyId: CompanyDocument }>('companyId')
    .lean();

  return memberships
    .filter((m) => m.companyId && m.companyId.isActive)
    .map((m) => ({
      company: { ...m.companyId, _id: String(m.companyId._id) },
      role: m.role as Role,
      branchId: m.branchId ? String(m.branchId) : null,
      warehouseId: m.warehouseId ? String(m.warehouseId) : null,
    }));
}

/**
 * Looks up the caller's membership in a company. This is the single
 * authorization gate for company-registry reads — a company id alone is never
 * enough to read a company.
 */
export async function requireMembership(userId: string, companyId: string) {
  if (!Types.ObjectId.isValid(companyId)) {
    throw ApiError.badRequest('Invalid company id');
  }
  const membership = await UserCompanyRoleModel.findOne({
    userId,
    companyId,
    isActive: true,
  }).lean();

  // Identical error whether the company is missing or merely not ours, so the
  // endpoint cannot be used to probe which company ids exist.
  if (!membership) throw new ApiError(403, 'No access to that company', 'FORBIDDEN');
  return membership;
}

export async function getCompany(userId: string, companyId: string) {
  const membership = await requireMembership(userId, companyId);
  const company = await CompanyModel.findOne({ _id: companyId, isActive: true });
  if (!company) throw ApiError.notFound('Company not found');

  return {
    company: company.toJSON(),
    role: membership.role as Role,
    branchId: membership.branchId ? String(membership.branchId) : null,
    warehouseId: membership.warehouseId ? String(membership.warehouseId) : null,
  };
}

/**
 * Updates the active company's profile. Takes the resolved TenantContext, so
 * the row being edited is always the active tenant — a caller cannot pass a
 * different company id in the path and edit someone else's profile.
 *
 * Phase 4: the guard here used to be a hard-coded role-name list
 * (`['SuperAdmin', 'Owner', 'Manager']`). It is now the `settings.update`
 * permission, so a company that builds a custom "Office Admin" role can grant
 * profile editing without handing over the whole Manager role — which is the
 * entire point of granular permissions.
 */
export async function updateCompany(tenant: TenantContext, input: UpdateCompanyInput) {
  await assertPermission(
    tenant.actor ? { id: tenant.actor.userId } : undefined,
    tenant,
    'settings',
    'update'
  );

  if (input.gstNumber) {
    const clash = await CompanyModel.findOne({
      gstNumber: input.gstNumber,
      _id: { $ne: tenant.companyId },
    }).lean();
    if (clash) throw ApiError.badRequest('A company with that GSTIN already exists');
  }

  // Filtered by the tenant's own id — never by a client-supplied one.
  const company = await CompanyModel.findOneAndUpdate(
    { _id: tenant.companyId, isActive: true },
    { $set: input },
    { new: true, runValidators: true }
  );
  if (!company) throw ApiError.notFound('Company not found');

  return { company: company.toJSON(), role: tenant.role };
}

/**
 * Switches the active company: verifies membership, remembers the choice, and
 * mints a fresh short-lived access token carrying the new companyId claim.
 * The refresh token is untouched — this is a scope change, not a new session.
 */
export async function setActiveCompany(userId: string, companyId: string) {
  const membership = await requireMembership(userId, companyId);

  const company = await CompanyModel.findOne({ _id: companyId, isActive: true });
  if (!company) throw ApiError.notFound('Company not found');

  const user = (await UserModel.findById(userId)) as UserDocument | null;
  if (!user || !user.isActive) throw ApiError.unauthorized('Account unavailable');

  user.set('activeCompanyId', company._id);
  await user.save();

  const claims: TenantClaims = {
    companyId: String(company._id),
    companyRole: membership.role,
    branchId: membership.branchId ? String(membership.branchId) : null,
    warehouseId: membership.warehouseId ? String(membership.warehouseId) : null,
  };

  logger.info(`Active company set to ${company.name} for user ${userId}`);
  return {
    accessToken: signAccessToken(user, claims),
    company: company.toJSON(),
    role: membership.role as Role,
    branchId: claims.branchId,
    warehouseId: claims.warehouseId,
  };
}

/**
 * Re-derives tenant claims for a user during token refresh. Membership is
 * re-checked here rather than trusted from `activeCompanyId`, so revoking
 * someone's membership takes effect on their next refresh.
 */
export async function tenantClaimsForUser(
  user: UserDocument
): Promise<TenantClaims | undefined> {
  const activeCompanyId = user.get('activeCompanyId');
  if (!activeCompanyId) return undefined;

  const membership = await UserCompanyRoleModel.findOne({
    userId: user._id,
    companyId: activeCompanyId,
    isActive: true,
  }).lean();
  if (!membership) return undefined;

  return {
    companyId: String(activeCompanyId),
    companyRole: membership.role,
    branchId: membership.branchId ? String(membership.branchId) : null,
    warehouseId: membership.warehouseId ? String(membership.warehouseId) : null,
  };
}
