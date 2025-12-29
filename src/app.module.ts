import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';

// Core Modules
import { SupabaseModule } from './common/supabase/supabase.module';
import { QueueModule } from './common/queue/queue.module';

// Feature Modules
import { WebhooksModule } from './modules/webhooks/webhooks.module';
import { OrchestratorModule } from './modules/orchestrator/orchestrator.module';
import { LeadsModule } from './modules/leads/leads.module';
import { ConversationsModule } from './modules/conversations/conversations.module';
import { MessagesModule } from './modules/messages/messages.module';
import { FollowupsModule } from './modules/followups/followups.module';
import { AiClientModule } from './modules/ai-client/ai-client.module';
import { PhotosModule } from './modules/photos/photos.module';
import { SettingsModule } from './modules/settings/settings.module';
import { NotificationsModule } from './modules/notifications/notifications.module';
import { AuthModule } from './modules/auth/auth.module';
import { CommentsModule } from './modules/comments/comments.module';
import { AiTrainingModule } from './modules/ai-training/ai-training.module';

@Module({
  imports: [
    // Configuration
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ['.env.local', '.env'],
    }),

    // Scheduling (for follow-ups)
    ScheduleModule.forRoot(),

    // Core
    SupabaseModule,
    QueueModule,

    // Features
    WebhooksModule,
    OrchestratorModule,
    LeadsModule,
    ConversationsModule,
    MessagesModule,
    FollowupsModule,
    AiClientModule,
    PhotosModule,
    SettingsModule,
    NotificationsModule,
    AuthModule,
    CommentsModule,
    AiTrainingModule,
  ],
})
export class AppModule {}

