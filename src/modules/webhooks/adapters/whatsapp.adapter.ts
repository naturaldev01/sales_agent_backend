import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import { NormalizedMessage, OutgoingMessage } from '../interfaces/normalized-message.interface';

export interface WhatsAppButton {
  id: string;
  title: string;
}

export interface WhatsAppInteractiveMessage {
  type: 'button' | 'list';
  header?: {
    type: 'text' | 'image';
    text?: string;
    image?: { link: string };
  };
  body: string;
  footer?: string;
  buttons?: WhatsAppButton[]; // For button type (max 3)
  sections?: Array<{           // For list type
    title: string;
    rows: Array<{
      id: string;
      title: string;
      description?: string;
    }>;
  }>;
  buttonText?: string; // For list type - the button that opens the list
}

interface WhatsappWebhookPayload {
  object: string;
  entry: Array<{
    id: string;
    changes: Array<{
      value: {
        messaging_product: string;
        metadata: {
          display_phone_number: string;
          phone_number_id: string;
        };
        contacts?: Array<{
          profile: { name: string };
          wa_id: string;
        }>;
        messages?: Array<{
          from: string;
          id: string;
          timestamp: string;
          type: string;
          text?: { body: string };
          image?: { id: string; mime_type: string; sha256: string; caption?: string };
          video?: { id: string; mime_type: string; sha256: string; caption?: string };
          audio?: { id: string; mime_type: string; sha256: string };
          document?: { id: string; mime_type: string; sha256: string; filename?: string; caption?: string };
          location?: { latitude: number; longitude: number; name?: string; address?: string };
          sticker?: { id: string; mime_type: string; sha256: string };
        }>;
        statuses?: Array<{
          id: string;
          status: string;
          timestamp: string;
          recipient_id: string;
        }>;
      };
      field: string;
    }>;
  }>;
}

@Injectable()
export class WhatsappAdapter {
  private readonly logger = new Logger(WhatsappAdapter.name);
  private readonly apiUrl: string;
  private readonly phoneNumberId: string;
  private readonly accessToken: string;

  constructor(private configService: ConfigService) {
    this.apiUrl = this.configService.get<string>('WHATSAPP_API_URL', 'https://graph.facebook.com/v18.0');
    this.phoneNumberId = this.configService.get<string>('WHATSAPP_PHONE_NUMBER_ID', '');
    this.accessToken = this.configService.get<string>('WHATSAPP_ACCESS_TOKEN', '');
  }

  normalizeWebhook(payload: WhatsappWebhookPayload): NormalizedMessage[] {
    const normalizedMessages: NormalizedMessage[] = [];

    if (payload.object !== 'whatsapp_business_account') {
      return normalizedMessages;
    }

    for (const entry of payload.entry || []) {
      for (const change of entry.changes || []) {
        if (change.field !== 'messages') continue;

        const value = change.value;
        const messages = value.messages || [];
        const contacts = value.contacts || [];

        for (const message of messages) {
          const contact = contacts.find((c) => c.wa_id === message.from);

          const normalized: NormalizedMessage = {
            channel: 'whatsapp',
            channelMessageId: message.id,
            channelUserId: message.from,
            senderName: contact?.profile?.name,
            senderPhone: message.from,
            mediaType: this.mapMediaType(message.type),
            timestamp: new Date(parseInt(message.timestamp) * 1000),
            rawPayload: message as unknown as Record<string, unknown>,
          };

          // Extract content based on type
          switch (message.type) {
            case 'text':
              normalized.content = message.text?.body;
              break;
            case 'image':
              normalized.content = message.image?.caption;
              normalized.mediaUrl = message.image?.id; // Will need to fetch actual URL
              break;
            case 'video':
              normalized.content = message.video?.caption;
              normalized.mediaUrl = message.video?.id;
              break;
            case 'audio':
              normalized.mediaUrl = message.audio?.id;
              break;
            case 'document':
              normalized.content = message.document?.caption;
              normalized.mediaUrl = message.document?.id;
              break;
            case 'location':
              normalized.location = {
                latitude: message.location?.latitude || 0,
                longitude: message.location?.longitude || 0,
              };
              normalized.content = message.location?.name || message.location?.address;
              break;
            case 'sticker':
              normalized.mediaUrl = message.sticker?.id;
              break;
          }

          normalizedMessages.push(normalized);
        }
      }
    }

    return normalizedMessages;
  }

