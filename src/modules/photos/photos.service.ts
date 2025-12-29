import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { SupabaseService, PhotoAsset, Lead, LeadProfile } from '../../common/supabase/supabase.service';
import { QueueService } from '../../common/queue/queue.service';
import * as path from 'path';
import * as fs from 'fs';

// Extended photo asset type with lead info
export interface PhotoAssetWithLeadInfo extends PhotoAsset {
  leads?: (Lead & { lead_profile: LeadProfile | null }) | null;
}

// Treatment category to template image mapping
const TREATMENT_TEMPLATE_MAP: Record<string, Record<string, string>> = {
  hair_transplant: {
    en: 'en-hairtransplant-man.jpeg',
    default: 'en-hairtransplant-man.jpeg',
  },
  hair_transplant_female: {
    ar: 'ar-female-hairtransplant.jpeg',
    default: 'ar-female-hairtransplant.jpeg',
  },
  dental: {
    en: 'en-dental-1.jpeg',
    default: 'en-dental-1.jpeg',
  },
  rhinoplasty: {
    en: 'en-rhinoplasty.jpeg',
    default: 'en-rhinoplasty.jpeg',
  },
  breast: {
    fr: 'fr-breast.jpeg',
    ar: 'ar-breast.jpeg',
    default: 'fr-breast.jpeg',
  },
  liposuction: {
    en: 'en-fullbody-female.jpeg',
    default: 'en-fullbody-female.jpeg',
  },
  bbl: {
    en: 'en-fullbody-female.jpeg',
    default: 'en-fullbody-female.jpeg',
  },
  arm_lift: {
    en: 'en-armlift.jpeg',
    default: 'en-armlift.jpeg',
  },
  facelift: {
    fr: 'fr-facelift-1.jpeg',
    default: 'fr-facelift-1.jpeg',
  },
};

@Injectable()
export class PhotosService {
  private readonly logger = new Logger(PhotosService.name);
  private readonly templateImagesPath: string;

  constructor(
    private readonly supabase: SupabaseService,
    private readonly queueService: QueueService,
  ) {
    // Template images are in the template_images folder at project root
    this.templateImagesPath = path.join(process.cwd(), 'template_images');
  }

  async findAll(limit = 50) {
    const { data, error } = await this.supabase.client
      .from('photo_assets')
      .select(`
        *,
        leads (
          id,
          status,
          lead_profile (name)
        )
      `)
      .order('created_at', { ascending: false })
      .limit(limit);

    if (error) throw error;
    return data || [];
  }

  async findAllWithUrls(limit = 50) {
    const photos = await this.findAll(limit);
    
    // Generate signed URLs for each photo
    const photosWithUrls = await Promise.all(
      photos.map(async (photo) => {
        try {
          const { data } = await this.supabase.client.storage
            .from('lead-media-private')
            .createSignedUrl(photo.storage_path, 3600); // 1 hour expiry
          
          return {
            ...photo,
            signed_url: data?.signedUrl || null,
          };
        } catch (error) {
          this.logger.error(`Failed to get signed URL for ${photo.id}:`, error);
          return {
            ...photo,
            signed_url: null,
          };
        }
      })
    );

    return photosWithUrls;
  }

  async getSignedUrl(id: string) {
    const { data: photo, error } = await this.supabase.client
      .from('photo_assets')
      .select('storage_path')
      .eq('id', id)
      .single();

    if (error || !photo) {
      throw new NotFoundException(`Photo not found: ${id}`);
    }

    const { data } = await this.supabase.client.storage
      .from('lead-media-private')
      .createSignedUrl(photo.storage_path, 3600);

    return { signedUrl: data?.signedUrl };
  }

  // ==================== PHOTO CHECKLIST & TEMPLATES ====================

  /**
   * Get photo checklist with template for a specific treatment and language
   */
  async getPhotoChecklistWithTemplate(treatmentCategory: string, language: string = 'en') {
    return this.supabase.getPhotoChecklistWithTemplate(treatmentCategory, language);
  }

  /**
   * Get all available treatment categories
   */
  async getAvailableTreatmentCategories(): Promise<string[]> {
    return this.supabase.getAvailableTreatmentCategories();
  }

  /**
   * Get template image filename for a treatment category and language
   */
  getTemplateImageFilename(treatmentCategory: string, language: string = 'en'): string | null {
    const categoryMap = TREATMENT_TEMPLATE_MAP[treatmentCategory];
    if (!categoryMap) {
      return null;
    }
    
    // Try to get language-specific template, fallback to default
    return categoryMap[language] || categoryMap['default'] || null;
  }

