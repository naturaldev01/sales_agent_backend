import { Injectable, Logger } from '@nestjs/common';
import { SupabaseService } from '../../common/supabase/supabase.service';

export interface NotificationItem {
  id: string;
  type: 'new_lead' | 'new_photo' | 'new_message';
  title: string;
  message: string;
  leadId?: string;
  photoId?: string;
  createdAt: string;
}

@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);

  constructor(private readonly supabase: SupabaseService) {}

  async getRecentActivity(since?: string): Promise<NotificationItem[]> {
    const notifications: NotificationItem[] = [];
    const sinceDate = since ? new Date(since) : new Date(Date.now() - 24 * 60 * 60 * 1000); // Default: last 24 hours

    try {
      // Get new leads
      const { data: newLeads } = await this.supabase.client
        .from('leads')
        .select(`
          id,
          created_at,
          lead_profile (name)
        `)
        .gte('created_at', sinceDate.toISOString())
        .order('created_at', { ascending: false })
        .limit(20);

      if (newLeads) {
        for (const lead of newLeads) {
          notifications.push({
            id: `lead-${lead.id}`,
            type: 'new_lead',
            title: 'New Lead',
            message: `${(lead.lead_profile as any)?.name || 'Someone'} started a conversation`,
            leadId: lead.id,
            createdAt: lead.created_at || new Date().toISOString(),
          });
        }
      }

      // Get new photos
      const { data: newPhotos } = await this.supabase.client
        .from('photo_assets')
        .select(`
          id,
          lead_id,
          created_at,
          leads (
            id,
            lead_profile (name)
          )
        `)
        .gte('created_at', sinceDate.toISOString())
        .order('created_at', { ascending: false })
        .limit(20);

      if (newPhotos) {
        for (const photo of newPhotos) {
          const leadName = (photo.leads as any)?.lead_profile?.name || 'A lead';
          notifications.push({
            id: `photo-${photo.id}`,
            type: 'new_photo',
            title: 'New Photo',
            message: `${leadName} uploaded a photo`,
            leadId: photo.lead_id,
            photoId: photo.id,
            createdAt: photo.created_at || new Date().toISOString(),
          });
        }
      }

      // Get new incoming messages (limit to avoid duplicates with leads)
      const { data: newMessages } = await this.supabase.client
        .from('messages')
        .select(`
          id,
          lead_id,
          created_at,
          content,
          leads (
            id,
            lead_profile (name)
          )
        `)
        .eq('direction', 'in')
        .gte('created_at', sinceDate.toISOString())
        .order('created_at', { ascending: false })
        .limit(30);

      if (newMessages) {
        // Group by lead to avoid spam - only show most recent message per lead
        const seenLeads = new Set<string>();
        for (const msg of newMessages) {
          if (!seenLeads.has(msg.lead_id)) {
            seenLeads.add(msg.lead_id);
            const leadName = (msg.leads as any)?.lead_profile?.name || 'A lead';
            notifications.push({
              id: `msg-${msg.id}`,
              type: 'new_message',
              title: 'New Message',
              message: `${leadName}: ${(msg.content || '').substring(0, 50)}${(msg.content || '').length > 50 ? '...' : ''}`,
              leadId: msg.lead_id,
              createdAt: msg.created_at || new Date().toISOString(),
            });
          }
        }
      }

      // Sort all notifications by date
      notifications.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

      return notifications.slice(0, 50); // Limit total
    } catch (error) {
      this.logger.error('Error fetching notifications:', error);
      return [];
    }
  }
}

