import { Router } from 'express';
import type { ZodTypeAny } from 'zod';
import { asyncHandler } from '../utils/asyncHandler.js';
import { validate } from '../middlewares/validate.js';
import { authenticate } from '../middlewares/auth.js';
import { requireTenant, resolveTenant } from '../middlewares/tenantScope.js';
import type { TenantContext } from '../middlewares/tenantScope.js';
import { requirePermission } from '../services/permission.service.js';
import { recordAudit } from '../services/audit.service.js';
import * as purchaseService from '../services/purchase.service.js';
import * as purchaseReturnService from '../services/purchaseReturn.service.js';
import * as supplierPaymentService from '../services/supplierPayment.service.js';
import type { TradeDocumentService } from '../services/tradeDocument.factory.js';
import {
  cancelSchema,
  convertToGrnSchema,
  convertToPurchaseInvoiceSchema,
  createGrnSchema,
  createPurchaseInvoiceSchema,
  createPurchaseOrderSchema,
  createPurchaseReturnSchema,
  listQuerySchema,
  listReturnsQuerySchema,
  paymentSummaryQuerySchema,
  purchaseOrderStatusSchema,
  recordSupplierPaymentSchema,
  updateGrnSchema,
  updatePurchaseInvoiceSchema,
  updatePurchaseOrderSchema,
} from '../validators/purchase.validators.js';

/**
 * Phase 11 — purchases. Mounted at /api/purchase.
 *
 * Structurally the mirror of sales.routes: one shared CRUD sub-router mounted
 * three times, plus the conversion and posting endpoints that are specific to
 * each document. Same middleware stack throughout:
 *
 *     authenticate → resolveTenant → requireTenant → requirePermission(...)
 *
 * Permissions come from the `purchases` module, which has existed in the
 * catalog since Phase 4 and until now gated nothing.
 */

const router = Router();
router.use(authenticate, resolveTenant, requireTenant);

function documentRoutes(options: {
  service: TradeDocumentService;
  entityName: string;
  createSchema: ZodTypeAny;
  updateSchema: ZodTypeAny;
  statusSchema?: ZodTypeAny;
  create?: (tenant: TenantContext, body: unknown) => Promise<any>;
}) {
  const { service, entityName, createSchema, updateSchema, statusSchema } = options;
  const sub = Router();

  sub.get(
    '/',
    requirePermission('purchases', 'view'),
    validate(listQuerySchema, 'query'),
    asyncHandler(async (req, res) => {
      const result = await service.list(req.tenant!, req.query);
      res.json({ success: true, data: result });
    })
  );

  sub.post(
    '/',
    requirePermission('purchases', 'create'),
    validate(createSchema),
    asyncHandler(async (req, res) => {
      const document = options.create
        ? await options.create(req.tenant!, req.body)
        : await service.create(req.tenant!, req.body);
      await recordAudit(req.tenant!, {
        action: 'create',
        entityName,
        entityId: String(document._id),
        newValue: document,
      });
      res.status(201).json({ success: true, data: { document } });
    })
  );

  sub.get(
    '/:id',
    requirePermission('purchases', 'view'),
    asyncHandler(async (req, res) => {
      const document = await service.getById(req.tenant!, req.params.id);
      res.json({ success: true, data: { document } });
    })
  );

  sub.patch(
    '/:id',
    requirePermission('purchases', 'update'),
    validate(updateSchema),
    asyncHandler(async (req, res) => {
      const before = await service.getById(req.tenant!, req.params.id);
      const document = await service.update(req.tenant!, req.params.id, req.body);
      await recordAudit(req.tenant!, {
        action: 'update',
        entityName,
        entityId: req.params.id,
        oldValue: before,
        newValue: document,
      });
      res.json({ success: true, data: { document } });
    })
  );

  if (statusSchema) {
    sub.patch(
      '/:id/status',
      requirePermission('purchases', 'update'),
      validate(statusSchema),
      asyncHandler(async (req, res) => {
        const document = await service.setStatus(req.tenant!, req.params.id, req.body.status);
        res.json({ success: true, data: { document } });
      })
    );
  }

  sub.delete(
    '/:id',
    requirePermission('purchases', 'delete'),
    asyncHandler(async (req, res) => {
      const before = await service.getById(req.tenant!, req.params.id);
      const result = await service.remove(req.tenant!, req.params.id);
      await recordAudit(req.tenant!, {
        action: 'delete',
        entityName,
        entityId: req.params.id,
        oldValue: before,
      });
      res.json({ success: true, data: result });
    })
  );

  return sub;
}

