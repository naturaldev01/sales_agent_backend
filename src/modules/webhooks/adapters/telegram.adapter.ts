import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios, { AxiosInstance } from 'axios';
import * as https from 'https';
import { NormalizedMessage, OutgoingMessage } from '../interfaces/normalized-message.interface';

interface TelegramUpdate {
  update_id: number;
  message?: {
    message_id: number;
    from: {
      id: number;
      is_bot: boolean;
      first_name: string;
      last_name?: string;
      username?: string;
      language_code?: string;
    };
    chat: {
      id: number;
      first_name?: string;
      last_name?: string;
      username?: string;
      type: string;
    };
    date: number;
    text?: string;
    photo?: Array<{
      file_id: string;
      file_unique_id: string;
      width: number;
      height: number;
      file_size?: number;
    }>;
    video?: {
      file_id: string;
      file_unique_id: string;
      width: number;
      height: number;
      duration: number;
      mime_type?: string;
      file_size?: number;
    };
    audio?: {
      file_id: string;
      file_unique_id: string;
      duration: number;
      performer?: string;
      title?: string;
      mime_type?: string;
      file_size?: number;
    };
    document?: {
      file_id: string;
      file_unique_id: string;
      file_name?: string;
      mime_type?: string;
      file_size?: number;
    };
    location?: {
      latitude: number;
      longitude: number;
    };
    sticker?: {
      file_id: string;
      file_unique_id: string;
      width: number;
      height: number;
      is_animated: boolean;
      emoji?: string;
    };
    caption?: string;
  };
}

@Injectable()
export class TelegramAdapter {
  private readonly logger = new Logger(TelegramAdapter.name);
  private readonly apiUrl: string;
  private readonly botToken: string;
  private readonly axiosInstance: AxiosInstance;

  constructor(private configService: ConfigService) {
    this.botToken = this.configService.get<string>('TELEGRAM_BOT_TOKEN', '');
    this.apiUrl = `https://api.telegram.org/bot${this.botToken}`;
    
    // Create axios instance with retry and timeout settings
    this.axiosInstance = axios.create({
      timeout: 60000, // 60 second timeout
      httpsAgent: new https.Agent({
        family: 4, // Force IPv4
        keepAlive: true,
        timeout: 60000,
      }),
      // Retry configuration via interceptor will be added
    });

    // Add retry interceptor
    this.axiosInstance.interceptors.response.use(
      (response) => response,
      async (error) => {
        const config = error.config;
        
        // Initialize retry count
        config.__retryCount = config.__retryCount || 0;
        
        // Max 3 retries
        if (config.__retryCount >= 3) {
          return Promise.reject(error);
        }
        
        // Only retry on network errors or 5xx errors
        const shouldRetry = 
          !error.response || 
          (error.response.status >= 500 && error.response.status <= 599);
        
        if (!shouldRetry) {
          return Promise.reject(error);
        }
        
        config.__retryCount += 1;
        this.logger.warn(`Retrying Telegram API request (attempt ${config.__retryCount}/3)...`);
        
        // Exponential backoff
        await new Promise(resolve => setTimeout(resolve, 1000 * config.__retryCount));
        
        return this.axiosInstance(config);
      }
    );
  }

  normalizeUpdate(update: TelegramUpdate): NormalizedMessage | null {
    const message = update.message;
    if (!message) {
      this.logger.debug('No message in Telegram update');
      return null;
    }

    // Skip bot messages
    if (message.from?.is_bot) {
      return null;
    }

    const normalized: NormalizedMessage = {
      channel: 'telegram',
      channelMessageId: message.message_id.toString(),
      channelUserId: message.chat.id.toString(),
      senderName: [message.from?.first_name, message.from?.last_name].filter(Boolean).join(' '),
      senderLanguage: message.from?.language_code, // e.g., 'en', 'tr', 'ar', 'ru'
      mediaType: this.getMediaType(message),
      timestamp: new Date(message.date * 1000),
      rawPayload: update as unknown as Record<string, unknown>,
    };

    // Extract content based on type
    if (message.text) {
      normalized.content = message.text;
    } else if (message.caption) {
      normalized.content = message.caption;
    }

    // Handle media
    if (message.photo && message.photo.length > 0) {
      // Get the highest resolution photo
      const photo = message.photo[message.photo.length - 1];
      normalized.mediaUrl = photo.file_id;
    } else if (message.video) {
      normalized.mediaUrl = message.video.file_id;
    } else if (message.audio) {
      normalized.mediaUrl = message.audio.file_id;
    } else if (message.document) {
      normalized.mediaUrl = message.document.file_id;
    } else if (message.sticker) {
      normalized.mediaUrl = message.sticker.file_id;
    } else if (message.location) {
      normalized.location = {
        latitude: message.location.latitude,
        longitude: message.location.longitude,
      };
    }

    return normalized;
  }

