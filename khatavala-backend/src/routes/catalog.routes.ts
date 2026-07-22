import { Router } from 'express';
import { asyncHandler } from '../utils/asyncHandler.js';
import { validate } from '../middlewares/validate.js';
import { authenticate } from '../middlewares/auth.js';
import { requireTenant, resolveTenant } from '../middlewares/tenantScope.js';
import { requirePermission } from '../services/permission.service.js';
import { recordAudit } from '../services/audit.service.js';
import * as catalog from '../services/catalog.service.js';
import {
  brandSchema,
  categorySchema,
  unitSchema,
} from '../validators/product.validators.js';
import type { AnyZodObject } from 'zod';

/**
 * Categories, brands and units — the product masters.
 *
 * Gated on the `products` module rather than a module of their own: these
 * exist only to classify products, and a role that can edit the catalog but
 * not its categories could not create a product at all.
 *
 * One router factory, mounted three times, for the same reason the service is
 * one implementation: three copies of this file would drift.
 */
function masterRouter(
  kind: catalog.MasterKind,
  schema: AnyZodObject,
  entityName: string
): Router {
  const router = Router();
  router.use(authenticate, resolveTenant, requireTenant);

  router.get(
    '/',
    requirePermission('products', 'view'),
    asyncHandler(async (req, res) => {
      // `?withUsage=true` adds the product count per row, which the settings
      // page needs to explain why a delete will deactivate rather than remove.
      const items =
        req.query.withUsage === 'true'
          ? await catalog.listWithUsage(req.tenant!, kind)
          : await catalog.list(req.tenant!, kind, {
              search: typeof req.query.search === 'string' ? req.query.search : undefined,
              isActive:
                req.query.isActive === undefined ? undefined : req.query.isActive === 'true',
            });
      res.json({ success: true, data: { items } });
    })
  );

  router.post(
    '/',
    requirePermission('products', 'create'),
    validate(schema),
    asyncHandler(async (req, res) => {
      const item = await catalog.create(req.tenant!, kind, req.body);
      await recordAudit(req.tenant!, {
        action: 'create',
        entityName,
        entityId: String(item._id),
        newValue: item,
      });
      res.status(201).json({ success: true, data: { item } });
    })
  );

  router.get(
    '/:id',
    requirePermission('products', 'view'),
    asyncHandler(async (req, res) => {
      res.json({
        success: true,
        data: { item: await catalog.getOne(req.tenant!, kind, req.params.id) },
      });
    })
  );

  router.patch(
    '/:id',
    requirePermission('products', 'update'),
    validate(schema.partial()),
    asyncHandler(async (req, res) => {
      const before = await catalog.getOne(req.tenant!, kind, req.params.id);
      const item = await catalog.update(req.tenant!, kind, req.params.id, req.body);
      await recordAudit(req.tenant!, {
        action: 'update',
        entityName,
        entityId: req.params.id,
        oldValue: before,
        newValue: item,
      });
      res.json({ success: true, data: { item } });
    })
  );

  router.delete(
    '/:id',
    requirePermission('products', 'delete'),
    asyncHandler(async (req, res) => {
      const before = await catalog.getOne(req.tenant!, kind, req.params.id);
      const result = await catalog.remove(req.tenant!, kind, req.params.id);
      await recordAudit(req.tenant!, {
        action: result.deleted ? 'delete' : 'update',
        entityName,
        entityId: req.params.id,
        oldValue: before,
      });
      res.json({ success: true, data: result });
    })
  );

  return router;
}

export const categoryRoutes = masterRouter('category', categorySchema, 'Category');
export const brandRoutes = masterRouter('brand', brandSchema, 'Brand');

export const unitRoutes = (() => {
  const router = masterRouter('unit', unitSchema, 'Unit');

  // Seeding is unit-only: a company with no units cannot create its first
  // product at all, whereas categories and brands are genuinely optional.
  router.post(
    '/seed-defaults',
    authenticate,
    resolveTenant,
    requireTenant,
    requirePermission('products', 'create'),
    asyncHandler(async (req, res) => {
      const created = await catalog.seedDefaultUnits(req.tenant!);
      res.json({ success: true, data: { created: created.length } });
    })
  );

  return router;
})();
