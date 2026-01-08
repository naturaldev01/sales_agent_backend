import {
  Controller,
  Post,
  Get,
  Param,
  UseGuards,
  Logger,
  Body,
} from '@nestjs/common';
import { ZohoCrmService, SyncResult } from './zoho-crm.service';
import { AuthGuard } from '../../common/guards/auth.guard';
import { RolesGuard, Roles } from '../../common/guards/roles.guard';

@Controller('zoho-crm')
@UseGuards(AuthGuard, RolesGuard)
export class ZohoCrmController {
  private readonly logger = new Logger(ZohoCrmController.name);

  constructor(private readonly zohoCrmService: ZohoCrmService) {}

  /**
   * Check if Zoho CRM integration is configured
   */
  @Get('status')
  @Roles('admin', 'manager')
  async getIntegrationStatus(): Promise<{
    configured: boolean;
    message: string;
  }> {
    const configured = this.zohoCrmService.isConfigured();
    return {
      configured,
      message: configured
        ? 'Zoho CRM integration is configured'
        : 'Zoho CRM integration is not configured. Please set ZOHO_CLIENT_ID, ZOHO_CLIENT_SECRET, and ZOHO_REFRESH_TOKEN environment variables.',
    };
  }

  /**
   * Sync a specific lead to Zoho CRM
   * Called manually or after doctor approval
   */
  @Post('sync/:leadId')
  @Roles('admin', 'manager', 'doctor')
  async syncLead(@Param('leadId') leadId: string): Promise<SyncResult> {
    this.logger.log(`Manual Zoho CRM sync requested for lead: ${leadId}`);
    return this.zohoCrmService.syncLeadToZoho(leadId);
  }

  /**
   * Bulk sync multiple leads to Zoho CRM
   */
  @Post('sync-bulk')
  @Roles('admin', 'manager')
  async syncMultipleLeads(@Body() body: { leadIds: string[] }): Promise<{
    total: number;
    succeeded: number;
    failed: number;
    results: Array<{ leadId: string; result: SyncResult }>;
  }> {
    this.logger.log(`Bulk Zoho CRM sync requested for ${body.leadIds.length} leads`);

    const results: Array<{ leadId: string; result: SyncResult }> = [];
    let succeeded = 0;
    let failed = 0;

    for (const leadId of body.leadIds) {
      const result = await this.zohoCrmService.syncLeadToZoho(leadId);
      results.push({ leadId, result });
      if (result.success) {
        succeeded++;
      } else {
        failed++;
      }
    }

    return {
      total: body.leadIds.length,
      succeeded,
      failed,
      results,
    };
  }

  /**
   * Get sync status for a specific lead
   */
  @Get('sync-status/:leadId')
  @Roles('admin', 'manager', 'sales', 'doctor')
  async getSyncStatus(@Param('leadId') leadId: string): Promise<{
    isSynced: boolean;
    zohoLeadId?: string;
    lastSyncAt?: string;
    lastError?: string;
  }> {
    return this.zohoCrmService.getSyncStatus(leadId);
  }

  /**
   * Retry sync for all failed leads
   */
  @Post('retry-failed')
  @Roles('admin')
  async retryFailedSyncs(): Promise<{
    processed: number;
    succeeded: number;
    failed: number;
  }> {
    this.logger.log('Retry failed Zoho CRM syncs requested');
    return this.zohoCrmService.retrySyncForFailedLeads();
  }
}
