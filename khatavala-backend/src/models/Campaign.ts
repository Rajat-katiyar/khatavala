import { Schema, model, type InferSchemaType } from 'mongoose';

export const CAMPAIGN_STATUSES = ['Draft', 'Scheduled', 'Sending', 'Sent', 'Failed', 'Cancelled'] as const;
export type CampaignStatus = (typeof CAMPAIGN_STATUSES)[number];

export const TARGET_SEGMENTS = ['AllCustomers', 'ByTag', 'ByOutstanding'] as const;
export type TargetSegment = (typeof TARGET_SEGMENTS)[number];

/**
 * WhatsApp / SMS Marketing Campaign.
 * Sent via the notification provider built in Phase 17.
 */
const campaignSchema = new Schema(
  {
    companyId: {
      type: Schema.Types.ObjectId,
      ref: 'Company',
      required: true,
      index: true,
    },
    name: { type: String, required: true, trim: true },
    channel: { type: String, enum: ['WhatsApp', 'SMS', 'Email'], default: 'WhatsApp' },
    /** Who receives the campaign */
    targetSegment: {
      type: String,
      enum: TARGET_SEGMENTS,
      required: true,
      default: 'AllCustomers',
    },
    /** Only used when targetSegment = 'ByTag' */
    targetTag: { type: String, trim: true, default: null },
    /** Only used when targetSegment = 'ByOutstanding' — minimum overdue amount */
    minOutstanding: { type: Number, default: 0 },
    /** The message body with optional {{customerName}}, {{companyName}} placeholders */
    messageTemplate: { type: String, required: true },
    scheduledAt: { type: Date, required: true },
    status: {
      type: String,
      enum: CAMPAIGN_STATUSES,
      default: 'Draft',
    },
    totalRecipients: { type: Number, default: 0 },
    sentCount: { type: Number, default: 0 },
    failedCount: { type: Number, default: 0 },
  },
  { timestamps: true }
);

export type ICampaign = InferSchemaType<typeof campaignSchema>;
export const CampaignModel = model('Campaign', campaignSchema);
