import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { SupabaseService } from '../../common/supabase/supabase.service';

// Types
export interface AiMessageFeedback {
  id: string;
  message_id: string;
  user_id: string;
  rating: 'good' | 'bad' | 'improvable';
  comment: string | null;
  suggested_response: string | null;
  created_at: string | null;
  updated_at: string | null;
  users?: {
    id: string;
    name: string;
    avatar_url: string | null;
    role: string;
  };
}

export interface KnowledgeBaseEntry {
  id: string;
  category: string;
  language: string | null;
  trigger_keywords: string[] | null;
  scenario: string | null;
  bad_response: string | null;
  good_response: string;
  context_notes: string | null;
  source_feedback_id: string | null;
  is_active: boolean | null;
  priority: number | null;
  usage_count: number | null;
  created_by: string | null;
  created_at: string | null;
  updated_at: string | null;
  users?: {
    id: string;
    name: string;
  };
}

export interface AiMessageWithContext {
  id: string;
  content: string | null;
  created_at: string | null;
  sender_type: string;
  conversation_id: string;
  lead_id: string;
  feedback?: AiMessageFeedback | null;
  context_messages: Array<{
    id: string;
    content: string | null;
    sender_type: string;
    created_at: string | null;
  }>;
  lead?: {
    id: string;
    status: string;
    language: string | null;
    treatment_category: string | null;
    lead_profile?: {
      name: string | null;
    } | null;
  } | null;
}

interface CreateFeedbackDto {
  rating: 'good' | 'bad' | 'improvable';
  comment?: string;
  suggested_response?: string;
}

interface UpdateFeedbackDto {
  rating?: 'good' | 'bad' | 'improvable';
  comment?: string;
  suggested_response?: string;
}

interface CreateKnowledgeBaseDto {
  category: string;
  language?: string;
  trigger_keywords?: string[];
  scenario?: string;
  bad_response?: string;
  good_response: string;
  context_notes?: string;
  source_feedback_id?: string;
  priority?: number;
}

interface UpdateKnowledgeBaseDto {
  category?: string;
  language?: string;
  trigger_keywords?: string[];
  scenario?: string;
  bad_response?: string;
  good_response?: string;
  context_notes?: string;
  is_active?: boolean;
  priority?: number;
}

@Injectable()
export class AiTrainingService {
  private readonly logger = new Logger(AiTrainingService.name);

  constructor(private readonly supabase: SupabaseService) {}

  // ==================== AI MESSAGES ====================

  async getAiMessages(options: {
    page?: number;
    limit?: number;
    rating?: 'pending' | 'good' | 'bad' | 'improvable';
    leadId?: string;
  }): Promise<{ messages: AiMessageWithContext[]; total: number; page: number }> {
    const { page = 1, limit = 20, rating, leadId } = options;
    const offset = (page - 1) * limit;

    // Build query for AI messages only
    let query = this.supabase.client
      .from('messages')
      .select(`
        id,
        content,
        created_at,
        sender_type,
        conversation_id,
        lead_id,
        leads (
          id,
          status,
          language,
          treatment_category,
          lead_profile (
            name
          )
        )
      `, { count: 'exact' })
      .eq('sender_type', 'ai')
      .order('created_at', { ascending: false });

    if (leadId) {
      query = query.eq('lead_id', leadId);
    }

    const { data: messages, error, count } = await query
      .range(offset, offset + limit - 1);

    if (error) {
      this.logger.error('Error fetching AI messages:', error);
      throw error;
    }

    // Get feedback for these messages
    const messageIds = (messages || []).map((m: any) => m.id);
    
    let feedbackMap: Record<string, AiMessageFeedback> = {};
    if (messageIds.length > 0) {
      const { data: feedbackData } = await this.supabase.client
        .from('ai_message_feedback')
        .select(`
          *,
          users (
            id,
            name,
            avatar_url,
            role
          )
        `)
        .in('message_id', messageIds);

      feedbackMap = (feedbackData || []).reduce((acc: Record<string, AiMessageFeedback>, fb: any) => {
        acc[fb.message_id] = fb;
        return acc;
      }, {});
    }

    // Filter by rating if specified
    let filteredMessages = messages || [];
    if (rating) {
      if (rating === 'pending') {
        filteredMessages = filteredMessages.filter((m: any) => !feedbackMap[m.id]);
      } else {
        filteredMessages = filteredMessages.filter((m: any) => feedbackMap[m.id]?.rating === rating);
      }
    }

    // Get context messages for each AI message
    const messagesWithContext: AiMessageWithContext[] = await Promise.all(
      filteredMessages.map(async (msg: any) => {
        const { data: contextMessages } = await this.supabase.client
          .from('messages')
          .select('id, content, sender_type, created_at')
          .eq('conversation_id', msg.conversation_id)
          .lt('created_at', msg.created_at)
          .order('created_at', { ascending: false })
          .limit(5);

        return {
          ...msg,
          feedback: feedbackMap[msg.id] || null,
          context_messages: (contextMessages || []).reverse(),
        };
      })
    );

    return {
      messages: messagesWithContext,
      total: count || 0,
      page,
    };
  }

