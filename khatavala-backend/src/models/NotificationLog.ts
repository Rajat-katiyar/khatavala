import { Schema, model, type Document } from 'mongoose';
import type { NotificationChannel, NotificationTemplateType } from './NotificationTemplate.js';

export type NotificationStatus = 'queued' | 'Sent' | 'Failed' | 'sent' | 'failed';

export interface INotificationLog extends Document {
  companyId: Schema.Types.ObjectId;
  channel: NotificationChannel;
  templateType?: NotificationTemplateType;
  recipient: string;
  subject?: string;
  body: string;
  status: NotificationStatus;
  errorMessage?: string;
  error?: string;
  metadata?: Record<string, unknown>;
  campaignId?: Schema.Types.ObjectId;
  sentAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

const notificationLogSchema = new Schema<INotificationLog>(
  {
    companyId: {
      type: Schema.Types.ObjectId,
      ref: 'Company',
      required: true,
      index: true,
    },
    channel: {
      type: String,
      enum: ['email', 'whatsapp', 'sms'],
      required: true,
    },
    templateType: {
      type: String,
      enum: ['InvoiceSend', 'PaymentReminder', 'LowStockAlert', 'QuotationSend', 'Campaign'],
      required: false,
    },
    recipient: { type: String, required: true, trim: true },
    subject: { type: String, trim: true },
    body: { type: String, required: true },
    status: {
      type: String,
      enum: ['queued', 'sent', 'failed', 'Sent', 'Failed'],
      default: 'sent',
      index: true,
    },
    errorMessage: { type: String },
    error: { type: String },
    metadata: { type: Schema.Types.Mixed },
    campaignId: { type: Schema.Types.ObjectId, ref: 'Campaign', default: null, index: true },
    sentAt: { type: Date, default: Date.now },
  },
  { timestamps: true }
);

export const NotificationLogModel = model<INotificationLog>(
  'NotificationLog',
  notificationLogSchema
);
