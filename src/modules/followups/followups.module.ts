import { Module, forwardRef } from '@nestjs/common';
import { FollowupsService } from './followups.service';
import { FollowupsScheduler } from './followups.scheduler';
import { WebhooksModule } from '../webhooks/webhooks.module';
import { AiClientModule } from '../ai-client/ai-client.module';

@Module({
  imports: [
    forwardRef(() => WebhooksModule),
    AiClientModule,
  ],
  providers: [FollowupsService, FollowupsScheduler],
  exports: [FollowupsService],
})
export class FollowupsModule {}

