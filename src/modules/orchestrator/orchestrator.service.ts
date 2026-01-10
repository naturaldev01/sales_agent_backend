import { Injectable, Logger, Inject, forwardRef } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import { v4 as uuidv4 } from 'uuid';
import {
  SupabaseService,
  Lead,
  LeadProfile,
  Conversation,
  Message,
} from '../../common/supabase/supabase.service';
import { QueueService } from '../../common/queue/queue.service';
import { StateMachineService, LeadStatus } from './state-machine.service';
import { NormalizedMessage } from '../webhooks/interfaces/normalized-message.interface';
import { PhotosService } from '../photos/photos.service';
import { PhotoAnalyzerService } from '../photos/photo-analyzer.service';
import { DoctorNotificationsService } from '../notifications/doctor-notifications.service';
import { TelegramAdapter } from '../webhooks/adapters/telegram.adapter';
import { WhatsappAdapter } from '../webhooks/adapters/whatsapp.adapter';

@Injectable()
export class OrchestratorService {
  private readonly logger = new Logger(OrchestratorService.name);
  private readonly telegramBotToken: string;
  
  // Photo debounce tracking: leadId -> { timeout, conversationId, messageId, language }
  private photoDebounceMap: Map<string, {
    timeout: NodeJS.Timeout;
    conversationId: string;
    messageId: string;
    language: string;
    photoCount: number;
  }> = new Map();
  
  // Debounce delay in milliseconds (wait for more photos)
  private readonly PHOTO_DEBOUNCE_DELAY = 5000; // 5 seconds

  // Virtual agent names by language for personalized greetings
  private readonly AGENT_NAMES: Record<string, string[]> = {
    tr: ['Ayşe', 'Zeynep', 'Elif', 'Merve', 'Selin', 'Deniz', 'Ece', 'Ceren', 'Büşra', 'Gizem'],
    en: ['Emily', 'Sarah', 'Jessica', 'Amanda', 'Rachel', 'Nicole', 'Ashley', 'Lauren', 'Emma', 'Sophie'],
    de: ['Anna', 'Sophie', 'Maria', 'Laura', 'Julia', 'Lisa', 'Lena', 'Hannah', 'Lea', 'Nina'],
    ar: ['فاطمة', 'عائشة', 'مريم', 'زينب', 'سارة', 'ليلى', 'نور', 'هدى', 'دينا', 'رانيا'],
    fr: ['Marie', 'Sophie', 'Camille', 'Julie', 'Laura', 'Léa', 'Chloé', 'Emma', 'Manon', 'Clara'],
    default: ['Sarah', 'Emma', 'Sophie', 'Anna', 'Laura', 'Julia', 'Lisa', 'Nina', 'Maria', 'Elena'],
  };

  // Environment variables for new features
  private readonly kvkkLinkUrl: string;
  private readonly patientFormUrl: string;

  constructor(
    private readonly supabase: SupabaseService,
    private readonly queueService: QueueService,
    private readonly stateMachine: StateMachineService,
    private readonly configService: ConfigService,
    private readonly photosService: PhotosService,
    @Inject(forwardRef(() => PhotoAnalyzerService))
    private readonly photoAnalyzer: PhotoAnalyzerService,
    @Inject(forwardRef(() => DoctorNotificationsService))
    private readonly doctorNotifications: DoctorNotificationsService,
    @Inject(forwardRef(() => TelegramAdapter))
    private readonly telegramAdapter: TelegramAdapter,
    @Inject(forwardRef(() => WhatsappAdapter))
    private readonly whatsappAdapter: WhatsappAdapter,
  ) {
    this.telegramBotToken = this.configService.get<string>('TELEGRAM_BOT_TOKEN', '');
    this.kvkkLinkUrl = this.configService.get<string>('KVKK_LINK_URL', 'https://naturalclinic.com/kvkk');
    this.patientFormUrl = this.configService.get<string>('PATIENT_FORM_URL', 'https://health-form-six.vercel.app');
  }

  async handleIncomingMessage(message: NormalizedMessage): Promise<void> {
    this.logger.log(`Handling incoming message from ${message.channel}:${message.channelUserId}`);

    try {
      // 1. Check for duplicate message (idempotency)
      const existingMessage = await this.supabase.getMessageByChannelId(message.channelMessageId);
      if (existingMessage) {
        this.logger.debug(`Duplicate message detected: ${message.channelMessageId}`);
        return;
      }

      // 2. Find or create lead
      let lead: (Lead & { lead_profile: LeadProfile | null }) | null = 
        await this.supabase.getLeadByChannelUser(message.channel, message.channelUserId);
      
      if (!lead) {
        const newLead = await this.createNewLead(message);
        lead = await this.supabase.getLeadById(newLead.id);
        this.logger.log(`New lead created: ${newLead.id}`);
      } else {
        this.logger.log(`Existing lead found: ${lead.id}`);
        
        // Cancel pending follow-ups since user responded
        await this.supabase.cancelPendingFollowups(lead.id);
        
        // Mark any pending follow-ups as responded
        await this.markFollowupsAsResponded(lead.id);
      }

      if (!lead) {
        throw new Error('Failed to create or retrieve lead');
      }

      // 3. Find or create active conversation
      let conversation: Conversation | null = await this.supabase.getActiveConversation(lead.id);
      
      if (!conversation) {
        conversation = await this.supabase.createConversation({
          lead_id: lead.id,
          channel: message.channel,
        });
        this.logger.log(`New conversation created: ${conversation.id}`);
      }

      // 4. Save the incoming message
      const savedMessage: Message = await this.supabase.createMessage({
        conversation_id: conversation.id,
        lead_id: lead.id,
        direction: 'in',
        content: message.content,
        media_type: message.mediaType,
        media_url: message.mediaUrl,
        sender_type: 'patient',
        channel_message_id: message.channelMessageId,
        metadata: {
          senderName: message.senderName,
          senderPhone: message.senderPhone,
          location: message.location,
        },
      });

      this.logger.log(`Message saved: ${savedMessage.id}`);

      // 4.5 If message contains an image, save it to photo_assets
      if (message.mediaType === 'image' && message.mediaUrl) {
        try {
          await this.processAndSavePhoto(lead.id, message);
          this.logger.log(`Photo saved for lead: ${lead.id}`);
        } catch (photoError) {
          this.logger.error('Error saving photo:', photoError);
          // Continue processing even if photo save fails
        }
      }

      // Get current status
      const currentStatus = lead.status as LeadStatus;

      // 4.6 Update lead language if detected from message (do this early)
      const detectedLanguage = message.senderLanguage;
      if (detectedLanguage && detectedLanguage !== lead.language) {
        await this.supabase.updateLead(lead.id, { language: detectedLanguage });
        this.logger.log(`Lead language updated to: ${detectedLanguage}`);
      }
      const messageLanguage = detectedLanguage || lead.language || 'en';

      // ═══════════════════════════════════════════════════════════════════════
      // 4.7 KVKK CONSENT CHECK - Must happen BEFORE any AI processing
      // ═══════════════════════════════════════════════════════════════════════
      
      // Check if this is a NEW lead that needs KVKK consent
      if (currentStatus === 'NEW' && !lead.lead_profile?.consent_given) {
        this.logger.log(`New lead ${lead.id} needs KVKK consent - sending consent message`);
        
        // Send KVKK consent message with buttons
        await this.sendKvkkConsentMessage(lead);
        
        // Update status to waiting consent
        await this.supabase.updateLead(lead.id, { status: 'WAITING_CONSENT' });
        this.logger.log(`Lead ${lead.id} status updated to WAITING_CONSENT`);
        
        // Don't queue AI job - wait for consent response
        return;
      }

      // Check if lead is waiting for consent
      if (currentStatus === 'WAITING_CONSENT') {
        // Check if user is trying to give consent via text (e.g., "evet", "yes", "onaylıyorum")
        const consentKeywords = ['evet', 'yes', 'onaylıyorum', 'kabul', 'accept', 'tamam', 'ok', 'okay', 'onay'];
        const declineKeywords = ['hayır', 'no', 'reddet', 'istemiyorum', 'decline', 'reject'];
        
        const lowerContent = (message.content || '').toLowerCase().trim();
        
        if (consentKeywords.some(kw => lowerContent.includes(kw))) {
          // User gave consent via text
          this.logger.log(`Lead ${lead.id} gave consent via text message`);
          await this.handleConsentResponse(lead.id, conversation.id, true, lead);
          return;
        }
        
        if (declineKeywords.some(kw => lowerContent.includes(kw))) {
          // User declined consent via text
          this.logger.log(`Lead ${lead.id} declined consent via text message`);
          await this.handleConsentResponse(lead.id, conversation.id, false, lead);
          return;
        }
        
        // User sent something else while waiting for consent - remind them
        const reminderMessages: Record<string, string> = {
          tr: 'Devam edebilmemiz için KVKK onayınıza ihtiyacımız var. Lütfen yukarıdaki butonu kullanarak onaylayın veya "Evet" yazın. 🙏',
          en: 'We need your consent to continue. Please use the button above to confirm or type "Yes". 🙏',
          ar: 'نحتاج موافقتك للمتابعة. يرجى استخدام الزر أعلاه للتأكيد أو اكتب "نعم". 🙏',
          fr: 'Nous avons besoin de votre consentement pour continuer. Veuillez utiliser le bouton ci-dessus ou tapez "Oui". 🙏',
        };
        
        await this.queueService.addChannelSendJob({
          channel: lead.channel as 'whatsapp' | 'telegram' | 'web',
          channelUserId: lead.channel_user_id!,
          content: reminderMessages[messageLanguage] || reminderMessages.en,
        });
        
        this.logger.log(`Lead ${lead.id} is waiting for consent, sent reminder`);
        return;
      }

      // ═══════════════════════════════════════════════════════════════════════
      // 5. Handle state transition (for non-consent states)
      // ═══════════════════════════════════════════════════════════════════════
      const newStatus = this.determineNewStatus(currentStatus, message);
      
      if (newStatus !== currentStatus) {
        await this.supabase.updateLead(lead.id, { status: newStatus });
        this.logger.log(`Lead status updated: ${currentStatus} -> ${newStatus}`);
      }

      // 6. Queue AI processing (with debounce for photos)
      if (message.mediaType === 'image') {
        // For photo messages, use debounce to batch multiple photos
        await this.queueAiJobWithPhotoDebounce(
          lead.id,
          conversation.id,
          savedMessage.id,
          messageLanguage,
        );
      } else {
        // For non-photo messages, queue immediately
        await this.queueService.addAiJob({
          jobType: 'ANALYZE_AND_DRAFT_REPLY',
          leadId: lead.id,
          conversationId: conversation.id,
          messageId: savedMessage.id,
          language: messageLanguage,
          contextWindow: 20,
        });
        this.logger.log(`AI job queued for lead: ${lead.id}`);
      }

    } catch (error) {
      this.logger.error('Error handling incoming message:', error);
      throw error;
    }
  }

