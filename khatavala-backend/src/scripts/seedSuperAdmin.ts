import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';
import { env } from '../config/env.js';
import { logger } from '../config/logger.js';
import { UserModel } from '../models/User.js';

async function seedSuperAdmin() {
  await mongoose.connect(env.MONGO_URI);
  logger.info('Connected to database to seed SuperAdmin account...');

  const superAdminEmail = 'admin@khatavala.com';
  const superAdminPassword = 'Admin@123456';

  let user = await UserModel.findOne({ email: superAdminEmail }).select('+passwordHash');
  const passwordHash = await bcrypt.hash(superAdminPassword, 10);

  if (!user) {
    user = await UserModel.create({
      email: superAdminEmail,
      passwordHash,
      fullName: 'System SuperAdmin',
      role: 'SuperAdmin',
      isActive: true,
    });
    logger.info(`SuperAdmin created: ${superAdminEmail} / ${superAdminPassword}`);
  } else {
    user.role = 'SuperAdmin';
    user.passwordHash = passwordHash;
    await user.save();
    logger.info(`SuperAdmin updated: ${superAdminEmail} / ${superAdminPassword}`);
  }

  await mongoose.disconnect();
  console.log('\n==========================================');
  console.log(' SUPERADMIN ACCOUNT DETAILS:');
  console.log(` Email:    ${superAdminEmail}`);
  console.log(` Password: ${superAdminPassword}`);
  console.log(' Role:     SuperAdmin');
  console.log('==========================================\n');
}

seedSuperAdmin().catch(async (err) => {
  logger.error('Failed to seed SuperAdmin:', err);
  await mongoose.disconnect().catch(() => undefined);
  process.exit(1);
});
