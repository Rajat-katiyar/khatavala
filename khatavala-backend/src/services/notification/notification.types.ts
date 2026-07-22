export interface SendNotificationOptions {
  recipient: string;
  subject?: string;
  body: string;
  attachments?: Array<{
    filename: string;
    content: Buffer;
    contentType?: string;
  }>;
}

export interface SendResult {
  success: boolean;
  messageId?: string;
  error?: string;
}

export interface NotificationProvider {
  channel: 'email' | 'whatsapp' | 'sms';
  send(options: SendNotificationOptions): Promise<SendResult>;
}