  private async createNewLead(message: NormalizedMessage): Promise<Lead> {
    // Create lead
    const lead = await this.supabase.createLead({
      channel: message.channel,
      channel_user_id: message.channelUserId,
      source: `${message.channel}_organic`,
    });

    // Create initial profile if we have sender info
    if (message.senderName || message.senderPhone) {
      await this.supabase.upsertLeadProfile(lead.id, {
        name: message.senderName,
        phone: message.senderPhone,
      });
    }

    return lead;
  }

  private determineNewStatus(currentStatus: LeadStatus, message: NormalizedMessage): LeadStatus {
    // If lead is dormant or waiting and they respond, move to qualifying
    if (currentStatus === 'DORMANT' || currentStatus === 'WAITING_FOR_USER') {
      return 'QUALIFYING';
    }

    // If new lead, start qualifying
    if (currentStatus === 'NEW') {
      return 'QUALIFYING';
    }

    // If they send a photo during photo collection, stay in that state
    if (currentStatus === 'PHOTO_COLLECTING' && message.mediaType === 'image') {
      return 'PHOTO_COLLECTING';
    }

    // If photo was requested and they respond, move to collecting
    if (currentStatus === 'PHOTO_REQUESTED') {
      if (message.mediaType === 'image') {
        return 'PHOTO_COLLECTING';
      }
      return 'QUALIFYING';
    }

    return currentStatus;
  }

  private async markFollowupsAsResponded(leadId: string): Promise<void> {
    // This would update any sent but not responded follow-ups
    // Implementation would depend on your specific needs
    this.logger.debug(`Marking follow-ups as responded for lead: ${leadId}`);
  }

