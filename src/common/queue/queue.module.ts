import { Module, Global, forwardRef } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { QueueService } from './queue.service';
import { ChannelSendProcessor } from './channel-send.processor';
import { WebhooksModule } from '../../modules/webhooks/webhooks.module';

@Global()
@Module({
  imports: [ConfigModule, forwardRef(() => WebhooksModule)],
  providers: [QueueService, ChannelSendProcessor],
  exports: [QueueService],
})
export class QueueModule {}