  async getMessageById(messageId: string): Promise<AiMessageWithContext | null> {
    const { data: message, error } = await this.supabase.client
      .from('messages')
      .select(`
        id,
        content,
        created_at,
        sender_type,
        conversation_id,
        lead_id,
        leads (
          id,
          status,
          language,
          treatment_category,
          lead_profile (
            name
          )
        )
      `)
      .eq('id', messageId)
      .single();

    if (error) {
      if (error.code === 'PGRST116') return null;
      throw error;
    }

    // Get feedback
    const { data: feedback } = await this.supabase.client
      .from('ai_message_feedback')
      .select(`
        *,
        users (
          id,
          name,
          avatar_url,
          role
        )
      `)
      .eq('message_id', messageId)
      .single();

    // Get context messages
    const { data: contextMessages } = await this.supabase.client
      .from('messages')
      .select('id, content, sender_type, created_at')
      .eq('conversation_id', message.conversation_id)
      .lt('created_at', message.created_at)
      .order('created_at', { ascending: false })
      .limit(5);

    return {
      ...message,
      feedback: feedback || null,
      context_messages: (contextMessages || []).reverse(),
    } as AiMessageWithContext;
  }

  // ==================== FEEDBACK ====================

  async createFeedback(
    messageId: string,
    userId: string,
    dto: CreateFeedbackDto,
  ): Promise<AiMessageFeedback> {
    // Check if message exists and is AI message, get full context
    const { data: message } = await this.supabase.client
      .from('messages')
      .select(`
        id, 
        sender_type, 
        content,
        lead_id,
        leads (
          language,
          treatment_category
        )
      `)
      .eq('id', messageId)
      .single();

    if (!message) {
      throw new NotFoundException('Message not found');
    }

    if (message.sender_type !== 'ai') {
      throw new BadRequestException('Can only rate AI messages');
    }

    const { data, error } = await this.supabase.client
      .from('ai_message_feedback')
      .upsert({
        message_id: messageId,
        user_id: userId,
        rating: dto.rating,
        comment: dto.comment || null,
        suggested_response: dto.suggested_response || null,
      }, { onConflict: 'message_id,user_id' })
      .select(`
        *,
        users (
          id,
          name,
          avatar_url,
          role
        )
      `)
      .single();

    if (error) {
      this.logger.error('Error creating feedback:', error);
      throw error;
    }

    // 🆕 AUTO-CREATE KNOWLEDGE BASE ENTRY
    // If rating is bad/improvable AND suggested_response is provided
    if ((dto.rating === 'bad' || dto.rating === 'improvable') && dto.suggested_response) {
      await this.autoCreateKnowledgeBaseEntry(
        data.id,
        userId,
        message.content,
        dto.suggested_response,
        dto.comment,
        (message as any).leads?.language || 'en',
        (message as any).leads?.treatment_category,
      );
    }

    return data as AiMessageFeedback;
  }

  /**
   * Automatically create a Knowledge Base entry from feedback
   */
  private async autoCreateKnowledgeBaseEntry(
    feedbackId: string,
    userId: string,
    badResponse: string | null,
    goodResponse: string,
    comment: string | null | undefined,
    language: string,
    treatmentCategory: string | null,
  ): Promise<void> {
    try {
      // Check if KB entry already exists for this feedback
      const { data: existing } = await this.supabase.client
        .from('knowledge_base')
        .select('id')
        .eq('source_feedback_id', feedbackId)
        .single();

      if (existing) {
        // Update existing entry
        await this.supabase.client
          .from('knowledge_base')
          .update({
            bad_response: badResponse,
            good_response: goodResponse,
            context_notes: comment,
          })
          .eq('id', existing.id);
        
        this.logger.log(`Updated KB entry from feedback: ${feedbackId}`);
        return;
      }

      // Extract potential keywords from the good response
      const keywords = this.extractKeywords(goodResponse);

      // Create new KB entry
      await this.supabase.client
        .from('knowledge_base')
        .insert({
          category: 'response_example',
          language: language,
          trigger_keywords: keywords.slice(0, 5),
          scenario: treatmentCategory 
            ? `${treatmentCategory} - Kullanıcı geri bildirimi ile eklendi`
            : 'Kullanıcı geri bildirimi ile otomatik eklendi',
          bad_response: badResponse,
          good_response: goodResponse,
          context_notes: comment || 'Feedback\'ten otomatik oluşturuldu',
          source_feedback_id: feedbackId,
          priority: 10, // Auto-generated entries get medium priority
          created_by: userId,
          is_active: true,
        });

      this.logger.log(`Auto-created KB entry from feedback: ${feedbackId}`);
    } catch (err) {
      // Don't throw - KB creation is secondary, feedback is primary
      this.logger.error('Failed to auto-create KB entry:', err);
    }
  }