  async processAiResponse(data: {
    leadId: string;
    conversationId: string;
    messageId: string;
    aiRunId: string;
    replyDraft: string;
    intent?: Record<string, unknown>;
    extraction?: Record<string, unknown>;
    desireScore?: number;
    shouldHandoff?: boolean;
    handoffReason?: string;
    readyForDoctor?: boolean;
    agentName?: string;  // Virtual agent name for greeting
    isGreeting?: boolean;  // Flag to indicate greeting response
    consentGiven?: boolean | null;  // KVKK consent status
    photoStatus?: string;  // Photo collection status
    sentiment?: {  // Sentiment analysis results
      mood?: string;
      toxicity?: boolean;
      toxicity_reason?: string | null;
    };
  }): Promise<void> {
    this.logger.log(`Processing AI response for lead: ${data.leadId}`);

    try {
      const lead = await this.supabase.getLeadById(data.leadId);
      if (!lead) {
        throw new Error(`Lead not found: ${data.leadId}`);
      }

      // Check for toxicity - trigger handoff if detected
      if (data.sentiment?.toxicity) {
        this.logger.warn(`Toxicity detected for lead ${data.leadId}: ${data.sentiment.toxicity_reason}`);
        await this.handleHandoff(
          data.leadId, 
          data.conversationId, 
          `toxicity:${data.sentiment.toxicity_reason || 'detected'}`
        );
        return;
      }

      // Check for handoff
      if (data.shouldHandoff) {
        await this.handleHandoff(data.leadId, data.conversationId, data.handoffReason || 'ai_recommendation');
        return;
      }

      // Check for angry sentiment - might need handoff
      if (data.sentiment?.mood === 'angry') {
        this.logger.warn(`Angry sentiment detected for lead ${data.leadId}`);
        // Add tag but don't automatically handoff - let AI try to resolve first
        await this.addLeadTag(data.leadId, 'ANGRY_USER');
      }

      // Handle KVKK consent button response (from callback query)
      const isConsentResponse = (data as any).isConsentResponse;
      if (isConsentResponse) {
        const consentGiven = (data as any).consentGiven || false;
        await this.handleConsentResponse(data.leadId, data.conversationId, consentGiven, lead);
        return;
      }

      // Handle flow selection response (Form vs Chat from callback query)
      const isFlowSelection = (data as any).isFlowSelection;
      if (isFlowSelection) {
        const selectedFlow = (data as any).selectedFlow || 'chat';
        await this.handleFlowSelection(data.leadId, data.conversationId, selectedFlow, lead);
        return;
      }

      // Update lead with extracted data
      const updateData: Record<string, unknown> = {};
      
      if (data.desireScore !== undefined) {
        updateData.desire_score = data.desireScore;
      }

      // Handle medical risk detection
      if (data.extraction?.high_risk_medical) {
        const riskDetails = (data.extraction.high_risk_details as string) || 'Unknown risk';
        const riskKeywords = (data.extraction.risk_keywords_found as string[]) || [];
        await this.handleMedicalRisk(
          data.leadId,
          riskDetails,
          riskKeywords,
          lead.lead_profile?.name ?? undefined,
        );
      }

      // Save agent name if this is a greeting (first contact)
      if (data.agentName && data.isGreeting) {
        await this.supabase.upsertLeadProfile(data.leadId, {
          agent_name: data.agentName,
        });
        this.logger.log(`Agent name saved for lead ${data.leadId}: ${data.agentName}`);
      }

      // Update consent status
      if (data.consentGiven !== null && data.consentGiven !== undefined) {
        await this.supabase.upsertLeadProfile(data.leadId, {
          consent_given: data.consentGiven,
          consent_at: data.consentGiven ? new Date().toISOString() : undefined,
          consent_version: data.consentGiven ? '1.0' : undefined,
        });
        this.logger.log(`Consent status updated for lead ${data.leadId}: ${data.consentGiven}`);
      }

      // Update photo status
      if (data.photoStatus) {
        await this.supabase.upsertLeadProfile(data.leadId, {
          photo_status: data.photoStatus,
        });
        this.logger.log(`Photo status updated for lead ${data.leadId}: ${data.photoStatus}`);
      }

      if (data.extraction) {
        // Update profile with extracted fields
        const mappedProfile = this.mapExtractionToProfile(data.extraction);
        this.logger.log(`Extraction received: ${JSON.stringify(data.extraction)}`);
        this.logger.log(`Mapped to profile: ${JSON.stringify(mappedProfile)}`);
        
        await this.supabase.upsertLeadProfile(data.leadId, {
          extracted_fields_json: data.extraction,
          ...mappedProfile,
        });

        // Check if treatment category was extracted
        if (data.extraction.treatment_category) {
          updateData.treatment_category = data.extraction.treatment_category;
        }

        // Check if language was detected
        if (data.extraction.language) {
          updateData.language = data.extraction.language;
        }

        // Check if country was detected
        if (data.extraction.country) {
          updateData.country = data.extraction.country;
        }
      }

      // Check if ready for doctor evaluation (all medical history collected - photos optional)
      if (data.readyForDoctor) {
        updateData.status = 'READY_FOR_DOCTOR';
        this.logger.log(`Lead ${data.leadId} is ready for doctor evaluation - all medical history collected`);
        
        // Add tag if no photos
        const profile = lead.lead_profile as Record<string, unknown> | null;
        if (!profile || profile.photo_status !== 'complete') {
          await this.addLeadTag(data.leadId, 'NO_PHOTOS');
        }
      }

      if (Object.keys(updateData).length > 0) {
        await this.supabase.updateLead(data.leadId, updateData);
      }

      // Save and send the reply
      if (data.replyDraft) {
        // Check if this is a photo request - handle template logic
        const isPhotoRequest = this.isPhotoRequestMessage(data.replyDraft, lead.language || 'en');
        const treatmentCategory = lead.treatment_category;
        const photoTemplateSent = await this.wasPhotoTemplateSent(data.leadId);
        
        // ═══════════════════════════════════════════════════════════════════════
        // CRITICAL: Check if minimum required info is collected BEFORE photo template
        // Priority: Personal info + Medical history BEFORE photos
        // ═══════════════════════════════════════════════════════════════════════
        const hasRequiredInfoForPhotos = this.hasRequiredInfoBeforePhotos(lead);
        
        // If photo request and template not yet sent, send ONLY template (AI message skipped)
        // BUT ONLY if we have collected the required information first
        if (isPhotoRequest && treatmentCategory && !photoTemplateSent && hasRequiredInfoForPhotos) {
          this.logger.log(`Sending photo template for lead ${data.leadId} - AI message will be SKIPPED entirely`);
          
          // Send template image only
          const templateSent = await this.sendTemplateImageIfAvailable(
            lead.channel as 'whatsapp' | 'telegram' | 'web',
            lead.channel_user_id!,
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
            
            // Update lead status
            await this.supabase.updateLead(data.leadId, { status: 'WAITING_PHOTOS' });
            
            // DON'T send AI message - template is enough
            // Schedule follow-up and return IMMEDIATELY
            await this.scheduleAiDrivenFollowup(
              data.leadId, 
              data.conversationId, 
              lead.language || 'en',
              data.desireScore,
            );
            
            this.logger.log(`Template sent successfully for lead ${data.leadId} - returning without sending AI message`);
            return; // CRITICAL: Exit here to prevent AI message from being sent
          }
          // If template failed, continue with AI message as fallback
          this.logger.warn(`Template send failed for lead ${data.leadId} - falling back to AI message`);
        }
        
        // If photo request but required info not collected yet, skip the photo request entirely
        // AI should continue collecting personal/medical info first
        if (isPhotoRequest && treatmentCategory && !photoTemplateSent && !hasRequiredInfoForPhotos) {
          this.logger.log(`Photo request skipped for lead ${data.leadId} - required info not yet collected`);
          
          // Save a note that we skipped photo request
          await this.supabase.createMessage({
            conversation_id: data.conversationId,
            lead_id: data.leadId,
            direction: 'out',
            content: `[Skipped: Photo request - personal/medical info not yet collected]`,
            sender_type: 'system',
            ai_run_id: data.aiRunId,
          });
          
          // Don't send photo template, AI will continue with info gathering
          // But also don't return - let the AI message through (if it's asking for info)
          // The AI message might be asking for medical info + mentioning photos
          // We'll filter out the photo request part and let the info request go through
        }

        // If photo request but template was already sent, skip the AI photo request message entirely
        // The user already has the template, no need to repeat photo instructions
        if (isPhotoRequest && treatmentCategory && photoTemplateSent) {
          this.logger.log(`Photo template already sent for lead ${data.leadId} - skipping AI photo request message`);
          
          // Save a note that we skipped redundant photo request
          await this.supabase.createMessage({
            conversation_id: data.conversationId,
            lead_id: data.leadId,
            direction: 'out',
            content: `[Skipped: Photo request - template already sent]`,
            sender_type: 'system',
            ai_run_id: data.aiRunId,
          });
          
          // Schedule follow-up and return
          await this.scheduleAiDrivenFollowup(
            data.leadId, 
            data.conversationId, 
            lead.language || 'en',
            data.desireScore,
          );
          return; // Don't send AI message asking for photos again
        }

        // Split message into parts for human-like conversation
        const messageParts = this.splitMessageIntoParts(data.replyDraft);
        const fullMessageContent = messageParts.join('\n\n'); // Store full message in DB for history
        
        // Save the complete message to database (joined for readability in history)
        const replyMessage = await this.supabase.createMessage({
          conversation_id: data.conversationId,
          lead_id: data.leadId,
          direction: 'out',
          content: fullMessageContent,
          sender_type: 'ai',
          ai_run_id: data.aiRunId,
        });
        
        // Queue each message part with SMART delay for human-like delivery
        // Delay is calculated based on message length to simulate typing
        let cumulativeDelay = 0;
        
        for (let i = 0; i < messageParts.length; i++) {
          const part = messageParts[i];
          
          // Calculate typing delay based on message length
          const typingDelay = this.calculateTypingDelay(part, i);
          cumulativeDelay += typingDelay;
          
          await this.queueService.addChannelSendJob({
            channel: lead.channel as 'whatsapp' | 'telegram' | 'web',
            channelUserId: lead.channel_user_id!,
            content: part,
            delay: cumulativeDelay,
          });
          
          this.logger.debug(`Message part ${i + 1}/${messageParts.length} queued with ${cumulativeDelay}ms cumulative delay`);
        }

        this.logger.log(`${messageParts.length} message part(s) queued for sending: ${replyMessage.id}`);
      }

      // Schedule AI-driven follow-up
      await this.scheduleAiDrivenFollowup(
        data.leadId, 
        data.conversationId, 
        lead.language || 'en',
        data.desireScore,
      );

    } catch (error) {
      this.logger.error('Error processing AI response:', error);
      throw error;
    }
  }

  /**
   * Add a tag to a lead (for tracking purposes)
   */
  private async addLeadTag(leadId: string, tag: string): Promise<void> {
    try {
      const lead = await this.supabase.getLeadById(leadId);
      if (!lead) return;
      
      const currentTags: string[] = (lead as any).tags || [];
      if (!currentTags.includes(tag)) {
        const newTags = [...currentTags, tag];
        await this.supabase.updateLead(leadId, { tags: newTags });
        this.logger.log(`Tag '${tag}' added to lead ${leadId}`);
      }
    } catch (error) {
      this.logger.error(`Error adding tag to lead ${leadId}:`, error);
    }
  }

