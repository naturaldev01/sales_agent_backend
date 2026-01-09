import { Injectable, Logger } from '@nestjs/common';
import { SupabaseService, Lead, LeadProfile } from '../../common/supabase/supabase.service';

// Note: doctor_notifications table will be created by migration 009
// After running migration, regenerate types with: supabase gen types typescript

export interface DoctorNotification {
  id: string;
  lead_id: string;
  notification_type: string;
  title: string;
  message: string | null;
  priority: string;
  metadata: Record<string, unknown>;
  is_read: boolean;
  read_by: string | null;
  read_at: string | null;
  created_at: string;
  leads?: Lead & { lead_profile?: LeadProfile | null };
}

export interface CreateDoctorNotificationDto {
  lead_id: string;
  notification_type: 'new_lead' | 'medical_risk' | 'photo_complete' | 'urgent' | 'needs_attention';
  title: string;
  message?: string;
  priority?: 'low' | 'normal' | 'high' | 'urgent';
  metadata?: Record<string, unknown>;
}

@Injectable()
export class DoctorNotificationsService {
  private readonly logger = new Logger(DoctorNotificationsService.name);

  constructor(private readonly supabase: SupabaseService) {}

  /**
   * Create a notification for doctors
   * Note: Uses raw query until types are regenerated after migration
   */
  async createNotification(dto: CreateDoctorNotificationDto): Promise<DoctorNotification> {
    const { data, error } = await (this.supabase.client as any)
      .from('doctor_notifications')
      .insert({
        lead_id: dto.lead_id,
        notification_type: dto.notification_type,
        title: dto.title,
        message: dto.message || null,
        priority: dto.priority || 'normal',
        metadata: dto.metadata || {},
      })
      .select()
      .single();

    if (error) {
      this.logger.error('Error creating doctor notification:', error);
      throw error;
    }

    this.logger.log(`Doctor notification created: ${dto.notification_type} for lead ${dto.lead_id}`);
    return data as DoctorNotification;
  }

  /**
   * Create medical risk alert for doctors
   */
  async createMedicalRiskAlert(
    leadId: string,
    riskDetails: string,
    keywordsFound: string[],
    patientName?: string,
  ): Promise<DoctorNotification> {
    return this.createNotification({
      lead_id: leadId,
      notification_type: 'medical_risk',
      title: `⚠️ Yüksek Riskli Hasta: ${patientName || 'Bilinmiyor'}`,
      message: `Risk faktörleri tespit edildi: ${riskDetails}`,
      priority: 'high',
      metadata: {
        risk_details: riskDetails,
        keywords_found: keywordsFound,
        detected_at: new Date().toISOString(),
      },
    });
  }

  /**
   * Create notification when lead is ready for doctor review
   */
  async createReadyForDoctorNotification(
    leadId: string,
    patientName?: string,
    treatmentCategory?: string,
    hasPhotos: boolean = false,
    hasMedicalInfo: boolean = false,
  ): Promise<DoctorNotification> {
    const statusParts = [];
    if (hasPhotos) statusParts.push('📸 Fotoğraflar mevcut');
    if (hasMedicalInfo) statusParts.push('📋 Medikal bilgi mevcut');
    
    return this.createNotification({
      lead_id: leadId,
      notification_type: 'new_lead',
      title: `Yeni Hasta: ${patientName || 'Bilinmiyor'}`,
      message: `${treatmentCategory || 'Genel'} değerlendirmesi için hazır.\n${statusParts.join('\n')}`,
      priority: 'normal',
      metadata: {
        treatment_category: treatmentCategory,
        has_photos: hasPhotos,
        has_medical_info: hasMedicalInfo,
      },
    });
  }

  /**
   * Create urgent notification
   */
  async createUrgentNotification(
    leadId: string,
    reason: string,
    patientName?: string,
  ): Promise<DoctorNotification> {
    return this.createNotification({
      lead_id: leadId,
      notification_type: 'urgent',
      title: `🚨 Acil: ${patientName || 'Bilinmiyor'}`,
      message: reason,
      priority: 'urgent',
      metadata: {
        urgency_reason: reason,
      },
    });
  }

  /**
   * Get all notifications (optionally filtered)
   * Note: Uses raw query until types are regenerated after migration
   */
  async getNotifications(options: {
    onlyUnread?: boolean;
    type?: string;
    priority?: string;
    limit?: number;
  } = {}): Promise<DoctorNotification[]> {
    let query = (this.supabase.client as any)
      .from('doctor_notifications')
      .select(`
        *,
        leads (
          id,
          treatment_category,
          status,
          language,
          country,
          lead_profile (
            name,
            email,
            phone
          )
        )
      `)
      .order('created_at', { ascending: false })
      .limit(options.limit || 50);

    if (options.onlyUnread) {
      query = query.eq('is_read', false);
    }

    if (options.type) {
      query = query.eq('notification_type', options.type);
    }

    if (options.priority) {
      query = query.eq('priority', options.priority);
    }

    const { data, error } = await query;

    if (error) {
      this.logger.error('Error fetching doctor notifications:', error);
      throw error;
    }

    return (data || []) as DoctorNotification[];
  }

  /**
   * Get unread notification count
   */
  async getUnreadCount(): Promise<number> {
    const { count, error } = await (this.supabase.client as any)
      .from('doctor_notifications')
      .select('*', { count: 'exact', head: true })
      .eq('is_read', false);

    if (error) {
      this.logger.error('Error getting unread count:', error);
      throw error;
    }

    return count || 0;
  }

  /**
   * Get high priority notifications
   */
  async getHighPriorityNotifications(limit = 10): Promise<DoctorNotification[]> {
    return this.getNotifications({
      onlyUnread: true,
      priority: 'high',
      limit,
    });
  }

  /**
   * Mark notification as read
   */
  async markAsRead(notificationId: string, userId: string): Promise<void> {
    const { error } = await (this.supabase.client as any)
      .from('doctor_notifications')
      .update({
        is_read: true,
        read_by: userId,
        read_at: new Date().toISOString(),
      })
      .eq('id', notificationId);

    if (error) {
      this.logger.error('Error marking notification as read:', error);
      throw error;
    }
  }

  /**
   * Mark all notifications as read for a user
   */
  async markAllAsRead(userId: string): Promise<number> {
    const { data, error } = await (this.supabase.client as any)
      .from('doctor_notifications')
      .update({
        is_read: true,
        read_by: userId,
        read_at: new Date().toISOString(),
      })
      .eq('is_read', false)
      .select('id');

    if (error) {
      this.logger.error('Error marking all notifications as read:', error);
      throw error;
    }

    return data?.length || 0;
  }

  /**
   * Delete old read notifications (cleanup)
   */
  async cleanupOldNotifications(daysOld = 30): Promise<number> {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - daysOld);

    const { data, error } = await (this.supabase.client as any)
      .from('doctor_notifications')
      .delete()
      .eq('is_read', true)
      .lt('created_at', cutoffDate.toISOString())
      .select('id');

    if (error) {
      this.logger.error('Error cleaning up old notifications:', error);
      throw error;
    }

    const count = data?.length || 0;
    if (count > 0) {
      this.logger.log(`Cleaned up ${count} old doctor notifications`);
    }

    return count;
  }
}