  async updateFeedback(
    messageId: string,
    userId: string,
    dto: UpdateFeedbackDto,
  ): Promise<AiMessageFeedback> {
    const updateData: Record<string, unknown> = {};
    if (dto.rating !== undefined) updateData.rating = dto.rating;
    if (dto.comment !== undefined) updateData.comment = dto.comment;
    if (dto.suggested_response !== undefined) updateData.suggested_response = dto.suggested_response;

    const { data, error } = await this.supabase.client
      .from('ai_message_feedback')
      .update(updateData)
      .eq('message_id', messageId)
      .eq('user_id', userId)
      .select(`
        *,
        users (
          id,
          name,
          avatar_url,
          role
        )
      `)
      .single();

    if (error) {
      if (error.code === 'PGRST116') {
        throw new NotFoundException('Feedback not found');
      }
      throw error;
    }

    return data as AiMessageFeedback;
  }

  async getFeedbackStats(): Promise<{
    total: number;
    good: number;
    bad: number;
    improvable: number;
    pending: number;
  }> {
    // Get total AI messages count
    const { count: totalAiMessages } = await this.supabase.client
      .from('messages')
      .select('*', { count: 'exact', head: true })
      .eq('sender_type', 'ai');

    // Get feedback counts by rating
    const { data: feedbackCounts } = await this.supabase.client
      .from('ai_message_feedback')
      .select('rating');

    const counts = (feedbackCounts || []).reduce(
      (acc: Record<string, number>, fb: { rating: string }) => {
        acc[fb.rating] = (acc[fb.rating] || 0) + 1;
        return acc;
      },
      { good: 0, bad: 0, improvable: 0 },
    );

    const ratedCount = counts.good + counts.bad + counts.improvable;

    return {
      total: totalAiMessages || 0,
      good: counts.good,
      bad: counts.bad,
      improvable: counts.improvable,
      pending: (totalAiMessages || 0) - ratedCount,
    };
  }

  // ==================== KNOWLEDGE BASE ====================

  async getKnowledgeBase(options: {
    category?: string;
    language?: string;
    search?: string;
    activeOnly?: boolean;
  }): Promise<KnowledgeBaseEntry[]> {
    const { category, language, search, activeOnly = true } = options;

    let query = this.supabase.client
      .from('knowledge_base')
      .select(`
        *,
        users:created_by (
          id,
          name
        )
      `)
      .order('priority', { ascending: false })
      .order('created_at', { ascending: false });

    if (activeOnly) {
      query = query.eq('is_active', true);
    }

    if (category) {
      query = query.eq('category', category);
    }

    if (language) {
      query = query.eq('language', language);
    }

    const { data, error } = await query;

    if (error) {
      this.logger.error('Error fetching knowledge base:', error);
      throw error;
    }

    let results = data || [];

    // Client-side search if search term provided
    if (search) {
      const searchLower = search.toLowerCase();
      results = results.filter(
        (entry: any) =>
          entry.scenario?.toLowerCase().includes(searchLower) ||
          entry.good_response?.toLowerCase().includes(searchLower) ||
          entry.bad_response?.toLowerCase().includes(searchLower) ||
          entry.trigger_keywords?.some((kw: string) => kw.toLowerCase().includes(searchLower)),
      );
    }

    return results as KnowledgeBaseEntry[];
  }

  async getKnowledgeBaseById(id: string): Promise<KnowledgeBaseEntry | null> {
    const { data, error } = await this.supabase.client
      .from('knowledge_base')
      .select(`
        *,
        users:created_by (
          id,
          name
        )
      `)
      .eq('id', id)
      .single();

    if (error) {
      if (error.code === 'PGRST116') return null;
      throw error;
    }

    return data as KnowledgeBaseEntry;
  }

  async createKnowledgeBaseEntry(
    userId: string,
    dto: CreateKnowledgeBaseDto,
  ): Promise<KnowledgeBaseEntry> {
    const { data, error } = await this.supabase.client
      .from('knowledge_base')
      .insert({
        category: dto.category,
        language: dto.language || 'en',
        trigger_keywords: dto.trigger_keywords || [],
        scenario: dto.scenario || null,
        bad_response: dto.bad_response || null,
        good_response: dto.good_response,
        context_notes: dto.context_notes || null,
        source_feedback_id: dto.source_feedback_id || null,
        priority: dto.priority || 0,
        created_by: userId,
      })
      .select(`
        *,
        users:created_by (
          id,
          name
        )
      `)
      .single();

    if (error) {
      this.logger.error('Error creating knowledge base entry:', error);
      throw error;
    }

    return data as KnowledgeBaseEntry;
  }