  private mapExtractionToProfile(extraction: Record<string, unknown>): Record<string, unknown> {
    const mapping: Record<string, string> = {
      // Consent
      consent_given: 'consent_given',
      
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
      has_blood_disease: 'has_blood_disease',
      blood_disease_detail: 'blood_disease_detail',
      uses_blood_thinners: 'uses_blood_thinners',
      blood_thinner_detail: 'blood_thinner_detail',
      has_previous_surgery: 'has_previous_surgery',
      previous_surgery_detail: 'previous_surgery_detail',
      has_previous_hair_transplant: 'has_previous_hair_transplant',
      previous_hair_transplant_detail: 'previous_hair_transplant_detail',
      current_medications: 'current_medications',
      alcohol_use: 'alcohol_use',
      smoking_use: 'smoking_use',
      
      // Photo intent
      photo_declined: 'photo_declined',
      photo_promised: 'photo_promised',
      
      // Language
      language: 'language_preference',
      detected_language: 'language_preference',
    };

    // Boolean fields that need conversion
    const booleanFields = [
      'consent_given',
      'has_allergies', 
      'has_chronic_disease', 
      'has_blood_disease',
      'uses_blood_thinners',
      'has_previous_surgery',
      'has_previous_hair_transplant',
      'photo_declined',
      'photo_promised',
    ];

    const profile: Record<string, unknown> = {};
    
    for (const [key, value] of Object.entries(extraction)) {
      if (mapping[key] && value !== null && value !== undefined) {
        // Convert yes/no strings to booleans for boolean fields
        if (booleanFields.includes(key)) {
          if (typeof value === 'string') {
            profile[mapping[key]] = value.toLowerCase() === 'yes' || value.toLowerCase() === 'true';
          } else {
            profile[mapping[key]] = Boolean(value);
          }
        } else {
          profile[mapping[key]] = value;
        }
      }
    }

    // Handle consent timestamp
    if (profile.consent_given === true && !extraction.consent_at) {
      profile.consent_at = new Date().toISOString();
      profile.consent_version = '1.0';
    }

    // Handle photo_status based on extraction
    if (extraction.photo_declined === true) {
      profile.photo_status = 'declined';
    }

    return profile;
  }

  private async handleHandoff(leadId: string, conversationId: string, reason: string): Promise<void> {
    this.logger.log(`Initiating handoff for lead: ${leadId}, reason: ${reason}`);

    // Update lead status
    await this.supabase.updateLead(leadId, { status: 'HANDOFF_HUMAN' });

    // Create handoff record
    await this.supabase.createHandoff({
      lead_id: leadId,
      conversation_id: conversationId,
      reason: reason,
      triggered_by: 'ai',
    });

    // Get lead for channel info
    const lead = await this.supabase.getLeadById(leadId);
    if (lead) {
      // Send handoff message to user
      const handoffMessage = this.getHandoffMessage(lead.language || 'en');
      
      await this.supabase.createMessage({
        conversation_id: conversationId,
        lead_id: leadId,
        direction: 'out',
        content: handoffMessage,
        sender_type: 'system',
      });

      await this.queueService.addChannelSendJob({
        channel: lead.channel as 'whatsapp' | 'telegram' | 'web',
        channelUserId: lead.channel_user_id!,
        content: handoffMessage,
      });
    }
  }

  private getHandoffMessage(language: string): string {
    const messages: Record<string, string> = {
      en: "I'll connect you with our team member who can better assist you. They'll reach out shortly! 🙂",
      tr: "Sizi daha iyi yardımcı olabilecek ekip arkadaşımıza bağlıyorum. Kısa süre içinde size ulaşacaklar! 🙂",
      ar: "سأوصلك بأحد أعضاء فريقنا الذي يمكنه مساعدتك بشكل أفضل. سيتواصلون معك قريبًا! 🙂",
      ru: "Я свяжу вас с нашим специалистом, который сможет лучше вам помочь. Они скоро свяжутся с вами! 🙂",
    };

    return messages[language] || messages.en;
  }

  // ═══════════════════════════════════════════════════════════════════════
  // New V1 Features: KVKK Consent, Flow Selection, Medical Risk
  // ═══════════════════════════════════════════════════════════════════════

  /**
   * Handle consent button response from user
   */
  private async handleConsentResponse(
    leadId: string,
    conversationId: string,
    consentGiven: boolean,
    lead: Lead & { lead_profile: LeadProfile | null },
  ): Promise<void> {
    const language = lead.language || 'en';

    if (consentGiven) {
      // Check if agent name already assigned (prevents duplicate greetings)
      const existingAgentName = (lead.lead_profile as any)?.agent_name;
      
      if (existingAgentName) {
        // Already greeted before, just update consent and status without sending greeting again
        this.logger.log(`Lead ${leadId} already has agent name ${existingAgentName}, skipping duplicate greeting`);
        
        await this.supabase.upsertLeadProfile(leadId, {
          consent_given: true,
          consent_at: new Date().toISOString(),
          consent_version: '1.0',
        });
        
        // Update status to qualifying if not already past that stage
        if (lead.status === 'NEW' || lead.status === 'WAITING_CONSENT') {
          await this.supabase.updateLead(leadId, { status: 'QUALIFYING' });
        }
        return;
      }

      // Generate random agent name for this lead (first time only)
      const agentName = this.getRandomAgentName(language);

      // Update consent in profile and save agent name
      await this.supabase.upsertLeadProfile(leadId, {
        consent_given: true,
        consent_at: new Date().toISOString(),
        consent_version: '1.0',
        agent_name: agentName,
      });

      this.logger.log(`Consent given by lead ${leadId}, assigned agent: ${agentName}`);

      // Directly continue with chat flow (Form selection removed from initial flow)
      const chatMessages: Record<string, (name: string) => string> = {
        tr: (name) => `Merhaba, ben Natural Clinic'ten ${name}. 😊\n\nÖncelikle onay verdiğiniz için teşekkür ederim. Hangi konuda yardımcı olabilirim?`,
        en: (name) => `Hello, I'm ${name} from Natural Clinic. 😊\n\nFirst of all, thank you for giving your consent. How can I help you?`,
        ar: (name) => `مرحباً، أنا ${name} من Natural Clinic. 😊\n\nأولاً، شكراً لك على موافقتك. كيف يمكنني مساعدتك؟`,
        fr: (name) => `Bonjour, je suis ${name} de Natural Clinic. 😊\n\nTout d'abord, merci pour votre consentement. Comment puis-je vous aider?`,
      };

      const messageGenerator = chatMessages[language] || chatMessages.en;
      await this.queueService.addChannelSendJob({
        channel: lead.channel as 'whatsapp' | 'telegram' | 'web',
        channelUserId: lead.channel_user_id!,
        content: messageGenerator(agentName),
      });

      // Update status to qualifying
      await this.supabase.updateLead(leadId, { status: 'QUALIFYING' });
      this.logger.log(`Lead ${leadId} consent given, starting qualification`);
    } else {
      // User declined consent
      await this.supabase.upsertLeadProfile(leadId, {
        consent_given: false,
      });

      // Send decline message
      const declineMessages: Record<string, string> = {
        tr: 'Anlıyoruz. Onay olmadan kişisel bilgi toplayamıyoruz, ancak genel sorularınızı yanıtlayabiliriz. Size nasıl yardımcı olabilirim?',
        en: 'We understand. Without consent, we cannot collect personal information, but we can answer your general questions. How can I help you?',
        ar: 'نتفهم ذلك. بدون موافقة، لا يمكننا جمع معلومات شخصية، لكن يمكننا الإجابة على أسئلتكم العامة. كيف يمكنني مساعدتك؟',
        fr: 'Nous comprenons. Sans consentement, nous ne pouvons pas collecter d\'informations personnelles, mais nous pouvons répondre à vos questions générales. Comment puis-je vous aider?',
      };

      await this.queueService.addChannelSendJob({
        channel: lead.channel as 'whatsapp' | 'telegram' | 'web',
        channelUserId: lead.channel_user_id!,
        content: declineMessages[language] || declineMessages.en,
      });
    }
  }

