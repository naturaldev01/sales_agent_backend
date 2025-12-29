import { Module, forwardRef } from '@nestjs/common';
import { AiClientService } from './ai-client.service';
import { AiWorkerProcessor } from './ai-worker.processor';
import { WebhooksModule } from '../webhooks/webhooks.module';

@Module({
  imports: [forwardRef(() => WebhooksModule)],
  providers: [AiClientService, AiWorkerProcessor],
  exports: [AiClientService],
})
export class AiClientModule {}

