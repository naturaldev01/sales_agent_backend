import { Injectable, Logger, UnauthorizedException, Inject, forwardRef } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { WhatsappAdapter } from './adapters/whatsapp.adapter';
import { TelegramAdapter, CallbackQueryResult } from './adapters/telegram.adapter';
import { OrchestratorService } from '../orchestrator/orchestrator.service';
import { NormalizedMessage } from './interfaces/normalized-message.interface';

@Injectable()
export class WebhooksService {
  private readonly logger = new Logger(WebhooksService.name);
  private readonly patientFormUrl: string;

  constructor(
    private readonly configService: ConfigService,
    private readonly whatsappAdapter: WhatsappAdapter,
    private readonly telegramAdapter: TelegramAdapter,
    @Inject(forwardRef(() => OrchestratorService))
    private readonly orchestratorService: OrchestratorService,
  ) {
    this.patientFormUrl = this.configService.get<string>('PATIENT_FORM_URL', 'https://health-form-six.vercel.app');
  }

  // ==================== WHATSAPP ====================

  verifyWhatsapp(mode: string, token: string, challenge: string): string {
    const verifyToken = this.configService.get<string>('WHATSAPP_VERIFY_TOKEN');

    if (mode === 'subscribe' && token === verifyToken) {
      this.logger.log('WhatsApp webhook verified');
      return challenge;
    }

    this.logger.warn('WhatsApp webhook verification failed');
    throw new UnauthorizedException('Verification failed');
  }

  async handleWhatsapp(payload: any): Promise<void> {
    const isEnabled = this.configService.get<string>('ENABLE_WHATSAPP') === 'true';
    if (!isEnabled) {
      this.logger.warn('WhatsApp is disabled, skipping webhook');
      return;
    }

    try {
      // Normalize the message
      const normalizedMessages = this.whatsappAdapter.normalizeWebhook(payload);

      for (const message of normalizedMessages) {
        if (message) {
          await this.processNormalizedMessage(message);
        }
      }
    } catch (error) {
      this.logger.error('Error processing WhatsApp webhook:', error);
      throw error;
    }
  }

  // ==================== TELEGRAM ====================

  async handleTelegram(payload: any, secretToken?: string): Promise<void> {
    const isEnabled = this.configService.get<string>('ENABLE_TELEGRAM') === 'true';
    if (!isEnabled) {
      this.logger.warn('Telegram is disabled, skipping webhook');
      return;
    }

    // Verify secret token if configured
    const expectedToken = this.configService.get<string>('TELEGRAM_WEBHOOK_SECRET');
    if (expectedToken && secretToken !== expectedToken) {
      this.logger.warn('Telegram webhook secret mismatch');
      throw new UnauthorizedException('Invalid secret token');
    }

    try {
      // Check if this is a callback query (button press)
      if (this.telegramAdapter.hasCallbackQuery(payload)) {
        const callbackResult = this.telegramAdapter.parseCallbackQuery(payload);
        if (callbackResult) {
          await this.handleTelegramCallback(callbackResult);
          return;
        }
      }

      // Normalize the message
      const normalizedMessage = this.telegramAdapter.normalizeUpdate(payload);

      if (normalizedMessage) {
        await this.processNormalizedMessage(normalizedMessage);
      }
    } catch (error) {
      this.logger.error('Error processing Telegram webhook:', error);
      throw error;
    }
  }

  /**
   * Handle Telegram callback query (button presses)
   */
  private async handleTelegramCallback(callback: CallbackQueryResult): Promise<void> {
    this.logger.log(`Telegram callback received: ${callback.data} from chat ${callback.chatId}`);

    try {
      // Acknowledge the callback query first
      await this.telegramAdapter.answerCallbackQuery(callback.callbackQueryId);

      const language = callback.language || 'en';

      // Handle different callback types
      switch (callback.data) {
        case 'consent_approve':
          this.logger.log(`User ${callback.chatId} approved consent`);
          await this.orchestratorService.handleCallbackConsentResponse(
            callback.chatId,
            true,
            language,
          );
          break;

        case 'consent_decline':
          this.logger.log(`User ${callback.chatId} declined consent`);
          await this.orchestratorService.handleCallbackConsentResponse(
            callback.chatId,
            false,
            language,
          );
          break;

        case 'flow_form':
          this.logger.log(`User ${callback.chatId} selected form flow`);
          await this.orchestratorService.handleCallbackFlowSelection(
            callback.chatId,
            'form',
            language,
          );
          break;

        case 'flow_chat':
          this.logger.log(`User ${callback.chatId} selected chat flow`);
          await this.orchestratorService.handleCallbackFlowSelection(
            callback.chatId,
            'chat',
            language,
          );
          break;

        default:
          this.logger.warn(`Unknown callback data: ${callback.data}`);
      }
    } catch (error) {
      this.logger.error('Error handling Telegram callback:', error);
      throw error;
    }
  }

  // ==================== COMMON PROCESSING ====================

  private async processNormalizedMessage(message: NormalizedMessage): Promise<void> {
    this.logger.log(`Processing message from ${message.channel}:${message.channelUserId}`);

    try {
      // Send to orchestrator for processing
      await this.orchestratorService.handleIncomingMessage(message);
    } catch (error) {
      this.logger.error('Error in orchestrator processing:', error);
      throw error;
    }
  }
}

