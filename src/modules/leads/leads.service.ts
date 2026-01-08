import { Injectable, Logger, NotFoundException, ForbiddenException, BadRequestException, Inject, forwardRef } from '@nestjs/common';
import {
  SupabaseService,
  Lead,
  LeadProfile,
  PhotoAsset,
  PhotoChecklist,
} from '../../common/supabase/supabase.service';
import { ZohoCrmService } from '../zoho-crm/zoho-crm.service';

export interface LeadWithProfile extends Lead {
  lead_profile?: LeadProfile | null;
}

export interface DoctorApprovalDto {
  treatment_recommendations: string;
}

export interface SalesPriceDto {
  estimated_price_min: number;
  estimated_price_max: number;
  price_currency: string;
  sync_to_zoho?: boolean;  // Optional flag to trigger CRM sync
}

export interface DoctorComment {
  id: string;
  comment: string;
  comment_type: string;
  is_pinned: boolean;
  created_at: string;
  users?: {
    name: string;
    role: string;
  };
}

@Injectable()
export class LeadsService {
  private readonly logger = new Logger(LeadsService.name);

  constructor(
    private readonly supabase: SupabaseService,
    @Inject(forwardRef(() => ZohoCrmService))
    private readonly zohoCrmService: ZohoCrmService,
  ) {}

  async findAll(options: {
    status?: string;
    treatment?: string;
    desireBand?: string;
    channel?: string;
    limit?: number;
    offset?: number;
    allowedTreatments?: string[];
  } = {}): Promise<LeadWithProfile[]> {
    const leads = await this.supabase.getAllLeads(options.limit || 50);

    // Apply filters
    let filtered = leads as LeadWithProfile[];

    // Doctor specialty filter - only show leads with allowed treatment categories
    if (options.allowedTreatments && options.allowedTreatments.length > 0) {
      filtered = filtered.filter((l) => 
        l.treatment_category && options.allowedTreatments!.includes(l.treatment_category)
      );
    }

    if (options.status) {
      filtered = filtered.filter((l) => l.status === options.status);
    }
    if (options.treatment) {
      filtered = filtered.filter((l) => l.treatment_category === options.treatment);
    }
    if (options.desireBand) {
      filtered = filtered.filter((l) => l.desire_band === options.desireBand);
    }
    if (options.channel) {
      filtered = filtered.filter((l) => l.channel === options.channel);
    }

    return filtered;
  }

  async findById(id: string): Promise<LeadWithProfile> {
    const lead = await this.supabase.getLeadById(id);
    if (!lead) {
      throw new NotFoundException(`Lead not found: ${id}`);
    }
    return lead as LeadWithProfile;
  }

  async findByStatus(status: string, limit = 50): Promise<LeadWithProfile[]> {
    return this.supabase.getLeadsByStatus(status, limit) as Promise<LeadWithProfile[]>;
  }

  async updateStatus(id: string, status: string): Promise<LeadWithProfile> {
    await this.supabase.updateLead(id, { status });
    return this.findById(id);
  }

  async updateDesireScore(id: string, score: number): Promise<LeadWithProfile> {
    await this.supabase.updateLead(id, { desire_score: score });
    return this.findById(id);
  }

  async getLeadPhotos(id: string): Promise<(PhotoAsset & { signed_url?: string })[]> {
    const photos = await this.supabase.getLeadPhotos(id);
    
    // Generate signed URLs for each photo
    const photosWithUrls = await Promise.all(
      photos.map(async (photo) => {
        try {
          const { data } = await this.supabase.client.storage
            .from('lead-media-private')
            .createSignedUrl(photo.storage_path, 3600); // 1 hour expiry
          
          return {
            ...photo,
            signed_url: data?.signedUrl || undefined,
          };
        } catch {
          return photo;
        }
      })
    );

    return photosWithUrls;
  }

