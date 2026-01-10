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
import { PhotosService } from '../photos/photos.service';

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
    @Inject(forwardRef(() => PhotosService))
    private readonly photosService: PhotosService,
  ) {
    this.telegramBotToken = this.configService.get<string>('TELEGRAM_BOT_TOKEN', '');
  }

  private readonly telegramBotToken: string;

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

    // Check if ready for doctor evaluation (all medical history collected)
    if (data.readyForDoctor) {
      updateData.status = 'READY_FOR_DOCTOR';
      this.logger.log(`🩺 Lead ${data.leadId} is ready for doctor evaluation - all medical history collected`);
      
      // Add tag if no photos
      const profile = lead.lead_profile as Record<string, unknown> | null;
      if (!profile || profile.photo_status !== 'complete') {
        await this.addLeadTag(data.leadId, 'NO_PHOTOS');
      }

      // Send notification to dashboard
      await this.sendDoctorReadyNotification(data.leadId, lead);
    }

    if (Object.keys(updateData).length > 0) {
      await this.supabase.updateLead(data.leadId, updateData);
    }

    // Save and send the reply
    if (data.replyDraft && !data.shouldHandoff) {
      // Check if this is a photo request - handle template logic
      const isPhotoRequest = this.isPhotoRequestMessage(data.replyDraft, lead.language || 'en');
      const treatmentCategory = (data.extraction?.treatment_category as string) || lead.treatment_category;
      const photoTemplateSent = await this.wasPhotoTemplateSent(data.leadId);
      
      this.logger.log(`📸 Photo request check: isPhotoRequest=${isPhotoRequest}, treatmentCategory=${treatmentCategory}, templateSent=${photoTemplateSent}`);
      
      // If photo request and template not yet sent, send ONLY template (skip AI message)
      if (isPhotoRequest && treatmentCategory && !photoTemplateSent && lead.channel_user_id) {
        this.logger.log(`📸 Sending photo template for lead ${data.leadId} - AI message will be SKIPPED`);
        
        const templateSent = await this.sendTemplateImageIfAvailable(
          lead.channel as 'whatsapp' | 'telegram' | 'web',
          lead.channel_user_id,
          treatmentCategory,
          lead.language || 'en',
        );
        
        if (templateSent) {
          // Mark template as sent
          await this.markPhotoTemplateSent(data.leadId);
          
          // Save a note in conversation history
          await this.supabase.createMessage({
            conversation_id: data.conversationId,
            lead_id: data.leadId,
            direction: 'out',
            content: `[Photo template sent for ${treatmentCategory}]`,
            sender_type: 'system',
            ai_run_id: data.aiRunId,
          });
          
          // Update lead status to waiting for photos
          await this.supabase.updateLead(data.leadId, { status: 'WAITING_PHOTOS' });
          
          this.logger.log(`✅ Template sent for lead ${data.leadId} - returning without AI message`);
          return; // CRITICAL: Exit here to prevent AI message
        }
        
        this.logger.warn(`⚠️ Template send failed for lead ${data.leadId} - falling back to AI message`);
      }
      
      // If photo request but template already sent, skip AI photo message entirely
      if (isPhotoRequest && treatmentCategory && photoTemplateSent) {
        this.logger.log(`📸 Photo template already sent for lead ${data.leadId} - skipping AI photo request`);
        
        await this.supabase.createMessage({
          conversation_id: data.conversationId,
          lead_id: data.leadId,
          direction: 'out',
          content: `[Skipped: Photo request - template already sent]`,
          sender_type: 'system',
          ai_run_id: data.aiRunId,
        });
        
        return; // Don't send AI message asking for photos again
      }
      
      // Split message into parts for human-like conversation
      const messageParts = this.splitMessageIntoParts(data.replyDraft);
      const fullMessageContent = messageParts.join('\n\n'); // Store full message in DB for history
      
      await this.supabase.createMessage({
        conversation_id: data.conversationId,
        lead_id: data.leadId,
        direction: 'out',
        content: fullMessageContent,
        sender_type: 'ai',
        ai_run_id: data.aiRunId,
      });

      // Send message parts via the appropriate channel with SMART delays
      if (lead.channel_user_id) {
        for (let i = 0; i < messageParts.length; i++) {
          const part = messageParts[i];
          
          // Calculate and wait for typing delay (except first message)
          if (i > 0) {
            const typingDelay = this.calculateTypingDelay(part, i);
            this.logger.debug(`⏳ Waiting ${typingDelay}ms before sending part ${i + 1}/${messageParts.length} (${part.length} chars)`);
            await this.delay(typingDelay);
          }
          
          try {
            if (lead.channel === 'telegram') {
              await this.telegramAdapter.sendMessage({
                channel: 'telegram',
                channelUserId: lead.channel_user_id,
                content: part,
              });
            } else if (lead.channel === 'whatsapp') {
              await this.whatsappAdapter.sendMessage({
                channel: 'whatsapp',
                channelUserId: lead.channel_user_id,
                content: part,
              });
            }
            this.logger.debug(`✅ Sent part ${i + 1}/${messageParts.length}`);
          } catch (sendError) {
            this.logger.error(`Failed to send reply part ${i + 1} via ${lead.channel}:`, sendError);
          }
        }
        
        this.logger.log(`📤 ${messageParts.length} message part(s) sent to ${lead.channel_user_id}`);
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
      // Get follow-up settings (with defaults if not configured)
      const configSettings = await this.supabase.getConfig('followup_settings') as {
        intervals_hours?: number[];
        max_attempts?: number;
        use_ai_timing?: boolean;
      } | null;
      
      // Use defaults if no config exists
      const settings = {
        intervals_hours: configSettings?.intervals_hours || [2, 24, 72],
        max_attempts: configSettings?.max_attempts || 3,
        use_ai_timing: configSettings?.use_ai_timing ?? true,
      };

      const intervals = settings.intervals_hours;

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

  /**
   * Calculate realistic typing delay based on message length.
   * Simulates human typing speed with natural variation.
   * 
   * @param message - The message content
   * @param messageIndex - Index of message in sequence (0 = first)
   * @returns Delay in milliseconds
   */
  private calculateTypingDelay(message: string, messageIndex: number): number {
    // Constants for delay calculation
    const BASE_DELAY_MS = 1000;           // Minimum base delay (1 second)
    const MS_PER_CHAR = 50;               // ~50ms per character (simulates typing)
    const MAX_DELAY_MS = 15000;           // Maximum delay (15 seconds)
    const MIN_DELAY_MS = 2000;            // Minimum practical delay (2 seconds)
    
    // First message has no delay (send immediately)
    if (messageIndex === 0) {
      return 0;
    }
    
    // Calculate base delay from message length
    const charCount = message.length;
    let delay = BASE_DELAY_MS + (charCount * MS_PER_CHAR);
    
    // Add random variation (±20%) for natural feel
    const variation = delay * 0.2;
    const randomOffset = (Math.random() * variation * 2) - variation;
    delay += randomOffset;
    
    // Add extra "thinking" time for longer/complex messages
    if (charCount > 100) {
      delay += 2000; // Extra 2 seconds for complex messages
    }
    
    // Clamp to min/max bounds
    delay = Math.max(MIN_DELAY_MS, Math.min(MAX_DELAY_MS, delay));
    
    return Math.round(delay);
  }

  /**
   * Split a message into multiple parts for human-like conversation.
   * Messages are split by the "|||" delimiter.
   */
  private splitMessageIntoParts(message: string): string[] {
    const parts = message.split('|||')
      .map(part => part.trim())
      .filter(part => part.length > 0);
    
    if (parts.length <= 1) {
      return [message.trim()];
    }
    
    return parts;
  }

  /**
   * Helper to create a delay between messages
   */
  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
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
      treatment_category: 'treatment_category',
      complaint: 'complaint',
      previous_treatment: 'has_previous_treatment',
      urgency: 'urgency',
      budget_mentioned: 'budget_mentioned',
      
      // Medical history
      has_allergies: 'has_allergies',
      allergies_detail: 'allergies_detail',
      has_chronic_disease: 'has_chronic_disease',
      chronic_disease_detail: 'chronic_disease_detail',
      has_previous_surgery: 'has_previous_surgery',
      previous_surgery_detail: 'previous_surgery_detail',
      alcohol_use: 'alcohol_use',
      smoking_use: 'smoking_use',
      
      // Language
      language: 'language_preference',
      detected_language: 'language_preference',
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

  /**
   * Check if photo template was already sent to this lead
   */
  private async wasPhotoTemplateSent(leadId: string): Promise<boolean> {
    const lead = await this.supabase.getLeadById(leadId);
    return (lead.lead_profile as any)?.photo_template_sent === true;
  }

  /**
   * Mark photo template as sent for this lead
   */
  private async markPhotoTemplateSent(leadId: string): Promise<void> {
    await this.supabase.upsertLeadProfile(leadId, {
      photo_template_sent: true,
    } as any);
  }

  /**
   * Check if a message is requesting photos from the user
   * Enhanced with more keywords and photo instruction patterns
   */
  private isPhotoRequestMessage(message: string, language: string): boolean {
    const photoKeywords: Record<string, string[]> = {
      en: [
        'photo', 'picture', 'image', 'send us', 'share', 'upload',
        'please send', 'could you send', 'would you send',
        'front view', 'side view', 'top view', 'back view',
        'show us', 'provide', 'attach'
      ],
      tr: [
        'fotoğraf', 'resim', 'görsel', 'gönderin', 'paylaşın', 'yükleyin',
        'lütfen gönderin', 'gönderir misiniz', 'gönderebilir misiniz',
        'önden görünüm', 'yandan görünüm', 'tepeden görünüm',
        'gösterin', 'paylaşabilir', 'fotoğraflarınızı'
      ],
      ar: [
        'صور', 'صورة', 'ارسل', 'شارك', 'ارسال',
        'يرجى إرسال', 'من فضلك ارسل',
        'منظر أمامي', 'منظر جانبي'
      ],
      ru: [
        'фото', 'фотографи', 'снимок', 'отправьте', 'загрузите',
        'пожалуйста отправьте', 'можете отправить',
        'вид спереди', 'вид сбоку'
      ],
      fr: [
        'photo', 'image', 'envoyez', 'partagez',
        'veuillez envoyer', 'pouvez-vous envoyer',
        'vue de face', 'profil'
      ],
    };

    // Photo instruction patterns that strongly indicate photo request
    const photoInstructionPatterns = [
      /\d+\.\s*\*?\*?(front|önden|أمامي|спереди|face)/i,
      /\d+\.\s*\*?\*?(side|yan|جانب|сбоку|profil)/i,
      /\d+\.\s*\*?\*?(top|tepe|علوي|сверху|dessus)/i,
      /\d+\.\s*\*?\*?(back|arka|خلف|сзади|arrière)/i,
      /açılardan.*fotoğraf/i,
      /photos from.*angles/i,
      /صور من.*زوايا/i,
    ];

    const keywords = photoKeywords[language] || photoKeywords.en;
    // Also include English keywords as fallback since AI sometimes uses English terms
    const allKeywords = [...new Set([...keywords, ...photoKeywords.en])];
    const messageLower = message.toLowerCase();
    
    // Check keywords
    const hasKeyword = allKeywords.some(keyword => messageLower.includes(keyword.toLowerCase()));
    
    // Check instruction patterns
    const hasInstructionPattern = photoInstructionPatterns.some(pattern => pattern.test(message));
    
    const isPhotoRequest = hasKeyword || hasInstructionPattern;
    
    if (isPhotoRequest) {
      this.logger.debug(`📸 Photo request detected in message (language: ${language})`);
    }
    
    return isPhotoRequest;
  }

  /**
   * Send template image to user if available for their treatment category
   */
  private async sendTemplateImageIfAvailable(
    channel: 'whatsapp' | 'telegram' | 'web',
    channelUserId: string,
    treatmentCategory: string,
    language: string,
  ): Promise<boolean> {
    try {
      this.logger.log(`🖼️ Attempting to send template image for ${treatmentCategory}/${language} via ${channel}`);
      
      const caption = this.getTemplateCaption(treatmentCategory, language);

      // Try to get image buffer from file system
      const imageData = await this.photosService.getTemplateImageBuffer(treatmentCategory, language);
      
      if (imageData && channel === 'telegram' && this.telegramBotToken) {
        await this.sendTelegramPhoto(channelUserId, imageData.buffer, caption);
        this.logger.log(`✅ Template image sent for ${treatmentCategory} to ${channel}:${channelUserId}`);
        return true;
      }

      // Try to get URL from database/Supabase Storage
      const templateUrl = await this.photosService.getTemplateImageUrl(treatmentCategory, language);
      
      if (templateUrl) {
        if (channel === 'telegram' && this.telegramBotToken) {
          await this.sendTelegramPhotoByUrl(channelUserId, templateUrl, caption);
          this.logger.log(`✅ Template image sent from URL for ${treatmentCategory} to ${channel}:${channelUserId}`);
          return true;
        }
        
        if (channel === 'whatsapp') {
          await this.whatsappAdapter.sendMessage({
            channel: 'whatsapp',
            channelUserId,
            content: caption,
            mediaUrl: templateUrl,
            mediaType: 'image',
          });
          this.logger.log(`✅ Template image sent via WhatsApp for ${treatmentCategory} to ${channelUserId}`);
          return true;
        }
      }
      
      this.logger.warn(`⚠️ No template image available for ${treatmentCategory}/${language} on channel ${channel}`);
      return false;
    } catch (error) {
      this.logger.error(`❌ Failed to send template image for ${treatmentCategory}:`, error);
      return false;
    }
  }

  /**
   * Get caption text for template image
   */
  private getTemplateCaption(treatmentCategory: string, language: string): string {
    const captions: Record<string, Record<string, string>> = {
      en: {
        default: 'Please send us photos like the examples shown above for a better evaluation 📸',
        hair_transplant: 'For an accurate hair transplant assessment, please send photos from these angles 📸',
        dental: 'Please send clear photos of your teeth as shown in the example 📸',
        rhinoplasty: 'For nose surgery evaluation, please share photos from these angles 📸',
        breast: 'Please send photos from these angles for accurate breast surgery assessment 📸',
        liposuction: 'For body contouring evaluation, please share full body photos as shown 📸',
        bbl: 'For BBL assessment, please send photos from these angles 📸',
        arm_lift: 'For arm lift evaluation, please share photos as shown in the example 📸',
        facelift: 'For facelift evaluation, please share photos of your face from these angles 📸',
      },
      tr: {
        default: 'Daha iyi bir değerlendirme için lütfen yukarıdaki örneklere benzer fotoğraflar gönderin 📸',
        hair_transplant: 'Doğru bir saç ekimi değerlendirmesi için lütfen bu açılardan fotoğraf gönderin 📸',
        dental: 'Lütfen örnekte gösterildiği gibi net diş fotoğrafları gönderin 📸',
        rhinoplasty: 'Burun estetiği değerlendirmesi için lütfen bu açılardan fotoğraf paylaşın 📸',
        breast: 'Doğru meme estetiği değerlendirmesi için lütfen bu açılardan fotoğraf gönderin 📸',
        liposuction: 'Liposuction değerlendirmesi için lütfen gösterilen şekilde tam vücut fotoğrafı paylaşın 📸',
        bbl: 'BBL değerlendirmesi için lütfen bu açılardan fotoğraf gönderin 📸',
        arm_lift: 'Kol germe değerlendirmesi için lütfen örnekte gösterildiği gibi fotoğraf paylaşın 📸',
        facelift: 'Yüz germe değerlendirmesi için lütfen bu açılardan yüz fotoğrafı paylaşın 📸',
      },
      ar: {
        default: 'يرجى إرسال صور مثل الأمثلة الموضحة أعلاه لتقييم أفضل 📸',
        hair_transplant: 'للحصول على تقييم دقيق لزراعة الشعر، يرجى إرسال صور من هذه الزوايا 📸',
        dental: 'يرجى إرسال صور واضحة لأسنانك كما هو موضح في المثال 📸',
        rhinoplasty: 'لتقييم جراحة الأنف، يرجى مشاركة صور من هذه الزوايا 📸',
        breast: 'يرجى إرسال صور من هذه الزوايا لتقييم دقيق لجراحة الثدي 📸',
      },
      fr: {
        default: 'Veuillez nous envoyer des photos comme les exemples ci-dessus pour une meilleure evaluation 📸',
        hair_transplant: 'Pour une evaluation precise de la greffe de cheveux, veuillez envoyer des photos sous ces angles 📸',
        dental: 'Veuillez envoyer des photos claires de vos dents comme indique dans exemple 📸',
        rhinoplasty: 'Pour evaluation de la rhinoplastie, veuillez partager des photos sous ces angles 📸',
        breast: 'Veuillez envoyer des photos sous ces angles pour une evaluation precise 📸',
      },
    };

    const langCaptions = captions[language] || captions.en;
    return langCaptions[treatmentCategory] || langCaptions.default;
  }

  /**
   * Send photo via Telegram using buffer
   */
  private async sendTelegramPhoto(chatId: string, photoBuffer: Buffer, caption?: string): Promise<void> {
    if (!this.telegramBotToken) {
      throw new Error('Telegram bot token not configured');
    }

    const FormData = require('form-data');
    const axios = require('axios');
    const formData = new FormData();
    formData.append('chat_id', chatId);
    formData.append('photo', photoBuffer, { filename: 'template.jpeg', contentType: 'image/jpeg' });
    if (caption) {
      formData.append('caption', caption);
    }

    await axios.post(
      `https://api.telegram.org/bot${this.telegramBotToken}/sendPhoto`,
      formData,
      { headers: formData.getHeaders() },
    );
  }

  /**
   * Send photo via Telegram using URL
   */
  private async sendTelegramPhotoByUrl(chatId: string, photoUrl: string, caption?: string): Promise<void> {
    if (!this.telegramBotToken) {
      throw new Error('Telegram bot token not configured');
    }

    const axios = require('axios');
    await axios.post(
      `https://api.telegram.org/bot${this.telegramBotToken}/sendPhoto`,
      {
        chat_id: chatId,
        photo: photoUrl,
        caption: caption,
      },
    );
  }

  /**
   * Add a tag to lead for tracking/filtering
   */
  private async addLeadTag(leadId: string, tag: string): Promise<void> {
    try {
      const lead = await this.supabase.getLeadById(leadId);
      if (!lead) return;

      const currentTags = ((lead as Record<string, unknown>).tags as string[]) || [];
      if (!currentTags.includes(tag)) {
        await this.supabase.updateLead(leadId, {
          tags: [...currentTags, tag],
        });
        this.logger.log(`🏷️ Added tag "${tag}" to lead ${leadId}`);
      }
    } catch (error) {
      this.logger.warn(`Failed to add tag "${tag}" to lead ${leadId}:`, error);
    }
  }

  /**
   * Send notification when lead is ready for doctor evaluation
   */
  private async sendDoctorReadyNotification(leadId: string, lead: any): Promise<void> {
    try {
      // Create a notification record for the dashboard
      const notificationData = {
        type: 'doctor_ready',
        lead_id: leadId,
        title: 'Lead Ready for Doctor',
        body: `Lead ${lead.name || lead.channel_user_id || leadId} is ready for doctor evaluation`,
        data: {
          leadId,
          channel: lead.channel,
          treatmentCategory: lead.treatment_category,
          language: lead.language,
        },
      };

      // Insert notification (assuming notifications table exists)
      await this.supabase.createNotification(notificationData);
      
      this.logger.log(`📢 Doctor ready notification sent for lead ${leadId}`);
    } catch (error) {
      this.logger.warn(`Failed to send doctor ready notification for lead ${leadId}:`, error);
      // Non-critical, don't throw
    }
  }
}
