import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import { NormalizedMessage, OutgoingMessage } from '../interfaces/normalized-message.interface';

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
}

