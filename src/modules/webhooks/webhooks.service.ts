import { Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { WhatsappAdapter } from './adapters/whatsapp.adapter';
import { TelegramAdapter } from './adapters/telegram.adapter';
import { OrchestratorService } from '../orchestrator/orchestrator.service';
import { NormalizedMessage } from './interfaces/normalized-message.interface';

@Injectable()
export class WebhooksService {
  private readonly logger = new Logger(WebhooksService.name);

  constructor(
    private readonly configService: ConfigService,
    private readonly whatsappAdapter: WhatsappAdapter,
    private readonly telegramAdapter: TelegramAdapter,
    private readonly orchestratorService: OrchestratorService,
  ) {}

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

