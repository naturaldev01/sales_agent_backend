import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';

export interface AiAnalysisRequest {
  leadId: string;
  conversationId: string;
  messageId: string;
  language: string;
  messages: Array<{
    role: 'user' | 'assistant';
    content: string;
    timestamp: string;
  }>;
  leadContext?: {
    status: string;
    treatmentCategory?: string;
    desireScore?: number;
    profile?: Record<string, unknown>;
    agentName?: string;  // Virtual agent name assigned to this lead
  };
  promptVersion?: string;
}

export interface AiAnalysisResponse {
  success: boolean;
  data?: {
    intent: {
      label: string;
      confidence: number;
    };
    extraction: Record<string, unknown>;
    desireScore: {
      value: number;
      reasons: string[];
    };
    replyDraft: string;
    shouldHandoff: boolean;
    handoffReason?: string;
    readyForDoctor?: boolean;
    agentName?: string;  // Virtual agent name (only set on greeting)
    isGreeting?: boolean;  // Flag to indicate greeting response
    model: string;
    tokensUsed: number;
    latencyMs: number;
  };
  error?: string;
}

export interface FollowupAnalysisRequest {
  leadId: string;
  conversationId: string;
  language: string;
  messages: Array<{
    role: 'user' | 'assistant';
    content: string;
    timestamp: string;
  }>;
  leadContext?: {
    status: string;
    treatmentCategory?: string;
    desireScore?: number;
    profile?: Record<string, unknown>;
    hasPhotos?: boolean;
    // Timezone context for smart scheduling
    timezone?: string;
  };
  lastUserResponseAt?: string;
  followupCount: number;
}

export interface FollowupAnalysisResponse {
  success: boolean;
  data?: {
    shouldFollowup: boolean;
    followupStrategy: 'immediate' | 'wait' | 'give_up' | 'escalate';
    waitHours: number | null;
    followupTone: 'gentle_reminder' | 'value_add' | 'urgency' | 'final_goodbye' | null;
    suggestedMessage: string | null;
    reasoning: string;
    confidence: number;
    escalationReason: string | null;
    model: string;
    tokensUsed: number;
    latencyMs: number;
  };
  error?: string;
}

export interface PhotoRejectionRequest {
  leadId: string;
  language: string;
  rejectionReason: string;
  treatmentCategory?: string;
  messages?: Array<{
    role: 'user' | 'assistant';
    content: string;
    timestamp?: string;
  }>;
  leadProfile?: Record<string, unknown>;
}

export interface PhotoRejectionResponse {
  success: boolean;
  data?: {
    message: string;
    tone: string;
    includesGuidelines: boolean;
    model: string;
    tokensUsed: number;
    latencyMs: number;
  };
  error?: string;
}

@Injectable()
export class AiClientService {
  private readonly logger = new Logger(AiClientService.name);
  private readonly aiWorkerUrl: string;
  private readonly apiKey: string;

  constructor(private configService: ConfigService) {
    this.aiWorkerUrl = this.configService.get<string>('AI_WORKER_URL', 'http://localhost:8000');
    this.apiKey = this.configService.get<string>('AI_WORKER_API_KEY', '');
  }

