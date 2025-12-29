import { Injectable, OnModuleInit, OnModuleDestroy, Logger, Inject, forwardRef } from '@nestjs/common';
import { Worker, Job } from 'bullmq';
import { ConfigService } from '@nestjs/config';
import IORedis from 'ioredis';
import { AiClientService } from './ai-client.service';
import {
  SupabaseService,
  Lead,
  LeadProfile,
  Message,
} from '../../common/supabase/supabase.service';
import { AiJobPayload } from '../../common/queue/queue.service';
import { TelegramAdapter } from '../webhooks/adapters/telegram.adapter';
import { WhatsappAdapter } from '../webhooks/adapters/whatsapp.adapter';

@Injectable()
export class AiWorkerProcessor implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(AiWorkerProcessor.name);
  private worker!: Worker<AiJobPayload>;
  private connection!: IORedis;

  constructor(
    private readonly configService: ConfigService,
    private readonly aiClientService: AiClientService,
    private readonly supabase: SupabaseService,
    @Inject(forwardRef(() => TelegramAdapter))
    private readonly telegramAdapter: TelegramAdapter,
    @Inject(forwardRef(() => WhatsappAdapter))
    private readonly whatsappAdapter: WhatsappAdapter,
  ) {}

  async onModuleInit() {
    // Support both REDIS_URL (Railway) and individual host/port/password config
    const redisUrl = this.configService.get<string>('REDIS_URL');
    
    if (redisUrl) {
      // Railway Redis URL format: redis://default:password@host:port
      this.connection = new IORedis(redisUrl, {
        maxRetriesPerRequest: null,
        enableReadyCheck: false,
        retryStrategy: (times) => {
          if (times > 3) {
            this.logger.error('Redis connection failed after 3 retries');
            return null;
          }
          return Math.min(times * 200, 2000);
        },
      });
    } else {
      // Fallback to individual config
      const redisHost = this.configService.get<string>('REDIS_HOST', 'localhost');
      const redisPort = this.configService.get<number>('REDIS_PORT', 6379);
      const redisPassword = this.configService.get<string>('REDIS_PASSWORD');

      this.connection = new IORedis({
        host: redisHost,
        port: redisPort,
        password: redisPassword || undefined,
        maxRetriesPerRequest: null,
      });
    }
    
    this.connection.on('connect', () => {
      this.logger.log('AI Worker connected to Redis');
    });
    
    this.connection.on('error', (err) => {
      this.logger.error('AI Worker Redis connection error:', err);
    });

    this.worker = new Worker<AiJobPayload>(
      'ai-processing',
      async (job: Job<AiJobPayload>) => {
        return this.processJob(job);
      },
      {
        connection: this.connection,
        concurrency: 5,
      },
    );

    this.worker.on('completed', (job) => {
      this.logger.log(`AI job completed: ${job.id}`);
    });

    this.worker.on('failed', (job, err) => {
      this.logger.error(`AI job failed: ${job?.id}`, err);
    });

    this.logger.log('AI Worker processor started');
  }

  async onModuleDestroy() {
    await this.worker?.close();
    await this.connection?.quit();
  }

  private async processJob(job: Job<AiJobPayload>): Promise<void> {
    const { leadId, conversationId, messageId, language, contextWindow, promptVersion } = job.data;

    this.logger.log(`Processing AI job: ${job.id} for lead ${leadId}`);

    try {
      // Get lead and conversation data
      const [lead, messages] = await Promise.all([
        this.supabase.getLeadById(leadId),
        this.supabase.getConversationMessages(conversationId, contextWindow || 20),
      ]) as [(Lead & { lead_profile: LeadProfile | null }) | null, Message[]];

      if (!lead) {
        throw new Error(`Lead not found: ${leadId}`);
      }

      // Format messages for AI
      const formattedMessages = messages.map((m: Message) => {
        let content = m.content || '';
        
        // If message has media but no text content, add a placeholder description
        if (!content && m.media_type === 'image') {
          content = '[User sent a photo]';
        } else if (!content && m.media_type === 'video') {
          content = '[User sent a video]';
        } else if (!content && m.media_type === 'document') {
          content = '[User sent a document]';
        } else if (!content && m.media_type === 'voice') {
          content = '[User sent a voice message]';
        } else if (!content && m.media_type) {
          content = `[User sent media: ${m.media_type}]`;
        }
        
        return {
          role: m.direction === 'in' ? 'user' as const : 'assistant' as const,
          content,
          timestamp: m.created_at || '',
        };
      });

      // Call AI service
      const startTime = Date.now();
      const aiResponse = await this.aiClientService.analyzeAndDraftReply({
        leadId,
        conversationId,
        messageId,
        language: language || 'en',
        messages: formattedMessages,
        leadContext: {
          status: lead.status,
          treatmentCategory: lead.treatment_category || undefined,
          desireScore: lead.desire_score || undefined,
          profile: lead.lead_profile || undefined,
          agentName: (lead.lead_profile as Record<string, unknown>)?.agent_name as string | undefined,
        },
        promptVersion,
      });

      const latencyMs = Date.now() - startTime;

      // Save AI run to database
      const aiRun = await this.supabase.createAiRun({
        lead_id: leadId,
        message_id: messageId,
        job_type: job.data.jobType.toLowerCase(),
        model: aiResponse.data?.model,
        prompt_version: promptVersion,
        input_json: { messages: formattedMessages.length, language },
        outputs_json: aiResponse.data || {},
        intent: aiResponse.data?.intent,
        extraction: aiResponse.data?.extraction,
        reply_draft: aiResponse.data?.replyDraft,
        score_result: aiResponse.data?.desireScore,
        latency_ms: latencyMs,
        tokens_used: aiResponse.data?.tokensUsed,
        error: aiResponse.error,
      });

      // If successful, process the response
      if (aiResponse.success && aiResponse.data) {
        // Call orchestrator to process the response
        // In a real implementation, this would be an HTTP call or event
        await this.processAiResponse({
          leadId,
          conversationId,
          messageId,
          aiRunId: aiRun.id,
          replyDraft: aiResponse.data.replyDraft,
          intent: aiResponse.data.intent,
          extraction: aiResponse.data.extraction,
          desireScore: aiResponse.data.desireScore.value,
          shouldHandoff: aiResponse.data.shouldHandoff,
          handoffReason: aiResponse.data.handoffReason,
          readyForDoctor: aiResponse.data.readyForDoctor,
          agentName: aiResponse.data.agentName,
          isGreeting: aiResponse.data.isGreeting,
        });
      }
    } catch (error: unknown) {
      this.logger.error(`Error processing AI job ${job.id}:`, error);
      throw error;
    }
  }

  private async processAiResponse(data: {
    leadId: string;
    conversationId: string;
    messageId: string;
    aiRunId: string;
    replyDraft: string;
    intent?: { label: string; confidence: number };
    extraction?: Record<string, unknown>;
    desireScore?: number;
    shouldHandoff?: boolean;
    handoffReason?: string;
    readyForDoctor?: boolean;
    agentName?: string;
    isGreeting?: boolean;
  }): Promise<void> {
    // This would typically call the orchestrator service
    // For now, we'll handle it inline

    const lead = await this.supabase.getLeadById(data.leadId);
    if (!lead) return;

    // Update lead with extracted data
    const updateData: Record<string, unknown> = {};

    if (data.desireScore !== undefined) {
      updateData.desire_score = data.desireScore;
    }

    // Save agent name if this is a greeting (first contact)
    if (data.agentName && data.isGreeting) {
      await this.supabase.upsertLeadProfile(data.leadId, {
        agent_name: data.agentName,
      });
      this.logger.log(`Agent name saved for lead ${data.leadId}: ${data.agentName}`);
    }

    if (data.extraction) {
      // Map extraction to profile fields
      const mappedProfile = this.mapExtractionToProfile(data.extraction);
      this.logger.log(`Extraction received: ${JSON.stringify(data.extraction)}`);
      this.logger.log(`Mapped to profile: ${JSON.stringify(mappedProfile)}`);
      
      await this.supabase.upsertLeadProfile(data.leadId, {
        extracted_fields_json: data.extraction,
        ...mappedProfile,
      });

      if (data.extraction.treatment_category) {
        updateData.treatment_category = data.extraction.treatment_category;
      }
      if (data.extraction.language) {
        updateData.language = data.extraction.language;
      }
      if (data.extraction.country) {
        updateData.country = data.extraction.country;
      }
    }

    if (Object.keys(updateData).length > 0) {
      await this.supabase.updateLead(data.leadId, updateData);
    }

    // Save and send the reply
    if (data.replyDraft && !data.shouldHandoff) {
      await this.supabase.createMessage({
        conversation_id: data.conversationId,
        lead_id: data.leadId,
        direction: 'out',
        content: data.replyDraft,
        sender_type: 'ai',
        ai_run_id: data.aiRunId,
      });

      // Send message via the appropriate channel
      if (lead.channel_user_id) {
        try {
          if (lead.channel === 'telegram') {
            await this.telegramAdapter.sendMessage({
              channel: 'telegram',
              channelUserId: lead.channel_user_id,
              content: data.replyDraft,
            });
            this.logger.log(`📤 Telegram reply sent to ${lead.channel_user_id}`);
          } else if (lead.channel === 'whatsapp') {
            await this.whatsappAdapter.sendMessage({
              channel: 'whatsapp',
              channelUserId: lead.channel_user_id,
              content: data.replyDraft,
            });
            this.logger.log(`📤 WhatsApp reply sent to ${lead.channel_user_id}`);
          }
        } catch (sendError) {
          this.logger.error(`Failed to send reply via ${lead.channel}:`, sendError);
        }
      }

      this.logger.log(`Reply saved for lead ${data.leadId}`);
    }

    // Handle handoff
    if (data.shouldHandoff) {
      await this.supabase.updateLead(data.leadId, { status: 'HANDOFF_HUMAN' });
      await this.supabase.createHandoff({
        lead_id: data.leadId,
        conversation_id: data.conversationId,
        reason: data.handoffReason || 'other',
        triggered_by: 'ai',
      });
      this.logger.log(`Handoff created for lead ${data.leadId}`);
    }

    // Schedule follow-up if not a handoff
    if (!data.shouldHandoff) {
      await this.scheduleFollowupIfNeeded(data.leadId, data.conversationId);
    }
  }

  private async scheduleFollowupIfNeeded(leadId: string, conversationId: string): Promise<void> {
    try {
      // Get follow-up settings
      const settings = await this.supabase.getConfig('followup_settings') as {
        intervals_hours?: number[];
        max_attempts?: number;
      } | null;
      
      if (!settings) {
        this.logger.debug('No followup settings found, skipping followup scheduling');
        return;
      }

      const intervals = settings.intervals_hours || [2, 24, 72];

      // Cancel any existing pending follow-ups for this lead
      await this.supabase.cancelPendingFollowups(leadId);

      // Schedule new follow-up
      const scheduledAt = new Date();
      scheduledAt.setHours(scheduledAt.getHours() + intervals[0]);

      await this.supabase.createFollowup({
        lead_id: leadId,
        conversation_id: conversationId,
        followup_type: 'reminder',
        attempt_number: 1,
        scheduled_at: scheduledAt.toISOString(),
      });

      this.logger.log(`Follow-up scheduled for lead ${leadId} at ${scheduledAt.toISOString()}`);
    } catch (error) {
      this.logger.error(`Error scheduling follow-up for lead ${leadId}:`, error);
    }
  }

  private mapExtractionToProfile(extraction: Record<string, unknown>): Record<string, unknown> {
    const mapping: Record<string, string> = {
      // Personal info
      name: 'name',
      phone: 'phone',
      email: 'email',
      city: 'city',
      country: 'country',
      age: 'age_range',
      birth_date: 'birth_date',
      height_cm: 'height_cm',
      weight_kg: 'weight_kg',
      
      // Treatment info
      complaint: 'complaint',
      previous_treatment: 'has_previous_treatment',
      
      // Medical history
      has_allergies: 'has_allergies',
      allergies_detail: 'allergies_detail',
      has_chronic_disease: 'has_chronic_disease',
      chronic_disease_detail: 'chronic_disease_detail',
      has_previous_surgery: 'has_previous_surgery',
      previous_surgery_detail: 'previous_surgery_detail',
      alcohol_use: 'alcohol_use',
      smoking_use: 'smoking_use',
    };

    const profile: Record<string, unknown> = {};
    
    for (const [key, value] of Object.entries(extraction)) {
      if (mapping[key] && value !== null && value !== undefined) {
        // Convert yes/no strings to booleans for boolean fields
        if (['has_allergies', 'has_chronic_disease', 'has_previous_surgery'].includes(key)) {
          if (typeof value === 'string') {
            profile[mapping[key]] = value.toLowerCase() === 'yes';
          } else {
            profile[mapping[key]] = Boolean(value);
          }
        } else {
          profile[mapping[key]] = value;
        }
      }
    }

    return profile;
  }
}
