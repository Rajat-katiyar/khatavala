import type { TenantContext } from '../middlewares/tenantScope.js';
import { tenantFilter, tenantStamp } from '../middlewares/tenantScope.js';
import { NotificationConfigModel, type INotificationConfig } from '../models/NotificationConfig.js';
import { NotificationTemplateModel, type NotificationTemplateType, type NotificationChannel } from '../models/NotificationTemplate.js';
import { NotificationLogModel } from '../models/NotificationLog.js';
import { SalesInvoiceModel } from '../models/SalesInvoice.js';
import { CustomerModel } from '../models/Customer.js';
import { CompanyModel } from '../models/Company.js';
import { renderInvoicePdf } from './invoicePdf.service.js';
import { EmailProvider } from './notification/email.provider.js';
import { WhatsAppProvider } from './notification/whatsapp.provider.js';
import { SmsProvider } from './notification/sms.provider.js';
import type { NotificationProvider } from './notification/notification.types.js';

export interface SendInvoiceParams {
  invoiceId: string;
  channel: NotificationChannel;
  recipient?: string;
}

export interface SendReminderParams {
  invoiceId: string;
  channel: NotificationChannel;
  recipient?: string;
}

/**
 * Default built-in templates if tenant hasn't saved custom ones yet.
 */
const DEFAULT_TEMPLATES: Record<NotificationTemplateType, { subject: string; body: string }> = {
  InvoiceSend: {
    subject: 'Tax Invoice {{invoiceNumber}} from {{companyName}}',
    body: 'Dear {{customerName}},\n\nPlease find attached Tax Invoice {{invoiceNumber}} for {{amount}}.\n\nThank you for doing business with {{companyName}}!',
  },
  PaymentReminder: {
    subject: 'Payment Reminder: Invoice {{invoiceNumber}} is due',
    body: 'Dear {{customerName}},\n\nThis is a friendly reminder that Invoice {{invoiceNumber}} for {{amount}} was due on {{dueDate}}.\n\nPlease arrange payment at your earliest convenience.\n\nRegards,\n{{companyName}}',
  },
  LowStockAlert: {
    subject: 'Low Stock Alert for {{companyName}}',
    body: 'Attention Admin,\n\nThe following product is running low on stock:\n- {{productName}} (SKU: {{sku}}): {{currentStock}} remaining (Min: {{minStockLevel}}).\n\nPlease reorder soon.',
  },
  QuotationSend: {
    subject: 'Quotation {{documentNumber}} from {{companyName}}',
    body: 'Dear {{customerName}},\n\nPlease find attached Quotation {{documentNumber}} for {{amount}}.\n\nRegards,\n{{companyName}}',
  },
};

/**
 * Replaces {{placeholder}} values in template strings.
 */
export function renderTemplate(template: string, data: Record<string, string>): string {
  let result = template;
  for (const [key, val] of Object.entries(data)) {
    const reg = new RegExp(`{{\\s*${key}\\s*}}`, 'g');
    result = result.replace(reg, val ?? '');
  }
  return result;
}

/**
 * Retrieves or initializes tenant notification configuration.
 */
export async function getNotificationConfig(tenant: TenantContext): Promise<INotificationConfig> {
  let config = await NotificationConfigModel.findOne({ companyId: tenant.companyId });
  if (!config) {
    config = await NotificationConfigModel.create({ companyId: tenant.companyId });
  }
  return config;
}

/**
 * Upserts tenant notification configuration.
 */
export async function updateNotificationConfig(
  tenant: TenantContext,
  input: Partial<INotificationConfig>
): Promise<INotificationConfig> {
  const config = await NotificationConfigModel.findOneAndUpdate(
    { companyId: tenant.companyId },
    { $set: input },
    { new: true, upsert: true }
  );
  return config;
}

/**
 * Retrieves template for a given channel and templateType, falling back to built-in default.
 */
export async function getTemplate(
  tenant: TenantContext,
  templateType: NotificationTemplateType,
  channel: NotificationChannel
): Promise<{ subject: string; body: string }> {
  const found = await NotificationTemplateModel.findOne(
    tenantFilter(tenant, { templateType, channel, isActive: true })
  );
  if (found) {
    return { subject: found.subject, body: found.body };
  }
  return DEFAULT_TEMPLATES[templateType] || { subject: 'Notification', body: 'Hello' };
}

/**
 * Selects provider instance based on channel and company settings.
 */
async function resolveProvider(
  tenant: TenantContext,
  channel: NotificationChannel
): Promise<NotificationProvider> {
  const config = await getNotificationConfig(tenant);
  if (channel === 'email') {
    return new EmailProvider(config.emailConfig);
  }
  if (channel === 'whatsapp') {
    return new WhatsAppProvider(config.whatsappConfig);
  }
  return new SmsProvider(config.smsConfig);
}

