import { Injectable, Logger } from '@nestjs/common';
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

  constructor(
    private readonly supabase: SupabaseService,
    private readonly queueService: QueueService,
    private readonly stateMachine: StateMachineService,
    private readonly configService: ConfigService,
    private readonly photosService: PhotosService,
  ) {
    this.telegramBotToken = this.configService.get<string>('TELEGRAM_BOT_TOKEN', '');
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

      // 5. Handle state transition
      const currentStatus = lead.status as LeadStatus;
      const newStatus = this.determineNewStatus(currentStatus, message);
      
      if (newStatus !== currentStatus) {
        await this.supabase.updateLead(lead.id, { status: newStatus });
        this.logger.log(`Lead status updated: ${currentStatus} -> ${newStatus}`);
      }

      // 5.5 Update lead language if detected from message
      const detectedLanguage = message.senderLanguage;
      if (detectedLanguage && detectedLanguage !== lead.language) {
        await this.supabase.updateLead(lead.id, { language: detectedLanguage });
        this.logger.log(`Lead language updated to: ${detectedLanguage}`);
      }

      // Use detected language or fall back to lead's stored language
      const messageLanguage = detectedLanguage || lead.language || 'en';

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
  }): Promise<void> {
    this.logger.log(`Processing AI response for lead: ${data.leadId}`);

    try {
      const lead = await this.supabase.getLeadById(data.leadId);
      if (!lead) {
        throw new Error(`Lead not found: ${data.leadId}`);
      }

      // Check for handoff
      if (data.shouldHandoff) {
        await this.handleHandoff(data.leadId, data.conversationId, data.handoffReason || 'ai_recommendation');
        return;
      }

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

      // Check if ready for doctor evaluation (all medical history collected)
      if (data.readyForDoctor) {
        updateData.status = 'READY_FOR_DOCTOR';
        this.logger.log(`Lead ${data.leadId} is ready for doctor evaluation - all medical history collected`);
      }

      if (Object.keys(updateData).length > 0) {
        await this.supabase.updateLead(data.leadId, updateData);
      }

      // Save and send the reply
      if (data.replyDraft) {
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

        // Check if this is a photo request and we should send a template image
        const isPhotoRequest = this.isPhotoRequestMessage(data.replyDraft, lead.language || 'en');
        const treatmentCategory = lead.treatment_category;
        
        if (isPhotoRequest && treatmentCategory) {
          // Try to send template image first
          await this.sendTemplateImageIfAvailable(
            lead.channel as 'whatsapp' | 'telegram' | 'web',
            lead.channel_user_id!,
            treatmentCategory,
            lead.language || 'en',
          );
        }

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

      // Schedule follow-up if needed
      await this.scheduleFollowupIfNeeded(data.leadId, data.conversationId);

    } catch (error) {
      this.logger.error('Error processing AI response:', error);
      throw error;
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
   */
  private isPhotoRequestMessage(message: string, language: string): boolean {
    const photoKeywords: Record<string, string[]> = {
      en: ['photo', 'picture', 'image', 'send us', 'share', 'upload'],
      tr: ['fotoğraf', 'resim', 'görsel', 'gönderin', 'paylaşın', 'yükleyin'],
      ar: ['صور', 'صورة', 'ارسل', 'شارك'],
      ru: ['фото', 'фотографи', 'снимок', 'отправьте', 'загрузите'],
      fr: ['photo', 'image', 'envoyez', 'partagez'],
    };

    const keywords = photoKeywords[language] || photoKeywords.en;
    const messageLower = message.toLowerCase();
    
    return keywords.some(keyword => messageLower.includes(keyword));
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
      // Get template image for the treatment
      const imageData = await this.photosService.getTemplateImageBuffer(treatmentCategory, language);
      
      if (!imageData) {
        this.logger.debug(`No template image available for ${treatmentCategory}/${language}`);
        return false;
      }

      // Send the template image via the appropriate channel
      if (channel === 'telegram' && this.telegramBotToken) {
        await this.sendTelegramPhoto(channelUserId, imageData.buffer, this.getTemplateCaption(treatmentCategory, language));
        this.logger.log(`Template image sent for ${treatmentCategory} to ${channel}:${channelUserId}`);
        return true;
      }
      
      // For WhatsApp, we would use the WhatsApp Business API
      // For web, we might use a different approach (e.g., URL)
      this.logger.debug(`Template image sending not implemented for channel: ${channel}`);
      return false;
    } catch (error) {
      this.logger.error(`Failed to send template image for ${treatmentCategory}:`, error);
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

    // Save to photo_assets table
    await this.supabase.createPhotoAsset({
      lead_id: leadId,
      storage_path: storagePath,
      file_name: `${assetId}.${extension}`,
      file_size: fileBuffer.length,
      mime_type: 'image/jpeg',
    });

    this.logger.log(`Photo uploaded: ${storagePath}`);
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
    // Get follow-up settings
    const settings = await this.supabase.getConfig('followup_settings') as {
      intervals_hours?: number[];
      max_attempts?: number;
    } | null;
    
    if (!settings) return;

    const intervals = settings.intervals_hours || [2, 24, 72];
    const maxAttempts = settings.max_attempts || 3;

    // Check existing follow-ups
    // For now, just schedule the first follow-up
    // A more complete implementation would check existing follow-ups

    const scheduledAt = new Date();
    scheduledAt.setHours(scheduledAt.getHours() + intervals[0]);

    await this.supabase.createFollowup({
      lead_id: leadId,
      conversation_id: conversationId,
      followup_type: 'reminder',
      attempt_number: 1,
      scheduled_at: scheduledAt.toISOString(),
    });

    this.logger.debug(`Follow-up scheduled for lead ${leadId} at ${scheduledAt.toISOString()}`);
  }
}