  /**
   * Get template image as buffer for sending via messaging channels
   */
  async getTemplateImageBuffer(treatmentCategory: string, language: string = 'en'): Promise<{
    buffer: Buffer;
    filename: string;
    mimeType: string;
  } | null> {
    const filename = this.getTemplateImageFilename(treatmentCategory, language);
    if (!filename) {
      this.logger.warn(`No template image found for ${treatmentCategory}/${language}`);
      return null;
    }

    const imagePath = path.join(this.templateImagesPath, filename);
    
    try {
      if (!fs.existsSync(imagePath)) {
        this.logger.warn(`Template image file not found: ${imagePath}`);
        return null;
      }

      const buffer = fs.readFileSync(imagePath);
      const ext = path.extname(filename).toLowerCase();
      const mimeType = ext === '.jpeg' || ext === '.jpg' ? 'image/jpeg' : 'image/png';

      return { buffer, filename, mimeType };
    } catch (error) {
      this.logger.error(`Failed to read template image: ${imagePath}`, error);
      return null;
    }
  }

  /**
   * Get template image path from database for a treatment category
   */
  async getTemplateImagePath(treatmentCategory: string): Promise<string | null> {
    return this.supabase.getTemplateImagePath(treatmentCategory);
  }

  // ==================== PHOTO VERIFICATION ====================

  /**
   * Verify (approve) a photo
   */
  async verifyPhoto(id: string, userId: string): Promise<PhotoAsset> {
    const { data, error } = await this.supabase.client
      .from('photo_assets')
      .update({
        is_verified: true,
        verified_at: new Date().toISOString(),
        verified_by: userId,
        quality_notes: null, // Clear any previous rejection notes
      })
      .eq('id', id)
      .select()
      .single();

    if (error) {
      this.logger.error(`Failed to verify photo ${id}:`, error);
      throw error;
    }

    this.logger.log(`Photo ${id} verified by user ${userId}`);
    return data;
  }

  /**
   * Reject a photo and send notification to the user
   */
  async rejectPhoto(id: string, userId: string, reason: string): Promise<PhotoAssetWithLeadInfo> {
    // First, get the photo with lead info
    const { data: photo, error: fetchError } = await this.supabase.client
      .from('photo_assets')
      .select(`
        *,
        leads (
          id,
          channel,
          channel_user_id,
          language,
          lead_profile (name)
        )
      `)
      .eq('id', id)
      .single();

    if (fetchError || !photo) {
      throw new NotFoundException(`Photo not found: ${id}`);
    }

    // Update the photo as rejected
    const { data, error } = await this.supabase.client
      .from('photo_assets')
      .update({
        is_verified: false,
        verified_at: new Date().toISOString(),
        verified_by: userId,
        quality_notes: reason,
      })
      .eq('id', id)
      .select()
      .single();

    if (error) {
      this.logger.error(`Failed to reject photo ${id}:`, error);
      throw error;
    }

    this.logger.log(`Photo ${id} rejected by user ${userId}. Reason: ${reason}`);

    // Send notification to the user via the channel
    const lead = photo.leads as any;
    if (lead?.channel && lead?.channel_user_id) {
      const message = this.getRejectionMessage(lead.language || 'en', reason);
      
      try {
        await this.queueService.addChannelSendJob({
          channel: lead.channel as 'whatsapp' | 'telegram' | 'web',
          channelUserId: lead.channel_user_id,
          content: message,
        });
        this.logger.log(`Rejection notification queued for lead ${lead.id}`);
      } catch (queueError) {
        this.logger.error(`Failed to queue rejection notification:`, queueError);
        // Don't throw - the photo was still rejected successfully
      }
    }

    return { ...data, leads: lead } as PhotoAssetWithLeadInfo;
  }

  /**
   * Get localized rejection message
   */
  private getRejectionMessage(language: string, reason: string): string {
    const messages: Record<string, string> = {
      en: `⚠️ Photo Update Required\n\nYour photo was not accepted.\nReason: ${reason}\n\nPlease send clearer photos following our guidelines. This helps our doctors provide you with the best evaluation possible. 📸`,
      tr: `⚠️ Fotoğraf Güncelleme Gerekli\n\nFotoğrafınız kabul edilmedi.\nSebep: ${reason}\n\nLütfen yönergelerimize uygun, daha net fotoğraflar gönderin. Bu, doktorlarımızın size en iyi değerlendirmeyi yapabilmesi için önemlidir. 📸`,
      ar: `⚠️ مطلوب تحديث الصورة\n\nلم يتم قبول صورتك.\nالسبب: ${reason}\n\nيرجى إرسال صور أوضح وفقًا لإرشاداتنا. هذا يساعد أطبائنا على تقديم أفضل تقييم لك. 📸`,
      fr: `⚠️ Mise à jour de photo requise\n\nVotre photo n'a pas été acceptée.\nRaison: ${reason}\n\nVeuillez envoyer des photos plus claires selon nos directives. Cela aide nos médecins à vous fournir la meilleure évaluation possible. 📸`,
      ru: `⚠️ Требуется обновление фото\n\nВаша фотография не принята.\nПричина: ${reason}\n\nПожалуйста, отправьте более четкие фотографии согласно нашим рекомендациям. Это поможет нашим врачам дать вам наилучшую оценку. 📸`,
    };
    return messages[language] || messages.en;
  }
}

