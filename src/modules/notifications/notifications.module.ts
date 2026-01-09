import { Module } from '@nestjs/common';
import { NotificationsController } from './notifications.controller';
import { NotificationsService } from './notifications.service';
import { DoctorNotificationsService } from './doctor-notifications.service';
import { SupabaseModule } from '../../common/supabase/supabase.module';

@Module({
  imports: [SupabaseModule],
  controllers: [NotificationsController],
  providers: [NotificationsService, DoctorNotificationsService],
  exports: [NotificationsService, DoctorNotificationsService],
})
export class NotificationsModule {}

