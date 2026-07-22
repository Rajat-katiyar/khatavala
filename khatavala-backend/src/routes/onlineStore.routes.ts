import { Router } from 'express';
import { authenticate } from '../middlewares/auth.js';
import { requireTenant, resolveTenant } from '../middlewares/tenantScope.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import * as onlineStoreService from '../services/onlineStore.service.js';

const router = Router();

/* ── PUBLIC routes (no auth) — /api/store/:storeSlug ───────────────────── */

const publicRouter = Router({ mergeParams: true });

publicRouter.get(
  '/:storeSlug',
  asyncHandler(async (req, res) => {
    const store = await onlineStoreService.getPublicStoreBySlug(req.params.storeSlug);
    res.json({ success: true, data: store });
  })
);

publicRouter.get(
  '/:storeSlug/products',
  asyncHandler(async (req, res) => {
    const { search } = req.query as Record<string, string>;
    const result = await onlineStoreService.listPublicProducts(req.params.storeSlug, search);
    res.json({ success: true, data: result });
  })
);

publicRouter.post(
  '/:storeSlug/checkout',
  asyncHandler(async (req, res) => {
    const result = await onlineStoreService.publicCheckout(req.params.storeSlug, req.body);
    res.status(201).json({ success: true, data: result });
  })
);

/* ── PRIVATE routes (auth required) — /api/online-store ────────────────── */

router.use(authenticate, resolveTenant, requireTenant);

router.get(
  '/',
  asyncHandler(async (req, res) => {
    const store = await onlineStoreService.getOrCreateStore(req.tenant!);
    res.json({ success: true, data: store });
  })
);

router.put(
  '/',
  asyncHandler(async (req, res) => {
    const store = await onlineStoreService.updateStore(req.tenant!, req.body);
    res.json({ success: true, data: store });
  })
);

export { publicRouter as onlineStorePublicRouter };
export default router;
