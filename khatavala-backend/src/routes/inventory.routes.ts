import { Router } from 'express';
import { asyncHandler } from '../utils/asyncHandler.js';
import { validate } from '../middlewares/validate.js';
import { authenticate } from '../middlewares/auth.js';
import { requireTenant, resolveTenant } from '../middlewares/tenantScope.js';
import { requirePermission } from '../services/permission.service.js';
import { recordAudit } from '../services/audit.service.js';
import * as stockService from '../services/stock.service.js';
import * as warehouseService from '../services/warehouse.service.js';
import {
  adjustmentSchema,
  createWarehouseSchema,
  currentStockQuerySchema,
  damageSchema,
  movementHistoryQuerySchema,
  openingStockSchema,
  transferSchema,
  updateWarehouseSchema,
} from '../validators/inventory.validators.js';

/**
 * PERMISSIONS USED HERE
 * ---------------------
 * `inventory.create` covers movements that bring stock in or shuttle it between
 * your own warehouses — a storekeeper's daily work.
 * `inventory.adjust` is a separate, scarcer grant covering adjustments and
 * damage write-offs, because those two are how stock disappears without a sale
 * and are exactly what an internal-control review looks at. A role that can
 * move stock is not automatically a role that can make it vanish.
 */

/* ------------------------------------------------------------------ *
 * /warehouses
 * ------------------------------------------------------------------ */

export const warehouseRoutes = Router();
warehouseRoutes.use(authenticate, resolveTenant, requireTenant);

warehouseRoutes.get(
  '/',
  requirePermission('inventory', 'view'),
  asyncHandler(async (req, res) => {
    const warehouses = await warehouseService.listWarehouses(
      req.tenant!,
      req.query.includeInactive === 'true'
    );
    res.json({ success: true, data: { warehouses } });
  })
);

warehouseRoutes.post(
  '/',
  requirePermission('inventory', 'create'),
  validate(createWarehouseSchema),
  asyncHandler(async (req, res) => {
    const warehouse = await warehouseService.createWarehouse(req.tenant!, req.body);
    await recordAudit(req.tenant!, {
      action: 'create',
      entityName: 'Warehouse',
      entityId: String(warehouse._id),
      newValue: warehouse,
    });
    res.status(201).json({ success: true, data: { warehouse } });
  })
);

warehouseRoutes.get(
  '/:id',
  requirePermission('inventory', 'view'),
  asyncHandler(async (req, res) => {
    const warehouse = await warehouseService.getWarehouse(req.tenant!, req.params.id);
    res.json({ success: true, data: { warehouse } });
  })
);

warehouseRoutes.patch(
  '/:id',
  requirePermission('inventory', 'update'),
  validate(updateWarehouseSchema),
  asyncHandler(async (req, res) => {
    const before = await warehouseService.getWarehouse(req.tenant!, req.params.id);
    const warehouse = await warehouseService.updateWarehouse(
      req.tenant!,
      req.params.id,
      req.body
    );
    await recordAudit(req.tenant!, {
      action: 'update',
      entityName: 'Warehouse',
      entityId: req.params.id,
      oldValue: before,
      newValue: warehouse,
    });
    res.json({ success: true, data: { warehouse } });
  })
);

warehouseRoutes.delete(
  '/:id',
  requirePermission('inventory', 'delete'),
  asyncHandler(async (req, res) => {
    const before = await warehouseService.getWarehouse(req.tenant!, req.params.id);
    const result = await warehouseService.deleteWarehouse(req.tenant!, req.params.id);
    await recordAudit(req.tenant!, {
      action: result.deleted ? 'delete' : 'update',
      entityName: 'Warehouse',
      entityId: req.params.id,
      oldValue: before,
    });
    res.json({ success: true, data: result });
  })
);

/* ------------------------------------------------------------------ *
 * /inventory
 * ------------------------------------------------------------------ */

const router = Router();
router.use(authenticate, resolveTenant, requireTenant);

/**
 * Current stock, grouped by product. `?warehouseId=` narrows it to one
 * location, `?lowOnly=true` to items at or below their reorder level.
 */
router.get(
  '/stock',
  requirePermission('inventory', 'view'),
  validate(currentStockQuerySchema, 'query'),
  asyncHandler(async (req, res) => {
    const stock = await stockService.getCurrentStock(req.tenant!, req.query);
    res.json({ success: true, data: stock });
  })
);

/**
 * The movement ledger. Declared before `/movements/:productId` would be — it
 * takes its product filter as a query param instead, so there is no `/:id`
 * route on this router to shadow anything.
 */
router.get(
  '/movements',
  requirePermission('inventory', 'view'),
  validate(movementHistoryQuerySchema, 'query'),
  asyncHandler(async (req, res) => {
    const history = await stockService.getMovementHistory(req.tenant!, req.query);
    res.json({ success: true, data: history });
  })
);

/**
 * Reconciliation check: recomputes every balance from the ledger and reports
 * disagreements. Read-only. Exposed because the auditability of an append-only
 * ledger is worth nothing if nobody can run the derivation.
 */
router.get(
  '/verify',
  requirePermission('inventory', 'view'),
  asyncHandler(async (req, res) => {
    const result = await stockService.verifyBalances(req.tenant!);
    res.json({ success: true, data: result });
  })
);

router.post(
  '/opening',
  requirePermission('inventory', 'create'),
  validate(openingStockSchema),
  asyncHandler(async (req, res) => {
    const { entry } = await stockService.recordOpeningStock(req.tenant!, req.body);
    await recordAudit(req.tenant!, {
      action: 'create',
      entityName: 'StockLedgerEntry',
      entityId: String(entry._id),
      newValue: entry,
    });
    res.status(201).json({ success: true, data: { entry } });
  })
);

router.post(
  '/transfer',
  requirePermission('inventory', 'create'),
  validate(transferSchema),
  asyncHandler(async (req, res) => {
    const result = await stockService.transferStock(req.tenant!, req.body);
    await recordAudit(req.tenant!, {
      action: 'create',
      entityName: 'StockTransfer',
      entityId: String(result.referenceId),
      newValue: {
        productId: req.body.productId,
        from: req.body.fromWarehouseId,
        to: req.body.toWarehouseId,
        quantity: req.body.quantity,
      },
    });
    res.status(201).json({
      success: true,
      data: { referenceId: result.referenceId, out: result.out.entry, in: result.in.entry },
    });
  })
);

router.post(
  '/adjustment',
  requirePermission('inventory', 'adjust'),
  validate(adjustmentSchema),
  asyncHandler(async (req, res) => {
    const { entry, balance } = await stockService.adjustStock(req.tenant!, req.body);
    await recordAudit(req.tenant!, {
      action: 'create',
      entityName: 'StockAdjustment',
      entityId: String(entry._id),
      newValue: { ...req.body, runningBalance: balance.quantity },
    });
    res.status(201).json({ success: true, data: { entry } });
  })
);

router.post(
  '/damage',
  requirePermission('inventory', 'adjust'),
  validate(damageSchema),
  asyncHandler(async (req, res) => {
    const { entry, balance } = await stockService.recordDamage(req.tenant!, req.body);
    await recordAudit(req.tenant!, {
      action: 'create',
      entityName: 'StockDamage',
      entityId: String(entry._id),
      newValue: { ...req.body, runningBalance: balance.quantity },
    });
    res.status(201).json({ success: true, data: { entry } });
  })
);

export default router;