/**
 * Sends an Invoice PDF notification via the specified channel.
 */
export async function sendInvoiceNotification(
  tenant: TenantContext,
  params: SendInvoiceParams
) {
  const invoice = await SalesInvoiceModel.findOne(
    tenantFilter(tenant, { _id: params.invoiceId })
  );
  if (!invoice) throw new Error('Invoice not found');

  const customer = await CustomerModel.findById(invoice.customerId);
  const company = await CompanyModel.findById(tenant.companyId);

  const recipient =
    params.recipient ||
    (params.channel === 'email' ? customer?.email : customer?.phone) ||
    'customer@example.com';

  const tpl = await getTemplate(tenant, 'InvoiceSend', params.channel);

  const grandTotal = Number(invoice.grandTotal || 0);

  const placeholders: Record<string, string> = {
    customerName: customer?.name || 'Valued Customer',
    invoiceNumber: invoice.invoiceNumber,
    amount: `${company?.currency ?? 'INR'} ${grandTotal.toFixed(2)}`,
    companyName: company?.name || 'Khatavala',
    dueDate: invoice.dueDate ? new Date(invoice.dueDate).toLocaleDateString() : 'N/A',
  };

  const subject = renderTemplate(tpl.subject, placeholders);
  const body = renderTemplate(tpl.body, placeholders);

  // Generate Invoice PDF Buffer
  const { buffer: pdfBuffer, fileName } = await renderInvoicePdf(tenant, params.invoiceId);

  const provider = await resolveProvider(tenant, params.channel);

  const sendResult = await provider.send({
    recipient,
    subject,
    body,
    attachments: [
      {
        filename: fileName || `${invoice.invoiceNumber}.pdf`,
        content: pdfBuffer,
        contentType: 'application/pdf',
      },
    ],
  });

  // Log dispatch
  const log = await NotificationLogModel.create(
    tenantStamp(tenant, {
      channel: params.channel,
      templateType: 'InvoiceSend',
      recipient,
      subject,
      body,
      status: sendResult.success ? 'sent' : 'failed',
      errorMessage: sendResult.error,
      metadata: { invoiceId: invoice._id, customerId: customer?._id },
    })
  );

  return { log, sendResult };
}

/**
 * Sends a Payment Reminder notification.
 */
export async function sendPaymentReminder(
  tenant: TenantContext,
  params: SendReminderParams
) {
  const invoice = await SalesInvoiceModel.findOne(
    tenantFilter(tenant, { _id: params.invoiceId })
  );
  if (!invoice) throw new Error('Invoice not found');

  const customer = await CustomerModel.findById(invoice.customerId);
  const company = await CompanyModel.findById(tenant.companyId);

  const recipient =
    params.recipient ||
    (params.channel === 'email' ? customer?.email : customer?.phone) ||
    'customer@example.com';

  const tpl = await getTemplate(tenant, 'PaymentReminder', params.channel);

  const balanceDue = Number(invoice.balanceDue || 0);

  const placeholders: Record<string, string> = {
    customerName: customer?.name || 'Valued Customer',
    invoiceNumber: invoice.invoiceNumber,
    amount: `${company?.currency ?? 'INR'} ${balanceDue.toFixed(2)}`,
    companyName: company?.name || 'Khatavala',
    dueDate: invoice.dueDate ? new Date(invoice.dueDate).toLocaleDateString() : 'N/A',
  };

  const subject = renderTemplate(tpl.subject, placeholders);
  const body = renderTemplate(tpl.body, placeholders);

  const provider = await resolveProvider(tenant, params.channel);

  const sendResult = await provider.send({
    recipient,
    subject,
    body,
  });

  const log = await NotificationLogModel.create(
    tenantStamp(tenant, {
      channel: params.channel,
      templateType: 'PaymentReminder',
      recipient,
      subject,
      body,
      status: sendResult.success ? 'sent' : 'failed',
      errorMessage: sendResult.error,
      metadata: { invoiceId: invoice._id, customerId: customer?._id },
    })
  );

  return { log, sendResult };
}

/**
 * Fetches sent notification logs.
 */
export async function getNotificationLogs(
  tenant: TenantContext,
  query: { channel?: string; status?: string; limit?: number } = {}
) {
  const filter: Record<string, unknown> = {};
  if (query.channel) filter.channel = query.channel;
  if (query.status) filter.status = query.status;

  return NotificationLogModel.find(tenantFilter(tenant, filter))
    .sort({ createdAt: -1 })
    .limit(query.limit || 50)
    .lean();
}
