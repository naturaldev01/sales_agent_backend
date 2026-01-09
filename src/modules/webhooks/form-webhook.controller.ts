import { 
  Controller, 
  Post, 
  Body, 
  Logger, 
  HttpCode, 
  HttpStatus,
  BadRequestException,
} from '@nestjs/common';
import { SupabaseService } from '../../common/supabase/supabase.service';
import { DoctorNotificationsService } from '../notifications/doctor-notifications.service';

/**
 * Form submission payload structure
 * This should match your external form provider (Typeform, Jotform, etc.)
 */
interface FormSubmissionPayload {
  // External form ID (from Typeform, Jotform, etc.)
  form_id?: string;
  submission_id?: string;
  
  // Lead identifier (phone, email, or lead_id)
  phone?: string;
  email?: string;
  lead_id?: string;
  
  // Personal information
  personal_info?: {
    name?: string;
    email?: string;
    phone?: string;
    birth_date?: string;
    country?: string;
    city?: string;
    height_cm?: number;
    weight_kg?: number;
  };
  
  // Medical information
  medical_info?: {
    has_allergies?: boolean;
    allergies_detail?: string;
    has_chronic_disease?: boolean;
    chronic_disease_detail?: string;
    uses_blood_thinners?: boolean;
    blood_thinner_detail?: string;
    has_previous_surgery?: boolean;
    previous_surgery_detail?: string;
    has_previous_hair_transplant?: boolean;
    previous_hair_transplant_detail?: string;
    current_medications?: string;
    alcohol_use?: string;
    smoking_use?: string;
  };
  
  // Treatment preferences
  treatment_info?: {
    treatment_category?: string;
    complaint?: string;
    urgency?: string;
    budget_mentioned?: string;
  };
  
  // Photo URLs (if form collects photos)
  photos?: Array<{
    url: string;
    slot?: string; // front, top, side_left, side_right, back
    file_name?: string;
  }>;
  
  // Raw form data for reference
  raw_data?: Record<string, unknown>;
}

@Controller('webhooks/form')
export class FormWebhookController {
  private readonly logger = new Logger(FormWebhookController.name);

  constructor(
    private readonly supabase: SupabaseService,
    private readonly doctorNotifications: DoctorNotificationsService,
  ) {}

  /**
   * Webhook endpoint for external form submissions
   * POST /webhooks/form/submission
   */
  @Post('submission')
  @HttpCode(HttpStatus.OK)
  async handleFormSubmission(@Body() payload: FormSubmissionPayload): Promise<{
    success: boolean;
    lead_id?: string;
    message: string;
  }> {
    this.logger.log('Received form submission webhook');
    
    try {
      // 1. Find the lead
      const lead = await this.findLead(payload);
      
      if (!lead) {
        // If no lead found, log the submission for manual review
        await this.logUnmatchedSubmission(payload);
        return {
          success: false,
          message: 'Lead not found. Submission logged for manual review.',
        };
      }

      this.logger.log(`Processing form submission for lead: ${lead.id}`);

      // 2. Update lead profile with form data
      await this.updateLeadProfile(lead.id, payload);

      // 3. Process photos if provided
      if (payload.photos && payload.photos.length > 0) {
        await this.processFormPhotos(lead.id, payload.photos);
      }

      // 4. Check for medical risks
      const hasRisk = this.checkMedicalRisk(payload.medical_info);
      if (hasRisk) {
        await this.supabase.upsertLeadProfile(lead.id, {
          medical_risk_detected: true,
          medical_risk_details: this.formatMedicalRiskDetails(payload.medical_info),
        } as any);
      }

      // 5. Update lead status to READY_FOR_DOCTOR
      await this.supabase.updateLead(lead.id, {
        status: 'READY_FOR_DOCTOR',
      });

      // 6. Create doctor notification
      const patientName = payload.personal_info?.name || (lead.lead_profile as any)?.name;
      await this.doctorNotifications.createReadyForDoctorNotification(
        lead.id,
        patientName ?? undefined,
        payload.treatment_info?.treatment_category || lead.treatment_category,
        (payload.photos?.length || 0) > 0,
        !!payload.medical_info,
      );

      // 7. If medical risk, create additional alert
      if (hasRisk) {
        await this.doctorNotifications.createMedicalRiskAlert(
          lead.id,
          this.formatMedicalRiskDetails(payload.medical_info),
          this.getMedicalRiskKeywords(payload.medical_info),
          patientName,
        );
      }

      // 8. Mark form submission as processed
      await this.markSubmissionProcessed(payload);

      this.logger.log(`Form submission processed successfully for lead: ${lead.id}`);

      return {
        success: true,
        lead_id: lead.id,
        message: 'Form submission processed successfully',
      };
      
    } catch (error: any) {
      this.logger.error('Error processing form submission:', error);
      
      // Log the failed submission
      await this.logFailedSubmission(payload, error.message);
      
      throw new BadRequestException(`Failed to process form submission: ${error.message}`);
    }
  }

