import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios, { AxiosInstance } from 'axios';
import {
  SupabaseService,
  Lead,
  LeadProfile,
} from '../../common/supabase/supabase.service';

export interface ZohoLeadData {
  // Personal Information
  First_Name: string;
  Last_Name: string;
  Email?: string;
  Phone?: string;
  Mobile?: string;
  Country?: string;
  City?: string;
  
  // Lead Source & Status
  Lead_Source: string;
  Lead_Status: string;
  
  // Treatment Information
  Treatment_Category?: string;
  Treatment_Details?: string;
  
  // Medical Information (custom fields - should be created in Zoho CRM)
  Has_Allergies?: boolean;
  Allergies_Detail?: string;
  Has_Chronic_Disease?: boolean;
  Chronic_Disease_Detail?: string;
  Current_Medications?: string;
  Has_Previous_Surgery?: boolean;
  Previous_Surgery_Detail?: string;
  Has_Previous_Hair_Transplant?: boolean;
  Previous_Hair_Transplant_Detail?: string;
  Uses_Blood_Thinners?: boolean;
  Blood_Thinner_Detail?: string;
  Smoking_Status?: string;
  Alcohol_Use?: string;
  
  // Doctor Evaluation
  Doctor_Recommendation?: string;
  Estimated_Price_Min?: number;
  Estimated_Price_Max?: number;
  Price_Currency?: string;
  
  // Scoring & Priority
  Desire_Score?: number;
  Desire_Band?: string;
  
  // Consent
  Consent_Given?: boolean;
  Consent_At?: string;
  
  // Internal Reference
  Internal_Lead_ID: string;
  Channel?: string;
  
  // Photos (can be URLs to signed storage links)
  Photo_Links?: string;
  Photo_Count?: number;
}

export interface ZohoTokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
  token_type: string;
}

export interface ZohoApiResponse {
  data?: Array<{
    code: string;
    details: {
      id: string;
      Modified_Time?: string;
      Created_Time?: string;
    };
    message: string;
    status: string;
  }>;
  error?: string;
}

export interface SyncResult {
  success: boolean;
  zohoLeadId?: string;
  message: string;
  error?: string;
}

@Injectable()
export class ZohoCrmService {
  private readonly logger = new Logger(ZohoCrmService.name);
  private readonly client: AxiosInstance;
  
  // Zoho OAuth & API configuration
  private readonly clientId: string;
  private readonly clientSecret: string;
  private readonly refreshToken: string;
  private readonly apiDomain: string;
  private accessToken: string | null = null;
  private tokenExpiresAt: number = 0;

  constructor(
    private readonly supabase: SupabaseService,
    private readonly configService: ConfigService,
  ) {
    this.clientId = this.configService.get<string>('ZOHO_CLIENT_ID', '');
    this.clientSecret = this.configService.get<string>('ZOHO_CLIENT_SECRET', '');
    this.refreshToken = this.configService.get<string>('ZOHO_REFRESH_TOKEN', '');
    this.apiDomain = this.configService.get<string>('ZOHO_API_DOMAIN', 'https://www.zohoapis.eu');

    this.client = axios.create({
      baseURL: this.apiDomain,
      headers: {
        'Content-Type': 'application/json',
      },
      timeout: 30000,
    });
  }

  /**
   * Check if Zoho CRM integration is configured
   */
  isConfigured(): boolean {
    return !!(this.clientId && this.clientSecret && this.refreshToken);
  }

  /**
   * Refresh the access token using the refresh token
   */
  private async refreshAccessToken(): Promise<void> {
    if (!this.isConfigured()) {
      throw new BadRequestException('Zoho CRM integration is not configured');
    }

    try {
      const response = await axios.post<ZohoTokenResponse>(
        `https://accounts.zoho.eu/oauth/v2/token`,
        null,
        {
          params: {
            refresh_token: this.refreshToken,
            client_id: this.clientId,
            client_secret: this.clientSecret,
            grant_type: 'refresh_token',
          },
        },
      );

      this.accessToken = response.data.access_token;
      // Set expiry 5 minutes before actual expiry for safety
      this.tokenExpiresAt = Date.now() + (response.data.expires_in - 300) * 1000;
      
      this.logger.log('Zoho CRM access token refreshed successfully');
    } catch (error: any) {
      this.logger.error('Failed to refresh Zoho access token:', error.response?.data || error.message);
      throw new BadRequestException('Failed to authenticate with Zoho CRM');
    }
  }

