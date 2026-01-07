import { Module, forwardRef } from '@nestjs/common';
import { AiClientService } from './ai-client.service';
import { AiWorkerProcessor } from './ai-worker.processor';
import { WebhooksModule } from '../webhooks/webhooks.module';
import { PhotosModule } from '../photos/photos.module';

@Module({
  imports: [
    forwardRef(() => WebhooksModule),
    forwardRef(() => PhotosModule),
  ],
  providers: [AiClientService, AiWorkerProcessor],
  exports: [AiClientService],
})
export class AiClientModule {}