  /**
   * Handle flow selection response (Form vs Chat)
   */
  private async handleFlowSelection(
    leadId: string,
    conversationId: string,
    selectedFlow: 'form' | 'chat',
    lead: Lead & { lead_profile: LeadProfile | null },
  ): Promise<void> {
    const language = lead.language || 'en';

    // Save preference
    await this.supabase.upsertLeadProfile(leadId, {
      preferred_flow: selectedFlow,
    } as any);

    if (selectedFlow === 'form') {
      // Send form link
      const formUrl = `${this.patientFormUrl}?lead_id=${leadId}&lang=${language}`;
      
      const formMessages: Record<string, string> = {
        tr: `Harika seçim! 📝\n\nFormu doldurmak için linke tıklayın:\n${formUrl}\n\nForm tamamlandığında doktorlarımız değerlendirecek.`,
        en: `Great choice! 📝\n\nClick the link to fill out the form:\n${formUrl}\n\nOnce completed, our doctors will evaluate.`,
        ar: `اختيار رائع! 📝\n\nانقر على الرابط لملء النموذج:\n${formUrl}\n\nبمجرد الانتهاء، سيقوم أطباؤنا بالتقييم.`,
        fr: `Excellent choix! 📝\n\nCliquez sur le lien pour remplir le formulaire:\n${formUrl}\n\nUne fois terminé, nos médecins évalueront.`,
      };

      await this.queueService.addChannelSendJob({
        channel: lead.channel as 'whatsapp' | 'telegram' | 'web',
        channelUserId: lead.channel_user_id!,
        content: formMessages[language] || formMessages.en,
      });

      // Update status
      await this.supabase.updateLead(leadId, { status: 'WAITING_FORM' });
      this.logger.log(`Lead ${leadId} chose form flow, link sent`);
    } else {
      // Continue with chat - send greeting and start qualification
      const chatMessages: Record<string, string> = {
        tr: 'Harika! Sizinle sohbet ederek ilerleyelim. 😊\n\nÖncelikle, hangi tedavi hakkında bilgi almak istiyorsunuz?',
        en: 'Great! Let\'s continue chatting. 😊\n\nFirst, which treatment are you interested in?',
        ar: 'رائع! دعنا نتابع الدردشة. 😊\n\nأولاً، ما هو العلاج الذي تهتم به؟',
        fr: 'Super! Continuons à discuter. 😊\n\nTout d\'abord, quel traitement vous intéresse?',
      };

      await this.queueService.addChannelSendJob({
        channel: lead.channel as 'whatsapp' | 'telegram' | 'web',
        channelUserId: lead.channel_user_id!,
        content: chatMessages[language] || chatMessages.en,
      });

      // Update status to qualifying
      await this.supabase.updateLead(leadId, { status: 'QUALIFYING' });
      this.logger.log(`Lead ${leadId} chose chat flow, starting qualification`);
    }
  }

  /**
   * Send flow selection message (Form vs Chat buttons)
   */
  private async sendFlowSelectionMessage(
    lead: Lead & { lead_profile: LeadProfile | null },
    language: string,
  ): Promise<void> {
    // This will be called after consent is given
    // The actual button sending is done via channel-specific adapters in the queue job
    // For now, queue a special flow selection message

    const flowMessages: Record<string, string> = {
      tr: 'Teşekkürler! Şimdi nasıl devam etmek istersiniz?\n\n📝 Form: Bilgilerinizi hızlıca form üzerinden doldurun.\n💬 Danışman: Benimle sohbet ederek ilerleyin.\n\nLütfen birini seçin:',
      en: 'Thank you! How would you like to continue?\n\n📝 Form: Quickly fill out your information via form.\n💬 Consultant: Continue chatting with me.\n\nPlease choose one:',
      ar: 'شكراً! كيف تريد المتابعة؟\n\n📝 النموذج: املأ معلوماتك بسرعة عبر النموذج.\n💬 المستشار: تابع الدردشة معي.\n\nيرجى الاختيار:',
      fr: 'Merci! Comment souhaitez-vous continuer?\n\n📝 Formulaire: Remplissez rapidement vos informations.\n💬 Consultant: Continuez à discuter avec moi.\n\nVeuillez choisir:',
    };

    // Queue flow selection with special flag
    await this.queueService.addChannelSendJob({
      channel: lead.channel as 'whatsapp' | 'telegram' | 'web',
      channelUserId: lead.channel_user_id!,
      content: flowMessages[language] || flowMessages.en,
      metadata: {
        messageType: 'flow_selection',
        formUrl: `${this.patientFormUrl}?lead_id=${lead.id}&lang=${language}`,
      },
    });
  }

  /**
   * Handle medical risk detection
   */
  private async handleMedicalRisk(
    leadId: string,
    riskDetails: string,
    keywordsFound: string[],
    patientName?: string,
  ): Promise<void> {
    this.logger.warn(`Medical risk detected for lead ${leadId}: ${riskDetails}`);

    // Update lead profile with risk flag
    await this.supabase.upsertLeadProfile(leadId, {
      medical_risk_detected: true,
      medical_risk_details: riskDetails,
    } as any);

    // Add tag to lead
    await this.addLeadTag(leadId, 'MEDICAL_RISK');

    // Create doctor notification
    await this.doctorNotifications.createMedicalRiskAlert(
      leadId,
      riskDetails,
      keywordsFound,
      patientName,
    );
  }

  /**
   * Send KVKK consent message with buttons
   * Called for new leads or when consent is needed
   * Sends directly via channel adapter (not queued)
   */
  async sendKvkkConsentMessage(
    lead: Lead & { lead_profile: LeadProfile | null },
  ): Promise<void> {
    const language = lead.language || 'en';
    const channelUserId = lead.channel_user_id;

    if (!channelUserId) {
      this.logger.error(`Cannot send KVKK consent - no channel_user_id for lead ${lead.id}`);
      return;
    }

    try {
      if (lead.channel === 'telegram') {
        await this.telegramAdapter.sendKvkkConsentMessage(
          channelUserId,
          language,
          this.kvkkLinkUrl,
        );
        this.logger.log(`KVKK consent message sent via Telegram for lead ${lead.id}`);
      } else if (lead.channel === 'whatsapp') {
        await this.whatsappAdapter.sendKvkkConsentMessage(
          channelUserId,
          language,
          this.kvkkLinkUrl,
        );
        this.logger.log(`KVKK consent message sent via WhatsApp for lead ${lead.id}`);
      } else {
        // Fallback for web or other channels - use queue
        await this.queueService.addChannelSendJob({
          channel: lead.channel as 'whatsapp' | 'telegram' | 'web',
          channelUserId,
          content: '', 
          metadata: {
            messageType: 'kvkk_consent',
            kvkkLinkUrl: this.kvkkLinkUrl,
            language,
          },
        });
        this.logger.log(`KVKK consent message queued for lead ${lead.id} (${lead.channel})`);
      }
    } catch (error) {
      this.logger.error(`Failed to send KVKK consent message for lead ${lead.id}:`, error);
      throw error;
    }
  }

