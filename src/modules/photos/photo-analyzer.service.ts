import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';

export interface PhotoSlotAnalysis {
  detected_slot: 'front' | 'top' | 'side_left' | 'side_right' | 'back' | 'unknown';
  confidence: number;
  quality_score: number;
  quality_issues: string[];
  is_usable: boolean;
  reasoning?: string;
}

export interface PhotoCompletionStatus {
  total_required: number;
  total_uploaded: number;
  missing_slots: string[];
  is_complete: boolean;
  completion_percentage: number;
}

@Injectable()
export class PhotoAnalyzerService {
  private readonly logger = new Logger(PhotoAnalyzerService.name);
  private readonly geminiApiKey: string;
  private readonly geminiApiUrl = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent';

  constructor(private readonly configService: ConfigService) {
    this.geminiApiKey = this.configService.get<string>('GEMINI_API_KEY', '');
  }

  /**
   * Analyze a photo using Gemini Vision to detect the slot (angle) it represents
   */
  async analyzePhotoSlot(
    imageBuffer: Buffer,
    treatmentCategory: string,
  ): Promise<PhotoSlotAnalysis> {
    if (!this.geminiApiKey) {
      this.logger.warn('Gemini API key not configured, using fallback analysis');
      return this.getFallbackAnalysis();
    }

    try {
      const base64Image = imageBuffer.toString('base64');
      
      const prompt = this.buildAnalysisPrompt(treatmentCategory);

      const response = await axios.post(
        `${this.geminiApiUrl}?key=${this.geminiApiKey}`,
        {
          contents: [
            {
              parts: [
                { text: prompt },
                {
                  inline_data: {
                    mime_type: 'image/jpeg',
                    data: base64Image,
                  },
                },
              ],
            },
          ],
          generationConfig: {
            temperature: 0.1,
            maxOutputTokens: 500,
            responseMimeType: 'application/json',
          },
        },
        {
          headers: {
            'Content-Type': 'application/json',
          },
        },
      );

      const textResponse = response.data.candidates?.[0]?.content?.parts?.[0]?.text;
      
      if (!textResponse) {
        this.logger.warn('Empty response from Gemini');
        return this.getFallbackAnalysis();
      }

      const analysis = JSON.parse(textResponse) as PhotoSlotAnalysis;
      
      this.logger.log(`Photo analyzed: slot=${analysis.detected_slot}, confidence=${analysis.confidence}, quality=${analysis.quality_score}`);
      
      return this.validateAnalysis(analysis);
      
    } catch (error: any) {
      this.logger.error('Error analyzing photo with Gemini:', error.message);
      return this.getFallbackAnalysis();
    }
  }

  /**
   * Build the analysis prompt based on treatment category
   */
  private buildAnalysisPrompt(treatmentCategory: string): string {
    const slotDescriptions = this.getSlotDescriptions(treatmentCategory);
    
    return `You are a medical photo analysis assistant. Analyze this photo to determine which angle/slot it represents for a ${treatmentCategory} evaluation.

POSSIBLE SLOTS:
${slotDescriptions}

QUALITY CRITERIA:
- Lighting: Is the image well-lit? Not too dark or overexposed?
- Focus: Is the image sharp and clear, not blurry?
- Angle: Does it clearly show the required view?
- Obstructions: Is the area visible without hats, hands, or other obstructions?
- Relevance: Is this actually a medical evaluation photo (not random image)?

IMPORTANT:
- If you cannot determine the slot with confidence, use "unknown"
- If the image is not a medical photo (random image, selfie with wrong angle, etc.), mark is_usable as false
- Be strict about quality - doctors need clear images

Respond with this exact JSON structure (no markdown, just JSON):
{
  "detected_slot": "front" | "top" | "side_left" | "side_right" | "back" | "unknown",
  "confidence": 0.0-1.0,
  "quality_score": 0-100,
  "quality_issues": ["issue1", "issue2"] or [],
  "is_usable": true | false,
  "reasoning": "Brief explanation of your analysis"
}`;
  }

  /**
   * Get slot descriptions based on treatment category
   */
  private getSlotDescriptions(treatmentCategory: string): string {
    const descriptions: Record<string, string> = {
      hair_transplant: `
- front: Face/head from front, showing the hairline and forehead. Person looking directly at camera.
- top: Top of head, usually taken from above. Shows the crown/vertex area.
- side_left: Left side profile of head. Shows left temple and side.
- side_right: Right side profile of head. Shows right temple and side.
- back: Back of head, showing the nape/donor area.`,

      dental: `
- front: Open mouth showing front teeth directly
- top: Upper teeth close-up
- side_left: Left side of mouth/teeth
- side_right: Right side of mouth/teeth
- back: Inside mouth showing back teeth`,

      rhinoplasty: `
- front: Face from front, neutral expression, showing nose directly
- top: Not typically used for rhinoplasty
- side_left: Left profile of face showing nose from left
- side_right: Right profile of face showing nose from right
- back: Bottom view showing nostrils from below`,

      default: `
- front: Front view of the area of concern
- top: Top/overhead view if applicable
- side_left: Left side view
- side_right: Right side view
- back: Back/rear view`,
    };

    return descriptions[treatmentCategory] || descriptions.default;
  }

