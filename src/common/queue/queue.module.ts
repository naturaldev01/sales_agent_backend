import { Module, Global } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { QueueService } from './queue.service';
import { ChannelSendProcessor } from './channel-send.processor';

@Global()
@Module({
  imports: [ConfigModule],
  providers: [QueueService, ChannelSendProcessor],
  exports: [QueueService],
})
export class QueueModule {}

