import nodemailer from 'nodemailer';
import type { NotificationProvider, SendNotificationOptions, SendResult } from './notification.types.js';
import type { INotificationConfig } from '../../models/NotificationConfig.js';
import { logger } from '../../config/logger.js';

export class EmailProvider implements NotificationProvider {
  channel: 'email' = 'email';

  private config?: INotificationConfig['emailConfig'];

  constructor(config?: INotificationConfig['emailConfig']) {
    this.config = config;
  }

  private async createTransporter() {
    if (this.config?.smtpHost && this.config?.smtpUser) {
      return nodemailer.createTransport({
        host: this.config.smtpHost,
        port: this.config.smtpPort || 587,
        secure: this.config.smtpPort === 465,
        auth: {
          user: this.config.smtpUser,
          pass: this.config.smtpPass,
        },
      });
    }

    // Fallback to ethereal test account when SMTP is not configured
    logger.info('[EmailProvider] No custom SMTP configured. Creating temporary Ethereal test account.');
    const testAccount = await nodemailer.createTestAccount();
    return nodemailer.createTransport({
      host: 'smtp.ethereal.email',
      port: 587,
      secure: false,
      auth: {
        user: testAccount.user,
        pass: testAccount.pass,
      },
    });
  }

  async send(options: SendNotificationOptions): Promise<SendResult> {
    try {
      const transporter = await this.createTransporter();

      const fromAddress = this.config?.fromEmail
        ? `"${this.config.fromName || 'Khatavala'}" <${this.config.fromEmail}>`
        : '"Khatavala Billing" <no-reply@khatavala.local>';

      const info = await transporter.sendMail({
        from: fromAddress,
        to: options.recipient,
        subject: options.subject || 'Notification from Khatavala',
        html: options.body.replace(/\n/g, '<br/>'),
        text: options.body,
        attachments: options.attachments?.map((a) => ({
          filename: a.filename,
          content: a.content,
          contentType: a.contentType || 'application/pdf',
        })),
      });

      const testUrl = nodemailer.getTestMessageUrl(info);
      if (testUrl) {
        logger.info(`[EmailProvider] Ethereal Email Preview URL: ${testUrl}`);
      }

      return {
        success: true,
        messageId: info.messageId,
      };
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      logger.error('[EmailProvider] Failed to send email', err);
      return {
        success: false,
        error: errorMsg,
      };
    }
  }
}