  async updateKnowledgeBaseEntry(
    id: string,
    dto: UpdateKnowledgeBaseDto,
  ): Promise<KnowledgeBaseEntry> {
    const updateData: Record<string, unknown> = {};
    if (dto.category !== undefined) updateData.category = dto.category;
    if (dto.language !== undefined) updateData.language = dto.language;
    if (dto.trigger_keywords !== undefined) updateData.trigger_keywords = dto.trigger_keywords;
    if (dto.scenario !== undefined) updateData.scenario = dto.scenario;
    if (dto.bad_response !== undefined) updateData.bad_response = dto.bad_response;
    if (dto.good_response !== undefined) updateData.good_response = dto.good_response;
    if (dto.context_notes !== undefined) updateData.context_notes = dto.context_notes;
    if (dto.is_active !== undefined) updateData.is_active = dto.is_active;
    if (dto.priority !== undefined) updateData.priority = dto.priority;

    const { data, error } = await this.supabase.client
      .from('knowledge_base')
      .update(updateData)
      .eq('id', id)
      .select(`
        *,
        users:created_by (
          id,
          name
        )
      `)
      .single();

    if (error) {
      if (error.code === 'PGRST116') {
        throw new NotFoundException('Knowledge base entry not found');
      }
      throw error;
    }

    return data as KnowledgeBaseEntry;
  }

  async deleteKnowledgeBaseEntry(id: string): Promise<{ success: boolean }> {
    // Soft delete - set is_active to false
    const { error } = await this.supabase.client
      .from('knowledge_base')
      .update({ is_active: false })
      .eq('id', id);

    if (error) {
      this.logger.error('Error deleting knowledge base entry:', error);
      throw error;
    }

    return { success: true };
  }

  // Get relevant knowledge base entries for AI prompts
  async getRelevantKnowledgeForMessage(
    message: string,
    language: string = 'en',
    limit: number = 5,
  ): Promise<KnowledgeBaseEntry[]> {
    // Extract keywords from message
    const keywords = this.extractKeywords(message);

    // Query knowledge base with keyword matching
    const { data, error } = await this.supabase.client
      .from('knowledge_base')
      .select('*')
      .eq('is_active', true)
      .eq('language', language)
      .order('priority', { ascending: false })
      .limit(limit * 2); // Get more to filter

    if (error) {
      this.logger.error('Error fetching relevant knowledge:', error);
      return [];
    }

    // Score and rank by keyword matches
    const scored = (data || []).map((entry: any) => {
      const entryKeywords = entry.trigger_keywords || [];
      const matches = keywords.filter((kw: string) =>
        entryKeywords.some((ek: string) => ek.toLowerCase().includes(kw.toLowerCase())),
      ).length;
      return { ...entry, score: matches + (entry.priority || 0) };
    });

    // Sort by score and return top entries
    return scored
      .sort((a: any, b: any) => b.score - a.score)
      .slice(0, limit) as KnowledgeBaseEntry[];
  }

  private extractKeywords(message: string): string[] {
    const stopWords = new Set([
      'the', 'a', 'an', 'is', 'are', 'was', 'were', 'i', 'you', 'we', 'they',
      'it', 'this', 'that', 'have', 'has', 'had', 'do', 'does', 'did', 'will',
      'would', 'could', 'should', 'be', 'been', 'being', 'to', 'of', 'in', 'for',
      'on', 'with', 'at', 'by', 'from', 'or', 'and', 'but', 'if', 'then', 'so',
      'my', 'your', 'his', 'her', 'its', 'our', 'their', 'can', 'want', 'need',
    ]);

    return message
      .toLowerCase()
      .replace(/[^\w\s]/g, '')
      .split(/\s+/)
      .filter((word) => word.length > 2 && !stopWords.has(word))
      .slice(0, 10);
  }

  // Format knowledge base for AI prompt inclusion
  formatKnowledgeForPrompt(entries: KnowledgeBaseEntry[]): string {
    if (entries.length === 0) return '';

    const lines = ['=== KNOWLEDGE BASE EXAMPLES ==='];
    lines.push('Use these as reference for appropriate responses:\n');

    entries.forEach((entry, i) => {
      lines.push(`EXAMPLE ${i + 1}:`);
      if (entry.scenario) {
        lines.push(`  Scenario: ${entry.scenario}`);
      }
      if (entry.bad_response) {
        lines.push(`  ❌ Bad: ${entry.bad_response}`);
      }
      lines.push(`  ✅ Good: ${entry.good_response}`);
      if (entry.context_notes) {
        lines.push(`  Note: ${entry.context_notes}`);
      }
      lines.push('');
    });

    lines.push('=== END KNOWLEDGE BASE ===\n');
    return lines.join('\n');
  }
}