  /**
   * Get a valid access token (refresh if needed)
   */
  private async getAccessToken(): Promise<string> {
    if (!this.accessToken || Date.now() >= this.tokenExpiresAt) {
      await this.refreshAccessToken();
    }
    return this.accessToken!;
  }

  /**
   * Sync a lead to Zoho CRM after doctor approval
   * This is the main entry point for CRM sync
   */
  async syncLeadToZoho(leadId: string): Promise<SyncResult> {
    this.logger.log(`Starting Zoho CRM sync for lead: ${leadId}`);

    try {
      if (!this.isConfigured()) {
        this.logger.warn('Zoho CRM integration not configured, skipping sync');
        return {
          success: false,
          message: 'Zoho CRM integration not configured',
        };
      }

      // Get lead with full profile
      const lead = await this.supabase.getLeadById(leadId);
      if (!lead) {
        throw new BadRequestException(`Lead not found: ${leadId}`);
      }

      // Check if lead is ready for CRM sync (must be DOCTOR_APPROVED)
      if (lead.status !== 'DOCTOR_APPROVED' && lead.status !== 'SALES_PRICED') {
        this.logger.warn(`Lead ${leadId} is not ready for CRM sync (status: ${lead.status})`);
        return {
          success: false,
          message: `Lead must be DOCTOR_APPROVED or SALES_PRICED for CRM sync (current: ${lead.status})`,
        };
      }

      // Transform lead data to Zoho format
      const zohoData = this.transformLeadToZohoFormat(lead);

      // Check if lead already exists in Zoho
      const existingZohoId = await this.supabase.getZohoLeadId(leadId);

      let result: ZohoApiResponse;
      if (existingZohoId) {
        // Update existing lead in Zoho
        result = await this.updateZohoLead(existingZohoId, zohoData);
        this.logger.log(`Updated existing Zoho lead: ${existingZohoId}`);
      } else {
        // Create new lead in Zoho
        result = await this.createZohoLead(zohoData);
        
        // Save Zoho lead ID to our database
        if (result.data?.[0]?.details?.id) {
          const zohoLeadId = result.data[0].details.id;
          await this.supabase.updateLead(leadId, {
            zoho_lead_id: zohoLeadId,
            zoho_synced_at: new Date().toISOString(),
          });
          this.logger.log(`Created new Zoho lead: ${zohoLeadId}`);
        }
      }

      // Check if sync was successful
      if (result.data?.[0]?.status === 'success') {
        return {
          success: true,
          zohoLeadId: result.data[0].details.id,
          message: existingZohoId ? 'Lead updated in Zoho CRM' : 'Lead created in Zoho CRM',
        };
      } else {
        throw new Error(result.data?.[0]?.message || 'Unknown Zoho API error');
      }

    } catch (error: any) {
      this.logger.error(`Zoho CRM sync failed for lead ${leadId}:`, error.message);
      
      // Log the sync failure for retry
      await this.supabase.logZohoSyncError(leadId, error.message);
      
      return {
        success: false,
        message: 'Failed to sync lead to Zoho CRM',
        error: error.message,
      };
    }
  }

  /**
   * Create a new lead in Zoho CRM
   */
  private async createZohoLead(data: ZohoLeadData): Promise<ZohoApiResponse> {
    const token = await this.getAccessToken();

    const response = await this.client.post<ZohoApiResponse>(
      '/crm/v6/Leads',
      { data: [data] },
      {
        headers: {
          Authorization: `Zoho-oauthtoken ${token}`,
        },
      },
    );

    return response.data;
  }

  /**
   * Update an existing lead in Zoho CRM
   */
  private async updateZohoLead(zohoLeadId: string, data: ZohoLeadData): Promise<ZohoApiResponse> {
    const token = await this.getAccessToken();

    const response = await this.client.put<ZohoApiResponse>(
      `/crm/v6/Leads/${zohoLeadId}`,
      { data: [data] },
      {
        headers: {
          Authorization: `Zoho-oauthtoken ${token}`,
        },
      },
    );

    return response.data;
  }

