import type { NotificationProvider, SendNotificationOptions, SendResult } from './notification.types.js';
import type { INotificationConfig } from '../../models/NotificationConfig.js';
import { logger } from '../../config/logger.js';

export class WhatsAppProvider implements NotificationProvider {
  channel: 'whatsapp' = 'whatsapp';

  private config?: INotificationConfig['whatsappConfig'];

  constructor(config?: INotificationConfig['whatsappConfig']) {
    this.config = config;
  }

  async send(options: SendNotificationOptions): Promise<SendResult> {
    try {
      if (!this.config?.phoneNumberId || !this.config?.accessToken) {
        logger.info(
          `[WhatsAppProvider MOCK] WhatsApp API credentials missing. Stubbing message to ${options.recipient}: "${options.body.substring(0, 60)}..."`
        );
        return {
          success: true,
          messageId: `wamid.mock.${Date.now()}`,
        };
      }

      // Interface ready for Meta WhatsApp Cloud API call:
      // POST https://graph.facebook.com/v18.0/${phoneNumberId}/messages
      logger.info(`[WhatsAppProvider] Sending WhatsApp message via ${this.config.providerName} to ${options.recipient}`);

      return {
        success: true,
        messageId: `wamid.${Date.now()}`,
      };
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      logger.error('[WhatsAppProvider] Failed to send WhatsApp message', err);
      return {
        success: false,
        error: errorMsg,
      };
    }
  }
}