  /**
   * Handle consent response from Telegram/WhatsApp callback button
   * Called by webhooks service when user presses consent button
   */
  async handleCallbackConsentResponse(
    channelUserId: string,
    consentGiven: boolean,
    language: string,
  ): Promise<void> {
    this.logger.log(`Handling callback consent response: ${consentGiven} for user ${channelUserId}`);

    // Find lead by channel_user_id
    const lead = await this.supabase.getLeadByChannelUser('telegram', channelUserId);
    
    if (!lead) {
      this.logger.error(`Lead not found for channel_user_id: ${channelUserId}`);
      return;
    }

    // Get or create conversation
    let conversation = await this.supabase.getActiveConversation(lead.id);
    if (!conversation) {
      conversation = await this.supabase.createConversation({
        lead_id: lead.id,
        channel: 'telegram',
      });
    }

    if (consentGiven) {
      const effectiveLanguage = language || lead.language || 'en';
      
      // Check if agent name already assigned (prevents duplicate greetings)
      const existingAgentName = (lead.lead_profile as any)?.agent_name;
      
      if (existingAgentName) {
        // Already greeted before, just update consent and status without sending greeting again
        this.logger.log(`Lead ${lead.id} already has agent name ${existingAgentName}, skipping duplicate greeting`);
        
        await this.supabase.upsertLeadProfile(lead.id, {
          consent_given: true,
          consent_at: new Date().toISOString(),
          consent_version: '1.0',
        });
        
        // Update status if not already past QUALIFYING
        if (lead.status === 'NEW' || lead.status === 'WAITING_CONSENT') {
          await this.supabase.updateLead(lead.id, { 
            status: 'QUALIFYING',
            language: effectiveLanguage,
          });
        }
        return;
      }

      // Generate random agent name for this lead (first time only)
      const agentName = this.getRandomAgentName(effectiveLanguage);

      // Update consent in profile and save agent name
      await this.supabase.upsertLeadProfile(lead.id, {
        consent_given: true,
        consent_at: new Date().toISOString(),
        consent_version: '1.0',
        agent_name: agentName,
      });

      // Update lead status
      await this.supabase.updateLead(lead.id, { 
        status: 'QUALIFYING',
        language: effectiveLanguage,
      });

      this.logger.log(`Consent given by lead ${lead.id}, assigned agent: ${agentName}`);

      // Directly continue with chat flow (Form selection removed from initial flow)
      const chatMessages: Record<string, (name: string) => string> = {
        tr: (name) => `Merhaba, ben Natural Clinic'ten ${name}. 😊\n\nÖncelikle onay verdiğiniz için teşekkür ederim. Hangi konuda yardımcı olabilirim?`,
        en: (name) => `Hello, I'm ${name} from Natural Clinic. 😊\n\nFirst of all, thank you for giving your consent. How can I help you?`,
        ar: (name) => `مرحباً، أنا ${name} من Natural Clinic. 😊\n\nأولاً، شكراً لك على موافقتك. كيف يمكنني مساعدتك؟`,
        fr: (name) => `Bonjour, je suis ${name} de Natural Clinic. 😊\n\nTout d'abord, merci pour votre consentement. Comment puis-je vous aider?`,
      };

      const messageGenerator = chatMessages[effectiveLanguage] || chatMessages.en;
      await this.telegramAdapter.sendMessage({
        channel: 'telegram',
        channelUserId,
        content: messageGenerator(agentName),
      });
    } else {
      // User declined consent - stay in WAITING_CONSENT but allow general chat
      await this.supabase.upsertLeadProfile(lead.id, {
        consent_given: false,
      });

      // Send decline message
      const declineMessages: Record<string, string> = {
        tr: 'Anlıyoruz. Onay olmadan kişisel bilgi toplayamıyoruz, ancak genel sorularınızı yanıtlayabiliriz. Size nasıl yardımcı olabilirim?',
        en: 'We understand. Without consent, we cannot collect personal information, but we can answer your general questions. How can I help you?',
        ar: 'نتفهم ذلك. بدون موافقة، لا يمكننا جمع معلومات شخصية، لكن يمكننا الإجابة على أسئلتكم العامة. كيف يمكنني مساعدتك؟',
        fr: 'Nous comprenons. Sans consentement, nous ne pouvons pas collecter d\'informations personnelles, mais nous pouvons répondre à vos questions générales. Comment puis-je vous aider?',
      };

      await this.telegramAdapter.sendMessage({
        channel: 'telegram',
        channelUserId,
        content: declineMessages[language] || declineMessages.en,
      });

      this.logger.log(`Consent declined by lead ${lead.id}`);
    }
  }

  /**
   * Handle flow selection from Telegram/WhatsApp callback button
   * Called by webhooks service when user presses form/chat button
   */
  async handleCallbackFlowSelection(
    channelUserId: string,
    selectedFlow: 'form' | 'chat',
    language: string,
  ): Promise<void> {
    this.logger.log(`Handling callback flow selection: ${selectedFlow} for user ${channelUserId}`);

    // Find lead by channel_user_id
    const lead = await this.supabase.getLeadByChannelUser('telegram', channelUserId);
    
    if (!lead) {
      this.logger.error(`Lead not found for channel_user_id: ${channelUserId}`);
      return;
    }

    // Save preference
    await this.supabase.upsertLeadProfile(lead.id, {
      preferred_flow: selectedFlow,
    } as any);

    if (selectedFlow === 'form') {
      // Send form link via adapter (with button)
      await this.telegramAdapter.sendFormLinkMessage(
        channelUserId,
        language || lead.language || 'en',
        `${this.patientFormUrl}?lead_id=${lead.id}&lang=${language || lead.language || 'en'}`,
      );

      // Update status
      await this.supabase.updateLead(lead.id, { status: 'WAITING_FORM' });
      this.logger.log(`Lead ${lead.id} chose form flow, link sent`);
    } else {
      // Continue with chat - send greeting and start qualification
      const chatMessages: Record<string, string> = {
        tr: 'Harika! Sizinle sohbet ederek ilerleyelim. 😊\n\nÖncelikle, hangi tedavi hakkında bilgi almak istiyorsunuz?',
        en: 'Great! Let\'s continue chatting. 😊\n\nFirst, which treatment are you interested in?',
        ar: 'رائع! دعنا نتابع الدردشة. 😊\n\nأولاً، ما هو العلاج الذي تهتم به؟',
        fr: 'Super! Continuons à discuter. 😊\n\nTout d\'abord, quel traitement vous intéresse?',
      };

      await this.telegramAdapter.sendMessage({
        channel: 'telegram',
        channelUserId,
        content: chatMessages[language] || chatMessages.en,
      });

      // Update status to qualifying
      await this.supabase.updateLead(lead.id, { status: 'QUALIFYING' });
      this.logger.log(`Lead ${lead.id} chose chat flow, starting qualification`);
    }
  }

  /**
   * Check if photo template was already sent
   */
  private async wasPhotoTemplateSent(leadId: string): Promise<boolean> {
    const lead = await this.supabase.getLeadById(leadId);
    return (lead.lead_profile as any)?.photo_template_sent === true;
  }

  /**
   * Mark photo template as sent
   */
  private async markPhotoTemplateSent(leadId: string): Promise<void> {
    await this.supabase.upsertLeadProfile(leadId, {
      photo_template_sent: true,
    } as any);
  }

  /**
   * Get a random agent name for the given language.
   * Used for personalized greetings after consent.
   */
  private getRandomAgentName(language: string): string {
    const names = this.AGENT_NAMES[language] || this.AGENT_NAMES.default;
    return names[Math.floor(Math.random() * names.length)];
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
   * This makes conversations feel more natural as humans typically
   * send multiple short messages instead of one long one.
   */
  private splitMessageIntoParts(message: string): string[] {
    // Split by ||| delimiter
    const parts = message.split('|||')
      .map(part => part.trim())
      .filter(part => part.length > 0);
    
    // If no delimiter found or only one part, return as single message
    if (parts.length <= 1) {
      return [message.trim()];
    }
    
    return parts;
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
      this.logger.debug(`Photo request detected in message (language: ${language}): "${message.substring(0, 100)}..."`);
    }
    
    return isPhotoRequest;
  }

