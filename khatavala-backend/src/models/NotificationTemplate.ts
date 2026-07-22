import { Schema, model, type Document } from 'mongoose';

export type NotificationTemplateType =
  | 'InvoiceSend'
  | 'PaymentReminder'
  | 'LowStockAlert'
  | 'QuotationSend';

export type NotificationChannel = 'email' | 'whatsapp' | 'sms';

export interface INotificationTemplate extends Document {
  companyId: Schema.Types.ObjectId;
  templateType: NotificationTemplateType;
  channel: NotificationChannel;
  subject: string;
  body: string;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const notificationTemplateSchema = new Schema<INotificationTemplate>(
  {
    companyId: {
      type: Schema.Types.ObjectId,
      ref: 'Company',
      required: true,
      index: true,
    },
    templateType: {
      type: String,
      enum: ['InvoiceSend', 'PaymentReminder', 'LowStockAlert', 'QuotationSend'],
      required: true,
    },
    channel: {
      type: String,
      enum: ['email', 'whatsapp', 'sms'],
      required: true,
      default: 'email',
    },
    subject: { type: String, trim: true, default: '' },
    body: { type: String, required: true },
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true }
);

notificationTemplateSchema.index({ companyId: 1, templateType: 1, channel: 1 }, { unique: true });

export const NotificationTemplateModel = model<INotificationTemplate>(
  'NotificationTemplate',
  notificationTemplateSchema
);