  async analyzeAndDraftReply(request: AiAnalysisRequest): Promise<AiAnalysisResponse> {
    try {
      const response = await axios.post(
        `${this.aiWorkerUrl}/api/v1/analyze`,
        request,
        {
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${this.apiKey}`,
          },
          timeout: 30000, // 30 second timeout
        },
      );

      return response.data;
    } catch (error: any) {
      this.logger.error('AI Worker request failed:', error.message);
      return {
        success: false,
        error: error.message,
      };
    }
  }

  async scoreLead(request: {
    leadId: string;
    messages: Array<{ role: string; content: string }>;
    profile: Record<string, unknown>;
  }): Promise<{ score: number; reasons: string[] } | null> {
    try {
      const response = await axios.post(
        `${this.aiWorkerUrl}/api/v1/score`,
        request,
        {
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${this.apiKey}`,
          },
          timeout: 15000,
        },
      );

      return response.data.data;
    } catch (error: any) {
      this.logger.error('Lead scoring failed:', error.message);
      return null;
    }
  }

  async extractInfo(request: {
    message: string;
    language: string;
    existingProfile?: Record<string, unknown>;
  }): Promise<Record<string, unknown> | null> {
    try {
      const response = await axios.post(
        `${this.aiWorkerUrl}/api/v1/extract`,
        request,
        {
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${this.apiKey}`,
          },
          timeout: 10000,
        },
      );

      return response.data.data;
    } catch (error: any) {
      this.logger.error('Information extraction failed:', error.message);
      return null;
    }
  }

  async classifyIntent(request: {
    message: string;
    language: string;
  }): Promise<{ label: string; confidence: number } | null> {
    try {
      const response = await axios.post(
        `${this.aiWorkerUrl}/api/v1/classify`,
        request,
        {
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${this.apiKey}`,
          },
          timeout: 10000,
        },
      );

      return response.data.data;
    } catch (error: any) {
      this.logger.error('Intent classification failed:', error.message);
      return null;
    }
  }

  async healthCheck(): Promise<boolean> {
    try {
      const response = await axios.get(`${this.aiWorkerUrl}/health`, {
        timeout: 5000,
      });
      return response.data.status === 'ok';
    } catch {
      return false;
    }
  }

  /**
   * Analyze conversation to determine optimal follow-up strategy.
   * This replaces the rigid max_attempts + fixed_intervals approach
   * with intelligent, context-aware follow-up scheduling.
   */
  async analyzeFollowupTiming(request: FollowupAnalysisRequest): Promise<FollowupAnalysisResponse> {
    try {
      const response = await axios.post(
        `${this.aiWorkerUrl}/api/v1/analyze-followup`,
        {
          leadId: request.leadId,
          conversationId: request.conversationId,
          language: request.language,
          messages: request.messages,
          leadContext: request.leadContext,
          lastUserResponseAt: request.lastUserResponseAt,
          followupCount: request.followupCount,
        },
        {
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${this.apiKey}`,
          },
          timeout: 30000, // 30 second timeout
        },
      );

      // Transform snake_case response to camelCase
      const data = response.data.data;
      return {
        success: response.data.success,
        data: data ? {
          shouldFollowup: data.should_followup,
          followupStrategy: data.followup_strategy,
          waitHours: data.wait_hours,
          followupTone: data.followup_tone,
          suggestedMessage: data.suggested_message,
          reasoning: data.reasoning,
          confidence: data.confidence,
          escalationReason: data.escalation_reason,
          model: data.model,
          tokensUsed: data.tokens_used,
          latencyMs: data.latencyMs,
        } : undefined,
        error: response.data.error,
      };
    } catch (error: any) {
      this.logger.error('Follow-up analysis request failed:', error.message);
      return {
        success: false,
        error: error.message,
      };
    }
  }

  /**
   * Generate a personalized photo rejection message using AI.
   * Called when a doctor rejects a photo from the dashboard.
   */
  async generatePhotoRejectionMessage(request: PhotoRejectionRequest): Promise<PhotoRejectionResponse> {
    try {
      const response = await axios.post(
        `${this.aiWorkerUrl}/api/v1/generate-rejection-message`,
        {
          leadId: request.leadId,
          language: request.language,
          rejectionReason: request.rejectionReason,
          treatmentCategory: request.treatmentCategory,
          messages: request.messages,
          leadProfile: request.leadProfile,
        },
        {
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${this.apiKey}`,
          },
          timeout: 30000, // 30 second timeout
        },
      );

      return {
        success: response.data.success,
        data: response.data.data,
        error: response.data.error,
      };
    } catch (error: any) {
      this.logger.error('Photo rejection message generation failed:', error.message);
      return {
        success: false,
        error: error.message,
      };
    }
  }
}