  /**
   * Send template image to user if available for their treatment category
   * Supports both file system and Supabase Storage sources
   */
  private async sendTemplateImageIfAvailable(
    channel: 'whatsapp' | 'telegram' | 'web',
    channelUserId: string,
    treatmentCategory: string,
    language: string,
  ): Promise<boolean> {
    try {
      this.logger.log(`Attempting to send template image for ${treatmentCategory}/${language} via ${channel}`);
      
      const caption = this.getTemplateCaption(treatmentCategory, language);

      // Strategy 1: Try to get image buffer from file system (for local/deployment with files)
      const imageData = await this.photosService.getTemplateImageBuffer(treatmentCategory, language);
      
      if (imageData && channel === 'telegram' && this.telegramBotToken) {
        await this.sendTelegramPhoto(channelUserId, imageData.buffer, caption);
        this.logger.log(`✅ Template image sent from file system for ${treatmentCategory} to ${channel}:${channelUserId}`);
        return true;
      }

      // Strategy 2: Try to get URL from database/Supabase Storage
      const templateUrl = await this.photosService.getTemplateImageUrl(treatmentCategory, language);
      
      if (templateUrl) {
        if (channel === 'telegram' && this.telegramBotToken) {
          await this.sendTelegramPhotoByUrl(channelUserId, templateUrl, caption);
          this.logger.log(`✅ Template image sent from URL for ${treatmentCategory} to ${channel}:${channelUserId}`);
          return true;
        }
        
        // For WhatsApp, we can use the URL directly
        if (channel === 'whatsapp') {
          await this.sendWhatsAppPhoto(channelUserId, templateUrl, caption);
          this.logger.log(`✅ Template image sent via WhatsApp for ${treatmentCategory} to ${channelUserId}`);
          return true;
        }
      }

      // Strategy 3: If no local file and no URL, try to upload from local and get URL
      if (imageData && !templateUrl) {
        const uploadedUrl = await this.photosService.uploadAndUpdateTemplateImage(
          treatmentCategory,
          language,
          imageData.buffer,
          imageData.filename,
        );
        
        if (uploadedUrl && channel === 'telegram' && this.telegramBotToken) {
          await this.sendTelegramPhotoByUrl(channelUserId, uploadedUrl, caption);
          this.logger.log(`✅ Template image uploaded and sent for ${treatmentCategory} to ${channel}:${channelUserId}`);
          return true;
        }
      }
      
      this.logger.warn(`No template image available for ${treatmentCategory}/${language} on channel ${channel}`);
      return false;
    } catch (error) {
      this.logger.error(`Failed to send template image for ${treatmentCategory}:`, error);
      return false;
    }
  }

