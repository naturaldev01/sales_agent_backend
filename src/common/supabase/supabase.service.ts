import { Injectable, OnModuleInit, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { Database, Json, Tables, TablesInsert, TablesUpdate } from './database.types';

// Row types
export type Lead = Tables<'leads'>;
export type Conversation = Tables<'conversations'>;
export type Message = Tables<'messages'>;
export type LeadProfile = Tables<'lead_profile'>;
export type AiRun = Tables<'ai_runs'>;
export type Followup = Tables<'followups'>;
export type Handoff = Tables<'handoffs'>;
export type PhotoAsset = Tables<'photo_assets'>;
export type PhotoChecklist = Tables<'photo_checklists'>;
export type SystemConfig = Tables<'system_configs'>;

// Insert types
type LeadInsert = TablesInsert<'leads'>;
type ConversationInsert = TablesInsert<'conversations'>;
type MessageInsert = TablesInsert<'messages'>;
type LeadProfileInsert = TablesInsert<'lead_profile'>;
type AiRunInsert = TablesInsert<'ai_runs'>;
type FollowupInsert = TablesInsert<'followups'>;
type HandoffInsert = TablesInsert<'handoffs'>;
type PhotoAssetInsert = TablesInsert<'photo_assets'>;

// Update types
type LeadUpdate = TablesUpdate<'leads'>;
type ConversationUpdate = TablesUpdate<'conversations'>;
type FollowupUpdate = TablesUpdate<'followups'>;

@Injectable()
export class SupabaseService implements OnModuleInit {
  private readonly logger = new Logger(SupabaseService.name);
  private supabase!: SupabaseClient<Database>;

  constructor(private configService: ConfigService) {}

  onModuleInit() {
    const supabaseUrl = this.configService.getOrThrow<string>('SUPABASE_URL');
    const supabaseKey = this.configService.getOrThrow<string>('SUPABASE_SERVICE_KEY');

    this.supabase = createClient<Database>(supabaseUrl, supabaseKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    });

    this.logger.log('Supabase client initialized');
  }

  get client(): SupabaseClient<Database> {
    return this.supabase;
  }

  // ==================== LEADS ====================

  async createLead(data: {
    channel: string;
    channel_user_id?: string;
    language?: string;
    country?: string;
    source?: string;
  }): Promise<Lead> {
    const insertData: LeadInsert = {
      channel: data.channel,
      channel_user_id: data.channel_user_id,
      language: data.language,
      country: data.country,
      source: data.source,
    };
    
    const { data: lead, error } = await this.supabase
      .from('leads')
      .insert(insertData)
      .select()
      .single();

    if (error) throw error;
    return lead!;
  }

  async getLeadById(id: string): Promise<Lead & { lead_profile: LeadProfile | null }> {
    const { data, error } = await this.supabase
      .from('leads')
      .select('*, lead_profile(*)')
      .eq('id', id)
      .single();

    if (error) throw error;
    return data as Lead & { lead_profile: LeadProfile | null };
  }

  async getLeadByChannelUser(channel: string, channelUserId: string): Promise<(Lead & { lead_profile: LeadProfile | null }) | null> {
    const { data, error } = await this.supabase
      .from('leads')
      .select('*, lead_profile(*)')
      .eq('channel', channel)
      .eq('channel_user_id', channelUserId)
      .order('created_at', { ascending: false })
      .limit(1)
      .single();

    if (error && error.code !== 'PGRST116') throw error;
    return data as (Lead & { lead_profile: LeadProfile | null }) | null;
  }

  async updateLead(id: string, data: Partial<{
    status: string;
    language: string;
    country: string;
    treatment_category: string;
    desire_score: number;
    metadata: Record<string, unknown>;
  }>): Promise<Lead> {
    const updateData: LeadUpdate = {
      status: data.status,
      language: data.language,
      country: data.country,
      treatment_category: data.treatment_category,
      desire_score: data.desire_score,
      metadata: data.metadata as Json,
    };
    
    // Remove undefined values
    Object.keys(updateData).forEach(key => {
      if (updateData[key as keyof LeadUpdate] === undefined) {
        delete updateData[key as keyof LeadUpdate];
      }
    });
    
    const { data: lead, error } = await this.supabase
      .from('leads')
      .update(updateData)
      .eq('id', id)
      .select()
      .single();

    if (error) throw error;
    return lead!;
  }

  async getLeadsByStatus(status: string, limit = 50): Promise<Lead[]> {
    const { data, error } = await this.supabase
      .from('leads')
      .select('*, lead_profile(*)')
      .eq('status', status)
      .order('created_at', { ascending: false })
      .limit(limit);

    if (error) throw error;
    return (data || []) as Lead[];
  }

  async getAllLeads(limit = 100): Promise<Lead[]> {
    const { data, error } = await this.supabase
      .from('leads')
      .select('*, lead_profile(*)')
      .order('created_at', { ascending: false })
      .limit(limit);

    if (error) throw error;
    return (data || []) as Lead[];
  }

  // ==================== CONVERSATIONS ====================

  async createConversation(data: {
    lead_id: string;
    channel: string;
  }): Promise<Conversation> {
    const insertData: ConversationInsert = {
      lead_id: data.lead_id,
      channel: data.channel,
    };
    
    const { data: conversation, error } = await this.supabase
      .from('conversations')
      .insert(insertData)
      .select()
      .single();

    if (error) throw error;
    return conversation!;
  }

  async getActiveConversation(leadId: string): Promise<Conversation | null> {
    const { data, error } = await this.supabase
      .from('conversations')
      .select('*')
      .eq('lead_id', leadId)
      .eq('is_active', true)
      .order('created_at', { ascending: false })
      .limit(1)
      .single();

    if (error && error.code !== 'PGRST116') throw error;
    return data;
  }

  async updateConversation(id: string, data: Partial<{
    state: string;
    is_active: boolean;
    metadata: Record<string, unknown>;
  }>): Promise<Conversation> {
    const updateData: ConversationUpdate = {
      state: data.state,
      is_active: data.is_active,
      metadata: data.metadata as Json,
    };
    
    Object.keys(updateData).forEach(key => {
      if (updateData[key as keyof ConversationUpdate] === undefined) {
        delete updateData[key as keyof ConversationUpdate];
      }
    });
    
    const { data: conversation, error } = await this.supabase
      .from('conversations')
      .update(updateData)
      .eq('id', id)
      .select()
      .single();

    if (error) throw error;
    return conversation!;
  }

  // ==================== MESSAGES ====================

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
    const insertData: MessageInsert = {
      conversation_id: data.conversation_id,
      lead_id: data.lead_id,
      direction: data.direction,
      content: data.content,
      media_type: data.media_type,
      media_url: data.media_url,
      sender_type: data.sender_type,
      channel_message_id: data.channel_message_id,
      ai_run_id: data.ai_run_id,
      metadata: data.metadata as Json,
    };
    
    const { data: message, error } = await this.supabase
      .from('messages')
      .insert(insertData)
      .select()
      .single();

    if (error) throw error;
    return message!;
  }

  async getMessageByChannelId(channelMessageId: string): Promise<Message | null> {
    const { data, error } = await this.supabase
      .from('messages')
      .select('*')
      .eq('channel_message_id', channelMessageId)
      .single();

    if (error && error.code !== 'PGRST116') throw error;
    return data;
  }

  async getConversationMessages(conversationId: string, limit = 20): Promise<Message[]> {
    const { data, error } = await this.supabase
      .from('messages')
      .select('*')
      .eq('conversation_id', conversationId)
      .order('created_at', { ascending: false })
      .limit(limit);

    if (error) throw error;
    return (data || []).reverse();
  }

  async markMessagesAsRead(conversationId: string): Promise<void> {
    const { error } = await this.supabase
      .from('messages')
      .update({ is_read: true })
      .eq('conversation_id', conversationId)
      .eq('is_read', false);

    if (error) throw error;
  }

  // ==================== LEAD PROFILE ====================

  async upsertLeadProfile(leadId: string, data: Partial<{
    // Personal info
    name: string;
    phone: string;
    email: string;
    city: string;
    country: string;
    age_range: string;
    birth_date: string;
    height_cm: number;
    weight_kg: number;
    
    // Treatment info
    complaint: string;
    has_previous_treatment: string;
    consent_given: boolean;
    
    // Medical history
    has_allergies: boolean;
    allergies_detail: string;
    has_chronic_disease: boolean;
    chronic_disease_detail: string;
    has_previous_surgery: boolean;
    previous_surgery_detail: string;
    alcohol_use: string;
    smoking_use: string;
    
    // System fields
    extracted_fields_json: Record<string, unknown>;
    agent_name: string;
  }>): Promise<LeadProfile> {
    // Build upsert data - only include defined fields to avoid overwriting with null
    const upsertData: Record<string, unknown> = {
      lead_id: leadId,
    };
    
    // Personal info
    if (data.name !== undefined) upsertData.name = data.name;
    if (data.phone !== undefined) upsertData.phone = data.phone;
    if (data.email !== undefined) upsertData.email = data.email;
    if (data.city !== undefined) upsertData.city = data.city;
    if (data.country !== undefined) upsertData.country = data.country;
    if (data.age_range !== undefined) upsertData.age_range = data.age_range;
    if (data.birth_date !== undefined) upsertData.birth_date = data.birth_date;
    if (data.height_cm !== undefined) upsertData.height_cm = data.height_cm;
    if (data.weight_kg !== undefined) upsertData.weight_kg = data.weight_kg;
    
    // Treatment info
    if (data.complaint !== undefined) upsertData.complaint = data.complaint;
    if (data.has_previous_treatment !== undefined) upsertData.has_previous_treatment = data.has_previous_treatment;
    if (data.consent_given !== undefined) upsertData.consent_given = data.consent_given;
    
    // Medical history
    if (data.has_allergies !== undefined) upsertData.has_allergies = data.has_allergies;
    if (data.allergies_detail !== undefined) upsertData.allergies_detail = data.allergies_detail;
    if (data.has_chronic_disease !== undefined) upsertData.has_chronic_disease = data.has_chronic_disease;
    if (data.chronic_disease_detail !== undefined) upsertData.chronic_disease_detail = data.chronic_disease_detail;
    if (data.has_previous_surgery !== undefined) upsertData.has_previous_surgery = data.has_previous_surgery;
    if (data.previous_surgery_detail !== undefined) upsertData.previous_surgery_detail = data.previous_surgery_detail;
    if (data.alcohol_use !== undefined) upsertData.alcohol_use = data.alcohol_use;
    if (data.smoking_use !== undefined) upsertData.smoking_use = data.smoking_use;
    
    // System fields
    if (data.extracted_fields_json !== undefined) upsertData.extracted_fields_json = data.extracted_fields_json;
    if (data.agent_name !== undefined) upsertData.agent_name = data.agent_name;
    
    this.logger.log(`Upserting lead_profile for ${leadId}: ${JSON.stringify(upsertData)}`);
    
    const { data: profile, error } = await this.supabase
      .from('lead_profile')
      .upsert(upsertData as LeadProfileInsert, { onConflict: 'lead_id' })
      .select()
      .single();

    if (error) {
      this.logger.error(`Error upserting lead_profile: ${error.message}`);
      throw error;
    }
    
    this.logger.log(`Lead profile upserted successfully: ${JSON.stringify(profile)}`);
    return profile!;
  }

  // ==================== AI RUNS ====================

  async createAiRun(data: {
    lead_id: string;
    message_id?: string;
    job_type: string;
    model?: string;
    prompt_version?: string;
    input_json?: Record<string, unknown>;
    outputs_json?: Record<string, unknown>;
    intent?: Record<string, unknown>;
    extraction?: Record<string, unknown>;
    reply_draft?: string;
    score_result?: Record<string, unknown>;
    latency_ms?: number;
    tokens_used?: number;
    error?: string;
  }): Promise<AiRun> {
    const insertData: AiRunInsert = {
      lead_id: data.lead_id,
      message_id: data.message_id,
      job_type: data.job_type,
      model: data.model,
      prompt_version: data.prompt_version,
      input_json: data.input_json as Json,
      outputs_json: data.outputs_json as Json,
      intent: data.intent as Json,
      extraction: data.extraction as Json,
      reply_draft: data.reply_draft,
      score_result: data.score_result as Json,
      latency_ms: data.latency_ms,
      tokens_used: data.tokens_used,
      error: data.error,
    };
    
    const { data: aiRun, error } = await this.supabase
      .from('ai_runs')
      .insert(insertData)
      .select()
      .single();

    if (error) throw error;
    return aiRun!;
  }

  // ==================== FOLLOWUPS ====================

  async createFollowup(data: {
    lead_id: string;
    conversation_id: string;
    followup_type: string;
    attempt_number: number;
    scheduled_at: string;
  }): Promise<Followup> {
    const insertData: FollowupInsert = {
      lead_id: data.lead_id,
      conversation_id: data.conversation_id,
      followup_type: data.followup_type,
      attempt_number: data.attempt_number,
      scheduled_at: data.scheduled_at,
    };
    
    const { data: followup, error } = await this.supabase
      .from('followups')
      .insert(insertData)
      .select()
      .single();

    if (error) throw error;
    return followup!;
  }

  async getPendingFollowups(): Promise<(Followup & { leads: Lead | null; conversations: Conversation | null })[]> {
    const now = new Date().toISOString();
    const { data, error } = await this.supabase
      .from('followups')
      .select('*, leads(*), conversations(*)')
      .eq('status', 'pending')
      .lte('scheduled_at', now)
      .order('scheduled_at', { ascending: true })
      .limit(100);

    if (error) throw error;
    return (data || []) as (Followup & { leads: Lead | null; conversations: Conversation | null })[];
  }

  async updateFollowup(id: string, data: Partial<{
    status: string;
    sent_at: string;
    response_received: boolean;
    response_at: string;
    message_id: string;
  }>): Promise<Followup> {
    const updateData: FollowupUpdate = {
      status: data.status,
      sent_at: data.sent_at,
      response_received: data.response_received,
      response_at: data.response_at,
      message_id: data.message_id,
    };
    
    Object.keys(updateData).forEach(key => {
      if (updateData[key as keyof FollowupUpdate] === undefined) {
        delete updateData[key as keyof FollowupUpdate];
      }
    });
    
    const { data: followup, error } = await this.supabase
      .from('followups')
      .update(updateData)
      .eq('id', id)
      .select()
      .single();

    if (error) throw error;
    return followup!;
  }

  async cancelPendingFollowups(leadId: string): Promise<void> {
    const { error } = await this.supabase
      .from('followups')
      .update({ status: 'cancelled' } as FollowupUpdate)
      .eq('lead_id', leadId)
      .eq('status', 'pending');

    if (error) throw error;
  }

  // ==================== HANDOFFS ====================

  async createHandoff(data: {
    lead_id: string;
    conversation_id?: string;
    reason: string;
    reason_details?: string;
    triggered_by: string;
  }): Promise<Handoff> {
    const insertData: HandoffInsert = {
      lead_id: data.lead_id,
      conversation_id: data.conversation_id,
      reason: data.reason,
      reason_details: data.reason_details,
      triggered_by: data.triggered_by,
    };
    
    const { data: handoff, error } = await this.supabase
      .from('handoffs')
      .insert(insertData)
      .select()
      .single();

    if (error) throw error;
    return handoff!;
  }

  // ==================== PHOTO ASSETS ====================

  async createPhotoAsset(data: {
    lead_id: string;
    checklist_key?: string;
    storage_path: string;
    file_name?: string;
    file_size?: number;
    mime_type?: string;
  }): Promise<PhotoAsset> {
    const insertData: PhotoAssetInsert = {
      lead_id: data.lead_id,
      checklist_key: data.checklist_key,
      storage_path: data.storage_path,
      file_name: data.file_name,
      file_size: data.file_size,
      mime_type: data.mime_type,
    };
    
    const { data: asset, error } = await this.supabase
      .from('photo_assets')
      .insert(insertData)
      .select()
      .single();

    if (error) throw error;
    return asset!;
  }

  async getLeadPhotos(leadId: string): Promise<PhotoAsset[]> {
    const { data, error } = await this.supabase
      .from('photo_assets')
      .select('*')
      .eq('lead_id', leadId)
      .order('created_at', { ascending: true });

    if (error) throw error;
    return data || [];
  }

  // ==================== PHOTO CHECKLISTS ====================

  async getPhotoChecklist(treatmentCategory: string): Promise<PhotoChecklist[]> {
    const { data, error } = await this.supabase
      .from('photo_checklists')
      .select('*')
      .eq('treatment_category', treatmentCategory)
      .eq('is_active', true)
      .order('sort_order', { ascending: true });

    if (error) throw error;
    return data || [];
  }

  /**
   * Get photo checklist with template image for a specific treatment and language
   * Returns the checklist items with localized display names and instructions
   */
  async getPhotoChecklistWithTemplate(
    treatmentCategory: string,
    language: string = 'en',
  ): Promise<{
    items: Array<{
      checklist_key: string;
      display_name: string;
      instructions: string;
      is_required: boolean;
      sort_order: number;
    }>;
    template_image_path: string | null;
  }> {
    const { data, error } = await this.supabase
      .from('photo_checklists')
      .select('*')
      .eq('treatment_category', treatmentCategory)
      .eq('is_active', true)
      .order('sort_order', { ascending: true });

    if (error) throw error;
    if (!data || data.length === 0) {
      return { items: [], template_image_path: null };
    }

    // Get template image path from first item (all items in same category share same template)
    const templatePath = data[0].template_image_path || null;

    // Map to localized fields based on language
    const langSuffix = language.toLowerCase();
    const items = data.map((item) => {
      // Get display name in order: requested language -> english -> first available
      const displayName =
        (item as Record<string, string | null>)[`display_name_${langSuffix}`] ||
        item.display_name_en ||
        item.checklist_key;

      // Get instructions in order: requested language -> english -> empty
      const instructions =
        (item as Record<string, string | null>)[`instructions_${langSuffix}`] ||
        item.instructions_en ||
        '';

      return {
        checklist_key: item.checklist_key,
        display_name: displayName,
        instructions: instructions,
        is_required: item.is_required ?? true,
        sort_order: item.sort_order ?? 0,
      };
    });

    return { items, template_image_path: templatePath };
  }

  /**
   * Get all treatment categories that have photo checklists
   */
  async getAvailableTreatmentCategories(): Promise<string[]> {
    const { data, error } = await this.supabase
      .from('photo_checklists')
      .select('treatment_category')
      .eq('is_active', true);

    if (error) throw error;
    
    // Get unique categories
    const categories = [...new Set(data?.map(d => d.treatment_category) || [])];
    return categories;
  }

  /**
   * Get template image path for a treatment category
   */
  async getTemplateImagePath(treatmentCategory: string): Promise<string | null> {
    const { data, error } = await this.supabase
      .from('photo_checklists')
      .select('template_image_path')
      .eq('treatment_category', treatmentCategory)
      .eq('is_active', true)
      .limit(1)
      .single();

    if (error && error.code !== 'PGRST116') throw error;
    return data?.template_image_path || null;
  }

  // ==================== SYSTEM CONFIGS ====================

  async getConfig(key: string): Promise<Json | null> {
    const { data, error } = await this.supabase
      .from('system_configs')
      .select('config_value')
      .eq('config_key', key)
      .eq('is_active', true)
      .single();

    if (error && error.code !== 'PGRST116') throw error;
    return data?.config_value ?? null;
  }

  // ==================== STORAGE ====================

  async uploadFile(bucket: string, path: string, file: Buffer, contentType: string) {
    const { data, error } = await this.supabase.storage
      .from(bucket)
      .upload(path, file, { contentType });

    if (error) throw error;
    return data;
  }

  async getSignedUrl(bucket: string, path: string, expiresIn = 900) {
    const { data, error } = await this.supabase.storage
      .from(bucket)
      .createSignedUrl(path, expiresIn);

    if (error) throw error;
    return data.signedUrl;
  }
}
