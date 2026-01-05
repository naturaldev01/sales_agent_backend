import {
  Controller,
  Get,
  Post,
  Param,
  Query,
  Patch,
  Body,
  Logger,
  ParseUUIDPipe,
  BadRequestException,
  Headers,
  UnauthorizedException,
  ForbiddenException,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiQuery, ApiParam, ApiHeader, ApiBody } from '@nestjs/swagger';
import { LeadsService, DoctorApprovalDto, SalesPriceDto } from './leads.service';
import { AuthService } from '../auth/auth.service';

// Roles allowed to approve leads
const DOCTOR_ROLES = ['doctor', 'admin'];
const SALES_ROLES = ['sales_agent', 'admin'];

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

  // ==================== DOCTOR APPROVAL ====================

  @Post(':id/doctor-approve')
  @ApiOperation({ summary: 'Doctor approves lead and sends to sales department' })
  @ApiParam({ name: 'id', type: String })
  @ApiHeader({ name: 'Authorization', description: 'Bearer token', required: true })
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        treatment_recommendations: { type: 'string', description: 'Required treatment recommendations' },
      },
      required: ['treatment_recommendations'],
    },
  })
  async doctorApprove(
    @Param('id', OptionalUUIDPipe) id: string,
    @Headers('authorization') authHeader: string,
    @Body() dto: DoctorApprovalDto,
  ) {
    // Validate token and get user
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      throw new UnauthorizedException('Authorization token required');
    }

    const token = authHeader.substring(7);
    const user = await this.authService.validateToken(token);

    // Check if user has doctor role
    if (!DOCTOR_ROLES.includes(user.role)) {
      throw new ForbiddenException('Only doctors and admins can approve leads');
    }

    this.logger.log(`Doctor ${user.email} approving lead ${id}`);
    return this.leadsService.doctorApprove(id, user.id, dto);
  }

  @Get(':id/doctor-recommendations')
  @ApiOperation({ summary: 'Get doctor recommendations for a lead' })
  @ApiParam({ name: 'id', type: String })
  @ApiHeader({ name: 'Authorization', description: 'Bearer token', required: true })
  async getDoctorRecommendations(
    @Param('id', OptionalUUIDPipe) id: string,
    @Headers('authorization') authHeader: string,
  ) {
    // Validate token
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      throw new UnauthorizedException('Authorization token required');
    }

    const token = authHeader.substring(7);
    await this.authService.validateToken(token);

    return this.leadsService.getDoctorRecommendations(id);
  }

  // ==================== SALES ENDPOINTS ====================

  @Post(':id/sales-price')
  @ApiOperation({ summary: 'Sales agent submits price for a lead' })
  @ApiParam({ name: 'id', type: String })
  @ApiHeader({ name: 'Authorization', description: 'Bearer token', required: true })
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        estimated_price_min: { type: 'number', description: 'Minimum price' },
        estimated_price_max: { type: 'number', description: 'Maximum price' },
        price_currency: { type: 'string', description: 'Currency (EUR, USD, GBP, TRY)' },
      },
      required: ['estimated_price_min', 'estimated_price_max', 'price_currency'],
    },
  })
  async submitSalesPrice(
    @Param('id', OptionalUUIDPipe) id: string,
    @Headers('authorization') authHeader: string,
    @Body() dto: SalesPriceDto,
  ) {
    // Validate token and get user
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      throw new UnauthorizedException('Authorization token required');
    }

    const token = authHeader.substring(7);
    const user = await this.authService.validateToken(token);

    // Check if user has sales role
    if (!SALES_ROLES.includes(user.role)) {
      throw new ForbiddenException('Only sales agents and admins can submit prices');
    }

    this.logger.log(`Sales agent ${user.email} submitting price for lead ${id}`);
    return this.leadsService.submitSalesPrice(id, user.id, dto);
  }

  @Get('sales/ready')
  @ApiOperation({ summary: 'Get leads ready for sales (READY_FOR_SALES status)' })
  @ApiHeader({ name: 'Authorization', description: 'Bearer token', required: true })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  async getLeadsForSales(
    @Headers('authorization') authHeader: string,
    @Query('limit') limit?: number,
  ) {
    // Validate token and check role
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      throw new UnauthorizedException('Authorization token required');
    }

    const token = authHeader.substring(7);
    const user = await this.authService.validateToken(token);

    // Sales agents and admins can access
    if (!SALES_ROLES.includes(user.role) && !DOCTOR_ROLES.includes(user.role)) {
      throw new ForbiddenException('Only sales agents and admins can access this endpoint');
    }

    return this.leadsService.getLeadsForSales(limit ? parseInt(String(limit), 10) : 50);
  }

  @Get('sales/notifications')
  @ApiOperation({ summary: 'Get sales notifications' })
  @ApiHeader({ name: 'Authorization', description: 'Bearer token', required: true })
  @ApiQuery({ name: 'unread', required: false, type: Boolean })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  async getSalesNotifications(
    @Headers('authorization') authHeader: string,
    @Query('unread') unread?: string,
    @Query('limit') limit?: number,
  ) {
    // Validate token and check role
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      throw new UnauthorizedException('Authorization token required');
    }

    const token = authHeader.substring(7);
    const user = await this.authService.validateToken(token);

    if (!SALES_ROLES.includes(user.role)) {
      throw new ForbiddenException('Only sales agents and admins can access notifications');
    }

    return this.leadsService.getSalesNotifications(
      unread === 'true',
      limit ? parseInt(String(limit), 10) : 50,
    );
  }

  @Patch('sales/notifications/:notificationId/read')
  @ApiOperation({ summary: 'Mark notification as read' })
  @ApiParam({ name: 'notificationId', type: String })
  @ApiHeader({ name: 'Authorization', description: 'Bearer token', required: true })
  async markNotificationRead(
    @Param('notificationId', OptionalUUIDPipe) notificationId: string,
    @Headers('authorization') authHeader: string,
  ) {
    // Validate token
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      throw new UnauthorizedException('Authorization token required');
    }

    const token = authHeader.substring(7);
    const user = await this.authService.validateToken(token);

    if (!SALES_ROLES.includes(user.role)) {
      throw new ForbiddenException('Only sales agents can mark notifications as read');
    }

    await this.leadsService.markNotificationRead(notificationId, user.id);
    return { success: true };
  }
}

