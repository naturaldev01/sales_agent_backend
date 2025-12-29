import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { SupabaseService } from '../../common/supabase/supabase.service';

@Injectable()
export class PhotosService {
  private readonly logger = new Logger(PhotosService.name);

  constructor(private readonly supabase: SupabaseService) {}

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
}

