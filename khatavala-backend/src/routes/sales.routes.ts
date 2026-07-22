import { Router } from 'express';
import { asyncHandler } from '../utils/asyncHandler.js';
import { validate } from '../middlewares/validate.js';
import { authenticate } from '../middlewares/auth.js';
import { requireTenant, resolveTenant } from '../middlewares/tenantScope.js';
import { requirePermission } from '../services/permission.service.js';
import { recordAudit } from '../services/audit.service.js';
import * as salesService from '../services/sales.service.js';
import * as paymentService from '../services/payment.service.js';
import * as posService from '../services/pos.service.js';
import * as returnService from '../services/salesReturn.service.js';
import * as challanService from '../services/deliveryChallan.service.js';
import { renderInvoicePdf } from '../services/invoicePdf.service.js';
import { peekDocumentNumber } from '../services/numbering.service.js';
import type { SalesDocumentService } from '../services/tradeDocument.factory.js';
import type { TenantContext } from '../middlewares/tenantScope.js';
import {
  cancelSchema,
  convertSchema,
  createInvoiceSchema,
  createQuotationSchema,
  createSalesOrderSchema,
  createChallanSchema,
  createReturnSchema,
  listQuerySchema,
  listReturnsQuerySchema,
  paymentSummaryQuerySchema,
  posCheckoutSchema,
  quickProductsQuerySchema,
  recordPaymentSchema,
  updateChallanSchema,
  quotationStatusSchema,
  salesOrderStatusSchema,
  updateInvoiceSchema,
  updateQuotationSchema,
  updateSalesOrderSchema,
} from '../validators/sales.validators.js';
import type { ZodTypeAny } from 'zod';

/**
 * Phase 9 — sales. Replaces the Phase 4 permission-demo placeholder.
 *
 * Mounted at /api/sales, with three sub-routers that share their CRUD shape the
 * same way the services do. Every route keeps the standard stack:
 *
 *     authenticate → resolveTenant → requireTenant → requirePermission(...)
 */

const router = Router();
router.use(authenticate, resolveTenant, requireTenant);

/**
 * The CRUD every document type has. Written once and mounted three times —
 * hand-copying it would let the three drift, which is exactly what the shared
 * service and schema exist to prevent.
 */
