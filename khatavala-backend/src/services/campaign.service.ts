import { CampaignModel } from '../models/Campaign.js';
import { CustomerModel } from '../models/Customer.js';
import { NotificationLogModel } from '../models/NotificationLog.js';
import { tenantFilter, tenantStamp, type TenantContext } from '../middlewares/tenantScope.js';
import { ApiError } from '../utils/ApiError.js';
import { WhatsAppProvider } from './notification/whatsapp.provider.js';
import { SmsProvider } from './notification/sms.provider.js';
import { EmailProvider } from './notification/email.provider.js';

/* ── CRUD ─────────────────────────────────────────────────────────────── */

export async function listCampaigns(tenant: TenantContext) {
  return CampaignModel.find(tenantFilter(tenant, {})).sort({ createdAt: -1 }).lean();
}

export async function getCampaign(tenant: TenantContext, id: string) {
  const campaign = await CampaignModel.findOne(tenantFilter(tenant, { _id: id })).lean();
  if (!campaign) throw ApiError.notFound('Campaign not found');
  return campaign;
}

export async function createCampaign(tenant: TenantContext, body: Record<string, any>) {
  const campaign = await CampaignModel.create(tenantStamp(tenant, body));
  return campaign;
}

export async function updateCampaign(tenant: TenantContext, id: string, body: Record<string, any>) {
  const campaign = await CampaignModel.findOneAndUpdate(
    tenantFilter(tenant, { _id: id }),
    { $set: body },
    { new: true }
  );
  if (!campaign) throw ApiError.notFound('Campaign not found');
  return campaign;
}

export async function deleteCampaign(tenant: TenantContext, id: string) {
  await CampaignModel.findOneAndDelete(tenantFilter(tenant, { _id: id }));
}

/* ── Targeting ───────────────────────────────────────────────────────── */

async function resolveRecipients(
  tenant: TenantContext,
  targetSegment: string,
  targetTag?: string,
  minOutstanding?: number
) {
  const baseFilter = tenantFilter(tenant, { isActive: true });

  if (targetSegment === 'ByTag' && targetTag) {
    return CustomerModel.find({ ...baseFilter, tags: targetTag })
      .select('name phone email')
      .lean();
  }

  if (targetSegment === 'ByOutstanding' && minOutstanding && minOutstanding > 0) {
    return CustomerModel.find({ ...baseFilter, outstandingBalance: { $gte: minOutstanding } })
      .select('name phone email')
      .lean();
  }

  // AllCustomers
  return CustomerModel.find(baseFilter).select('name phone email').lean();
}

/* ── Send Campaign ───────────────────────────────────────────────────── */

function renderMessage(template: string, vars: Record<string, string>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key) => vars[key] ?? '');
}

export async function sendCampaign(tenant: TenantContext, campaignId: string) {
  const campaign = await CampaignModel.findOne(tenantFilter(tenant, { _id: campaignId }));
  if (!campaign) throw ApiError.notFound('Campaign not found');
  if (campaign.status === 'Sent') throw ApiError.badRequest('Campaign already sent');

  const recipients = await resolveRecipients(
    tenant,
    campaign.targetSegment,
    campaign.targetTag ?? undefined,
    campaign.minOutstanding ?? 0
  );

  campaign.status = 'Sending';
  campaign.totalRecipients = recipients.length;
  await campaign.save();

  let sentCount = 0;
  let failedCount = 0;

  // Rate-limited delivery — 1 per 300ms to avoid WhatsApp API throttling
  const RATE_DELAY_MS = 300;

  for (const customer of recipients) {
    const message = renderMessage(campaign.messageTemplate, {
      customerName: customer.name,
      companyName: String(tenant.companyId),
    });

    const recipient = (customer as any).phone || (customer as any).email || '';

    try {
      const provider = campaign.channel === 'SMS'
        ? new SmsProvider()
        : campaign.channel === 'Email'
          ? new EmailProvider()
          : new WhatsAppProvider();

      await provider.send({
        recipient,
        subject: campaign.name,
        body: message,
      });

      await NotificationLogModel.create({
        companyId: tenant.companyId,
        channel: campaign.channel.toLowerCase(),
        recipient,
        status: 'Sent',
        subject: campaign.name,
        body: message,
        campaignId: String(campaign._id),
      });

      sentCount++;
    } catch (err) {
      await NotificationLogModel.create({
        companyId: tenant.companyId,
        channel: campaign.channel.toLowerCase(),
        recipient,
        status: 'Failed',
        subject: campaign.name,
        body: message,
        error: err instanceof Error ? err.message : 'Unknown error',
        campaignId: String(campaign._id),
      });
      failedCount++;
    }

    // Respect rate limits
    await new Promise((r) => setTimeout(r, RATE_DELAY_MS));
  }

  campaign.status = 'Sent';
  campaign.sentCount = sentCount;
  campaign.failedCount = failedCount;
  await campaign.save();

  return { sentCount, failedCount, totalRecipients: recipients.length };
}

/* ── Campaign Delivery Report ────────────────────────────────────────── */

export async function getCampaignReport(tenant: TenantContext, campaignId: string) {
  const campaign = await getCampaign(tenant, campaignId);
  const logs = await NotificationLogModel.find({
    companyId: tenant.companyId,
    campaignId,
  })
    .sort({ createdAt: -1 })
    .lean();

  return { campaign, logs };
}

/* ── Smart Ad Copy Generator ─────────────────────────────────────────── */

export async function generateAdCopy(
  tenant: TenantContext,
  productName: string,
  sellingPrice: number,
  mrp?: number,
  description?: string
): Promise<string[]> {
  const discount = mrp && mrp > sellingPrice
    ? `Flat ${Math.round(((mrp - sellingPrice) / mrp) * 100)}% off`
    : 'Special offer';

  const savings = mrp && mrp > sellingPrice ? `Save ₹${(mrp - sellingPrice).toFixed(0)}` : '';

  // Template-based ad copy generator (LLM-style structured output without requiring API keys)
  const variants: string[] = [
    `🛍️ *${productName}* — Now at just *₹${sellingPrice}*! ${savings ? `(${savings}) ` : ''}${discount}. Limited stock, order now! 👉 ${description || ''}`,

    `✨ Introducing *${productName}*!\n💰 Price: ₹${sellingPrice}${mrp ? ` (MRP ₹${mrp})` : ''}\n${savings ? `💸 ${savings}\n` : ''}🛒 Tap to order on WhatsApp or visit our online store!`,

    `🔥 Grab *${productName}* at ₹${sellingPrice} — ${discount}!\n${description ? `📦 ${description}\n` : ''}📲 Message us to order. Fast delivery guaranteed! #ShopNow #${productName.replace(/\s+/g, '')}`,
  ];

  return variants;
}
