import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { SupabaseService } from '../../common/supabase/supabase.service';

@Injectable()
export class ConversationsService {
  private readonly logger = new Logger(ConversationsService.name);

  constructor(private readonly supabase: SupabaseService) {}

  async findAll(limit = 50) {
    const { data, error } = await this.supabase.client
      .from('conversations')
      .select(`
        *,
        leads (
          id,
          status,
          channel,
          lead_profile (name)
        )
      `)
      .order('last_message_at', { ascending: false })
      .limit(limit);

    if (error) throw error;
    return data || [];
  }

  async findByLeadId(leadId: string) {
    const { data, error } = await this.supabase.client
      .from('conversations')
      .select('*')
      .eq('lead_id', leadId)
      .order('created_at', { ascending: false });

    if (error) throw error;
    return data || [];
  }

  async findById(id: string) {
    const { data, error } = await this.supabase.client
      .from('conversations')
      .select('*')
      .eq('id', id)
      .single();

    if (error) throw error;
    if (!data) throw new NotFoundException(`Conversation not found: ${id}`);
    return data;
  }

  async getMessages(conversationId: string, limit = 50) {
    return this.supabase.getConversationMessages(conversationId, limit);
  }

  async getActiveConversation(leadId: string) {
    return this.supabase.getActiveConversation(leadId);
  }

  async closeConversation(id: string) {
    return this.supabase.updateConversation(id, {
      state: 'COMPLETED',
      is_active: false,
    });
  }
}

