import { Injectable, Logger } from '@nestjs/common';
import { SupabaseService } from '../../common/supabase/supabase.service';
import { QueueService } from '../../common/queue/queue.service';

interface FollowupSettings {
  intervals_hours: number[];
  max_attempts: number;
  working_hours_start: string;
  working_hours_end: string;
  cooldown_days: number;
}

@Injectable()
export class FollowupsService {
  private readonly logger = new Logger(FollowupsService.name);

  constructor(
    private readonly supabase: SupabaseService,
    private readonly queueService: QueueService,
  ) {}

  async getSettings(): Promise<FollowupSettings> {
    const settings = await this.supabase.getConfig('followup_settings');
    const defaultSettings: FollowupSettings = {
      intervals_hours: [2, 24, 72],
      max_attempts: 3,
      working_hours_start: '09:00',
      working_hours_end: '19:00',
      cooldown_days: 7,
    };
    
    if (settings && typeof settings === 'object' && !Array.isArray(settings)) {
      return { ...defaultSettings, ...settings as Partial<FollowupSettings> };
    }
    
    return defaultSettings;
  }

  async scheduleFollowups(leadId: string, conversationId: string): Promise<void> {
    const settings = await this.getSettings();
    const now = new Date();

    for (let i = 0; i < settings.max_attempts; i++) {
      const scheduledAt = new Date(now);
      scheduledAt.setHours(scheduledAt.getHours() + settings.intervals_hours[i]);

      // Adjust for working hours
      const adjustedTime = this.adjustForWorkingHours(
        scheduledAt,
        settings.working_hours_start,
        settings.working_hours_end,
      );

      const followupType = i === 0 ? 'reminder' : i === 1 ? 'check_in' : 'final';

      await this.supabase.createFollowup({
        lead_id: leadId,
        conversation_id: conversationId,
        followup_type: followupType,
        attempt_number: i + 1,
        scheduled_at: adjustedTime.toISOString(),
      });

      this.logger.debug(
        `Followup ${i + 1} scheduled for ${adjustedTime.toISOString()}`,
      );
    }
  }

  private adjustForWorkingHours(
    date: Date,
    startHour: string,
    endHour: string,
  ): Date {
    const [startH, startM] = startHour.split(':').map(Number);
    const [endH, endM] = endHour.split(':').map(Number);

    const adjusted = new Date(date);
    const hour = adjusted.getHours();

    // If before working hours, move to start
    if (hour < startH || (hour === startH && adjusted.getMinutes() < startM)) {
      adjusted.setHours(startH, startM, 0, 0);
    }
    // If after working hours, move to next day start
    else if (hour > endH || (hour === endH && adjusted.getMinutes() >= endM)) {
      adjusted.setDate(adjusted.getDate() + 1);
      adjusted.setHours(startH, startM, 0, 0);
    }

    return adjusted;
  }

  async getPendingFollowups() {
    return this.supabase.getPendingFollowups();
  }

  async markAsSent(followupId: string, messageId: string): Promise<void> {
    await this.supabase.updateFollowup(followupId, {
      status: 'sent',
      sent_at: new Date().toISOString(),
      message_id: messageId,
    });
  }

  async markAsResponded(followupId: string): Promise<void> {
    await this.supabase.updateFollowup(followupId, {
      status: 'responded',
      response_received: true,
      response_at: new Date().toISOString(),
    });
  }

  async cancelPendingForLead(leadId: string): Promise<void> {
    await this.supabase.cancelPendingFollowups(leadId);
  }

  getFollowupMessage(language: string, attemptNumber: number): string {
    const messages: Record<string, Record<number, string>> = {
      en: {
        1: "Hi! Just checking in - did you have any other questions about the procedure? I'm here to help! 🙂",
        2: "Hello again! I wanted to follow up and see if you're still interested. Feel free to reach out anytime.",
        3: "Hi there! This is my final check-in. If you ever want to continue our conversation, just send a message. Take care! 👋",
      },
      tr: {
        1: "Merhaba! Sadece kontrol ediyorum - işlem hakkında başka sorularınız var mıydı? Yardımcı olmak için buradayım! 🙂",
        2: "Tekrar merhaba! Hala ilgilenip ilgilenmediğinizi görmek istedim. Dilediğiniz zaman ulaşabilirsiniz.",
        3: "Merhaba! Bu son kontrol mesajım. Sohbetimize devam etmek isterseniz mesaj atmanız yeterli. Kendinize iyi bakın! 👋",
      },
      ar: {
        1: "مرحباً! أردت الاطمئنان - هل لديك أي أسئلة أخرى حول الإجراء؟ أنا هنا للمساعدة! 🙂",
        2: "مرحباً مجدداً! أردت المتابعة ومعرفة ما إذا كنت لا تزال مهتماً. لا تتردد في التواصل في أي وقت.",
        3: "مرحباً! هذه آخر متابعة مني. إذا أردت مواصلة محادثتنا، فقط أرسل رسالة. اعتنِ بنفسك! 👋",
      },
      ru: {
        1: "Привет! Просто проверяю - есть ли у вас другие вопросы о процедуре? Я здесь, чтобы помочь! 🙂",
        2: "Здравствуйте снова! Хотел узнать, всё ещё ли вы заинтересованы. Обращайтесь в любое время.",
        3: "Привет! Это моё последнее сообщение. Если захотите продолжить разговор, просто напишите. Берегите себя! 👋",
      },
    };

    const langMessages = messages[language] || messages.en;
    return langMessages[attemptNumber] || langMessages[1];
  }
}

