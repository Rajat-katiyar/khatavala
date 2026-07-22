import { Queue, Worker } from 'bullmq';
import { redis } from '../config/redis.js';
import { logger } from '../config/logger.js';
import { SalesInvoiceModel } from '../models/SalesInvoice.js';
import { ProductModel } from '../models/Product.js';
import { CompanyModel } from '../models/Company.js';
import { UserModel } from '../models/User.js';
import { sendPaymentReminder, getTemplate, renderTemplate } from '../services/notification.service.js';
import { EmailProvider } from '../services/notification/email.provider.js';
import { NotificationLogModel } from '../models/NotificationLog.js';
import { Types } from 'mongoose';

const QUEUE_NAME = 'notification-jobs';

let _notificationQueue: Queue | null = null;

export function getNotificationQueue(): Queue {
  if (!_notificationQueue) {
    _notificationQueue = new Queue(QUEUE_NAME, { connection: redis });
  }
  return _notificationQueue;
}

/**
 * Job processor for automated daily payment reminders and low-stock alerts.
 */
export async function processNotificationJobs() {
  logger.info('[NotificationJob] Executing daily automated checks...');

  // 1. Process Overdue Payment Reminders
  const today = new Date();
  const overdueInvoices = await SalesInvoiceModel.find({
    status: 'Posted',
    balanceDue: { $gt: 0 },
    dueDate: { $lt: today },
  }).limit(50);

  for (const invoice of overdueInvoices) {
    try {
      const tenant = { companyId: invoice.companyId as Types.ObjectId, role: 'System', roleId: null, branchId: null, warehouseId: null };
      await sendPaymentReminder(tenant, {
        invoiceId: String(invoice._id),
        channel: 'email',
      });
    } catch (err) {
      logger.error(`[NotificationJob] Failed reminder for invoice ${invoice.invoiceNumber}`, err);
    }
  }

  // 2. Process Low Stock Alerts for Companies
  const companies = await CompanyModel.find({ isActive: true });
  for (const company of companies) {
    const lowStockProducts = await ProductModel.find({
      companyId: company._id,
      isActive: true,
      minStockLevel: { $type: 'number' },
      $expr: { $lte: ['$currentStock', '$minStockLevel'] },
    }).limit(10);

    if (lowStockProducts.length > 0) {
      const owner = await UserModel.findById(company.ownerId);
      if (owner?.email) {
        const tenant = { companyId: company._id as Types.ObjectId, role: 'System', roleId: null, branchId: null, warehouseId: null };
        const tpl = await getTemplate(tenant, 'LowStockAlert', 'email');
        const bodyText = lowStockProducts
          .map((p) => `- ${p.name} (SKU: ${p.sku}): ${p.currentStock} remaining (Min: ${p.minStockLevel})`)
          .join('\n');

        const placeholders = {
          companyName: company.name,
          productName: lowStockProducts[0].name,
          sku: lowStockProducts[0].sku,
          currentStock: String(lowStockProducts[0].currentStock),
          minStockLevel: String(lowStockProducts[0].minStockLevel),
        };

        const subject = renderTemplate(tpl.subject, placeholders);
        const body = `${renderTemplate(tpl.body, placeholders)}\n\nFull List:\n${bodyText}`;

        const provider = new EmailProvider();
        const res = await provider.send({
          recipient: owner.email,
          subject,
          body,
        });

        await NotificationLogModel.create({
          companyId: company._id,
          channel: 'email',
          templateType: 'LowStockAlert',
          recipient: owner.email,
          subject,
          body,
          status: res.success ? 'sent' : 'failed',
          errorMessage: res.error,
        });
      }
    }
  }

  logger.info('[NotificationJob] Daily automated notification checks completed.');
}

/**
 * Schedules daily repeatable notification jobs.
 */
export async function scheduleNotificationJobs(): Promise<void> {
  const queue = getNotificationQueue();
  await queue.add(
    'daily-notification-checks',
    {},
    {
      repeat: { pattern: '0 8 * * *' },
      jobId: 'daily-notification-checks',
    }
  );
  logger.info('Notification jobs scheduled (daily 08:00 AM)');
}

/**
 * Creates BullMQ worker for notification jobs.
 */
export function createNotificationWorker(): Worker {
  const worker = new Worker(
    QUEUE_NAME,
    async () => {
      await processNotificationJobs();
    },
    { connection: redis }
  );

  worker.on('failed', (job, err) => {
    logger.error(`[NotificationWorker] Job ${job?.id} failed`, err);
  });

  return worker;
}