  private getMediaType(message: TelegramUpdate['message']): NormalizedMessage['mediaType'] {
    if (!message) return 'text';
    if (message.photo) return 'image';
    if (message.video) return 'video';
    if (message.audio) return 'audio';
    if (message.document) return 'document';
    if (message.sticker) return 'sticker';
    if (message.location) return 'location';
    return 'text';
  }

  async sendMessage(message: OutgoingMessage): Promise<string> {
    try {
      this.logger.log(`📤 Attempting to send message to chat_id: ${message.channelUserId}`);
      
      let response;

      if (message.mediaUrl && message.mediaType) {
        // Send media message
        const method = this.getMediaMethod(message.mediaType);
        response = await this.axiosInstance.post(`${this.apiUrl}/${method}`, {
          chat_id: message.channelUserId,
          [message.mediaType]: message.mediaUrl,
          caption: message.content,
          parse_mode: 'HTML',
        });
      } else {
        // Send text message
        response = await this.axiosInstance.post(`${this.apiUrl}/sendMessage`, {
          chat_id: message.channelUserId,
          text: message.content,
          parse_mode: 'HTML',
          reply_to_message_id: message.replyToMessageId,
        });
      }

      const messageId = response.data.result?.message_id?.toString();
      this.logger.log(`✅ Telegram message sent successfully: ${messageId}`);
      return messageId;
    } catch (error: any) {
      // Detailed error logging
      this.logger.error(`❌ Failed to send Telegram message to ${message.channelUserId}`);
      
      if (error.response) {
        // Telegram API returned an error
        this.logger.error(`Telegram API Error Status: ${error.response.status}`);
        this.logger.error(`Telegram API Response: ${JSON.stringify(error.response.data)}`);
      } else if (error.code) {
        // Network/system error
        this.logger.error(`Network Error Code: ${error.code}`);
        this.logger.error(`Network Error Message: ${error.message}`);
      } else if (error.errors && Array.isArray(error.errors)) {
        // AggregateError - multiple errors
        this.logger.error(`AggregateError with ${error.errors.length} errors:`);
        error.errors.forEach((e: Error, i: number) => {
          this.logger.error(`  Error ${i + 1}: ${e.message || e}`);
        });
      } else {
        this.logger.error(`Error: ${error.message || error}`);
      }
      
      throw error;
    }
  }

  private getMediaMethod(mediaType: string): string {
    const methods: Record<string, string> = {
      image: 'sendPhoto',
      video: 'sendVideo',
      audio: 'sendAudio',
      document: 'sendDocument',
    };
    return methods[mediaType] || 'sendMessage';
  }

  async getFileUrl(fileId: string): Promise<string> {
    try {
      const response = await this.axiosInstance.get(`${this.apiUrl}/getFile`, {
        params: { file_id: fileId },
      });

      const filePath = response.data.result?.file_path;
      if (filePath) {
        return `https://api.telegram.org/file/bot${this.botToken}/${filePath}`;
      }
      throw new Error('File path not found');
    } catch (error: any) {
      this.logger.error(`Failed to get Telegram file URL: ${error.message}`);
      throw error;
    }
  }

  async setWebhook(webhookUrl: string): Promise<void> {
    const secretToken = this.configService.get<string>('TELEGRAM_WEBHOOK_SECRET');

    try {
      await this.axiosInstance.post(`${this.apiUrl}/setWebhook`, {
        url: webhookUrl,
        secret_token: secretToken,
        allowed_updates: ['message', 'callback_query'],
      });
      this.logger.log(`Telegram webhook set to: ${webhookUrl}`);
    } catch (error: any) {
      this.logger.error(`Failed to set Telegram webhook: ${error.message}`);
      throw error;
    }
  }
}

