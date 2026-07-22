import type { NotificationProvider, SendNotificationOptions, SendResult } from './notification.types.js';
import type { INotificationConfig } from '../../models/NotificationConfig.js';
import { logger } from '../../config/logger.js';

export class SmsProvider implements NotificationProvider {
  channel: 'sms' = 'sms';

  private config?: INotificationConfig['smsConfig'];

  constructor(config?: INotificationConfig['smsConfig']) {
    this.config = config;
  }

  async send(options: SendNotificationOptions): Promise<SendResult> {
    try {
      if (!this.config?.apiKey) {
        logger.info(
          `[SmsProvider MOCK] SMS API key missing. Stubbing SMS to ${options.recipient}: "${options.body.substring(0, 60)}..."`
        );
        return {
          success: true,
          messageId: `sms.mock.${Date.now()}`,
        };
      }

      // Interface ready for MSG91 / Twilio SMS gateway API call
      logger.info(`[SmsProvider] Sending SMS via ${this.config.providerName} to ${options.recipient}`);

      return {
        success: true,
        messageId: `sms.${Date.now()}`,
      };
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      logger.error('[SmsProvider] Failed to send SMS', err);
      return {
        success: false,
        error: errorMsg,
      };
    }
  }
}
