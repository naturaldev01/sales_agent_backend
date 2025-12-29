import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import {
  SupabaseService,
  Lead,
  LeadProfile,
  Conversation,
  Followup,
  Message,
} from '../../common/supabase/supabase.service';
import { QueueService } from '../../common/queue/queue.service';
import { FollowupsService } from './followups.service';
import { WhatsappAdapter } from '../webhooks/adapters/whatsapp.adapter';
import { TelegramAdapter } from '../webhooks/adapters/telegram.adapter';
import { AiClientService } from '../ai-client/ai-client.service';

interface FollowupWithRelations extends Followup {
  leads: (Lead & { lead_profile: LeadProfile | null }) | null;
  conversations: Conversation | null;
}

@Injectable()
export class FollowupsScheduler {
  private readonly logger = new Logger(FollowupsScheduler.name);
  private isRunning = false;

  constructor(
    private readonly supabase: SupabaseService,
    private readonly queueService: QueueService,
    private readonly followupsService: FollowupsService,
    private readonly whatsappAdapter: WhatsappAdapter,
    private readonly telegramAdapter: TelegramAdapter,
    private readonly aiClientService: AiClientService,
  ) {}

  @Cron(CronExpression.EVERY_MINUTE)
  async processFollowups(): Promise<void> {
    if (this.isRunning) {
      this.logger.debug('Followup processor already running, skipping');
      return;
    }

    this.isRunning = true;

    try {
      const pendingFollowups = await this.followupsService.getPendingFollowups();
      this.logger.log(`Processing ${pendingFollowups.length} pending followups`);

      for (const followup of pendingFollowups) {
        await this.processFollowup(followup as FollowupWithRelations);
      }
    } catch (error) {
      this.logger.error('Error processing followups:', error);
    } finally {
      this.isRunning = false;
    }
  }

  private async processFollowup(followup: FollowupWithRelations): Promise<void> {
    try {
      const lead = followup.leads;
      const conversation = followup.conversations;

      if (!lead || !conversation) {
        this.logger.warn(`Missing lead or conversation for followup ${followup.id}`);
        return;
      }

      // Check if lead status allows followups
      if (['HANDOFF_HUMAN', 'CONVERTED', 'CLOSED', 'READY_FOR_DOCTOR'].includes(lead.status)) {
        this.logger.debug(`Skipping followup for lead ${lead.id} with status ${lead.status}`);
        await this.supabase.updateFollowup(followup.id, { status: 'cancelled' });
        return;
      }

      // Get conversation messages for AI context
      const conversationMessages = await this.supabase.getConversationMessages(conversation.id, 10);
      
      // Generate AI-powered follow-up message
      let message: string;
      
      try {
        message = await this.generateAiFollowupMessage(
          lead,
          conversationMessages,
          followup.attempt_number,
        );
        this.logger.log(`AI generated followup message for lead ${lead.id}`);
      } catch (aiError) {
        // Fallback to template message if AI fails
        this.logger.warn(`AI followup generation failed, using template: ${aiError}`);
        message = this.followupsService.getFollowupMessage(
          lead.language || 'en',
          followup.attempt_number,
        );
      }

      // Save the message to database
      const savedMessage: Message = await this.supabase.createMessage({
        conversation_id: conversation.id,
        lead_id: lead.id,
        direction: 'out',
        content: message,
        sender_type: 'ai',
      });

      // Send via appropriate channel
      try {
        if (lead.channel === 'whatsapp' && lead.channel_user_id) {
          await this.whatsappAdapter.sendMessage({
            channel: 'whatsapp',
            channelUserId: lead.channel_user_id,
            content: message,
          });
        } else if (lead.channel === 'telegram' && lead.channel_user_id) {
          await this.telegramAdapter.sendMessage({
            channel: 'telegram',
            channelUserId: lead.channel_user_id,
            content: message,
          });
        }
      } catch (error) {
        this.logger.error(`Failed to send followup via ${lead.channel}:`, error);
        await this.supabase.updateFollowup(followup.id, { status: 'failed' });
        return;
      }

      // Mark followup as sent
      await this.followupsService.markAsSent(followup.id, savedMessage.id);

      // Update lead status and schedule next followup if needed
      const settings = await this.followupsService.getSettings();
      if (followup.attempt_number >= settings.max_attempts) {
        await this.supabase.updateLead(lead.id, { status: 'DORMANT' });
        this.logger.log(`Lead ${lead.id} moved to DORMANT after max followups`);
      } else {
        await this.supabase.updateLead(lead.id, { status: 'WAITING_FOR_USER' });
        
        // Schedule next followup attempt
        const nextAttempt = followup.attempt_number + 1;
        const intervals = settings.intervals_hours || [2, 12, 24, 48, 72];
        const nextIntervalHours = intervals[nextAttempt - 1] || intervals[intervals.length - 1];
        
        const nextScheduledAt = new Date();
        nextScheduledAt.setHours(nextScheduledAt.getHours() + nextIntervalHours);
        
        // Determine followup type based on attempt number
        const followupType = nextAttempt === 2 ? 'check_in' : 
                            nextAttempt >= settings.max_attempts ? 'final' : 'reminder';
        
        await this.supabase.createFollowup({
          lead_id: lead.id,
          conversation_id: conversation.id,
          followup_type: followupType,
          attempt_number: nextAttempt,
          scheduled_at: nextScheduledAt.toISOString(),
        });
        
        this.logger.log(`Next followup (attempt ${nextAttempt}) scheduled for lead ${lead.id} at ${nextScheduledAt.toISOString()}`);
      }

      this.logger.log(`Followup ${followup.id} sent successfully`);
    } catch (error) {
      this.logger.error(`Error processing followup ${followup.id}:`, error);
    }
  }

