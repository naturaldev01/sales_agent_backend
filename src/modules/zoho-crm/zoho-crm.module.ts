import { Module } from '@nestjs/common';
import { ZohoCrmService } from './zoho-crm.service';
import { ZohoCrmController } from './zoho-crm.controller';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [AuthModule],
  controllers: [ZohoCrmController],
  providers: [ZohoCrmService],
  exports: [ZohoCrmService],
})
export class ZohoCrmModule {}