  /**
   * Transform our lead data to Zoho CRM format
   */
  private transformLeadToZohoFormat(lead: Lead & { lead_profile?: LeadProfile | null }): ZohoLeadData {
    const profile = lead.lead_profile || {};

    // Parse name into first/last
    const fullName = (profile as any).name || '';
    const nameParts = fullName.split(' ');
    const firstName = nameParts[0] || 'Unknown';
    const lastName = nameParts.slice(1).join(' ') || 'Lead';

    // Map internal status to Zoho status
    const statusMap: Record<string, string> = {
      DOCTOR_APPROVED: 'Qualified',
      SALES_PRICED: 'Qualified',
      PRICE_SENT: 'Contact in Future',
      BOOKING: 'Engaged',
      CONVERTED: 'Closed Won',
      LOST: 'Closed Lost',
    };

    // Get photo links if available
    let photoLinks = '';
    let photoCount = 0;
    // Photo links would need to be fetched separately if needed

    const zohoData: ZohoLeadData = {
      // Personal Info
      First_Name: firstName,
      Last_Name: lastName,
      Email: (profile as any).email || undefined,
      Phone: (profile as any).phone || undefined,
      Country: lead.country || (profile as any).country || undefined,
      City: (profile as any).city || undefined,
      
      // Lead Source & Status
      Lead_Source: this.mapChannelToSource(lead.channel),
      Lead_Status: statusMap[lead.status] || 'Open',
      
      // Treatment Info
      Treatment_Category: lead.treatment_category || undefined,
      Treatment_Details: (profile as any).complaint || undefined,
      
      // Medical History
      Has_Allergies: (profile as any).has_allergies,
      Allergies_Detail: (profile as any).allergies_detail,
      Has_Chronic_Disease: (profile as any).has_chronic_disease,
      Chronic_Disease_Detail: (profile as any).chronic_disease_detail,
      Current_Medications: (profile as any).current_medications,
      Has_Previous_Surgery: (profile as any).has_previous_surgery,
      Previous_Surgery_Detail: (profile as any).previous_surgery_detail,
      Has_Previous_Hair_Transplant: (profile as any).has_previous_hair_transplant,
      Previous_Hair_Transplant_Detail: (profile as any).previous_hair_transplant_detail,
      Uses_Blood_Thinners: (profile as any).uses_blood_thinners,
      Blood_Thinner_Detail: (profile as any).blood_thinner_detail,
      Smoking_Status: (profile as any).smoking_use,
      Alcohol_Use: (profile as any).alcohol_use,
      
      // Doctor Evaluation
      Doctor_Recommendation: (profile as any).treatment_recommendations,
      Estimated_Price_Min: (profile as any).estimated_price_min,
      Estimated_Price_Max: (profile as any).estimated_price_max,
      Price_Currency: (profile as any).price_currency,
      
      // Scoring
      Desire_Score: lead.desire_score || undefined,
      Desire_Band: lead.desire_band || undefined,
      
      // Consent
      Consent_Given: (profile as any).consent_given,
      Consent_At: (profile as any).consent_at,
      
      // Internal Reference
      Internal_Lead_ID: lead.id,
      Channel: lead.channel,
      
      // Photos
      Photo_Count: photoCount || undefined,
    };

    // Remove undefined values
    return Object.fromEntries(
      Object.entries(zohoData).filter(([_, v]) => v !== undefined),
    ) as ZohoLeadData;
  }

  /**
   * Map our channel to Zoho lead source
   */
  private mapChannelToSource(channel: string): string {
    const sourceMap: Record<string, string> = {
      whatsapp: 'WhatsApp',
      telegram: 'Telegram',
      web: 'Website',
      instagram: 'Instagram',
      facebook: 'Facebook',
    };
    return sourceMap[channel] || 'Other';
  }

  /**
   * Get sync status for a lead
   */
  async getSyncStatus(leadId: string): Promise<{
    isSynced: boolean;
    zohoLeadId?: string;
    lastSyncAt?: string;
    lastError?: string;
  }> {
    const lead = await this.supabase.getLeadById(leadId);
    if (!lead) {
      throw new BadRequestException(`Lead not found: ${leadId}`);
    }

    return {
      isSynced: !!(lead as any).zoho_lead_id,
      zohoLeadId: (lead as any).zoho_lead_id,
      lastSyncAt: (lead as any).zoho_synced_at,
      lastError: (lead as any).zoho_sync_error,
    };
  }

  /**
   * Manually trigger a sync retry for failed leads
   */
  async retrySyncForFailedLeads(): Promise<{
    processed: number;
    succeeded: number;
    failed: number;
  }> {
    const failedLeads = await this.supabase.getLeadsWithFailedZohoSync();
    
    let succeeded = 0;
    let failed = 0;

    for (const lead of failedLeads) {
      const result = await this.syncLeadToZoho(lead.id);
      if (result.success) {
        succeeded++;
      } else {
        failed++;
      }
    }

    return {
      processed: failedLeads.length,
      succeeded,
      failed,
    };
  }
}