  /**
   * Find lead by phone, email, or lead_id
   */
  private async findLead(payload: FormSubmissionPayload) {
    // Try lead_id first
    if (payload.lead_id) {
      try {
        return await this.supabase.getLeadById(payload.lead_id);
      } catch {
        // Lead not found by ID, try other methods
      }
    }

    // Try phone number
    const phone = payload.phone || payload.personal_info?.phone;
    if (phone) {
      const { data } = await this.supabase.client
        .from('leads')
        .select('*, lead_profile(*)')
        .or(`channel_user_id.eq.${phone},lead_profile.phone.eq.${phone}`)
        .order('created_at', { ascending: false })
        .limit(1)
        .single();
      
      if (data) return data;
    }

    // Try email
    const email = payload.email || payload.personal_info?.email;
    if (email) {
      const { data } = await this.supabase.client
        .from('lead_profile')
        .select('lead_id, leads(*)')
        .eq('email', email)
        .order('created_at', { ascending: false })
        .limit(1)
        .single();
      
      if (data?.leads) {
        return { lead_id: data.lead_id, ...data.leads, lead_profile: data } as any;
      }
    }

    return null;
  }

  /**
   * Update lead profile with form data
   */
  private async updateLeadProfile(leadId: string, payload: FormSubmissionPayload): Promise<void> {
    const profileData: Record<string, unknown> = {
      preferred_flow: 'form',
    };

    // Personal info
    if (payload.personal_info) {
      const pi = payload.personal_info;
      if (pi.name) profileData.name = pi.name;
      if (pi.email) profileData.email = pi.email;
      if (pi.phone) profileData.phone = pi.phone;
      if (pi.birth_date) profileData.birth_date = pi.birth_date;
      if (pi.country) profileData.country = pi.country;
      if (pi.city) profileData.city = pi.city;
      if (pi.height_cm) profileData.height_cm = pi.height_cm;
      if (pi.weight_kg) profileData.weight_kg = pi.weight_kg;
    }

    // Medical info
    if (payload.medical_info) {
      const mi = payload.medical_info;
      if (mi.has_allergies !== undefined) profileData.has_allergies = mi.has_allergies;
      if (mi.allergies_detail) profileData.allergies_detail = mi.allergies_detail;
      if (mi.has_chronic_disease !== undefined) profileData.has_chronic_disease = mi.has_chronic_disease;
      if (mi.chronic_disease_detail) profileData.chronic_disease_detail = mi.chronic_disease_detail;
      if (mi.uses_blood_thinners !== undefined) profileData.uses_blood_thinners = mi.uses_blood_thinners;
      if (mi.blood_thinner_detail) profileData.blood_thinner_detail = mi.blood_thinner_detail;
      if (mi.has_previous_surgery !== undefined) profileData.has_previous_surgery = mi.has_previous_surgery;
      if (mi.previous_surgery_detail) profileData.previous_surgery_detail = mi.previous_surgery_detail;
      if (mi.has_previous_hair_transplant !== undefined) profileData.has_previous_hair_transplant = mi.has_previous_hair_transplant;
      if (mi.previous_hair_transplant_detail) profileData.previous_hair_transplant_detail = mi.previous_hair_transplant_detail;
      if (mi.current_medications) profileData.current_medications = mi.current_medications;
      if (mi.alcohol_use) profileData.alcohol_use = mi.alcohol_use;
      if (mi.smoking_use) profileData.smoking_use = mi.smoking_use;
    }

    // Treatment info
    if (payload.treatment_info) {
      const ti = payload.treatment_info;
      if (ti.treatment_category) profileData.treatment_category = ti.treatment_category;
      if (ti.complaint) profileData.complaint = ti.complaint;
      if (ti.urgency) profileData.urgency = ti.urgency;
      if (ti.budget_mentioned) profileData.budget_mentioned = ti.budget_mentioned;
    }

    await this.supabase.upsertLeadProfile(leadId, profileData as any);

    // Update lead treatment category if provided
    if (payload.treatment_info?.treatment_category) {
      await this.supabase.updateLead(leadId, {
        treatment_category: payload.treatment_info.treatment_category,
      });
    }
  }