  async getLeadPhotoProgress(id: string): Promise<{
    checklist: PhotoChecklist[];
    uploaded: PhotoAsset[];
    progress: number;
  }> {
    const lead = await this.findById(id);
    if (!lead.treatment_category) {
      return { checklist: [], uploaded: [], progress: 0 };
    }

    const [checklist, photos] = await Promise.all([
      this.supabase.getPhotoChecklist(lead.treatment_category),
      this.supabase.getLeadPhotos(id),
    ]);

    const uploadedKeys = photos.map((p) => p.checklist_key);
    const requiredItems = checklist.filter((c) => c.is_required);
    const completedRequired = requiredItems.filter((c) =>
      uploadedKeys.includes(c.checklist_key),
    );

    return {
      checklist,
      uploaded: photos,
      progress: requiredItems.length > 0
        ? Math.round((completedRequired.length / requiredItems.length) * 100)
        : 100,
    };
  }

  async getStatistics(): Promise<{
    total: number;
    byStatus: Record<string, number>;
    byDesireBand: Record<string, number>;
  }> {
    const leads = await this.supabase.getAllLeads(1000);

    const stats = {
      total: leads.length,
      byStatus: {} as Record<string, number>,
      byDesireBand: {} as Record<string, number>,
    };

    for (const lead of leads) {
      // Count by status
      stats.byStatus[lead.status] = (stats.byStatus[lead.status] || 0) + 1;

      // Count by desire band
      if (lead.desire_band) {
        stats.byDesireBand[lead.desire_band] =
          (stats.byDesireBand[lead.desire_band] || 0) + 1;
      }
    }

    return stats;
  }

  // ==================== DOCTOR APPROVAL ====================

  /**
   * Doctor approves a lead and sends it to sales department
   * Status: READY_FOR_DOCTOR -> READY_FOR_SALES
   */
  async doctorApprove(
    leadId: string,
    doctorId: string,
    dto: DoctorApprovalDto,
  ): Promise<LeadWithProfile> {
    // Get the lead first
    const lead = await this.findById(leadId);

    // Validate lead is in correct status
    if (lead.status !== 'READY_FOR_DOCTOR') {
      throw new BadRequestException(
        `Lead must be in READY_FOR_DOCTOR status to approve. Current status: ${lead.status}`,
      );
    }

    // Validate treatment recommendations
    if (!dto.treatment_recommendations || dto.treatment_recommendations.trim().length === 0) {
      throw new BadRequestException('Treatment recommendations are required');
    }

    // Update lead with doctor approval (only treatment recommendations, no price)
    const updateData: Record<string, unknown> = {
      status: 'READY_FOR_SALES',
      doctor_approved_by: doctorId,
      doctor_approved_at: new Date().toISOString(),
      treatment_recommendations: dto.treatment_recommendations.trim(),
    };

    await this.supabase.updateLead(leadId, updateData);

    // Create sales notification
    await this.createSalesNotification(leadId, lead);

    this.logger.log(`Lead ${leadId} approved by doctor ${doctorId} and sent to sales`);

    return this.findById(leadId);
  }

  /**
   * Create a notification for sales team
   */
  private async createSalesNotification(leadId: string, lead: LeadWithProfile): Promise<void> {
    try {
      const patientName = lead.lead_profile?.name || 'Unknown Patient';
      const treatment = lead.treatment_category || 'Unknown Treatment';

      const { error } = await this.supabase.client
        .from('sales_notifications')
        .insert({
          lead_id: leadId,
          notification_type: 'new_lead',
          title: `New Lead Ready: ${patientName}`,
          message: `A new ${treatment} lead has been approved by the doctor and is ready for pricing.`,
          metadata: {
            treatment_category: lead.treatment_category,
            patient_name: patientName,
            country: lead.country,
            language: lead.language,
          },
        });

      if (error) {
        this.logger.error('Failed to create sales notification:', error);
        // Don't throw - the approval was successful
      }
    } catch (err) {
      this.logger.error('Error creating sales notification:', err);
    }
  }

  /**
   * Get leads ready for sales (READY_FOR_SALES status)
   */
  async getLeadsForSales(limit = 50): Promise<LeadWithProfile[]> {
    const { data, error } = await this.supabase.client
      .from('leads')
      .select(`
        *,
        lead_profile (*)
      `)
      .eq('status', 'READY_FOR_SALES')
      .order('doctor_approved_at', { ascending: false })
      .limit(limit);

    if (error) {
      this.logger.error('Error fetching leads for sales:', error);
      throw error;
    }

    return data as LeadWithProfile[];
  }

