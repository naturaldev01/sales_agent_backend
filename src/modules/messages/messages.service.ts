import { Injectable, Logger } from '@nestjs/common';
import { SupabaseService, Message } from '../../common/supabase/supabase.service';

@Injectable()
export class MessagesService {
  private readonly logger = new Logger(MessagesService.name);

  constructor(private readonly supabase: SupabaseService) {}

  async createMessage(data: {
    conversation_id: string;
    lead_id: string;
    direction: 'in' | 'out';
    content?: string;
    media_type?: string;
    media_url?: string;
    sender_type: 'patient' | 'ai' | 'system' | 'human';
    channel_message_id?: string;
    ai_run_id?: string;
    metadata?: Record<string, unknown>;
  }): Promise<Message> {
    return this.supabase.createMessage(data);
  }

  async getMessageByChannelId(channelMessageId: string): Promise<Message | null> {
    return this.supabase.getMessageByChannelId(channelMessageId);
  }

  async getConversationMessages(conversationId: string, limit = 20): Promise<Message[]> {
    return this.supabase.getConversationMessages(conversationId, limit);
  }

  async markAsRead(conversationId: string): Promise<void> {
    return this.supabase.markMessagesAsRead(conversationId);
  }
}
