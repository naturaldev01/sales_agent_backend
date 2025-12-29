import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  UseGuards,
  Request,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { AuthGuard } from '../../common/guards/auth.guard';
import { RolesGuard, Roles } from '../../common/guards/roles.guard';
import { AiTrainingService } from './ai-training.service';

@Controller('ai-training')
@UseGuards(AuthGuard, RolesGuard)
export class AiTrainingController {
  constructor(private readonly aiTrainingService: AiTrainingService) {}

  // ==================== AI MESSAGES ====================

  @Get('messages')
  @Roles('admin', 'doctor', 'sales')
  async getAiMessages(
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('rating') rating?: 'pending' | 'good' | 'bad' | 'improvable',
    @Query('leadId') leadId?: string,
  ) {
    return this.aiTrainingService.getAiMessages({
      page: page ? parseInt(page, 10) : 1,
      limit: limit ? parseInt(limit, 10) : 20,
      rating,
      leadId,
    });
  }

  @Get('messages/:messageId')
  @Roles('admin', 'doctor', 'sales')
  async getMessageById(@Param('messageId') messageId: string) {
    return this.aiTrainingService.getMessageById(messageId);
  }

  // ==================== FEEDBACK ====================

  @Get('stats')
  @Roles('admin', 'doctor', 'sales')
  async getFeedbackStats() {
    return this.aiTrainingService.getFeedbackStats();
  }

  @Post('messages/:messageId/rate')
  @Roles('admin', 'doctor', 'sales')
  @HttpCode(HttpStatus.OK)
  async createFeedback(
    @Param('messageId') messageId: string,
    @Body() body: {
      rating: 'good' | 'bad' | 'improvable';
      comment?: string;
      suggested_response?: string;
    },
    @Request() req: any,
  ) {
    return this.aiTrainingService.createFeedback(messageId, req.user.id, {
      rating: body.rating,
      comment: body.comment,
      suggested_response: body.suggested_response,
    });
  }

  @Patch('messages/:messageId/rate')
  @Roles('admin', 'doctor', 'sales')
  async updateFeedback(
    @Param('messageId') messageId: string,
    @Body() body: {
      rating?: 'good' | 'bad' | 'improvable';
      comment?: string;
      suggested_response?: string;
    },
    @Request() req: any,
  ) {
    return this.aiTrainingService.updateFeedback(messageId, req.user.id, body);
  }

  // ==================== KNOWLEDGE BASE ====================

  @Get('knowledge-base')
  @Roles('admin', 'doctor', 'sales')
  async getKnowledgeBase(
    @Query('category') category?: string,
    @Query('language') language?: string,
    @Query('search') search?: string,
    @Query('activeOnly') activeOnly?: string,
  ) {
    return this.aiTrainingService.getKnowledgeBase({
      category,
      language,
      search,
      activeOnly: activeOnly !== 'false',
    });
  }

  @Get('knowledge-base/:id')
  @Roles('admin', 'doctor', 'sales')
  async getKnowledgeBaseById(@Param('id') id: string) {
    return this.aiTrainingService.getKnowledgeBaseById(id);
  }

  @Post('knowledge-base')
  @Roles('admin', 'doctor')
  async createKnowledgeBaseEntry(
    @Body() body: {
      category: string;
      language?: string;
      trigger_keywords?: string[];
      scenario?: string;
      bad_response?: string;
      good_response: string;
      context_notes?: string;
      source_feedback_id?: string;
      priority?: number;
    },
    @Request() req: any,
  ) {
    return this.aiTrainingService.createKnowledgeBaseEntry(req.user.id, {
      category: body.category,
      language: body.language,
      trigger_keywords: body.trigger_keywords,
      scenario: body.scenario,
      bad_response: body.bad_response,
      good_response: body.good_response,
      context_notes: body.context_notes,
      source_feedback_id: body.source_feedback_id,
      priority: body.priority,
    });
  }

  @Patch('knowledge-base/:id')
  @Roles('admin', 'doctor')
  async updateKnowledgeBaseEntry(
    @Param('id') id: string,
    @Body() body: {
      category?: string;
      language?: string;
      trigger_keywords?: string[];
      scenario?: string;
      bad_response?: string;
      good_response?: string;
      context_notes?: string;
      is_active?: boolean;
      priority?: number;
    },
  ) {
    return this.aiTrainingService.updateKnowledgeBaseEntry(id, body);
  }

  @Delete('knowledge-base/:id')
  @Roles('admin', 'doctor')
  async deleteKnowledgeBaseEntry(@Param('id') id: string) {
    return this.aiTrainingService.deleteKnowledgeBaseEntry(id);
  }

  // ==================== AI INTEGRATION ====================

  @Get('knowledge-base/relevant')
  @Roles('admin', 'doctor', 'sales')
  async getRelevantKnowledge(
    @Query('message') message: string,
    @Query('language') language?: string,
    @Query('limit') limit?: string,
  ) {
    const entries = await this.aiTrainingService.getRelevantKnowledgeForMessage(
      message,
      language || 'en',
      limit ? parseInt(limit, 10) : 5,
    );
    
    return {
      entries,
      formatted: this.aiTrainingService.formatKnowledgeForPrompt(entries),
    };
  }
}

