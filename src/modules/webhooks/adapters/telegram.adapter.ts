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
  callback_query?: {
    id: string;
    from: {
      id: number;
      is_bot: boolean;
      first_name: string;
      last_name?: string;
      username?: string;
      language_code?: string;
    };
    message?: {
      message_id: number;
      chat: {
        id: number;
        type: string;
      };
    };
    chat_instance: string;
    data?: string; // Callback data from button
  };
}

// Result type for callback query processing
export interface CallbackQueryResult {
  type: 'callback_query';
  callbackQueryId: string;
  chatId: string;
  userId: string;
  data: string;
  userName?: string;
  language?: string;
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

  /**
   * Check if update contains a callback query (button press)
   */
  hasCallbackQuery(update: TelegramUpdate): boolean {
    return !!update.callback_query;
  }

  /**
   * Parse callback query from update
   */
  parseCallbackQuery(update: TelegramUpdate): CallbackQueryResult | null {
    const callback = update.callback_query;
    if (!callback) {
      return null;
    }

    return {
      type: 'callback_query',
      callbackQueryId: callback.id,
      chatId: callback.message?.chat?.id?.toString() || callback.from.id.toString(),
      userId: callback.from.id.toString(),
      data: callback.data || '',
      userName: [callback.from.first_name, callback.from.last_name].filter(Boolean).join(' '),
      language: callback.from.language_code,
    };
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

  /**
   * Send message with inline keyboard buttons
   */
  async sendMessageWithInlineKeyboard(
    chatId: string,
    text: string,
    buttons: Array<Array<{ text: string; callback_data: string }>>,
  ): Promise<string> {
    try {
      const response = await this.axiosInstance.post(`${this.apiUrl}/sendMessage`, {
        chat_id: chatId,
        text,
        parse_mode: 'HTML',
        reply_markup: {
          inline_keyboard: buttons,
        },
      });

      const messageId = response.data.result?.message_id?.toString();
      this.logger.log(`Telegram inline keyboard message sent: ${messageId}`);
      return messageId;
    } catch (error: any) {
      this.logger.error('Failed to send Telegram inline keyboard message:', error.message);
      throw error;
    }
  }

  /**
   * Send KVKK consent message with approval buttons
   */
  async sendKvkkConsentMessage(
    chatId: string,
    language: string,
    kvkkLinkUrl: string,
  ): Promise<string> {
    const messages: Record<string, { text: string; approve: string; decline: string }> = {
      tr: {
        text: `Size daha iyi yardımcı olabilmem için birkaç bilgi ve fotoğraf isteyeceğim.\n\nPaylaştığınız bilgiler yalnızca doktor değerlendirmesi için kullanılacaktır.\n\n📋 <a href="${kvkkLinkUrl}">KVKK Aydınlatma Metni</a>\n\n<i>Verileriniz güvende tutulacaktır.</i>`,
        approve: '✅ Onaylıyorum',
        decline: '❌ Onaylamıyorum',
      },
      en: {
        text: `To better assist you, I'll need to ask for some information and photos.\n\nThe information you share will only be used for doctor evaluation.\n\n📋 <a href="${kvkkLinkUrl}">Privacy Policy</a>\n\n<i>Your data will be kept safe.</i>`,
        approve: '✅ I Approve',
        decline: '❌ I Decline',
      },
      ar: {
        text: `لمساعدتك بشكل أفضل، سأحتاج إلى بعض المعلومات والصور.\n\nالمعلومات التي تشاركها ستُستخدم فقط لتقييم الطبيب.\n\n📋 <a href="${kvkkLinkUrl}">سياسة الخصوصية</a>\n\n<i>بياناتك ستبقى آمنة.</i>`,
        approve: '✅ أوافق',
        decline: '❌ لا أوافق',
      },
      fr: {
        text: `Pour mieux vous aider, j'aurai besoin de quelques informations et photos.\n\nLes informations partagées seront uniquement utilisées pour l'évaluation médicale.\n\n📋 <a href="${kvkkLinkUrl}">Politique de confidentialité</a>\n\n<i>Vos données seront protégées.</i>`,
        approve: '✅ J\'approuve',
        decline: '❌ Je refuse',
      },
    };

    const msg = messages[language] || messages.en;

    return this.sendMessageWithInlineKeyboard(chatId, msg.text, [
      [
        { text: msg.approve, callback_data: 'consent_approve' },
        { text: msg.decline, callback_data: 'consent_decline' },
      ],
    ]);
  }

  /**
   * Send flow selection after KVKK approval (Form vs Chat)
   */
  async sendFlowSelectionMessage(
    chatId: string,
    language: string,
    formUrl: string,
  ): Promise<string> {
    const messages: Record<string, { text: string; form: string; chat: string }> = {
      tr: {
        text: `Teşekkürler! Şimdi nasıl devam etmek istersiniz?\n\n📝 <b>Form:</b> Bilgilerinizi hızlıca form üzerinden doldurun.\n💬 <b>Danışman:</b> Benimle sohbet ederek ilerleyin.`,
        form: '📝 Form ile devam',
        chat: '💬 Danışmanla devam',
      },
      en: {
        text: `Thank you! How would you like to continue?\n\n📝 <b>Form:</b> Quickly fill out your information via form.\n💬 <b>Consultant:</b> Continue chatting with me.`,
        form: '📝 Continue with Form',
        chat: '💬 Chat with Consultant',
      },
      ar: {
        text: `شكراً! كيف تريد المتابعة؟\n\n📝 <b>النموذج:</b> املأ معلوماتك بسرعة عبر النموذج.\n💬 <b>المستشار:</b> تابع الدردشة معي.`,
        form: '📝 متابعة بالنموذج',
        chat: '💬 الدردشة مع مستشار',
      },
      fr: {
        text: `Merci! Comment souhaitez-vous continuer?\n\n📝 <b>Formulaire:</b> Remplissez rapidement vos informations.\n💬 <b>Consultant:</b> Continuez à discuter avec moi.`,
        form: '📝 Continuer avec Form',
        chat: '💬 Discuter avec Consultant',
      },
    };

    const msg = messages[language] || messages.en;

    return this.sendMessageWithInlineKeyboard(chatId, msg.text, [
      [
        { text: msg.form, callback_data: 'flow_form' },
        { text: msg.chat, callback_data: 'flow_chat' },
      ],
    ]);
  }

  /**
   * Send form link message with inline button
   */
  async sendFormLinkMessage(
    chatId: string,
    language: string,
    formUrl: string,
  ): Promise<string> {
    const messages: Record<string, { text: string; button: string }> = {
      tr: {
        text: `Harika seçim! 📝\n\nAşağıdaki butona tıklayarak formu doldurun.\nForm tamamlandığında doktorlarımız değerlendirecektir.`,
        button: '📋 Formu Doldur',
      },
      en: {
        text: `Great choice! 📝\n\nClick the button below to fill out the form.\nOnce completed, our doctors will evaluate.`,
        button: '📋 Fill Out Form',
      },
      ar: {
        text: `اختيار رائع! 📝\n\nانقر على الزر أدناه لملء النموذج.\nبمجرد الانتهاء، سيقوم أطباؤنا بالتقييم.`,
        button: '📋 ملء النموذج',
      },
      fr: {
        text: `Excellent choix! 📝\n\nCliquez sur le bouton ci-dessous pour remplir le formulaire.\nUne fois terminé, nos médecins évalueront.`,
        button: '📋 Remplir le formulaire',
      },
    };

    const msg = messages[language] || messages.en;

    try {
      // Send message with URL button (opens in browser)
      const response = await this.axiosInstance.post(`${this.apiUrl}/sendMessage`, {
        chat_id: chatId,
        text: msg.text,
        parse_mode: 'HTML',
        reply_markup: {
          inline_keyboard: [
            [
              { text: msg.button, url: formUrl },
            ],
          ],
        },
      });

      const messageId = response.data.result?.message_id?.toString();
      this.logger.log(`Telegram form link message sent: ${messageId}`);
      return messageId;
    } catch (error: any) {
      this.logger.error('Failed to send Telegram form link message:', error.message);
      // Fallback to regular message with link
      return this.sendMessage({ 
        channel: 'telegram', 
        channelUserId: chatId, 
        content: `${msg.text}\n\n🔗 ${formUrl}` 
      });
    }
  }

  /**
   * Answer callback query (acknowledge button press)
   */
  async answerCallbackQuery(
    callbackQueryId: string,
    text?: string,
  ): Promise<void> {
    try {
      await this.axiosInstance.post(`${this.apiUrl}/answerCallbackQuery`, {
        callback_query_id: callbackQueryId,
        text,
      });
    } catch (error: any) {
      this.logger.warn('Failed to answer callback query:', error.message);
    }
  }
}

