import { Module } from '@nestjs/common';
import { PhotosController } from './photos.controller';
import { PhotosService } from './photos.service';
import { SupabaseModule } from '../../common/supabase/supabase.module';
import { QueueModule } from '../../common/queue/queue.module';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [SupabaseModule, QueueModule, AuthModule],
  controllers: [PhotosController],
  providers: [PhotosService],
  exports: [PhotosService],
})
export class PhotosModule {}