  private mapMediaType(type: string): NormalizedMessage['mediaType'] {
    const mapping: Record<string, NormalizedMessage['mediaType']> = {
      text: 'text',
      image: 'image',
      video: 'video',
      audio: 'audio',
      document: 'document',
      location: 'location',
      sticker: 'sticker',
    };
    return mapping[type] || 'text';
  }

  async sendMessage(message: OutgoingMessage): Promise<string> {
    const url = `${this.apiUrl}/${this.phoneNumberId}/messages`;

    const payload: Record<string, unknown> = {
      messaging_product: 'whatsapp',
      to: message.channelUserId,
      type: 'text',
      text: { body: message.content },
    };

    // Handle media messages
    if (message.mediaUrl && message.mediaType) {
      payload.type = message.mediaType;
      payload[message.mediaType] = {
        link: message.mediaUrl,
        caption: message.content,
      };
      delete payload.text;
    }

    try {
      const response = await axios.post(url, payload, {
        headers: {
          Authorization: `Bearer ${this.accessToken}`,
          'Content-Type': 'application/json',
        },
      });

      const messageId = response.data.messages?.[0]?.id;
      this.logger.log(`WhatsApp message sent: ${messageId}`);
      return messageId;
    } catch (error) {
      this.logger.error('Failed to send WhatsApp message:', error);
      throw error;
    }
  }

  async getMediaUrl(mediaId: string): Promise<string> {
    try {
      // First, get media URL
      const mediaResponse = await axios.get(`${this.apiUrl}/${mediaId}`, {
        headers: { Authorization: `Bearer ${this.accessToken}` },
      });

      // Then download the media
      const mediaUrl = mediaResponse.data.url;
      return mediaUrl;
    } catch (error) {
      this.logger.error('Failed to get WhatsApp media URL:', error);
      throw error;
    }
  }

  async markAsRead(messageId: string): Promise<void> {
    const url = `${this.apiUrl}/${this.phoneNumberId}/messages`;

    try {
      await axios.post(
        url,
        {
          messaging_product: 'whatsapp',
          status: 'read',
          message_id: messageId,
        },
        {
          headers: {
            Authorization: `Bearer ${this.accessToken}`,
            'Content-Type': 'application/json',
          },
        },
      );
      this.logger.debug(`WhatsApp message marked as read: ${messageId}`);
    } catch (error) {
      this.logger.warn('Failed to mark WhatsApp message as read:', error);
    }
  }

  /**
   * Send an interactive message with buttons
   * Max 3 buttons allowed by WhatsApp
   */
  async sendInteractiveButtons(
    to: string,
    message: WhatsAppInteractiveMessage,
  ): Promise<string> {
    const url = `${this.apiUrl}/${this.phoneNumberId}/messages`;

    const payload: Record<string, unknown> = {
      messaging_product: 'whatsapp',
      to,
      type: 'interactive',
      interactive: {
        type: 'button',
        body: {
          text: message.body,
        },
        action: {
          buttons: message.buttons?.slice(0, 3).map((btn) => ({
            type: 'reply',
            reply: {
              id: btn.id,
              title: btn.title.substring(0, 20), // Max 20 chars for button title
            },
          })),
        },
      },
    };

    // Add header if provided
    if (message.header) {
      (payload.interactive as Record<string, unknown>).header = message.header;
    }

    // Add footer if provided
    if (message.footer) {
      (payload.interactive as Record<string, unknown>).footer = {
        text: message.footer,
      };
    }

    try {
      const response = await axios.post(url, payload, {
        headers: {
          Authorization: `Bearer ${this.accessToken}`,
          'Content-Type': 'application/json',
        },
      });

      const messageId = response.data.messages?.[0]?.id;
      this.logger.log(`WhatsApp interactive button message sent: ${messageId}`);
      return messageId;
    } catch (error: any) {
      this.logger.error('Failed to send WhatsApp interactive message:', error.response?.data || error.message);
      throw error;
    }
  }

