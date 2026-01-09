import { Module, forwardRef } from '@nestjs/common';
import { OrchestratorService } from './orchestrator.service';
import { OrchestratorController } from './orchestrator.controller';
import { StateMachineService } from './state-machine.service';
import { LeadsModule } from '../leads/leads.module';
import { ConversationsModule } from '../conversations/conversations.module';
import { MessagesModule } from '../messages/messages.module';
import { AiClientModule } from '../ai-client/ai-client.module';
import { FollowupsModule } from '../followups/followups.module';
import { PhotosModule } from '../photos/photos.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { WebhooksModule } from '../webhooks/webhooks.module';

@Module({
  imports: [
    forwardRef(() => LeadsModule),
    forwardRef(() => ConversationsModule),
    forwardRef(() => MessagesModule),
    forwardRef(() => AiClientModule),
    forwardRef(() => FollowupsModule),
    forwardRef(() => PhotosModule),
    forwardRef(() => NotificationsModule),
    forwardRef(() => WebhooksModule),
  ],
  controllers: [OrchestratorController],
  providers: [OrchestratorService, StateMachineService],
  exports: [OrchestratorService, StateMachineService],
})
export class OrchestratorModule {}

