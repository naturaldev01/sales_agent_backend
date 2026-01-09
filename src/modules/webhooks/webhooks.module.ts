import { Module } from '@nestjs/common';
import { WebhooksController } from './webhooks.controller';
import { FormWebhookController } from './form-webhook.controller';
import { WhatsappAdapter } from './adapters/whatsapp.adapter';
import { TelegramAdapter } from './adapters/telegram.adapter';
import { WebhooksService } from './webhooks.service';
import { TelegramPollingService } from './telegram-polling.service';
import { OrchestratorModule } from '../orchestrator/orchestrator.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { SupabaseModule } from '../../common/supabase/supabase.module';

@Module({
  imports: [OrchestratorModule, NotificationsModule, SupabaseModule],
  controllers: [WebhooksController, FormWebhookController],
  providers: [
    WebhooksService,
    WhatsappAdapter,
    TelegramAdapter,
    TelegramPollingService,
  ],
  exports: [WhatsappAdapter, TelegramAdapter, TelegramPollingService],
})
export class WebhooksModule {}