  /**
   * Process photos from form submission
   */
  private async processFormPhotos(
    leadId: string,
    photos: FormSubmissionPayload['photos'],
  ): Promise<void> {
    if (!photos) return;

    for (const photo of photos) {
      // Download photo from URL and save to storage
      // For now, just create the photo_asset record with the external URL
      await this.supabase.createPhotoAsset({
        lead_id: leadId,
        storage_path: photo.url, // External URL for now
        file_name: photo.file_name || 'form_photo.jpg',
        checklist_key: photo.slot,
      });
    }

    // Update photo status
    await this.supabase.upsertLeadProfile(leadId, {
      photo_status: photos.length >= 3 ? 'complete' : 'partial',
    });
  }

  /**
   * Check if medical info contains risk factors
   */
  private checkMedicalRisk(medicalInfo?: FormSubmissionPayload['medical_info']): boolean {
    if (!medicalInfo) return false;

    // Check for high-risk conditions
    if (medicalInfo.uses_blood_thinners) return true;
    if (medicalInfo.has_chronic_disease) {
      const details = (medicalInfo.chronic_disease_detail || '').toLowerCase();
      if (details.includes('heart') || details.includes('kalp') ||
          details.includes('diabetes') || details.includes('diyabet') ||
          details.includes('cancer') || details.includes('kanser')) {
        return true;
      }
    }

    return false;
  }

  /**
   * Format medical risk details for notification
   */
  private formatMedicalRiskDetails(medicalInfo?: FormSubmissionPayload['medical_info']): string {
    if (!medicalInfo) return '';

    const risks: string[] = [];
    
    if (medicalInfo.uses_blood_thinners) {
      risks.push(`Kan sulandırıcı: ${medicalInfo.blood_thinner_detail || 'Belirtilmedi'}`);
    }
    if (medicalInfo.has_chronic_disease) {
      risks.push(`Kronik hastalık: ${medicalInfo.chronic_disease_detail || 'Belirtilmedi'}`);
    }
    if (medicalInfo.current_medications) {
      risks.push(`İlaçlar: ${medicalInfo.current_medications}`);
    }

    return risks.join('; ');
  }

  /**
   * Get medical risk keywords for notification
   */
  private getMedicalRiskKeywords(medicalInfo?: FormSubmissionPayload['medical_info']): string[] {
    if (!medicalInfo) return [];

    const keywords: string[] = [];
    
    if (medicalInfo.uses_blood_thinners) {
      keywords.push('blood_thinner');
      if (medicalInfo.blood_thinner_detail) {
        keywords.push(medicalInfo.blood_thinner_detail);
      }
    }
    if (medicalInfo.has_chronic_disease && medicalInfo.chronic_disease_detail) {
      keywords.push(medicalInfo.chronic_disease_detail);
    }

    return keywords;
  }

  /**
   * Log unmatched submission for manual review
   * Note: Uses raw query until types are regenerated after migration
   */
  private async logUnmatchedSubmission(payload: FormSubmissionPayload): Promise<void> {
    await (this.supabase.client as any)
      .from('form_submissions')
      .insert({
        external_form_id: payload.form_id || payload.submission_id,
        form_type: 'patient_intake',
        submission_data: payload,
        processed: false,
        processing_error: 'Lead not found',
      });
  }

  /**
   * Log failed submission
   */
  private async logFailedSubmission(payload: FormSubmissionPayload, error: string): Promise<void> {
    await (this.supabase.client as any)
      .from('form_submissions')
      .insert({
        lead_id: payload.lead_id,
        external_form_id: payload.form_id || payload.submission_id,
        form_type: 'patient_intake',
        submission_data: payload,
        processed: false,
        processing_error: error,
      });
  }

  /**
   * Mark submission as processed
   */
  private async markSubmissionProcessed(payload: FormSubmissionPayload): Promise<void> {
    if (payload.form_id || payload.submission_id) {
      await (this.supabase.client as any)
        .from('form_submissions')
        .upsert({
          lead_id: payload.lead_id,
          external_form_id: payload.form_id || payload.submission_id,
          form_type: 'patient_intake',
          submission_data: payload,
          processed: true,
          processed_at: new Date().toISOString(),
        }, {
          onConflict: 'external_form_id',
        });
    }
  }
}
