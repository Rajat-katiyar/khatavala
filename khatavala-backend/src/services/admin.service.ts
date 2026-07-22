import { CompanyModel } from '../models/Company.js';
import { CompanySubscriptionModel } from '../models/CompanySubscription.js';
import { SubscriptionPlanModel, type ISubscriptionPlan } from '../models/SubscriptionPlan.js';
import { UserModel } from '../models/User.js';
import { UserCompanyRoleModel } from '../models/UserCompanyRole.js';
import { SalesInvoiceModel } from '../models/SalesInvoice.js';
import { ApiError } from '../utils/ApiError.js';

/**
 * Calculates platform-wide SuperAdmin metrics.
 */
export async function getPlatformMetrics() {
  const totalCompanies = await CompanyModel.countDocuments();

  const activeSubscriptions = await CompanySubscriptionModel.find({ status: 'Active' })
    .populate<{ planId: ISubscriptionPlan }>('planId')
    .lean();

  const mrr = activeSubscriptions.reduce((sum, sub) => {
    const plan = sub.planId as unknown as ISubscriptionPlan;
    return sum + (plan?.price || 0);
  }, 0);

  const startOfMonth = new Date();
  startOfMonth.setDate(1);
  startOfMonth.setHours(0, 0, 0, 0);

  const totalInvoicesThisMonth = await SalesInvoiceModel.countDocuments({
    createdAt: { $gte: startOfMonth },
  });

  return {
    totalTenants: totalCompanies,
    activeSubscriptions: activeSubscriptions.length,
    monthlyRecurringRevenue: mrr,
    invoicesThisMonth: totalInvoicesThisMonth,
  };
}

/**
 * Lists all companies with owner info and subscription details.
 */
export async function listAllCompanies() {
  const companies = await CompanyModel.find().sort({ createdAt: -1 }).lean();

  const results = await Promise.all(
    companies.map(async (comp) => {
      const owner = await UserModel.findById(comp.ownerId).select('fullName email').lean();

      let sub = await CompanySubscriptionModel.findOne({ companyId: comp._id })
        .populate<{ planId: ISubscriptionPlan }>('planId')
        .lean();

      const userCount = await UserCompanyRoleModel.countDocuments({ companyId: comp._id });
      const invoiceCount = await SalesInvoiceModel.countDocuments({ companyId: comp._id });

      const plan = sub?.planId as unknown as ISubscriptionPlan;

      return {
        id: String(comp._id),
        name: comp.name,
        gstNumber: comp.gstNumber || '—',
        isActive: comp.isActive,
        createdAt: comp.createdAt,
        owner: owner ? { name: owner.fullName, email: owner.email } : { name: 'Owner', email: 'N/A' },
        subscription: {
          planName: plan?.name || 'Trial',
          status: sub?.status || 'Trial',
          endDate: sub?.endDate || comp.createdAt,
        },
        usage: {
          users: userCount,
          invoices: invoiceCount,
        },
      };
    })
  );

  return results;
}

/**
 * Manually extends a company's subscription.
 */
export async function extendSubscription(companyId: string, daysToAdd: number = 30) {
  const comp = await CompanyModel.findById(companyId);
  if (!comp) throw new ApiError(404, 'Company not found');

  const sub = await CompanySubscriptionModel.findOne({ companyId });
  const currentEnd = sub?.endDate ? new Date(sub.endDate) : new Date();
  const baseDate = currentEnd > new Date() ? currentEnd : new Date();
  const newEndDate = new Date(baseDate.getTime() + daysToAdd * 24 * 60 * 60 * 1000);

  const updated = await CompanySubscriptionModel.findOneAndUpdate(
    { companyId },
    {
      $set: {
        endDate: newEndDate,
        status: 'Active',
      },
    },
    { new: true, upsert: true }
  ).populate('planId');

  return updated;
}

/**
 * Toggles tenant company active/suspended status.
 */
export async function toggleCompanyStatus(companyId: string) {
  const comp = await CompanyModel.findById(companyId);
  if (!comp) throw new ApiError(404, 'Company not found');

  comp.isActive = !comp.isActive;
  await comp.save();

  return { id: String(comp._id), name: comp.name, isActive: comp.isActive };
}
