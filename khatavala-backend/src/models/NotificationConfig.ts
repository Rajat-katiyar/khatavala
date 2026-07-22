import { Schema, model, type Document } from 'mongoose';

export interface INotificationConfig extends Document {
  companyId: Schema.Types.ObjectId;
  emailConfig: {
    smtpHost: string;
    smtpPort: number;
    smtpUser: string;
    smtpPass: string;
    fromEmail: string;
    fromName: string;
    useTls: boolean;
  };
  whatsappConfig: {
    phoneNumberId: string;
    accessToken: string;
    senderNumber: string;
    providerName: string;
  };
  smsConfig: {
    apiKey: string;
    senderId: string;
    providerName: string;
  };
  createdAt: Date;
  updatedAt: Date;
}

const notificationConfigSchema = new Schema<INotificationConfig>(
  {
    companyId: {
      type: Schema.Types.ObjectId,
      ref: 'Company',
      required: true,
      unique: true,
      index: true,
    },
    emailConfig: {
      smtpHost: { type: String, trim: true, default: '' },
      smtpPort: { type: Number, default: 587 },
      smtpUser: { type: String, trim: true, default: '' },
      smtpPass: { type: String, default: '' },
      fromEmail: { type: String, trim: true, default: '' },
      fromName: { type: String, trim: true, default: 'Khatavala Invoicing' },
      useTls: { type: Boolean, default: true },
    },
    whatsappConfig: {
      phoneNumberId: { type: String, trim: true, default: '' },
      accessToken: { type: String, default: '' },
      senderNumber: { type: String, trim: true, default: '' },
      providerName: { type: String, trim: true, default: 'MetaCloudAPI' },
    },
    smsConfig: {
      apiKey: { type: String, default: '' },
      senderId: { type: String, trim: true, default: '' },
      providerName: { type: String, trim: true, default: 'MSG91' },
    },
  },
  { timestamps: true }
);

export const NotificationConfigModel = model<INotificationConfig>(
  'NotificationConfig',
  notificationConfigSchema
);