  // ==================== SALES PRICE SUBMISSION ====================

  /**
   * Sales agent submits price for a lead
   * Status changes to SALES_PRICED and optionally syncs to Zoho CRM
   */
  async submitSalesPrice(
    leadId: string,
    salesAgentId: string,
    dto: SalesPriceDto,
  ): Promise<LeadWithProfile & { zohoSync?: { success: boolean; zohoLeadId?: string; error?: string } }> {
    const lead = await this.findById(leadId);

    // Validate lead is in correct status
    if (lead.status !== 'READY_FOR_SALES') {
      throw new BadRequestException(
        `Lead must be in READY_FOR_SALES status to submit price. Current status: ${lead.status}`,
      );
    }

    // Validate price fields
    if (dto.estimated_price_min <= 0 || dto.estimated_price_max <= 0) {
      throw new BadRequestException('Price values must be greater than 0');
    }
    if (dto.estimated_price_min > dto.estimated_price_max) {
      throw new BadRequestException('Minimum price cannot be greater than maximum price');
    }

    // Update lead with price information and change status to SALES_PRICED
    await this.supabase.updateLead(leadId, {
      status: 'SALES_PRICED',
      estimated_price_min: dto.estimated_price_min,
      estimated_price_max: dto.estimated_price_max,
      price_currency: dto.price_currency,
      sales_price_set_by: salesAgentId,
      sales_price_set_at: new Date().toISOString(),
    });

    this.logger.log(`Sales price submitted for lead ${leadId} by agent ${salesAgentId}`);

    // Get updated lead
    const updatedLead = await this.findById(leadId);

    // Sync to Zoho CRM if requested or by default
    let zohoSync: { success: boolean; zohoLeadId?: string; error?: string } | undefined;
    
    if (dto.sync_to_zoho !== false) {
      try {
        const syncResult = await this.zohoCrmService.syncLeadToZoho(leadId);
        zohoSync = {
          success: syncResult.success,
          zohoLeadId: syncResult.zohoLeadId,
          error: syncResult.error,
        };
        
        if (syncResult.success) {
          this.logger.log(`Lead ${leadId} synced to Zoho CRM: ${syncResult.zohoLeadId}`);
        } else {
          this.logger.warn(`Zoho CRM sync failed for lead ${leadId}: ${syncResult.error}`);
        }
      } catch (error: any) {
        this.logger.error(`Error syncing lead ${leadId} to Zoho CRM:`, error.message);
        zohoSync = {
          success: false,
          error: error.message,
        };
      }
    }

    return { ...updatedLead, zohoSync };
  }

  /**
   * Get doctor recommendations (comments) for a lead
   */
  async getDoctorRecommendations(leadId: string): Promise<DoctorComment[]> {
    const { data, error } = await this.supabase.client
      .from('doctor_comments')
      .select(`
        id,
        comment,
        comment_type,
        is_pinned,
        created_at,
        users (
          name,
          role
        )
      `)
      .eq('lead_id', leadId)
      .in('comment_type', ['recommendation', 'diagnosis', 'note'])
      .order('is_pinned', { ascending: false })
      .order('created_at', { ascending: false });

    if (error) {
      this.logger.error('Error fetching doctor recommendations:', error);
      throw error;
    }

    return data as DoctorComment[];
  }

  /**
   * Get sales notifications
   */
  async getSalesNotifications(onlyUnread = false, limit = 50): Promise<unknown[]> {
    let query = this.supabase.client
      .from('sales_notifications')
      .select(`
        *,
        leads (
          id,
          treatment_category,
          lead_profile (name)
        )
      `)
      .order('created_at', { ascending: false })
      .limit(limit);

    if (onlyUnread) {
      query = query.eq('is_read', false);
    }

    const { data, error } = await query;

    if (error) {
      this.logger.error('Error fetching sales notifications:', error);
      throw error;
    }

    return data || [];
  }

  /**
   * Mark sales notification as read
   */
  async markNotificationRead(notificationId: string, userId: string): Promise<void> {
    const { error } = await this.supabase.client
      .from('sales_notifications')
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
}