  /**
   * Send an interactive list message
   * Useful for multiple options (more than 3)
   */
  async sendInteractiveList(
    to: string,
    message: WhatsAppInteractiveMessage,
  ): Promise<string> {
    const url = `${this.apiUrl}/${this.phoneNumberId}/messages`;

    const payload: Record<string, unknown> = {
      messaging_product: 'whatsapp',
      to,
      type: 'interactive',
      interactive: {
        type: 'list',
        body: {
          text: message.body,
        },
        action: {
          button: message.buttonText || 'Seçenekler', // Button text that opens the list
          sections: message.sections,
        },
      },
    };

    // Add header if provided
    if (message.header) {
      (payload.interactive as Record<string, unknown>).header = message.header;
    }

    // Add footer if provided
    if (message.footer) {
      (payload.interactive as Record<string, unknown>).footer = {
        text: message.footer,
      };
    }

    try {
      const response = await axios.post(url, payload, {
        headers: {
          Authorization: `Bearer ${this.accessToken}`,
          'Content-Type': 'application/json',
        },
      });

      const messageId = response.data.messages?.[0]?.id;
      this.logger.log(`WhatsApp interactive list message sent: ${messageId}`);
      return messageId;
    } catch (error: any) {
      this.logger.error('Failed to send WhatsApp list message:', error.response?.data || error.message);
      throw error;
    }
  }

  /**
   * Send KVKK consent message with approval buttons
   */
  async sendKvkkConsentMessage(
    to: string,
    language: string,
    kvkkLinkUrl: string,
  ): Promise<string> {
    const messages: Record<string, { body: string; approve: string; decline: string; footer: string }> = {
      tr: {
        body: `Size daha iyi yardımcı olabilmem için birkaç bilgi ve fotoğraf isteyeceğim.\n\nPaylaştığınız bilgiler yalnızca doktor değerlendirmesi için kullanılacaktır.\n\n📋 KVKK Aydınlatma Metni: ${kvkkLinkUrl}`,
        approve: '✅ Onaylıyorum',
        decline: '❌ Onaylamıyorum',
        footer: 'Verileriniz güvende tutulacaktır.',
      },
      en: {
        body: `To better assist you, I'll need to ask for some information and photos.\n\nThe information you share will only be used for doctor evaluation.\n\n📋 Privacy Policy: ${kvkkLinkUrl}`,
        approve: '✅ I Approve',
        decline: '❌ I Decline',
        footer: 'Your data will be kept safe.',
      },
      ar: {
        body: `لمساعدتك بشكل أفضل، سأحتاج إلى بعض المعلومات والصور.\n\nالمعلومات التي تشاركها ستُستخدم فقط لتقييم الطبيب.\n\n📋 سياسة الخصوصية: ${kvkkLinkUrl}`,
        approve: '✅ أوافق',
        decline: '❌ لا أوافق',
        footer: 'بياناتك ستبقى آمنة.',
      },
      fr: {
        body: `Pour mieux vous aider, j'aurai besoin de quelques informations et photos.\n\nLes informations partagées seront uniquement utilisées pour l'évaluation médicale.\n\n📋 Politique de confidentialité: ${kvkkLinkUrl}`,
        approve: '✅ J\'approuve',
        decline: '❌ Je refuse',
        footer: 'Vos données seront protégées.',
      },
    };

    const msg = messages[language] || messages.en;

    return this.sendInteractiveButtons(to, {
      type: 'button',
      body: msg.body,
      footer: msg.footer,
      buttons: [
        { id: 'consent_approve', title: msg.approve },
        { id: 'consent_decline', title: msg.decline },
      ],
    });
  }

