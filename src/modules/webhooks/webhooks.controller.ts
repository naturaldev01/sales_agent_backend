import {
  Controller,
  Post,
  Get,
  Body,
  Query,
  Param,
  HttpCode,
  HttpStatus,
  Logger,
  Headers,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiParam } from '@nestjs/swagger';
import { WebhooksService } from './webhooks.service';

@ApiTags('webhooks')
@Controller('webhooks')
export class WebhooksController {
  private readonly logger = new Logger(WebhooksController.name);

  constructor(private readonly webhooksService: WebhooksService) {}

  // ==================== WHATSAPP ====================

  @Get('whatsapp')
  @ApiOperation({ summary: 'WhatsApp webhook verification' })
  async verifyWhatsapp(
    @Query('hub.mode') mode: string,
    @Query('hub.verify_token') token: string,
    @Query('hub.challenge') challenge: string,
  ): Promise<string> {
    this.logger.log('WhatsApp verification request received');
    return this.webhooksService.verifyWhatsapp(mode, token, challenge);
  }

  @Post('whatsapp')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'WhatsApp incoming webhook' })
  async handleWhatsapp(@Body() payload: any): Promise<{ status: string }> {
    this.logger.log('WhatsApp webhook received');
    
    // Process asynchronously - return immediately
    setImmediate(() => {
      this.webhooksService.handleWhatsapp(payload).catch((err) => {
        this.logger.error('WhatsApp webhook processing error:', err);
      });
    });

    return { status: 'received' };
  }

  // ==================== TELEGRAM ====================

  @Post('telegram')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Telegram incoming webhook' })
  async handleTelegram(
    @Body() payload: any,
    @Headers('x-telegram-bot-api-secret-token') secretToken?: string,
  ): Promise<{ status: string }> {
    this.logger.log('Telegram webhook received');

    // Process asynchronously - return immediately
    setImmediate(() => {
      this.webhooksService.handleTelegram(payload, secretToken).catch((err) => {
        this.logger.error('Telegram webhook processing error:', err);
      });
    });

    return { status: 'received' };
  }

  // ==================== GENERIC CHANNEL ====================

  @Post('channel/:provider')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Generic channel webhook' })
  @ApiParam({ name: 'provider', enum: ['whatsapp', 'telegram', 'web'] })
  async handleChannel(
    @Param('provider') provider: string,
    @Body() payload: any,
  ): Promise<{ status: string }> {
    this.logger.log(`Channel webhook received: ${provider}`);

    switch (provider) {
      case 'whatsapp':
        setImmediate(() => this.webhooksService.handleWhatsapp(payload));
        break;
      case 'telegram':
        setImmediate(() => this.webhooksService.handleTelegram(payload));
        break;
      default:
        this.logger.warn(`Unknown channel provider: ${provider}`);
    }

    return { status: 'received' };
  }
}

