import {
  Injectable,
  Logger,
  NotFoundException,
  ForbiddenException,
} from '@nestjs/common';
import { SupabaseService } from '../../common/supabase/supabase.service';

export interface DoctorComment {
  id: string;
  lead_id: string;
  user_id: string;
  comment: string;
  comment_type: string;
  is_pinned: boolean;
  created_at: string;
  updated_at: string;
  users?: {
    id: string;
    name: string;
    avatar_url: string | null;
    role: string;
  };
}

interface CreateCommentDto {
  comment: string;
  comment_type?: string;
  is_pinned?: boolean;
}

interface UpdateCommentDto {
  comment?: string;
  comment_type?: string;
  is_pinned?: boolean;
}

@Injectable()
export class CommentsService {
  private readonly logger = new Logger(CommentsService.name);

  constructor(private readonly supabase: SupabaseService) {}

  async getLeadComments(leadId: string): Promise<DoctorComment[]> {
    const { data, error } = await this.supabase.client
      .from('doctor_comments')
      .select(`
        *,
        users (
          id,
          name,
          avatar_url,
          role
        )
      `)
      .eq('lead_id', leadId)
      .order('is_pinned', { ascending: false })
      .order('created_at', { ascending: false });

    if (error) {
      this.logger.error('Error fetching comments:', error);
      throw error;
    }

    return data as DoctorComment[];
  }

  async createComment(
    leadId: string,
    userId: string,
    dto: CreateCommentDto,
  ): Promise<DoctorComment> {
    const { data, error } = await this.supabase.client
      .from('doctor_comments')
      .insert({
        lead_id: leadId,
        user_id: userId,
        comment: dto.comment,
        comment_type: dto.comment_type || 'note',
        is_pinned: dto.is_pinned || false,
      })
      .select(`
        *,
        users (
          id,
          name,
          avatar_url,
          role
        )
      `)
      .single();

    if (error) {
      this.logger.error('Error creating comment:', error);
      throw error;
    }

    return data as DoctorComment;
  }

  async updateComment(
    id: string,
    userId: string,
    dto: UpdateCommentDto,
  ): Promise<DoctorComment> {
    // Check ownership
    const { data: existing } = await this.supabase.client
      .from('doctor_comments')
      .select('user_id')
      .eq('id', id)
      .single();

    if (!existing) {
      throw new NotFoundException('Comment not found');
    }

    if (existing.user_id !== userId) {
      throw new ForbiddenException('You can only edit your own comments');
    }

    const { data, error } = await this.supabase.client
      .from('doctor_comments')
      .update({
        ...dto,
        updated_at: new Date().toISOString(),
      })
      .eq('id', id)
      .select(`
        *,
        users (
          id,
          name,
          avatar_url,
          role
        )
      `)
      .single();

    if (error) {
      this.logger.error('Error updating comment:', error);
      throw error;
    }

    return data as DoctorComment;
  }

  async deleteComment(id: string, userId: string): Promise<{ success: boolean }> {
    // Check ownership
    const { data: existing } = await this.supabase.client
      .from('doctor_comments')
      .select('user_id')
      .eq('id', id)
      .single();

    if (!existing) {
      throw new NotFoundException('Comment not found');
    }

    if (existing.user_id !== userId) {
      throw new ForbiddenException('You can only delete your own comments');
    }

    const { error } = await this.supabase.client
      .from('doctor_comments')
      .delete()
      .eq('id', id);

    if (error) {
      this.logger.error('Error deleting comment:', error);
      throw error;
    }

    return { success: true };
  }

  async togglePin(id: string, userId: string): Promise<DoctorComment> {
    // Check ownership
    const { data: existing } = await this.supabase.client
      .from('doctor_comments')
      .select('user_id, is_pinned')
      .eq('id', id)
      .single();

    if (!existing) {
      throw new NotFoundException('Comment not found');
    }

    if (existing.user_id !== userId) {
      throw new ForbiddenException('You can only pin your own comments');
    }

    const { data, error } = await this.supabase.client
      .from('doctor_comments')
      .update({
        is_pinned: !existing.is_pinned,
        updated_at: new Date().toISOString(),
      })
      .eq('id', id)
      .select(`
        *,
        users (
          id,
          name,
          avatar_url,
          role
        )
      `)
      .single();

    if (error) {
      this.logger.error('Error toggling pin:', error);
      throw error;
    }

    return data as DoctorComment;
  }
}