  /**
   * Send flow selection after KVKK approval (Form vs Chat)
   */
  async sendFlowSelectionMessage(
    to: string,
    language: string,
    formUrl: string,
  ): Promise<string> {
    const messages: Record<string, { body: string; form: string; chat: string; footer: string }> = {
      tr: {
        body: `Teşekkürler! Şimdi nasıl devam etmek istersiniz?\n\n📝 Form: Bilgilerinizi hızlıca form üzerinden doldurun.\n💬 Danışman: Benimle sohbet ederek ilerleyin.`,
        form: '📝 Form ile devam',
        chat: '💬 Danışmanla devam',
        footer: 'Size en uygun seçeneği seçin.',
      },
      en: {
        body: `Thank you! How would you like to continue?\n\n📝 Form: Quickly fill out your information via form.\n💬 Consultant: Continue chatting with me.`,
        form: '📝 Continue with Form',
        chat: '💬 Chat with Consultant',
        footer: 'Choose the option that suits you best.',
      },
      ar: {
        body: `شكراً! كيف تريد المتابعة؟\n\n📝 النموذج: املأ معلوماتك بسرعة عبر النموذج.\n💬 المستشار: تابع الدردشة معي.`,
        form: '📝 متابعة بالنموذج',
        chat: '💬 الدردشة مع مستشار',
        footer: 'اختر الخيار الأنسب لك.',
      },
      fr: {
        body: `Merci! Comment souhaitez-vous continuer?\n\n📝 Formulaire: Remplissez rapidement vos informations.\n💬 Consultant: Continuez à discuter avec moi.`,
        form: '📝 Continuer avec Form',
        chat: '💬 Discuter avec Consultant',
        footer: 'Choisissez l\'option qui vous convient.',
      },
    };

    const msg = messages[language] || messages.en;

    return this.sendInteractiveButtons(to, {
      type: 'button',
      body: msg.body,
      footer: msg.footer,
      buttons: [
        { id: 'flow_form', title: msg.form },
        { id: 'flow_chat', title: msg.chat },
      ],
    });
  }

  /**
   * Send form link message with CTA button
   * WhatsApp supports URL buttons via interactive messages
   */
  async sendFormLinkMessage(
    to: string,
    language: string,
    formUrl: string,
  ): Promise<string> {
    const messages: Record<string, { body: string; button: string; footer: string }> = {
      tr: {
        body: `Harika seçim! 📝\n\nAşağıdaki butona tıklayarak hasta bilgi formunu doldurun.\n\nForm tamamlandığında doktorlarımız değerlendirecektir.`,
        button: '📋 Formu Doldur',
        footer: 'Natural Clinic',
      },
      en: {
        body: `Great choice! 📝\n\nClick the button below to fill out the patient information form.\n\nOnce completed, our doctors will evaluate.`,
        button: '📋 Fill Out Form',
        footer: 'Natural Clinic',
      },
      ar: {
        body: `اختيار رائع! 📝\n\nانقر على الزر أدناه لملء نموذج معلومات المريض.\n\nبمجرد الانتهاء، سيقوم أطباؤنا بالتقييم.`,
        button: '📋 ملء النموذج',
        footer: 'Natural Clinic',
      },
      fr: {
        body: `Excellent choix! 📝\n\nCliquez sur le bouton ci-dessous pour remplir le formulaire d'information patient.\n\nUne fois terminé, nos médecins évalueront.`,
        button: '📋 Remplir le formulaire',
        footer: 'Natural Clinic',
      },
    };

    const msg = messages[language] || messages.en;
    const url = `${this.apiUrl}/${this.phoneNumberId}/messages`;

    // Try to send as CTA URL button (requires WhatsApp Business API v2.45+)
    try {
      const payload = {
        messaging_product: 'whatsapp',
        to,
        type: 'interactive',
        interactive: {
          type: 'cta_url',
          body: {
            text: msg.body,
          },
          footer: {
            text: msg.footer,
          },
          action: {
            name: 'cta_url',
            parameters: {
              display_text: msg.button,
              url: formUrl,
            },
          },
        },
      };

      const response = await axios.post(url, payload, {
        headers: {
          Authorization: `Bearer ${this.accessToken}`,
          'Content-Type': 'application/json',
        },
      });

      const messageId = response.data.messages?.[0]?.id;
      this.logger.log(`WhatsApp form CTA message sent: ${messageId}`);
      return messageId;
    } catch (error: any) {
      // Fallback to regular text message with link if CTA not supported
      this.logger.warn('WhatsApp CTA URL not supported, falling back to text message:', error.response?.data?.error?.message || error.message);
      
      const fallbackContent = `${msg.body}\n\n🔗 ${formUrl}`;
      return this.sendMessage({ channel: 'whatsapp', channelUserId: to, content: fallbackContent });
    }
  }
}

