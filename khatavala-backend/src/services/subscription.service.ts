import crypto from 'crypto';
import { Types } from 'mongoose';
import { SubscriptionPlanModel, type ISubscriptionPlan } from '../models/SubscriptionPlan.js';
import { CompanySubscriptionModel } from '../models/CompanySubscription.js';
import { SalesInvoiceModel } from '../models/SalesInvoice.js';
import { UserCompanyRoleModel } from '../models/UserCompanyRole.js';
import { WarehouseModel } from '../models/Warehouse.js';
import { tenantFilter, type TenantContext } from '../middlewares/tenantScope.js';
import { ApiError } from '../utils/ApiError.js';

const DEFAULT_PLANS = [
  {
    name: 'Trial',
    price: 0,
    billingCycle: 'Monthly',
    maxUsers: 3,
    maxInvoicesPerMonth: 50,
    maxWarehouses: 1,
    featureFlags: { posTerminal: true, multiWarehouse: false, customTemplates: false, apiAccess: false },
  },
  {
    name: 'Basic',
    price: 999,
    billingCycle: 'Monthly',
    maxUsers: 5,
    maxInvoicesPerMonth: 250,
    maxWarehouses: 2,
    featureFlags: { posTerminal: true, multiWarehouse: true, customTemplates: false, apiAccess: false },
  },
  {
    name: 'Pro',
    price: 2499,
    billingCycle: 'Monthly',
    maxUsers: 15,
    maxInvoicesPerMonth: 1000,
    maxWarehouses: 5,
    featureFlags: { posTerminal: true, multiWarehouse: true, customTemplates: true, apiAccess: false },
  },
  {
    name: 'Enterprise',
    price: 5999,
    billingCycle: 'Monthly',
    maxUsers: 999,
    maxInvoicesPerMonth: 999999,
    maxWarehouses: 99,
    featureFlags: { posTerminal: true, multiWarehouse: true, customTemplates: true, apiAccess: true },
  },
];

/**
 * Ensures default plans exist in DB.
 */
export async function seedDefaultPlans() {
  for (const plan of DEFAULT_PLANS) {
    await SubscriptionPlanModel.findOneAndUpdate(
      { name: plan.name },
      { $setOnInsert: plan },
      { upsert: true, new: true }
    );
  }
}

/**
 * Retrieves current active subscription & usage metrics for tenant.
 */
export async function getSubscriptionDetails(tenant: TenantContext) {
  await seedDefaultPlans();

  let sub = await CompanySubscriptionModel.findOne({ companyId: tenant.companyId })
    .populate<{ planId: ISubscriptionPlan }>('planId')
    .lean();

  if (!sub) {
    const trialPlan = await SubscriptionPlanModel.findOne({ name: 'Trial' });
    if (!trialPlan) throw new ApiError(500, 'Trial plan missing');

    const now = new Date();
    const endDate = new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000); // 14-day trial

    const created = await CompanySubscriptionModel.create({
      companyId: tenant.companyId,
      planId: trialPlan._id,
      startDate: now,
      endDate,
      status: 'Trial',
    });

    sub = await CompanySubscriptionModel.findById(created._id)
      .populate<{ planId: ISubscriptionPlan }>('planId')
      .lean();
  }

  const plan = sub?.planId as unknown as ISubscriptionPlan;

  // Calculate current month invoice count
  const startOfMonth = new Date();
  startOfMonth.setDate(1);
  startOfMonth.setHours(0, 0, 0, 0);

  const invoiceCount = await SalesInvoiceModel.countDocuments(
    tenantFilter(tenant, { createdAt: { $gte: startOfMonth } })
  );

  const userCount = await UserCompanyRoleModel.countDocuments({ companyId: tenant.companyId });
  const warehouseCount = await WarehouseModel.countDocuments(tenantFilter(tenant, {}));

  const now = new Date();
  const isExpired = sub ? new Date(sub.endDate) < now : false;

  return {
    subscription: sub,
    plan,
    status: isExpired ? 'Expired' : sub?.status,
    usage: {
      invoicesThisMonth: invoiceCount,
      maxInvoices: plan.maxInvoicesPerMonth,
      usersCount: userCount,
      maxUsers: plan.maxUsers,
      warehousesCount: warehouseCount,
      maxWarehouses: plan.maxWarehouses,
    },
  };
}

/**
 * Creates Razorpay Order for Plan Upgrade.
 */
export async function createRazorpayOrder(tenant: TenantContext, planId: string) {
  const plan = await SubscriptionPlanModel.findById(planId);
  if (!plan) throw new ApiError(404, 'Subscription plan not found');

  const amountInPaise = plan.price * 100;
  const mockOrderId = `order_${crypto.randomBytes(8).toString('hex')}`;

  // Store pending order reference
  await CompanySubscriptionModel.findOneAndUpdate(
    { companyId: tenant.companyId },
    { $set: { razorpayOrderId: mockOrderId } }
  );

  return {
    orderId: mockOrderId,
    amount: amountInPaise,
    currency: 'INR',
    planName: plan.name,
    key: process.env.RAZORPAY_KEY_ID || 'rzp_test_khatavala_mock',
  };
}

/**
 * Verifies Razorpay payment & upgrades Company Subscription.
 */
export async function verifyAndUpgradeSubscription(
  tenant: TenantContext,
  params: { planId: string; razorpayOrderId?: string; razorpayPaymentId?: string; razorpaySignature?: string }
) {
  const plan = await SubscriptionPlanModel.findById(params.planId);
  if (!plan) throw new ApiError(404, 'Subscription plan not found');

  const now = new Date();
  const endDate = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000); // 30 days active

  const updated = await CompanySubscriptionModel.findOneAndUpdate(
    { companyId: tenant.companyId },
    {
      $set: {
        planId: plan._id,
        startDate: now,
        endDate,
        status: 'Active',
        paymentReference: params.razorpayPaymentId || `pay_mock_${crypto.randomBytes(6).toString('hex')}`,
        razorpayOrderId: params.razorpayOrderId,
        razorpayPaymentId: params.razorpayPaymentId,
      },
    },
    { new: true, upsert: true }
  ).populate('planId');

  return updated;
}
