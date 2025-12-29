import { Controller, Get, Query, Logger } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiQuery } from '@nestjs/swagger';
import { NotificationsService } from './notifications.service';

@ApiTags('notifications')
@Controller('notifications')
export class NotificationsController {
  private readonly logger = new Logger(NotificationsController.name);

  constructor(private readonly notificationsService: NotificationsService) {}

  @Get()
  @ApiOperation({ summary: 'Get recent notifications' })
  @ApiQuery({ name: 'since', required: false, type: String, description: 'ISO date string to get notifications after' })
  async getNotifications(@Query('since') since?: string) {
    return this.notificationsService.getRecentActivity(since);
  }
}

