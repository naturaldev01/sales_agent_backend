import { Controller, Get, Logger } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { SettingsService } from './settings.service';

@ApiTags('settings')
@Controller('settings')
export class SettingsController {
  private readonly logger = new Logger(SettingsController.name);

  constructor(private readonly settingsService: SettingsService) {}

  @Get('configs')
  @ApiOperation({ summary: 'Get all active system configs' })
  async getConfigs() {
    return this.settingsService.getConfigs();
  }
}

