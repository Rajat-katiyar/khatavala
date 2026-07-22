/**
 * Phase 4 migration: give every existing company its system roles, and point
 * every existing membership at one.
 *
 * Phase 3 stored authority as a plain string on UserCompanyRole. Phase 4 makes
 * `roleId` required, so rows written before this migration would fail
 * validation on their next save and — more importantly — resolve to *no
 * permissions at all*, silently locking out every existing user.
 *
 *   npm run db:seed-roles
 *
 * Safe to re-run: role seeding skips names that exist, and the backfill only
 * touches memberships whose `roleId` is missing.
 */
import mongoose from 'mongoose';
import { env } from '../config/env.js';
import { logger } from '../config/logger.js';
import { CompanyModel } from '../models/Company.js';
import { RoleModel } from '../models/Role.js';
import { UserCompanyRoleModel } from '../models/UserCompanyRole.js';
import { seedSystemRoles } from '../services/role.service.js';

async function seedRoles() {
  await mongoose.connect(env.MONGO_URI);
  logger.info(`Seeding roles in '${mongoose.connection.db!.databaseName}'`);

  const companies = await CompanyModel.find().select('_id name').lean();
  logger.info(`${companies.length} company/companies found`);

  let backfilled = 0;
  let orphaned = 0;

  for (const company of companies) {
    const roles = await seedSystemRoles(company._id);

    // `roleId: null` covers rows written before the field existed; `$exists`
    // covers rows where Mongoose never set it at all.
    const memberships = await UserCompanyRoleModel.find({
      companyId: company._id,
      $or: [{ roleId: null }, { roleId: { $exists: false } }],
    });

    for (const membership of memberships) {
      // The Phase 3 string is a system role name by construction — the enum
      // allowed nothing else — so it maps directly.
      const role = roles.get(membership.role);

      if (!role) {
        // Should not happen, but a membership naming a role we cannot resolve
        // must be surfaced, not quietly defaulted to something permissive.
        logger.warn(
          `  Company ${company.name}: membership ${String(membership._id)} names unknown role '${membership.role}' — left unmapped, assign it manually`
        );
        orphaned += 1;
        continue;
      }

      await UserCompanyRoleModel.updateOne(
        { _id: membership._id },
        { $set: { roleId: role._id, role: role.name } }
      );
      backfilled += 1;
    }
  }

  const totalRoles = await RoleModel.countDocuments();
  logger.info(
    `Done: ${totalRoles} role document(s), ${backfilled} membership(s) backfilled, ${orphaned} unmapped`
  );

  if (orphaned > 0) {
    logger.warn(
      'Unmapped memberships hold NO permissions until a role is assigned to them.'
    );
  }

  await mongoose.disconnect();
}

seedRoles().catch(async (err) => {
  logger.error(`Role seeding failed: ${(err as Error).message}`);
  await mongoose.disconnect().catch(() => undefined);
  process.exit(1);
});
