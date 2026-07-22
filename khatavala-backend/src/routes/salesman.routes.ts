import { Router } from 'express';
import { authenticate } from '../middlewares/auth.js';
import { requireTenant, resolveTenant } from '../middlewares/tenantScope.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import * as salesmanService from '../services/salesman.service.js';

const router = Router();

router.use(authenticate, resolveTenant, requireTenant);

router.post(
  '/location-ping',
  asyncHandler(async (req, res) => {
    const { latitude, longitude, batteryLevel } = req.body;
    const userId = (req as any).user._id;

    const payload = await salesmanService.recordLocationPing(
      req.tenant!,
      userId,
      Number(latitude || 28.6139),
      Number(longitude || 77.209),
      Number(batteryLevel || 90)
    );

    res.json({ success: true, data: payload });
  })
);

router.get(
  '/live-locations',
  asyncHandler(async (req, res) => {
    const locations = await salesmanService.getLiveLocations(req.tenant!);
    res.json({ success: true, data: locations });
  })
);

export default router;
