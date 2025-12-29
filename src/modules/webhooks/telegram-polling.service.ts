import { Injectable, OnModuleInit, OnModuleDestroy, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import { TelegramAdapter } from './adapters/telegram.adapter';
import { OrchestratorService } from '../orchestrator/orchestrator.service';

@Injectable()
export class TelegramPollingService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(TelegramPollingService.name);
  private readonly apiUrl: string;
  private readonly botToken: string;
  private isPolling = false;
  private pollTimeout: NodeJS.Timeout | null = null;
  private lastUpdateId = 0;

  constructor(
    private readonly configService: ConfigService,
    private readonly telegramAdapter: TelegramAdapter,
    private readonly orchestratorService: OrchestratorService,
  ) {
    this.botToken = this.configService.get<string>('TELEGRAM_BOT_TOKEN', '');
    this.apiUrl = `https://api.telegram.org/bot${this.botToken}`;
  }

  async onModuleInit() {
    const isEnabled = this.configService.get<string>('ENABLE_TELEGRAM') === 'true';
    const usePolling = this.configService.get<string>('TELEGRAM_USE_POLLING') === 'true';

    if (!isEnabled) {
      this.logger.log('Telegram is disabled');
      return;
    }

    if (!this.botToken || this.botToken === 'your_telegram_bot_token_here') {
      this.logger.warn('Telegram bot token not configured');
      return;
    }

    if (usePolling) {
      // Delete any existing webhook first
      await this.deleteWebhook();
      this.startPolling();
    } else {
      this.logger.log('Telegram polling disabled, using webhook mode');
    }
  }

  async onModuleDestroy() {
    this.stopPolling();
  }

  private async deleteWebhook(): Promise<void> {
    try {
      await axios.post(`${this.apiUrl}/deleteWebhook`);
      this.logger.log('Telegram webhook deleted');
    } catch (error) {
      this.logger.error('Failed to delete webhook:', error);
    }
  }

  private startPolling(): void {
    if (this.isPolling) return;

    this.isPolling = true;
    this.logger.log('🚀 Telegram polling started');
    this.poll();
  }

  private stopPolling(): void {
    this.isPolling = false;
    if (this.pollTimeout) {
      clearTimeout(this.pollTimeout);
      this.pollTimeout = null;
    }
    this.logger.log('Telegram polling stopped');
  }

  private async poll(): Promise<void> {
    if (!this.isPolling) return;

    try {
      const response = await axios.get(`${this.apiUrl}/getUpdates`, {
        params: {
          offset: this.lastUpdateId + 1,
          timeout: 30, // Long polling - wait up to 30 seconds
          allowed_updates: ['message'],
        },
        timeout: 35000, // axios timeout slightly longer than Telegram timeout
      });

      const updates = response.data.result || [];

      for (const update of updates) {
        this.lastUpdateId = update.update_id;
        await this.processUpdate(update);
      }
    } catch (error: any) {
      if (error.code === 'ECONNABORTED' || error.code === 'ETIMEDOUT') {
        // Normal timeout, continue polling
      } else {
        this.logger.error('Polling error:', error.message);
        // Wait a bit before retrying on error
        await new Promise((resolve) => setTimeout(resolve, 5000));
      }
    }

    // Schedule next poll
    if (this.isPolling) {
      this.pollTimeout = setTimeout(() => this.poll(), 100);
    }
  }

  private async processUpdate(update: any): Promise<void> {
    try {
      this.logger.log(`📩 Telegram update received: ${update.update_id}`);

      const normalizedMessage = this.telegramAdapter.normalizeUpdate(update);

      if (normalizedMessage) {
        this.logger.log(`Processing message from ${normalizedMessage.channelUserId}: ${normalizedMessage.content}`);
        await this.orchestratorService.handleIncomingMessage(normalizedMessage);
      }
    } catch (error) {
      this.logger.error('Error processing Telegram update:', error);
    }
  }

  // Method to send message (used by orchestrator)
  async sendMessage(chatId: string, text: string): Promise<string | undefined> {
    try {
      const response = await axios.post(`${this.apiUrl}/sendMessage`, {
        chat_id: chatId,
        text: text,
        parse_mode: 'HTML',
      });

      const messageId = response.data.result?.message_id?.toString();
      this.logger.log(`📤 Telegram message sent to ${chatId}: ${messageId}`);
      return messageId;
    } catch (error: any) {
      this.logger.error(`Failed to send Telegram message: ${error.message}`);
      throw error;
    }
  }
}

