import { api } from './api';
import type { ApiResponse } from '@/types';

export interface NotificationConfigPayload {
  _id?: string;
  companyId?: string;
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
}

export interface NotificationTemplatePayload {
  _id?: string;
  templateType: 'InvoiceSend' | 'PaymentReminder' | 'LowStockAlert' | 'QuotationSend';
  channel: 'email' | 'whatsapp' | 'sms';
  subject: string;
  body: string;
  isActive: boolean;
}

export interface NotificationLogItem {
  _id: string;
  channel: 'email' | 'whatsapp' | 'sms';
  templateType: string;
  recipient: string;
  subject?: string;
  body: string;
  status: 'queued' | 'sent' | 'failed';
  errorMessage?: string;
  sentAt: string;
}

export async function getNotificationConfig(): Promise<NotificationConfigPayload> {
  const { data } = await api.get<ApiResponse<NotificationConfigPayload>>('/notifications/config');
  return data.data!;
}

export async function updateNotificationConfig(
  input: Partial<NotificationConfigPayload>
): Promise<NotificationConfigPayload> {
  const { data } = await api.put<ApiResponse<NotificationConfigPayload>>('/notifications/config', input);
  return data.data!;
}

export async function getNotificationTemplates(): Promise<NotificationTemplatePayload[]> {
  const { data } = await api.get<ApiResponse<NotificationTemplatePayload[]>>('/notifications/templates');
  return data.data!;
}

export async function upsertNotificationTemplate(
  input: NotificationTemplatePayload
): Promise<NotificationTemplatePayload> {
  const { data } = await api.put<ApiResponse<NotificationTemplatePayload>>('/notifications/templates', input);
  return data.data!;
}

export async function getNotificationHistory(params?: {
  channel?: string;
  status?: string;
  limit?: number;
}): Promise<NotificationLogItem[]> {
  const { data } = await api.get<ApiResponse<NotificationLogItem[]>>('/notifications/history', { params });
  return data.data!;
}

export async function sendInvoiceNotification(input: {
  invoiceId: string;
  channel: 'email' | 'whatsapp' | 'sms';
  recipient?: string;
}): Promise<{ success: boolean; error?: string }> {
  const { data } = await api.post<ApiResponse<{ sendResult: { success: boolean; error?: string } }>>(
    '/notifications/send-invoice',
    input
  );
  return data.data!.sendResult;
}

export async function sendPaymentReminder(input: {
  invoiceId: string;
  channel: 'email' | 'whatsapp' | 'sms';
  recipient?: string;
}): Promise<{ success: boolean; error?: string }> {
  const { data } = await api.post<ApiResponse<{ sendResult: { success: boolean; error?: string } }>>(
    '/notifications/send-reminder',
    input
  );
  return data.data!.sendResult;
}
