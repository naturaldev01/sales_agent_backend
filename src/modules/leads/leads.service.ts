import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import {
  SupabaseService,
  Lead,
  LeadProfile,
  PhotoAsset,
  PhotoChecklist,
} from '../../common/supabase/supabase.service';

export interface LeadWithProfile extends Lead {
  lead_profile?: LeadProfile | null;
}

@Injectable()
export class LeadsService {
  private readonly logger = new Logger(LeadsService.name);

  constructor(private readonly supabase: SupabaseService) {}

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
}