  /**
   * Send photo via Telegram using URL
   */
  private async sendTelegramPhotoByUrl(chatId: string, photoUrl: string, caption?: string): Promise<void> {
    if (!this.telegramBotToken) {
      throw new Error('Telegram bot token not configured');
    }

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
   * Send photo via WhatsApp using URL
   */
  private async sendWhatsAppPhoto(phoneNumber: string, imageUrl: string, caption?: string): Promise<void> {
    const whatsappPhoneId = this.configService.get<string>('WHATSAPP_PHONE_NUMBER_ID');
    const whatsappToken = this.configService.get<string>('WHATSAPP_ACCESS_TOKEN');
    
    if (!whatsappPhoneId || !whatsappToken) {
      this.logger.warn('WhatsApp credentials not configured, skipping photo send');
      return;
    }

    const url = `https://graph.facebook.com/v18.0/${whatsappPhoneId}/messages`;
    
    await axios.post(
      url,
      {
        messaging_product: 'whatsapp',
        to: phoneNumber,
        type: 'image',
        image: {
          link: imageUrl,
          caption: caption,
        },
      },
      {
        headers: {
          Authorization: `Bearer ${whatsappToken}`,
          'Content-Type': 'application/json',
        },
      },
    );
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
   * Send photo via Telegram
   */
  private async sendTelegramPhoto(chatId: string, photoBuffer: Buffer, caption?: string): Promise<void> {
    if (!this.telegramBotToken) {
      throw new Error('Telegram bot token not configured');
    }

    const FormData = require('form-data');
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

  private async processAndSavePhoto(leadId: string, message: NormalizedMessage): Promise<void> {
    if (!message.mediaUrl) return;

    const fileId = message.mediaUrl;
    let fileUrl: string | null = null;
    let fileBuffer: Buffer | null = null;

    // For Telegram, we need to get the file URL first
    if (message.channel === 'telegram' && this.telegramBotToken) {
      try {
        // Get file path from Telegram
        const getFileResponse = await axios.get(
          `https://api.telegram.org/bot${this.telegramBotToken}/getFile`,
          { params: { file_id: fileId } }
        );

        const filePath = getFileResponse.data.result?.file_path;
        if (filePath) {
          fileUrl = `https://api.telegram.org/file/bot${this.telegramBotToken}/${filePath}`;
          
          // Download the file
          const downloadResponse = await axios.get(fileUrl, {
            responseType: 'arraybuffer',
          });
          fileBuffer = Buffer.from(downloadResponse.data);
        }
      } catch (error) {
        this.logger.error('Failed to download Telegram photo:', error);
        throw error;
      }
    }

    if (!fileBuffer) {
      this.logger.warn('Could not download photo file');
      return;
    }

    // Get lead for treatment category
    const lead = await this.supabase.getLeadById(leadId);
    const treatmentCategory = lead.treatment_category || 'hair_transplant';

    // Analyze photo with Gemini to detect slot
    let slotAnalysis;
    try {
      slotAnalysis = await this.photoAnalyzer.analyzePhotoSlot(fileBuffer, treatmentCategory);
      this.logger.log(`Photo analyzed: slot=${slotAnalysis.detected_slot}, confidence=${slotAnalysis.confidence}`);
    } catch (error) {
      this.logger.error('Photo analysis failed:', error);
      slotAnalysis = {
        detected_slot: 'unknown',
        confidence: 0,
        quality_score: 50,
        quality_issues: [],
        is_usable: true,
      };
    }

    // Generate unique file name
    const assetId = uuidv4();
    const extension = 'jpg'; // Most Telegram photos are JPEG
    const storagePath = `leads/${leadId}/${assetId}.${extension}`;

    // Upload to Supabase Storage
    const { error: uploadError } = await this.supabase.client.storage
      .from('lead-media-private')
      .upload(storagePath, fileBuffer, {
        contentType: 'image/jpeg',
        upsert: false,
      });

    if (uploadError) {
      this.logger.error('Failed to upload photo to storage:', uploadError);
      throw uploadError;
    }

    // Save to photo_assets table with slot detection results
    const { error: insertError } = await this.supabase.client
      .from('photo_assets')
      .insert({
        lead_id: leadId,
        storage_path: storagePath,
        file_name: `${assetId}.${extension}`,
        file_size: fileBuffer.length,
        mime_type: 'image/jpeg',
        checklist_key: slotAnalysis.detected_slot !== 'unknown' ? slotAnalysis.detected_slot : null,
        detected_slot: slotAnalysis.detected_slot,
        slot_confidence: slotAnalysis.confidence,
        quality_score: slotAnalysis.quality_score,
        quality_issues: slotAnalysis.quality_issues,
        is_usable: slotAnalysis.is_usable,
      });

    if (insertError) {
      this.logger.error('Failed to save photo asset:', insertError);
      throw insertError;
    }

    this.logger.log(`Photo uploaded and analyzed: ${storagePath}, slot: ${slotAnalysis.detected_slot}`);

    // Check photo completion status
    await this.checkAndUpdatePhotoCompletion(leadId, treatmentCategory, lead.language || 'en');
  }

  /**
   * Check photo completion and update lead status / send reminders
   */
  private async checkAndUpdatePhotoCompletion(
    leadId: string,
    treatmentCategory: string,
    language: string,
  ): Promise<void> {
    // Get all uploaded photos for this lead
    const photos = await this.supabase.getLeadPhotos(leadId);
    const uploadedSlots = photos
      .map(p => (p as any).detected_slot)
      .filter(s => s && s !== 'unknown');

    // Check completion status
    const completion = this.photoAnalyzer.checkCompletion(uploadedSlots, treatmentCategory);

    this.logger.log(`Photo completion for lead ${leadId}: ${completion.completion_percentage}% (${completion.total_uploaded}/${completion.total_required})`);

    if (completion.is_complete) {
      // All required photos received - update status
      await this.supabase.upsertLeadProfile(leadId, {
        photo_status: 'complete',
      });

      // Check if medical info is also complete, if so, mark ready for doctor
      const lead = await this.supabase.getLeadById(leadId);
      const profile = lead.lead_profile as any;
      
      const hasMedicalInfo = profile?.has_allergies !== undefined && 
                            profile?.has_chronic_disease !== undefined;

      if (hasMedicalInfo) {
        await this.supabase.updateLead(leadId, { status: 'READY_FOR_DOCTOR' });
        
        // Create doctor notification
        await this.doctorNotifications.createReadyForDoctorNotification(
          leadId,
          profile?.name,
          treatmentCategory,
          true,
          true,
        );
        
        this.logger.log(`Lead ${leadId} is ready for doctor review`);
      }
    } else {
      // Update partial status
      await this.supabase.upsertLeadProfile(leadId, {
        photo_status: 'partial',
      });

      // Note: Missing photo reminder will be handled by AI in the next message
      // The AI will see the completion status and ask for missing photos
    }
  }

  private async queueAiJobWithPhotoDebounce(
    leadId: string,
    conversationId: string,
    messageId: string,
    language: string,
  ): Promise<void> {
    const existingDebounce = this.photoDebounceMap.get(leadId);

    if (existingDebounce) {
      // Clear existing timeout and update with new message info
      clearTimeout(existingDebounce.timeout);
      existingDebounce.photoCount += 1;
      existingDebounce.messageId = messageId; // Use latest message ID
      this.logger.log(`Photo debounce updated for lead ${leadId}, count: ${existingDebounce.photoCount}`);
    }

    const photoCount = existingDebounce?.photoCount ?? 1;

    // Set new timeout
    const timeout = setTimeout(async () => {
      this.photoDebounceMap.delete(leadId);
      
      this.logger.log(`Photo debounce triggered for lead ${leadId}, processing ${photoCount} photo(s)`);
      
      // Queue the AI job after debounce delay
      await this.queueService.addAiJob({
        jobType: 'ANALYZE_AND_DRAFT_REPLY',
        leadId,
        conversationId,
        messageId,
        language,
        contextWindow: 20,
      });
      
      this.logger.log(`AI job queued for lead ${leadId} after photo debounce`);
    }, this.PHOTO_DEBOUNCE_DELAY);

    this.photoDebounceMap.set(leadId, {
      timeout,
      conversationId,
      messageId,
      language,
      photoCount,
    });

    this.logger.log(`Photo debounce set for lead ${leadId}, waiting ${this.PHOTO_DEBOUNCE_DELAY}ms for more photos`);
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

      // Cancel any existing pending follow-ups for this lead before scheduling new one
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
   * AI-driven follow-up scheduling
   * Calls the AI to analyze the conversation and determine optimal follow-up timing
   */
  private async scheduleAiDrivenFollowup(
    leadId: string, 
    conversationId: string,
    language: string,
    desireScore?: number,
  ): Promise<void> {
    try {
      // Cancel any existing pending follow-ups
      await this.supabase.cancelPendingFollowups(leadId);

      // Get AI Python service URL
      const aiServiceUrl = this.configService.get<string>('AI_SERVICE_URL', 'http://localhost:8000');
      
      // Get conversation history
      const messages = await this.supabase.getConversationMessages(conversationId, 15);
      
      // Get lead context
      const lead = await this.supabase.getLeadById(leadId);
      if (!lead) {
        this.logger.error(`Lead not found for follow-up scheduling: ${leadId}`);
        return;
      }

      // Count previous follow-ups
      const previousFollowups = await this.supabase.getFollowupCount(leadId);
      
      // Get last user response time
      const lastUserMessage = messages
        .filter((m: any) => m.direction === 'in')
        .sort((a: any, b: any) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())[0];
      
      const lastUserResponseAt = lastUserMessage?.created_at;

      // Call AI service for follow-up analysis
      const response = await axios.post(`${aiServiceUrl}/api/v1/analyze-followup`, {
        messages: messages.map((m: any) => ({
          role: m.direction === 'in' ? 'user' : 'assistant',
          content: m.content,
        })),
        language,
        lead_context: {
          status: lead.status,
          treatmentCategory: lead.treatment_category,
          desireScore: desireScore ?? lead.desire_score,
          hasPhotos: (lead.lead_profile as Record<string, unknown> | null)?.photo_status === 'complete',
          profile: lead.lead_profile,
        },
        last_user_response_at: lastUserResponseAt,
        followup_count: previousFollowups,
      });

      const result = response.data;
      
      this.logger.log(`AI follow-up analysis for lead ${leadId}:`, {
        strategy: result.followup_strategy,
        shouldFollowup: result.should_followup,
        waitHours: result.wait_hours,
        confidence: result.confidence,
      });

      // Handle different strategies
      if (result.followup_strategy === 'give_up') {
        this.logger.log(`AI decided to give up follow-ups for lead ${leadId}: ${result.reasoning}`);
        return; // Don't schedule any follow-up
      }

      if (result.followup_strategy === 'escalate') {
        this.logger.log(`AI escalating lead ${leadId} to human: ${result.escalation_reason}`);
        await this.handleHandoff(leadId, conversationId, result.escalation_reason || 'ai_escalation');
        return;
      }

      if (!result.should_followup) {
        this.logger.log(`AI decided no follow-up needed for lead ${leadId}: ${result.reasoning}`);
        return;
      }

      // Calculate scheduled time
      const scheduledAt = new Date();
      if (result.followup_strategy === 'immediate') {
        // Schedule for 1 hour from now (give some buffer)
        scheduledAt.setHours(scheduledAt.getHours() + 1);
      } else if (result.wait_hours) {
        scheduledAt.setHours(scheduledAt.getHours() + result.wait_hours);
      } else {
        // Default to 24 hours
        scheduledAt.setHours(scheduledAt.getHours() + 24);
      }

      // Create follow-up with AI analysis data
      await this.supabase.createFollowup({
        lead_id: leadId,
        conversation_id: conversationId,
        followup_type: result.followup_tone || 'reminder',
        attempt_number: previousFollowups + 1,
        scheduled_at: scheduledAt.toISOString(),
        followup_strategy: result.followup_strategy,
        suggested_message: result.suggested_message,
        reasoning: result.reasoning,
        ai_confidence: result.confidence,
      });

      this.logger.log(
        `AI-driven follow-up scheduled for lead ${leadId} at ${scheduledAt.toISOString()} ` +
        `(strategy: ${result.followup_strategy}, tone: ${result.followup_tone})`
      );

    } catch (error) {
      this.logger.error(`Error scheduling AI-driven follow-up for lead ${leadId}:`, error);
      
      // Fallback to simple scheduling if AI service fails
      await this.scheduleFollowupIfNeeded(leadId, conversationId);
    }
  }

  /**
   * Check if minimum required information is collected before sending photo template.
   * 
   * Priority order for data collection:
   * 1. Name (personal info)
   * 2. Medical history basics (allergies, chronic diseases)
   * 3. THEN photos
   * 
   * This prevents jumping to photos before gathering essential info.
   */
  private hasRequiredInfoBeforePhotos(lead: Lead & { lead_profile: LeadProfile | null }): boolean {
    const profile = lead.lead_profile as Record<string, unknown> | null;
    
    if (!profile) {
      this.logger.debug(`Lead ${lead.id}: No profile, required info not collected`);
      return false;
    }
    
    // Required: Name (at minimum we need to know who we're talking to)
    const hasName = !!profile.name;
    
    // Required: At least one medical question answered
    // (indicates we've started the medical history collection)
    const hasAnyMedicalInfo = 
      profile.has_allergies !== undefined && profile.has_allergies !== null ||
      profile.has_chronic_disease !== undefined && profile.has_chronic_disease !== null ||
      profile.has_blood_disease !== undefined && profile.has_blood_disease !== null;
    
    const isReady = hasName && hasAnyMedicalInfo;
    
    this.logger.debug(
      `Lead ${lead.id}: hasRequiredInfoBeforePhotos = ${isReady} (hasName: ${hasName}, hasAnyMedicalInfo: ${hasAnyMedicalInfo})`
    );
    
    return isReady;
  }
}
