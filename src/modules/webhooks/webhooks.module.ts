import { Module } from '@nestjs/common';
import { WebhooksController } from './webhooks.controller';
import { WhatsappAdapter } from './adapters/whatsapp.adapter';
import { TelegramAdapter } from './adapters/telegram.adapter';
import { WebhooksService } from './webhooks.service';
import { TelegramPollingService } from './telegram-polling.service';
import { OrchestratorModule } from '../orchestrator/orchestrator.module';

@Module({
  imports: [OrchestratorModule],
  controllers: [WebhooksController],
  providers: [
    WebhooksService,
    WhatsappAdapter,
    TelegramAdapter,
    TelegramPollingService,
  ],
  exports: [WhatsappAdapter, TelegramAdapter, TelegramPollingService],
})
export class WebhooksModule {}