  private async generateAiFollowupMessage(
    lead: Lead & { lead_profile: LeadProfile | null },
    messages: Message[],
    attemptNumber: number,
  ): Promise<string> {
    // Format messages for AI
    const formattedMessages = messages.map((m) => ({
      role: m.direction === 'in' ? 'user' as const : 'assistant' as const,
      content: m.content || '',
      timestamp: m.created_at || '',
    }));

    // Add a system context message about the follow-up
    const followupContext = this.getFollowupContext(attemptNumber, lead.language || 'en');
    
    // Call AI service to generate personalized follow-up
    const aiResponse = await this.aiClientService.analyzeAndDraftReply({
      leadId: lead.id,
      conversationId: '',
      messageId: '',
      language: lead.language || 'en',
      messages: [
        ...formattedMessages,
        // Add a pseudo-message to signal this is a follow-up
        {
          role: 'user' as const,
          content: followupContext,
          timestamp: new Date().toISOString(),
        },
      ],
      leadContext: {
        status: lead.status,
        treatmentCategory: lead.treatment_category || undefined,
        desireScore: lead.desire_score || undefined,
        profile: lead.lead_profile || undefined,
      },
    });

    if (aiResponse.success && aiResponse.data?.replyDraft) {
      return aiResponse.data.replyDraft;
    }

    throw new Error('AI did not return a valid reply');
  }

  private getFollowupContext(attemptNumber: number, language: string): string {
    const contexts: Record<string, Record<number, string>> = {
      en: {
        1: '[SYSTEM: User has not responded for 2 hours. Generate a friendly, short follow-up message to check in and remind them you are here to help. Do not repeat previous messages.]',
        2: '[SYSTEM: User has not responded for 24 hours. Generate a gentle check-in message. Ask if they have any questions or concerns. Keep it brief and friendly.]',
        3: '[SYSTEM: User has not responded for 3 days. Generate a final, warm follow-up message. Let them know they can reach out anytime. This should feel like a friendly goodbye, not pushy.]',
      },
      tr: {
        1: '[SİSTEM: Kullanıcı 2 saattir yanıt vermedi. Nazik ve kısa bir hatırlatma mesajı oluştur. Yardımcı olmak için burada olduğunu hatırlat. Önceki mesajları tekrarlama.]',
        2: '[SİSTEM: Kullanıcı 24 saattir yanıt vermedi. Nazik bir kontrol mesajı oluştur. Soruları veya endişeleri olup olmadığını sor. Kısa ve samimi tut.]',
        3: '[SİSTEM: Kullanıcı 3 gündür yanıt vermedi. Son bir sıcak takip mesajı oluştur. İstedikleri zaman ulaşabileceklerini bildir. Baskıcı değil, samimi bir veda gibi olsun.]',
      },
    };

    const langContexts = contexts[language] || contexts.en;
    return langContexts[attemptNumber] || langContexts[1];
  }
}