  /**
   * Validate and normalize the analysis response
   */
  private validateAnalysis(analysis: PhotoSlotAnalysis): PhotoSlotAnalysis {
    const validSlots = ['front', 'top', 'side_left', 'side_right', 'back', 'unknown'];
    
    return {
      detected_slot: validSlots.includes(analysis.detected_slot) 
        ? analysis.detected_slot 
        : 'unknown',
      confidence: Math.max(0, Math.min(1, analysis.confidence || 0)),
      quality_score: Math.max(0, Math.min(100, analysis.quality_score || 50)),
      quality_issues: Array.isArray(analysis.quality_issues) 
        ? analysis.quality_issues 
        : [],
      is_usable: typeof analysis.is_usable === 'boolean' 
        ? analysis.is_usable 
        : true,
      reasoning: analysis.reasoning || undefined,
    };
  }

  /**
   * Fallback analysis when Gemini is not available
   */
  private getFallbackAnalysis(): PhotoSlotAnalysis {
    return {
      detected_slot: 'unknown',
      confidence: 0,
      quality_score: 50,
      quality_issues: ['Automatic analysis unavailable'],
      is_usable: true, // Assume usable, let doctor decide
      reasoning: 'Fallback analysis - manual review required',
    };
  }

  /**
   * Get missing photo slots for a lead
   */
  async getMissingSlots(
    uploadedSlots: string[],
    treatmentCategory: string,
  ): Promise<string[]> {
    const requiredSlots = this.getRequiredSlots(treatmentCategory);
    
    return requiredSlots.filter(slot => !uploadedSlots.includes(slot));
  }

  /**
   * Get required slots for a treatment category
   */
  getRequiredSlots(treatmentCategory: string): string[] {
    const requirements: Record<string, string[]> = {
      hair_transplant: ['front', 'top', 'back'], // side photos optional
      dental: ['front', 'top'],
      rhinoplasty: ['front', 'side_left', 'side_right'],
      breast: ['front', 'side_left', 'side_right'],
      liposuction: ['front', 'back', 'side_left', 'side_right'],
      bbl: ['back', 'side_left', 'side_right'],
      facelift: ['front', 'side_left', 'side_right'],
      arm_lift: ['front', 'back'],
    };

    return requirements[treatmentCategory] || ['front'];
  }

  /**
   * Check if photo collection is complete for a lead
   */
  checkCompletion(
    uploadedSlots: string[],
    treatmentCategory: string,
  ): PhotoCompletionStatus {
    const requiredSlots = this.getRequiredSlots(treatmentCategory);
    const uniqueUploaded = [...new Set(uploadedSlots.filter(s => s && s !== 'unknown'))];
    
    const missingSlots = requiredSlots.filter(slot => !uniqueUploaded.includes(slot));
    
    const totalRequired = requiredSlots.length;
    const totalUploaded = uniqueUploaded.filter(s => requiredSlots.includes(s)).length;
    
    return {
      total_required: totalRequired,
      total_uploaded: totalUploaded,
      missing_slots: missingSlots,
      is_complete: missingSlots.length === 0,
      completion_percentage: totalRequired > 0 
        ? Math.round((totalUploaded / totalRequired) * 100) 
        : 100,
    };
  }

  /**
   * Generate a friendly message about missing photos
   */
  getMissingPhotosMessage(
    missingSlots: string[],
    language: string,
  ): string | null {
    if (missingSlots.length === 0) {
      return null;
    }

    const slotNames = this.getSlotNames(language);
    const missingNames = missingSlots.map(slot => slotNames[slot] || slot);

    const templates: Record<string, (slots: string[]) => string> = {
      en: (slots) => {
        if (slots.length === 1) {
          return `We're just missing the ${slots[0]} photo. Could you send that one? 📸`;
        }
        return `We're missing a few photos: ${slots.join(', ')}. Could you send those? 📸`;
      },
      tr: (slots) => {
        if (slots.length === 1) {
          return `Sadece ${slots[0]} fotoğrafı eksik. Onu da gönderebilir misiniz? 📸`;
        }
        return `Birkaç fotoğraf eksik: ${slots.join(', ')}. Bunları da gönderebilir misiniz? 📸`;
      },
      ar: (slots) => {
        if (slots.length === 1) {
          return `نحتاج فقط صورة ${slots[0]}. هل يمكنك إرسالها؟ 📸`;
        }
        return `نحتاج بعض الصور: ${slots.join('، ')}. هل يمكنك إرسالها؟ 📸`;
      },
      fr: (slots) => {
        if (slots.length === 1) {
          return `Il nous manque juste la photo ${slots[0]}. Pourriez-vous l'envoyer? 📸`;
        }
        return `Il nous manque quelques photos: ${slots.join(', ')}. Pourriez-vous les envoyer? 📸`;
      },
    };

    const template = templates[language] || templates.en;
    return template(missingNames);
  }

  /**
   * Get localized slot names
   */
  private getSlotNames(language: string): Record<string, string> {
    const names: Record<string, Record<string, string>> = {
      en: {
        front: 'front view',
        top: 'top view',
        side_left: 'left side',
        side_right: 'right side',
        back: 'back view',
      },
      tr: {
        front: 'önden',
        top: 'tepeden',
        side_left: 'sol yandan',
        side_right: 'sağ yandan',
        back: 'arkadan',
      },
      ar: {
        front: 'الأمامية',
        top: 'العلوية',
        side_left: 'الجانب الأيسر',
        side_right: 'الجانب الأيمن',
        back: 'الخلفية',
      },
      fr: {
        front: 'de face',
        top: 'du dessus',
        side_left: 'côté gauche',
        side_right: 'côté droit',
        back: 'de dos',
      },
    };

    return names[language] || names.en;
  }
}
