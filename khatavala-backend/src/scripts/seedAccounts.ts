/**
 * Seeds the default chart of accounts for every company that lacks one.
 *
 *   npm run db:seed-accounts
 *
 * Safe to re-run: `ensureDefaultAccounts` upserts by system key, so an existing
 * chart is left alone and only missing accounts are created. Renamed accounts
 * keep their names — the lookup is by `systemKey`, not by name.
 *
 * Running this is OPTIONAL. The posting service seeds lazily inside whatever
 * transaction first needs an account, so a company that has never run this
 * still gets correct books the moment it raises an invoice. The script exists
 * so an operator can populate the chart up front and let users rename and
 * extend it before any trading happens.
 */
import mongoose from 'mongoose';
import { Types } from 'mongoose';
import { env } from '../config/env.js';
import { logger } from '../config/logger.js';
import { CompanyModel } from '../models/Company.js';
import { AccountModel } from '../models/Account.js';
import { ensureDefaultAccounts } from '../services/account.service.js';
import type { TenantContext } from '../middlewares/tenantScope.js';

async function seed() {
  await mongoose.connect(env.MONGO_URI);
  logger.info(`Seeding chart of accounts in '${mongoose.connection.db!.databaseName}'`);

  const companies = await CompanyModel.find().select('name').lean();
  if (companies.length === 0) {
    logger.warn('No companies found — nothing to seed.');
  }

  for (const company of companies) {
    const before = await AccountModel.countDocuments({ companyId: company._id });

    // The seeder acts for the company itself, not a user; `actor` is omitted
    // deliberately so nothing attributes these rows to a person who did not
    // create them.
    const tenant: TenantContext = {
      companyId: company._id as Types.ObjectId,
      role: 'Owner',
      roleId: null,
      branchId: null,
      warehouseId: null,
    };

    await ensureDefaultAccounts(tenant);

    const after = await AccountModel.countDocuments({ companyId: company._id });
    logger.info(
      `  ${company.name}: ${after - before} account(s) created, ${after} total`
    );
  }

  logger.info('Chart of accounts ready');
  await mongoose.disconnect();
}

seed().catch(async (err) => {
  logger.error(`Account seeding failed: ${(err as Error).message}`);
  await mongoose.disconnect().catch(() => undefined);
  process.exit(1);
});
