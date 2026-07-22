import { Router } from 'express';
import { authenticate } from '../middlewares/auth.js';
import { requireTenant, resolveTenant } from '../middlewares/tenantScope.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { SubscriptionPlanModel } from '../models/SubscriptionPlan.js';
import * as subService from '../services/subscription.service.js';

const router = Router();

router.get(
  '/plans',
  asyncHandler(async (_req, res) => {
    await subService.seedDefaultPlans();
    const plans = await SubscriptionPlanModel.find({ isActive: true }).sort({ price: 1 }).lean();
    res.json({ success: true, data: plans });
  })
);

router.use(authenticate, resolveTenant, requireTenant);

router.get(
  '/current',
  asyncHandler(async (req, res) => {
    const details = await subService.getSubscriptionDetails(req.tenant!);
    res.json({ success: true, data: details });
  })
);

router.post(
  '/create-order',
  asyncHandler(async (req, res) => {
    const { planId } = req.body;
    const orderData = await subService.createRazorpayOrder(req.tenant!, planId);
    res.json({ success: true, data: orderData });
  })
);

router.post(
  '/verify',
  asyncHandler(async (req, res) => {
    const { planId, razorpayOrderId, razorpayPaymentId, razorpaySignature } = req.body;
    const subscription = await subService.verifyAndUpgradeSubscription(req.tenant!, {
      planId,
      razorpayOrderId,
      razorpayPaymentId,
      razorpaySignature,
    });
    res.json({ success: true, data: subscription });
  })
);

export default router;
