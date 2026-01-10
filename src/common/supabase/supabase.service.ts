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
    tags: string[];
    // Doctor approval fields
    doctor_approved_by: string;
    doctor_approved_at: string;
    treatment_recommendations: string;
    // Sales price fields
    estimated_price_min: number;
    estimated_price_max: number;
    price_currency: string;
    sales_price_set_by: string;
    sales_price_set_at: string;
    // Timezone field
    timezone: string;
    // Zoho CRM fields
    zoho_lead_id: string;
    zoho_synced_at: string;
    zoho_sync_error: string;
    zoho_sync_attempted_at: string;
  }>): Promise<Lead> {
    const updateData: Record<string, unknown> = {};
    
    if (data.status !== undefined) updateData.status = data.status;
    if (data.language !== undefined) updateData.language = data.language;
    if (data.country !== undefined) updateData.country = data.country;
    if (data.treatment_category !== undefined) updateData.treatment_category = data.treatment_category;
    if (data.desire_score !== undefined) updateData.desire_score = data.desire_score;
    if (data.metadata !== undefined) updateData.metadata = data.metadata;
    if (data.tags !== undefined) updateData.tags = data.tags;
    // Doctor approval fields
    if (data.doctor_approved_by !== undefined) updateData.doctor_approved_by = data.doctor_approved_by;
    if (data.doctor_approved_at !== undefined) updateData.doctor_approved_at = data.doctor_approved_at;
    if (data.treatment_recommendations !== undefined) updateData.treatment_recommendations = data.treatment_recommendations;
    // Sales price fields
    if (data.estimated_price_min !== undefined) updateData.estimated_price_min = data.estimated_price_min;
    if (data.estimated_price_max !== undefined) updateData.estimated_price_max = data.estimated_price_max;
    if (data.price_currency !== undefined) updateData.price_currency = data.price_currency;
    if (data.sales_price_set_by !== undefined) updateData.sales_price_set_by = data.sales_price_set_by;
    if (data.sales_price_set_at !== undefined) updateData.sales_price_set_at = data.sales_price_set_at;
    // Timezone field
    if (data.timezone !== undefined) updateData.timezone = data.timezone;
    // Zoho CRM fields
    if (data.zoho_lead_id !== undefined) updateData.zoho_lead_id = data.zoho_lead_id;
    if (data.zoho_synced_at !== undefined) updateData.zoho_synced_at = data.zoho_synced_at;
    if (data.zoho_sync_error !== undefined) updateData.zoho_sync_error = data.zoho_sync_error;
    if (data.zoho_sync_attempted_at !== undefined) updateData.zoho_sync_attempted_at = data.zoho_sync_attempted_at;
    
    const { data: lead, error } = await this.supabase
      .from('leads')
      .update(updateData as LeadUpdate)
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

  async getConversationMessages(conversationId: string, limit = 20): Promise<(Message & { ai_message_feedback?: { id: string; rating: string; comment: string | null; suggested_response: string | null; created_at: string | null; users?: { id: string; name: string; avatar_url: string | null } | null }[] | null })[]> {
    const { data, error } = await this.supabase
      .from('messages')
      .select(`
        *,
        ai_message_feedback (
          id,
          rating,
          comment,
          suggested_response,
          created_at,
          users (
            id,
            name,
            avatar_url
          )
        )
      `)
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
    treatment_category: string;
    complaint: string;
    has_previous_treatment: string;
    urgency: string;
    budget_mentioned: string;
    
    // Consent fields
    consent_given: boolean;
    consent_at: string;
    consent_version: string;
    
    // Photo status
    photo_status: string;
    photo_declined: boolean;
    photo_promised: boolean;
    
    // Medical history
    has_allergies: boolean;
    allergies_detail: string;
    has_chronic_disease: boolean;
    chronic_disease_detail: string;
    has_blood_disease: boolean;
    blood_disease_detail: string;
    uses_blood_thinners: boolean;
    blood_thinner_detail: string;
    has_previous_surgery: boolean;
    previous_surgery_detail: string;
    has_previous_hair_transplant: boolean;
    previous_hair_transplant_detail: string;
    current_medications: string;
    alcohol_use: string;
    smoking_use: string;
    
    // System fields
    extracted_fields_json: Record<string, unknown>;
    agent_name: string;
    language_preference: string;
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
    if (data.treatment_category !== undefined) upsertData.treatment_category = data.treatment_category;
    if (data.complaint !== undefined) upsertData.complaint = data.complaint;
    if (data.has_previous_treatment !== undefined) upsertData.has_previous_treatment = data.has_previous_treatment;
    if (data.urgency !== undefined) upsertData.urgency = data.urgency;
    if (data.budget_mentioned !== undefined) upsertData.budget_mentioned = data.budget_mentioned;
    if (data.consent_given !== undefined) upsertData.consent_given = data.consent_given;
    
    // Consent fields
    if (data.consent_at !== undefined) upsertData.consent_at = data.consent_at;
    if (data.consent_version !== undefined) upsertData.consent_version = data.consent_version;
    
    // Photo status
    if (data.photo_status !== undefined) upsertData.photo_status = data.photo_status;
    if (data.photo_declined !== undefined) upsertData.photo_declined = data.photo_declined;
    if (data.photo_promised !== undefined) upsertData.photo_promised = data.photo_promised;
    
    // Medical history
    if (data.has_allergies !== undefined) upsertData.has_allergies = data.has_allergies;
    if (data.allergies_detail !== undefined) upsertData.allergies_detail = data.allergies_detail;
    if (data.has_chronic_disease !== undefined) upsertData.has_chronic_disease = data.has_chronic_disease;
    if (data.chronic_disease_detail !== undefined) upsertData.chronic_disease_detail = data.chronic_disease_detail;
    if (data.has_blood_disease !== undefined) upsertData.has_blood_disease = data.has_blood_disease;
    if (data.blood_disease_detail !== undefined) upsertData.blood_disease_detail = data.blood_disease_detail;
    if (data.uses_blood_thinners !== undefined) upsertData.uses_blood_thinners = data.uses_blood_thinners;
    if (data.blood_thinner_detail !== undefined) upsertData.blood_thinner_detail = data.blood_thinner_detail;
    if (data.has_previous_surgery !== undefined) upsertData.has_previous_surgery = data.has_previous_surgery;
    if (data.previous_surgery_detail !== undefined) upsertData.previous_surgery_detail = data.previous_surgery_detail;
    if (data.has_previous_hair_transplant !== undefined) upsertData.has_previous_hair_transplant = data.has_previous_hair_transplant;
    if (data.previous_hair_transplant_detail !== undefined) upsertData.previous_hair_transplant_detail = data.previous_hair_transplant_detail;
    if (data.current_medications !== undefined) upsertData.current_medications = data.current_medications;
    if (data.alcohol_use !== undefined) upsertData.alcohol_use = data.alcohol_use;
    if (data.smoking_use !== undefined) upsertData.smoking_use = data.smoking_use;
    
    // System fields
    if (data.extracted_fields_json !== undefined) upsertData.extracted_fields_json = data.extracted_fields_json;
    if (data.agent_name !== undefined) upsertData.agent_name = data.agent_name;
    if (data.language_preference !== undefined) upsertData.language_preference = data.language_preference;
    
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
    // AI-driven follow-up fields
    followup_strategy?: string;
    suggested_message?: string;
    reasoning?: string;
    ai_confidence?: number;
    escalation_reason?: string;
  }): Promise<Followup> {
    const insertData: Record<string, unknown> = {
      lead_id: data.lead_id,
      conversation_id: data.conversation_id,
      followup_type: data.followup_type,
      attempt_number: data.attempt_number,
      scheduled_at: data.scheduled_at,
    };
    
    // AI-driven fields
    if (data.followup_strategy !== undefined) insertData.followup_strategy = data.followup_strategy;
    if (data.suggested_message !== undefined) insertData.suggested_message = data.suggested_message;
    if (data.reasoning !== undefined) insertData.reasoning = data.reasoning;
    if (data.ai_confidence !== undefined) insertData.ai_confidence = data.ai_confidence;
    if (data.escalation_reason !== undefined) insertData.escalation_reason = data.escalation_reason;
    
    const { data: followup, error } = await this.supabase
      .from('followups')
      .insert(insertData as FollowupInsert)
      .select()
      .single();

    if (error) throw error;
    return followup!;
  }
  
  /**
   * Get total count of follow-ups for a lead
   */
  async getFollowupCount(leadId: string): Promise<number> {
    const { count, error } = await this.supabase
      .from('followups')
      .select('*', { count: 'exact', head: true })
      .eq('lead_id', leadId);

    if (error) throw error;
    return count || 0;
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
    scheduled_at: string;
    ai_decision: Record<string, unknown>;
    ai_confidence: number;
  }>): Promise<Followup> {
    const updateData: Record<string, unknown> = {};
    
    if (data.status !== undefined) updateData.status = data.status;
    if (data.sent_at !== undefined) updateData.sent_at = data.sent_at;
    if (data.response_received !== undefined) updateData.response_received = data.response_received;
    if (data.response_at !== undefined) updateData.response_at = data.response_at;
    if (data.message_id !== undefined) updateData.message_id = data.message_id;
    if (data.scheduled_at !== undefined) updateData.scheduled_at = data.scheduled_at;
    if (data.ai_decision !== undefined) updateData.ai_decision = data.ai_decision;
    if (data.ai_confidence !== undefined) updateData.ai_confidence = data.ai_confidence;
    
    const { data: followup, error } = await this.supabase
      .from('followups')
      .update(updateData as FollowupUpdate)
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

  /**
   * Get count of follow-ups sent without user response
   */
  async getUnansweredFollowupCount(leadId: string): Promise<number> {
    const { count, error } = await this.supabase
      .from('followups')
      .select('*', { count: 'exact', head: true })
      .eq('lead_id', leadId)
      .eq('status', 'sent')
      .eq('response_received', false);

    if (error) throw error;
    return count || 0;
  }

  /**
   * Get the timestamp of the last user response in a conversation
   */
  async getLastUserResponseAt(conversationId: string): Promise<string | null> {
    const { data, error } = await this.supabase
      .from('messages')
      .select('created_at')
      .eq('conversation_id', conversationId)
      .eq('direction', 'in')
      .order('created_at', { ascending: false })
      .limit(1)
      .single();

    if (error && error.code !== 'PGRST116') throw error;
    return data?.created_at || null;
  }

  /**
   * Check if a lead has any photos
   */
  async hasPhotos(leadId: string): Promise<boolean> {
    const { count, error } = await this.supabase
      .from('photo_assets')
      .select('*', { count: 'exact', head: true })
      .eq('lead_id', leadId);

    if (error) throw error;
    return (count || 0) > 0;
  }

  /**
   * Get pending followups with full lead data including profile
   */
  async getPendingFollowupsWithProfile(): Promise<(Followup & { 
    leads: (Lead & { lead_profile: LeadProfile | null }) | null; 
    conversations: Conversation | null 
  })[]> {
    const now = new Date().toISOString();
    const { data, error } = await this.supabase
      .from('followups')
      .select('*, leads(*, lead_profile(*)), conversations(*)')
      .eq('status', 'pending')
      .lte('scheduled_at', now)
      .order('scheduled_at', { ascending: true })
      .limit(100);

    if (error) throw error;
    return (data || []) as (Followup & { 
      leads: (Lead & { lead_profile: LeadProfile | null }) | null; 
      conversations: Conversation | null 
    })[];
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

  // ==================== ZOHO CRM ====================

  async getZohoLeadId(leadId: string): Promise<string | null> {
    const { data, error } = await this.supabase
      .from('leads')
      .select('zoho_lead_id')
      .eq('id', leadId)
      .single();

    if (error && error.code !== 'PGRST116') throw error;
    return (data as any)?.zoho_lead_id || null;
  }

  async logZohoSyncError(leadId: string, errorMessage: string): Promise<void> {
    await this.supabase
      .from('leads')
      .update({
        zoho_sync_error: errorMessage,
        zoho_sync_attempted_at: new Date().toISOString(),
      } as any)
      .eq('id', leadId);
  }

  async getLeadsWithFailedZohoSync(): Promise<Lead[]> {
    const { data, error } = await this.supabase
      .from('leads')
      .select('*')
      .in('status', ['DOCTOR_APPROVED', 'SALES_PRICED'])
      .not('zoho_sync_error', 'is', null)
      .is('zoho_lead_id', null)
      .order('created_at', { ascending: false })
      .limit(50);

    if (error) throw error;
    return data || [];
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

  // ==================== NOTIFICATIONS ====================

  async createNotification(data: {
    type: string;
    lead_id?: string;
    title: string;
    body?: string;
    data?: Record<string, unknown>;
  }): Promise<void> {
    try {
      // Insert into sales_notifications table
      // Required fields: lead_id, notification_type, title
      if (!data.lead_id) {
        this.logger.warn('createNotification called without lead_id, skipping');
        return;
      }

      const { error } = await this.supabase
        .from('sales_notifications')
        .insert({
          lead_id: data.lead_id,
          notification_type: data.type,
          title: data.title,
          message: data.body || null,
          metadata: data.data as Json,
        });

      if (error) {
        this.logger.warn(`Failed to create notification: ${error.message}`);
      }
    } catch (err) {
      this.logger.warn('Error creating notification:', err);
    }
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
