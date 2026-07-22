import { Router, type Request, type Response, type NextFunction } from 'express';
import { asyncHandler } from '../utils/asyncHandler.js';
import { authenticate } from '../middlewares/auth.js';
import { resolveTenant, requireTenant, type TenantContext } from '../middlewares/tenantScope.js';
import {
  sendInvoiceNotification,
  sendPaymentReminder,
  getNotificationConfig,
  updateNotificationConfig,
  getNotificationLogs,
} from '../services/notification.service.js';
import { NotificationTemplateModel } from '../models/NotificationTemplate.js';
import { tenantFilter, tenantStamp } from '../middlewares/tenantScope.js';

export const notificationRouter = Router();

notificationRouter.use(authenticate, resolveTenant, requireTenant);

/**
 * POST /api/notifications/send-invoice
 * Sends Invoice PDF via Email/WhatsApp/SMS
 */
notificationRouter.post(
  '/send-invoice',
  asyncHandler(async (req: Request, res: Response) => {
    const tenant = (req as Request & { tenant?: TenantContext }).tenant!;
    const { invoiceId, channel = 'email', recipient } = req.body;

    if (!invoiceId) {
      res.status(400).json({ success: false, error: 'invoiceId is required' });
      return;
    }

    const result = await sendInvoiceNotification(tenant, {
      invoiceId,
      channel,
      recipient,
    });

    res.json({
      success: true,
      data: result,
    });
  })
);

/**
 * POST /api/notifications/send-reminder
 * Sends Payment Reminder via Email/WhatsApp/SMS
 */
notificationRouter.post(
  '/send-reminder',
  asyncHandler(async (req: Request, res: Response) => {
    const tenant = (req as Request & { tenant?: TenantContext }).tenant!;
    const { invoiceId, channel = 'email', recipient } = req.body;

    if (!invoiceId) {
      res.status(400).json({ success: false, error: 'invoiceId is required' });
      return;
    }

    const result = await sendPaymentReminder(tenant, {
      invoiceId,
      channel,
      recipient,
    });

    res.json({
      success: true,
      data: result,
    });
  })
);

/**
 * GET /api/notifications/config
 * Retrieves tenant notification credentials (passwords/keys masked for security)
 */
notificationRouter.get(
  '/config',
  asyncHandler(async (req: Request, res: Response) => {
    const tenant = (req as Request & { tenant?: TenantContext }).tenant!;
    const config = await getNotificationConfig(tenant);
    const obj = config.toObject();

    // Mask passwords for safety
    if (obj.emailConfig?.smtpPass) {
      obj.emailConfig.smtpPass = '••••••••';
    }
    if (obj.whatsappConfig?.accessToken) {
      obj.whatsappConfig.accessToken = '••••••••';
    }
    if (obj.smsConfig?.apiKey) {
      obj.smsConfig.apiKey = '••••••••';
    }

    res.json({ success: true, data: obj });
  })
);

/**
 * PUT /api/notifications/config
 * Updates tenant notification credentials
 */
notificationRouter.put(
  '/config',
  asyncHandler(async (req: Request, res: Response) => {
    const tenant = (req as Request & { tenant?: TenantContext }).tenant!;
    const updated = await updateNotificationConfig(tenant, req.body);
    res.json({ success: true, data: updated });
  })
);

/**
 * GET /api/notifications/templates
 * Fetches all templates for tenant
 */
notificationRouter.get(
  '/templates',
  asyncHandler(async (req: Request, res: Response) => {
    const tenant = (req as Request & { tenant?: TenantContext }).tenant!;
    const templates = await NotificationTemplateModel.find(tenantFilter(tenant, {})).lean();
    res.json({ success: true, data: templates });
  })
);

/**
 * PUT /api/notifications/templates
 * Upserts a custom template
 */
notificationRouter.put(
  '/templates',
  asyncHandler(async (req: Request, res: Response) => {
    const tenant = (req as Request & { tenant?: TenantContext }).tenant!;
    const { templateType, channel = 'email', subject, body, isActive = true } = req.body;

    if (!templateType || !body) {
      res.status(400).json({ success: false, error: 'templateType and body are required' });
      return;
    }

    const template = await NotificationTemplateModel.findOneAndUpdate(
      tenantFilter(tenant, { templateType, channel }),
      { $set: tenantStamp(tenant, { templateType, channel, subject, body, isActive }) },
      { upsert: true, new: true }
    );

    res.json({ success: true, data: template });
  })
);

/**
 * GET /api/notifications/history
 * Sent notification logs
 */
notificationRouter.get(
  '/history',
  asyncHandler(async (req: Request, res: Response) => {
    const tenant = (req as Request & { tenant?: TenantContext }).tenant!;
    const { channel, status, limit } = req.query as { channel?: string; status?: string; limit?: string };
    const logs = await getNotificationLogs(tenant, {
      channel,
      status,
      limit: limit ? Number(limit) : 50,
    });
    res.json({ success: true, data: logs });
  })
);
