import { Module } from '@nestjs/common';
import { AiTrainingController } from './ai-training.controller';
import { AiTrainingService } from './ai-training.service';
import { SupabaseModule } from '../../common/supabase/supabase.module';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [SupabaseModule, AuthModule],
  controllers: [AiTrainingController],
  providers: [AiTrainingService],
  exports: [AiTrainingService],
})
export class AiTrainingModule {}

