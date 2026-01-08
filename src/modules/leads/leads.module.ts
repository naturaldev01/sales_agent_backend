import { Module, forwardRef } from '@nestjs/common';
import { LeadsService } from './leads.service';
import { LeadsController } from './leads.controller';
import { AuthModule } from '../auth/auth.module';
import { ZohoCrmModule } from '../zoho-crm/zoho-crm.module';

@Module({
  imports: [AuthModule, forwardRef(() => ZohoCrmModule)],
  controllers: [LeadsController],
  providers: [LeadsService],
  exports: [LeadsService],
})
export class LeadsModule {}