/* -------------------------- Purchase orders ------------------------- */

const orderRouter = documentRoutes({
  service: purchaseService.purchaseOrderService,
  entityName: 'PurchaseOrder',
  createSchema: createPurchaseOrderSchema,
  updateSchema: updatePurchaseOrderSchema,
  statusSchema: purchaseOrderStatusSchema,
});

/**
 * Order → receipt. Creates a DRAFT GRN pre-filled with what is still
 * outstanding; confirming it is the act that moves stock.
 */
orderRouter.post(
  '/:id/convert-to-grn',
  requirePermission('purchases', 'create'),
  validate(convertToGrnSchema),
  asyncHandler(async (req, res) => {
    const document = await purchaseService.convertOrderToGrn(req.tenant!, req.params.id, req.body);
    await recordAudit(req.tenant!, {
      action: 'create',
      entityName: 'GoodsReceiptNote',
      entityId: String(document._id),
      newValue: {
        convertedFromOrder: req.params.id,
        documentNumber: document.documentNumber,
      },
    });
    res.status(201).json({ success: true, data: { document } });
  })
);

/** Order → bill directly, for services and expenses with no goods. */
orderRouter.post(
  '/:id/convert-to-invoice',
  requirePermission('purchases', 'create'),
  validate(convertToPurchaseInvoiceSchema),
  asyncHandler(async (req, res) => {
    const document = await purchaseService.convertOrderToInvoice(
      req.tenant!,
      req.params.id,
      req.body
    );
    await recordAudit(req.tenant!, {
      action: 'create',
      entityName: 'PurchaseInvoice',
      entityId: String(document._id),
      newValue: {
        convertedFromOrder: req.params.id,
        documentNumber: document.documentNumber,
      },
    });
    res.status(201).json({ success: true, data: { document } });
  })
);

/* ---------------------------- Receipts ------------------------------ */

const grnRouter = documentRoutes({
  service: purchaseService.grnService,
  entityName: 'GoodsReceiptNote',
  createSchema: createGrnSchema,
  updateSchema: updateGrnSchema,
});

/** THE stock-moving endpoint on the buying side. */
grnRouter.post(
  '/:id/receive',
  requirePermission('purchases', 'update'),
  asyncHandler(async (req, res) => {
    const document = await purchaseService.receiveGrn(req.tenant!, req.params.id);
    await recordAudit(req.tenant!, {
      action: 'update',
      entityName: 'GoodsReceiptNote',
      entityId: req.params.id,
      newValue: { status: document.status, receivedAt: document.receivedAt },
    });
    res.json({ success: true, data: { document } });
  })
);

grnRouter.post(
  '/:id/convert-to-invoice',
  requirePermission('purchases', 'create'),
  validate(convertToPurchaseInvoiceSchema),
  asyncHandler(async (req, res) => {
    const document = await purchaseService.convertGrnToInvoice(
      req.tenant!,
      req.params.id,
      req.body
    );
    await recordAudit(req.tenant!, {
      action: 'create',
      entityName: 'PurchaseInvoice',
      entityId: String(document._id),
      newValue: { convertedFromGrn: req.params.id, documentNumber: document.documentNumber },
    });
    res.status(201).json({ success: true, data: { document } });
  })
);

grnRouter.post(
  '/:id/cancel',
  requirePermission('purchases', 'delete'),
  validate(cancelSchema),
  asyncHandler(async (req, res) => {
    const document = await purchaseService.cancelGrn(
      req.tenant!,
      req.params.id,
      req.body.reason
    );
    await recordAudit(req.tenant!, {
      action: 'update',
      entityName: 'GoodsReceiptNote',
      entityId: req.params.id,
      newValue: { status: 'Cancelled', reason: req.body.reason },
    });
    res.json({ success: true, data: { document } });
  })
);

/* -------------------------- Purchase bills -------------------------- */

const invoiceRouter = documentRoutes({
  service: purchaseService.purchaseInvoiceService,
  entityName: 'PurchaseInvoice',
  createSchema: createPurchaseInvoiceSchema,
  updateSchema: updatePurchaseInvoiceSchema,
  // Bills post the supplier ledger, so they go through the transactional path.
  create: (tenant, body) => purchaseService.createPurchaseInvoice(tenant, body as never),
});

invoiceRouter.post(
  '/:id/confirm',
  requirePermission('purchases', 'update'),
  asyncHandler(async (req, res) => {
    const document = await purchaseService.confirmPurchaseInvoice(req.tenant!, req.params.id);
    await recordAudit(req.tenant!, {
      action: 'update',
      entityName: 'PurchaseInvoice',
      entityId: req.params.id,
      newValue: { status: document.status, postedAt: document.postedAt },
    });
    res.json({ success: true, data: { document } });
  })
);