function documentRoutes(options: {
  service: SalesDocumentService;
  entityName: string;
  createSchema: ZodTypeAny;
  updateSchema: ZodTypeAny;
  statusSchema?: ZodTypeAny;
  /** Invoices are created through the transactional path instead. */
  create?: (tenant: TenantContext, body: unknown) => Promise<any>;
}) {
  const { service, entityName, createSchema, updateSchema, statusSchema } = options;
  const sub = Router();

  sub.get(
    '/',
    requirePermission('sales', 'view'),
    validate(listQuerySchema, 'query'),
    asyncHandler(async (req, res) => {
      const result = await service.list(req.tenant!, req.query);
      res.json({ success: true, data: result });
    })
  );

  sub.post(
    '/',
    requirePermission('sales', 'create'),
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
    requirePermission('sales', 'view'),
    asyncHandler(async (req, res) => {
      // The chain comes back with the document so the detail page can show
      // "converted from QTN-…" without a second round trip.
      const [document, chain] = await Promise.all([
        service.getById(req.tenant!, req.params.id),
        salesService.getDocumentChain(req.tenant!, service, req.params.id),
      ]);
      res.json({ success: true, data: { document, chain } });
    })
  );

  sub.patch(
    '/:id',
    requirePermission('sales', 'update'),
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
      requirePermission('sales', 'update'),
      validate(statusSchema),
      asyncHandler(async (req, res) => {
        const document = await service.setStatus(req.tenant!, req.params.id, req.body.status);
        await recordAudit(req.tenant!, {
          action: 'update',
          entityName,
          entityId: req.params.id,
          newValue: { status: req.body.status },
        });
        res.json({ success: true, data: { document } });
      })
    );
  }

  sub.delete(
    '/:id',
    requirePermission('sales', 'delete'),
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

/* ---------------------------- Quotations --------------------------- */

const quotationRouter = documentRoutes({
  service: salesService.quotationService,
  entityName: 'Quotation',
  createSchema: createQuotationSchema,
  updateSchema: updateQuotationSchema,
  statusSchema: quotationStatusSchema,
});

quotationRouter.post(
  '/:id/convert-to-order',
  requirePermission('sales', 'create'),
  validate(convertSchema),
  asyncHandler(async (req, res) => {
    const document = await salesService.convertQuotationToOrder(req.tenant!, req.params.id, {
      expectedDeliveryDate: req.body.expectedDeliveryDate,
    });
    await recordAudit(req.tenant!, {
      action: 'create',
      entityName: 'SalesOrder',
      entityId: String(document._id),
      newValue: {
        convertedFromQuotation: req.params.id,
        documentNumber: document.documentNumber,
      },
    });
    res.status(201).json({ success: true, data: { document } });
  })
);

quotationRouter.post(
  '/:id/convert-to-invoice',
  requirePermission('sales', 'create'),
  validate(convertSchema),
  asyncHandler(async (req, res) => {
    const document = await salesService.convertQuotationToInvoice(req.tenant!, req.params.id, {
      confirm: req.body.confirm,
      dueDate: req.body.dueDate,
    });
    await recordAudit(req.tenant!, {
      action: 'create',
      entityName: 'Invoice',
      entityId: String(document._id),
      newValue: {
        convertedFromQuotation: req.params.id,
        documentNumber: document.documentNumber,
      },
    });
    res.status(201).json({ success: true, data: { document } });
  })
);

/* --------------------------- Sales orders -------------------------- */

const orderRouter = documentRoutes({
  service: salesService.salesOrderService,
  entityName: 'SalesOrder',
  createSchema: createSalesOrderSchema,
  updateSchema: updateSalesOrderSchema,
  statusSchema: salesOrderStatusSchema,
});

orderRouter.post(
  '/:id/convert-to-invoice',
  requirePermission('sales', 'create'),
  validate(convertSchema),
  asyncHandler(async (req, res) => {
    const document = await salesService.convertOrderToInvoice(req.tenant!, req.params.id, {
      confirm: req.body.confirm,
      dueDate: req.body.dueDate,
    });
    await recordAudit(req.tenant!, {
      action: 'create',
      entityName: 'Invoice',
      entityId: String(document._id),
      newValue: { convertedFromOrder: req.params.id, documentNumber: document.documentNumber },
    });
    res.status(201).json({ success: true, data: { document } });
  })
);

/* ----------------------------- Invoices ---------------------------- */

const invoiceRouter = documentRoutes({
  service: salesService.invoiceService,
  entityName: 'Invoice',
  createSchema: createInvoiceSchema,
  updateSchema: updateInvoiceSchema,
  // Invoices are created through the transaction that also moves stock and
  // posts the ledger — never through the plain factory create.
  create: (tenant, body) => salesService.createInvoice(tenant, body as never),
});

/**
 * The next invoice number, for the "will be numbered…" hint on the entry
 * screen. A hint, not a reservation — see peekDocumentNumber. Declared before
 * `/:id` so it is not captured as an invoice id.
 */
invoiceRouter.get(
  '/next-number',
  requirePermission('sales', 'view'),
  asyncHandler(async (req, res) => {
    const documentNumber = await peekDocumentNumber(req.tenant!, {
      key: 'SalesInvoice',
      prefix: 'INV',
    });
    res.json({ success: true, data: { documentNumber } });
  })
);

invoiceRouter.post(
  '/:id/confirm',
  requirePermission('sales', 'update'),
  asyncHandler(async (req, res) => {
    const document = await salesService.confirmInvoice(req.tenant!, req.params.id);
    await recordAudit(req.tenant!, {
      action: 'update',
      entityName: 'Invoice',
      entityId: req.params.id,
      newValue: { status: document.status, postedAt: document.postedAt },
    });
    res.json({ success: true, data: { document } });
  })
);

invoiceRouter.post(
  '/:id/cancel',
  // `void` rather than `delete`: cancelling reverses a posted invoice's stock
  // and ledger, which is a heavier act than deleting an unposted draft.
  requirePermission('sales', 'void'),
  validate(cancelSchema),
  asyncHandler(async (req, res) => {
    const document = await salesService.cancelInvoice(
      req.tenant!,
      req.params.id,
      req.body.reason
    );
    await recordAudit(req.tenant!, {
      action: 'update',
      entityName: 'Invoice',
      entityId: req.params.id,
      newValue: { status: 'Cancelled', reason: req.body.reason },
    });
    res.json({ success: true, data: { document } });
  })
);

invoiceRouter.post(
  '/:id/payments',
  requirePermission('sales', 'update'),
  validate(recordPaymentSchema),
  asyncHandler(async (req, res) => {
    const { payment, invoice } = await paymentService.recordPayment(
      req.tenant!,
      req.params.id,
      req.body
    );
    await recordAudit(req.tenant!, {
      action: 'create',
      entityName: 'Payment',
      entityId: String(payment._id),
      newValue: {
        amount: payment.amount,
        mode: payment.mode,
        invoice: invoice.documentNumber,
        invoiceStatus: invoice.status,
      },
    });
    res.status(201).json({ success: true, data: { payment, document: invoice } });
  })
);

/** Payment history for one invoice — drives the modal on the detail page. */
invoiceRouter.get(
  '/:id/payments',
  requirePermission('sales', 'view'),
  asyncHandler(async (req, res) => {
    const history = await paymentService.getPaymentsForInvoice(req.tenant!, req.params.id);
    res.json({ success: true, data: history });
  })
);

/** Everything the till needs to print a receipt, in one call. */
invoiceRouter.get(
  '/:id/receipt',
  requirePermission('sales', 'view'),
  asyncHandler(async (req, res) => {
    const receipt = await posService.getReceipt(req.tenant!, req.params.id);
    res.json({ success: true, data: receipt });
  })
);

invoiceRouter.get(
  '/:id/pdf',
  requirePermission('sales', 'view'),
  asyncHandler(async (req, res) => {
    const { buffer, fileName } = await renderInvoicePdf(req.tenant!, req.params.id);
    res.setHeader('Content-Type', 'application/pdf');
    // `inline` so a browser preview works; the client passes ?download=1 to
    // force the save dialog instead.
    res.setHeader(
      'Content-Disposition',
      `${req.query.download ? 'attachment' : 'inline'}; filename="${fileName}"`
    );
    res.setHeader('Content-Length', String(buffer.length));
    res.send(buffer);
  })
);

/**
 * Send by email / WhatsApp — STUB, per the phase brief.
 *
 * Returns 501 rather than 200-with-a-lie. A stub that reports success is worse
 * than one that reports "not built": the UI would show the invoice as sent, and
 * the shop would find out it never was when the customer does not pay.
 * mail.service.ts already exists for the email path when this is implemented.
 */
invoiceRouter.post(
  '/:id/send',
  requirePermission('sales', 'update'),
  asyncHandler(async (req, res) => {
    // Fetched purely to 404 on an unknown id before reporting "not built",
    // and to name the invoice in the message.
    const document = (await salesService.invoiceService.getById(
      req.tenant!,
      req.params.id
    )) as unknown as { documentNumber: string };
    res.status(501).json({
      success: false,
      error: {
        code: 'NOT_IMPLEMENTED',
        message:
          'Sending invoices by email or WhatsApp is not built yet. Download the PDF and send it manually for now.',
        details: { documentNumber: document.documentNumber },
      },
    });
  })
);

/* ------------------------------------------------------------------ *
 * POS
 * ------------------------------------------------------------------ */

const posRouter = Router();

/**
 * ONE CALL: invoice + stock + payment, in one transaction. See pos.service for
 * why this is not three calls to the endpoints above.
 */
posRouter.post(
  '/checkout',
  requirePermission('sales', 'create'),
  validate(posCheckoutSchema),
  asyncHandler(async (req, res) => {
    const result = await posService.checkout(req.tenant!, req.body);
    await recordAudit(req.tenant!, {
      action: 'create',
      entityName: 'Invoice',
      entityId: String(result.invoice._id),
      newValue: {
        channel: 'POS',
        documentNumber: result.invoice.documentNumber,
        grandTotal: result.invoice.grandTotal,
        paymentMode: req.body.payment.mode,
      },
    });
    res.status(201).json({ success: true, data: result });
  })
);

/** The tap-to-add grid, ordered by what actually moves. */
posRouter.get(
  '/products',
  requirePermission('sales', 'view'),
  validate(quickProductsQuerySchema, 'query'),
  asyncHandler(async (req, res) => {
    const result = await posService.getQuickProducts(req.tenant!, req.query);
    res.json({ success: true, data: result });
  })
);

/* ------------------------------------------------------------------ *
 * Returns
 * ------------------------------------------------------------------ */

const returnRouter = Router();

returnRouter.get(
  '/',
  requirePermission('sales', 'view'),
  validate(listReturnsQuerySchema, 'query'),
  asyncHandler(async (req, res) => {
    const result = await returnService.listReturns(req.tenant!, req.query);
    res.json({ success: true, data: result });
  })
);

/**
 * What is still returnable on an invoice. Declared before `/:id` so it is not
 * captured as a return id.
 */
returnRouter.get(
  '/returnable/:invoiceId',
  requirePermission('sales', 'view'),
  asyncHandler(async (req, res) => {
    const result = await returnService.getReturnableLines(req.tenant!, req.params.invoiceId);
    res.json({ success: true, data: result });
  })
);

returnRouter.post(
  '/',
  // A return moves stock and credits a customer — the same weight as voiding
  // an invoice, so it takes the same permission rather than plain `create`.
  requirePermission('sales', 'void'),
  validate(createReturnSchema),
  asyncHandler(async (req, res) => {
    const result = await returnService.createReturn(req.tenant!, req.body);
    await recordAudit(req.tenant!, {
      action: 'create',
      entityName: 'SalesReturn',
      entityId: String(result.salesReturn._id),
      newValue: {
        documentNumber: result.salesReturn.documentNumber,
        invoiceNumber: result.salesReturn.invoiceNumber,
        grandTotal: result.salesReturn.grandTotal,
        creditNote: result.creditNote.documentNumber,
        reason: result.salesReturn.reason,
      },
    });
    res.status(201).json({ success: true, data: result });
  })
);

returnRouter.get(
  '/:id',
  requirePermission('sales', 'view'),
  asyncHandler(async (req, res) => {
    const result = await returnService.getReturn(req.tenant!, req.params.id);
    res.json({ success: true, data: result });
  })
);

/* ------------------------------------------------------------------ *
 * Delivery challans
 * ------------------------------------------------------------------ */

const challanRouter = documentRoutes({
  service: challanService.challanService,
  entityName: 'DeliveryChallan',
  createSchema: createChallanSchema,
  updateSchema: updateChallanSchema,
});

challanRouter.post(
  '/:id/dispatch',
  requirePermission('sales', 'update'),
  asyncHandler(async (req, res) => {
    const document = await challanService.dispatchChallan(req.tenant!, req.params.id);
    await recordAudit(req.tenant!, {
      action: 'update',
      entityName: 'DeliveryChallan',
      entityId: req.params.id,
      newValue: { status: document.status, dispatchedAt: document.dispatchedAt },
    });
    res.json({ success: true, data: { document } });
  })
);

challanRouter.post(
  '/:id/convert-to-invoice',
  requirePermission('sales', 'create'),
  validate(convertSchema),
  asyncHandler(async (req, res) => {
    const document = await challanService.invoiceChallan(req.tenant!, req.params.id, {
      dueDate: req.body.dueDate,
    });
    await recordAudit(req.tenant!, {
      action: 'create',
      entityName: 'Invoice',
      entityId: String(document._id),
      newValue: {
        convertedFromChallan: req.params.id,
        documentNumber: document.documentNumber,
      },
    });
    res.status(201).json({ success: true, data: { document } });
  })
);

challanRouter.post(
  '/:id/cancel',
  requirePermission('sales', 'void'),
  validate(cancelSchema),
  asyncHandler(async (req, res) => {
    const document = await challanService.cancelChallan(
      req.tenant!,
      req.params.id,
      req.body.reason
    );
    await recordAudit(req.tenant!, {
      action: 'update',
      entityName: 'DeliveryChallan',
      entityId: req.params.id,
      newValue: { status: 'Cancelled', reason: req.body.reason },
    });
    res.json({ success: true, data: { document } });
  })
);

/* ------------------------------------------------------------------ *
 * Payments
 * ------------------------------------------------------------------ */

const paymentRouter = Router();

/** Cash-up: what came in today, by mode. */
paymentRouter.get(
  '/summary',
  requirePermission('sales', 'view'),
  validate(paymentSummaryQuerySchema, 'query'),
  asyncHandler(async (req, res) => {
    const summary = await paymentService.getPaymentSummary(req.tenant!, req.query);
    res.json({ success: true, data: summary });
  })
);

router.use('/pos', posRouter);
router.use('/returns', returnRouter);
router.use('/challans', challanRouter);
router.use('/payments', paymentRouter);
router.use('/quotations', quotationRouter);
router.use('/orders', orderRouter);
router.use('/invoices', invoiceRouter);

export default router;
