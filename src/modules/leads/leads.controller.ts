import {
  Controller,
  Get,
  Param,
  Query,
  Patch,
  Body,
  Logger,
  ParseUUIDPipe,
  BadRequestException,
  Headers,
  UnauthorizedException,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiQuery, ApiParam, ApiHeader } from '@nestjs/swagger';
import { LeadsService } from './leads.service';
import { AuthService } from '../auth/auth.service';

// Custom UUID pipe that handles "null" string gracefully
const OptionalUUIDPipe = new ParseUUIDPipe({
  exceptionFactory: () => new BadRequestException('Invalid UUID format'),
});

@ApiTags('leads')
@Controller('leads')
export class LeadsController {
  private readonly logger = new Logger(LeadsController.name);

  constructor(
    private readonly leadsService: LeadsService,
    private readonly authService: AuthService,
  ) {}

  @Get()
  @ApiOperation({ summary: 'List all leads (filtered by doctor specialty if applicable)' })
  @ApiHeader({ name: 'Authorization', description: 'Bearer token', required: false })
  @ApiQuery({ name: 'status', required: false })
  @ApiQuery({ name: 'treatment', required: false })
  @ApiQuery({ name: 'desireBand', required: false })
  @ApiQuery({ name: 'channel', required: false })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  async findAll(
    @Headers('authorization') authHeader: string,
    @Query('status') status?: string,
    @Query('treatment') treatment?: string,
    @Query('desireBand') desireBand?: string,
    @Query('channel') channel?: string,
    @Query('limit') limit?: number,
  ) {
    // Get user from token to check specialties
    let allowedTreatments: string[] | undefined;
    
    if (authHeader && authHeader.startsWith('Bearer ')) {
      try {
        const token = authHeader.substring(7);
        const user = await this.authService.validateToken(token);
        
        // If user is a doctor with specific specialties, filter by those
        if (user.role === 'doctor' && user.specialties && user.specialties.length > 0) {
          allowedTreatments = user.specialties;
          this.logger.log(`Doctor ${user.email} filtering leads by specialties: ${allowedTreatments.join(', ')}`);
        }
        // Admin and staff can see all leads
      } catch {
        // If token validation fails, continue without specialty filter
        this.logger.warn('Token validation failed for leads filtering');
      }
    }

    return this.leadsService.findAll({
      status,
      treatment,
      desireBand,
      channel,
      limit: limit ? parseInt(String(limit), 10) : undefined,
      allowedTreatments,
    });
  }

  @Get('statistics')
  @ApiOperation({ summary: 'Get lead statistics' })
  async getStatistics() {
    return this.leadsService.getStatistics();
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get lead by ID' })
  @ApiParam({ name: 'id', type: String })
  async findById(@Param('id', OptionalUUIDPipe) id: string) {
    return this.leadsService.findById(id);
  }

  @Get(':id/photos')
  @ApiOperation({ summary: 'Get lead photos' })
  @ApiParam({ name: 'id', type: String })
  async getPhotos(@Param('id', OptionalUUIDPipe) id: string) {
    return this.leadsService.getLeadPhotos(id);
  }

  @Get(':id/photo-progress')
  @ApiOperation({ summary: 'Get lead photo progress' })
  @ApiParam({ name: 'id', type: String })
  async getPhotoProgress(@Param('id', OptionalUUIDPipe) id: string) {
    return this.leadsService.getLeadPhotoProgress(id);
  }

  @Patch(':id/status')
  @ApiOperation({ summary: 'Update lead status' })
  @ApiParam({ name: 'id', type: String })
  async updateStatus(
    @Param('id', OptionalUUIDPipe) id: string,
    @Body('status') status: string,
  ) {
    return this.leadsService.updateStatus(id, status);
  }

  @Patch(':id/score')
  @ApiOperation({ summary: 'Update lead desire score' })
  @ApiParam({ name: 'id', type: String })
  async updateScore(
    @Param('id', OptionalUUIDPipe) id: string,
    @Body('score') score: number,
  ) {
    return this.leadsService.updateDesireScore(id, score);
  }
}