invoiceRouter.post(
  '/:id/cancel',
  requirePermission('purchases', 'delete'),
  validate(cancelSchema),
  asyncHandler(async (req, res) => {
    const document = await purchaseService.cancelPurchaseInvoice(
      req.tenant!,
      req.params.id,
      req.body.reason
    );
    await recordAudit(req.tenant!, {
      action: 'update',
      entityName: 'PurchaseInvoice',
      entityId: req.params.id,
      newValue: { status: 'Cancelled', reason: req.body.reason },
    });
    res.json({ success: true, data: { document } });
  })
);

/* ---------------------------- Payments ------------------------------ */

invoiceRouter.post(
  '/:id/payments',
  requirePermission('purchases', 'update'),
  validate(recordSupplierPaymentSchema),
  asyncHandler(async (req, res) => {
    const { payment, purchaseInvoice } = await supplierPaymentService.recordPayment(
      req.tenant!,
      req.params.id,
      req.body
    );
    await recordAudit(req.tenant!, {
      action: 'create',
      entityName: 'SupplierPayment',
      entityId: String(payment._id),
      newValue: {
        amount: payment.amount,
        mode: payment.mode,
        bill: purchaseInvoice.documentNumber,
        billStatus: purchaseInvoice.status,
      },
    });
    res.status(201).json({ success: true, data: { payment, document: purchaseInvoice } });
  })
);

invoiceRouter.get(
  '/:id/payments',
  requirePermission('purchases', 'view'),
  asyncHandler(async (req, res) => {
    const history = await supplierPaymentService.getPaymentsForInvoice(
      req.tenant!,
      req.params.id
    );
    res.json({ success: true, data: history });
  })
);

/* ----------------------------- Returns ------------------------------ */

const returnRouter = Router();

returnRouter.get(
  '/',
  requirePermission('purchases', 'view'),
  validate(listReturnsQuerySchema, 'query'),
  asyncHandler(async (req, res) => {
    const result = await purchaseReturnService.listPurchaseReturns(req.tenant!, req.query);
    res.json({ success: true, data: result });
  })
);

/** Declared before `/:id` so it is not captured as a debit-note id. */
returnRouter.get(
  '/returnable/:purchaseInvoiceId',
  requirePermission('purchases', 'view'),
  asyncHandler(async (req, res) => {
    const result = await purchaseReturnService.getReturnableLines(
      req.tenant!,
      req.params.purchaseInvoiceId
    );
    res.json({ success: true, data: result });
  })
);

returnRouter.post(
  '/',
  // A return moves stock and adjusts a payable — heavier than an ordinary
  // create, so it takes the delete grant, mirroring `sales.void`.
  requirePermission('purchases', 'delete'),
  validate(createPurchaseReturnSchema),
  asyncHandler(async (req, res) => {
    const result = await purchaseReturnService.createPurchaseReturn(req.tenant!, req.body);
    await recordAudit(req.tenant!, {
      action: 'create',
      entityName: 'DebitNote',
      entityId: String(result.debitNote._id),
      newValue: {
        documentNumber: result.debitNote.documentNumber,
        purchaseInvoiceNumber: result.debitNote.purchaseInvoiceNumber,
        grandTotal: result.debitNote.grandTotal,
        reason: result.debitNote.reason,
      },
    });
    res.status(201).json({ success: true, data: result });
  })
);

returnRouter.get(
  '/:id',
  requirePermission('purchases', 'view'),
  asyncHandler(async (req, res) => {
    const result = await purchaseReturnService.getPurchaseReturn(req.tenant!, req.params.id);
    res.json({ success: true, data: result });
  })
);

/* --------------------------- Cash-out ------------------------------- */

const paymentRouter = Router();

/** What we paid out, by mode — the buying-side mirror of the cash-up report. */
paymentRouter.get(
  '/summary',
  requirePermission('purchases', 'view'),
  validate(paymentSummaryQuerySchema, 'query'),
  asyncHandler(async (req, res) => {
    const summary = await supplierPaymentService.getPaymentSummary(req.tenant!, req.query);
    res.json({ success: true, data: summary });
  })
);

router.use('/orders', orderRouter);
router.use('/grn', grnRouter);
router.use('/invoices', invoiceRouter);
router.use('/returns', returnRouter);
router.use('/payments', paymentRouter);

export default router;
