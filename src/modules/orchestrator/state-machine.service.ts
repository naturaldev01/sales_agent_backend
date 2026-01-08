import { Injectable, Logger } from '@nestjs/common';

/**
 * Lead Status Enum
 * 
 * Flow (with photos): NEW → QUALIFYING → PHOTO_REQUESTED → PHOTO_COLLECTING → READY_FOR_DOCTOR → READY_FOR_SALES → CONVERTED
 * Flow (without photos): NEW → QUALIFYING → READY_FOR_DOCTOR → READY_FOR_SALES → CONVERTED
 * 
 * Alternative paths:
 * - PHOTO_COLLECTING → PHOTO_QA_FIX (if photos are incomplete/poor quality)
 * - QUALIFYING → READY_FOR_DOCTOR (if user declines photos but medical info complete)
 * - Any → HANDOFF_HUMAN (if human intervention needed)
 * - Any → WAITING_FOR_USER (if waiting for user response)
 * - WAITING_FOR_USER → DORMANT (if max follow-ups reached)
 * - Any → CLOSED (if user declines or admin closes)
 * 
 * Note: Photos are OPTIONAL. Lead can proceed to doctor without photos.
 */
export type LeadStatus =
  | 'NEW'                  // Initial state - first contact
  | 'QUALIFYING'           // Gathering initial info (treatment, concern area, timeline, medical history)
  | 'PHOTO_REQUESTED'      // Photos have been requested (optional)
  | 'PHOTO_COLLECTING'     // Receiving photos
  | 'PHOTO_QA_FIX'         // Photos received but need fixes (incomplete/poor quality)
  | 'READY_FOR_DOCTOR'     // All medical info collected, ready for doctor (photos optional)
  | 'READY_FOR_SALES'      // Doctor approved, waiting for sales to create offer
  | 'WAITING_FOR_USER'     // Waiting for user to respond
  | 'DORMANT'              // User hasn't responded after max follow-ups
  | 'HANDOFF_HUMAN'        // Transferred to human agent
  | 'CONVERTED'            // Lead converted to customer
  | 'CLOSED';              // Lead closed (declined, unsubscribed, etc.)

/**
 * Lead Events that trigger state transitions
 */
export type LeadEvent =
  | 'MESSAGE_RECEIVED'        // User sent a message
  | 'PHOTO_RECEIVED'          // User sent a photo
  | 'QUALIFYING_COMPLETE'     // Qualifying phase done, ready for photos
  | 'MEDICAL_COMPLETE'        // All medical questions answered (can go to doctor without photos)
  | 'PHOTOS_COMPLETE'         // All required photos received and validated
  | 'PHOTOS_DECLINED'         // User explicitly declined to send photos
  | 'PHOTOS_NEED_FIX'         // Photos received but need fixes
  | 'PHOTOS_FIXED'            // Fixed photos received
  | 'FOLLOWUP_SENT'           // Follow-up message sent
  | 'MAX_FOLLOWUPS_REACHED'   // No response after max follow-ups
  | 'HANDOFF_REQUESTED'       // Human handoff requested
  | 'DOCTOR_APPROVED'         // Doctor approved the case
  | 'SALES_OFFER_SENT'        // Sales sent offer to user
  | 'CONVERTED'               // Lead converted
  | 'CLOSED_BY_USER'          // User requested to close
  | 'CLOSED_BY_ADMIN';        // Admin closed the lead

interface StateTransition {
  from: LeadStatus[];
  to: LeadStatus;
  event: LeadEvent;
  condition?: (context: StateContext) => boolean;
}

interface StateContext {
  lead: {
    status: LeadStatus;
    treatment_category?: string;
    desire_score?: number;
    consent_given?: boolean;
    photo_status?: 'pending' | 'declined' | 'partial' | 'complete';
  };
  conversation?: {
    message_count: number;
    last_user_message_at?: string;
  };
  photos?: {
    count: number;
    required: number;
    hasQualityIssues?: boolean;
    missingAngles?: string[];
  };
  medical?: {
    isComplete: boolean;
    missingFields?: string[];
  };
  followups?: {
    sent: number;
    max: number;
  };
}

@Injectable()
export class StateMachineService {
  private readonly logger = new Logger(StateMachineService.name);

  // Define all valid state transitions
  private readonly transitions: StateTransition[] = [
    // ═══════════════════════════════════════════════════════════════════════
    // NEW LEAD FLOW
    // ═══════════════════════════════════════════════════════════════════════
    
    // New lead receives first message
    {
      from: ['NEW'],
      to: 'QUALIFYING',
      event: 'MESSAGE_RECEIVED',
    },

    // ═══════════════════════════════════════════════════════════════════════
    // QUALIFYING FLOW
    // ═══════════════════════════════════════════════════════════════════════

    // Qualifying lead receives message (continues qualifying)
    {
      from: ['QUALIFYING', 'WAITING_FOR_USER'],
      to: 'QUALIFYING',
      event: 'MESSAGE_RECEIVED',
    },

    // Dormant lead comes back
    {
      from: ['DORMANT'],
      to: 'QUALIFYING',
      event: 'MESSAGE_RECEIVED',
    },

    // Qualifying complete, request photos (optional path)
    {
      from: ['QUALIFYING'],
      to: 'PHOTO_REQUESTED',
      event: 'QUALIFYING_COMPLETE',
      condition: (ctx) => !!ctx.lead.treatment_category,
    },

    // ═══════════════════════════════════════════════════════════════════════
    // PHOTO-OPTIONAL FLOW (NEW - Photos are not required)
    // ═══════════════════════════════════════════════════════════════════════

    // Medical info complete without photos -> Ready for doctor
    {
      from: ['QUALIFYING'],
      to: 'READY_FOR_DOCTOR',
      event: 'MEDICAL_COMPLETE',
      condition: (ctx) => ctx.medical?.isComplete === true,
    },

    // User declines photos but has medical info -> Ready for doctor
    {
      from: ['QUALIFYING', 'PHOTO_REQUESTED'],
      to: 'READY_FOR_DOCTOR',
      event: 'PHOTOS_DECLINED',
      condition: (ctx) => ctx.medical?.isComplete === true,
    },

    // User declines photos but medical not complete -> Stay in qualifying
    {
      from: ['PHOTO_REQUESTED'],
      to: 'QUALIFYING',
      event: 'PHOTOS_DECLINED',
      condition: (ctx) => ctx.medical?.isComplete !== true,
    },

    // ═══════════════════════════════════════════════════════════════════════
    // PHOTO COLLECTION FLOW (for users who choose to send photos)
    // ═══════════════════════════════════════════════════════════════════════

    // First photo received after request
    {
      from: ['PHOTO_REQUESTED'],
      to: 'PHOTO_COLLECTING',
      event: 'PHOTO_RECEIVED',
    },

    // Photo received during qualifying (user sends without being asked)
    {
      from: ['QUALIFYING'],
      to: 'PHOTO_COLLECTING',
      event: 'PHOTO_RECEIVED',
    },

    // More photos received (still collecting)
    {
      from: ['PHOTO_COLLECTING'],
      to: 'PHOTO_COLLECTING',
      event: 'PHOTO_RECEIVED',
      condition: (ctx) => ctx.photos!.count < ctx.photos!.required,
    },

    // Photos received but need fixes (quality issues or missing angles)
    {
      from: ['PHOTO_COLLECTING'],
      to: 'PHOTO_QA_FIX',
      event: 'PHOTOS_NEED_FIX',
      condition: (ctx) => ctx.photos!.hasQualityIssues || (ctx.photos!.missingAngles?.length ?? 0) > 0,
    },

    // User sends fixed photos
    {
      from: ['PHOTO_QA_FIX'],
      to: 'PHOTO_COLLECTING',
      event: 'PHOTO_RECEIVED',
    },

    // After fix, still needs more fixes
    {
      from: ['PHOTO_QA_FIX'],
      to: 'PHOTO_QA_FIX',
      event: 'PHOTOS_NEED_FIX',
    },

    // Fixed photos are now complete
    {
      from: ['PHOTO_QA_FIX'],
      to: 'READY_FOR_DOCTOR',
      event: 'PHOTOS_FIXED',
    },

    // All photos complete and valid
    {
      from: ['PHOTO_COLLECTING'],
      to: 'READY_FOR_DOCTOR',
      event: 'PHOTOS_COMPLETE',
      condition: (ctx) => ctx.photos!.count >= ctx.photos!.required,
    },

    // Medical complete while collecting photos -> Ready for doctor
    {
      from: ['PHOTO_COLLECTING'],
      to: 'READY_FOR_DOCTOR',
      event: 'MEDICAL_COMPLETE',
      condition: (ctx) => ctx.medical?.isComplete === true,
    },

    // ═══════════════════════════════════════════════════════════════════════
    // DOCTOR & SALES FLOW
    // ═══════════════════════════════════════════════════════════════════════

    // Doctor approves -> Goes to sales
    {
      from: ['READY_FOR_DOCTOR'],
      to: 'READY_FOR_SALES',
      event: 'DOCTOR_APPROVED',
    },

    // Sales sends offer -> Converted
    {
      from: ['READY_FOR_SALES'],
      to: 'CONVERTED',
      event: 'SALES_OFFER_SENT',
    },

    // Lead converts (from various states)
    {
      from: ['HANDOFF_HUMAN', 'READY_FOR_SALES'],
      to: 'CONVERTED',
      event: 'CONVERTED',
    },

    // ═══════════════════════════════════════════════════════════════════════
    // FOLLOW-UP & DORMANCY FLOW
    // ═══════════════════════════════════════════════════════════════════════

    // Any active state can wait for user
    {
      from: ['QUALIFYING', 'PHOTO_REQUESTED', 'PHOTO_COLLECTING', 'PHOTO_QA_FIX'],
      to: 'WAITING_FOR_USER',
      event: 'FOLLOWUP_SENT',
    },

    // Max follow-ups reached -> Dormant
    {
      from: ['WAITING_FOR_USER'],
      to: 'DORMANT',
      event: 'MAX_FOLLOWUPS_REACHED',
    },

    // ═══════════════════════════════════════════════════════════════════════
    // HANDOFF FLOW
    // ═══════════════════════════════════════════════════════════════════════

    // Handoff from any active state
    {
      from: ['QUALIFYING', 'PHOTO_REQUESTED', 'PHOTO_COLLECTING', 'PHOTO_QA_FIX', 'WAITING_FOR_USER', 'READY_FOR_DOCTOR'],
      to: 'HANDOFF_HUMAN',
      event: 'HANDOFF_REQUESTED',
    },

    // ═══════════════════════════════════════════════════════════════════════
    // CLOSE FLOW
    // ═══════════════════════════════════════════════════════════════════════

    // Close from any state (by user)
    {
      from: ['NEW', 'QUALIFYING', 'PHOTO_REQUESTED', 'PHOTO_COLLECTING', 'PHOTO_QA_FIX', 'READY_FOR_DOCTOR', 'READY_FOR_SALES', 'WAITING_FOR_USER', 'DORMANT', 'HANDOFF_HUMAN'],
      to: 'CLOSED',
      event: 'CLOSED_BY_USER',
    },
    
    // Close from any state (by admin)
    {
      from: ['NEW', 'QUALIFYING', 'PHOTO_REQUESTED', 'PHOTO_COLLECTING', 'PHOTO_QA_FIX', 'READY_FOR_DOCTOR', 'READY_FOR_SALES', 'WAITING_FOR_USER', 'DORMANT', 'HANDOFF_HUMAN'],
      to: 'CLOSED',
      event: 'CLOSED_BY_ADMIN',
    },
  ];

  /**
   * Check if a transition is valid
   */
  canTransition(from: LeadStatus, event: LeadEvent, context?: StateContext): boolean {
    const transition = this.findTransition(from, event, context);
    return transition !== null;
  }

  /**
   * Get the next state for a given transition
   */
  getNextState(from: LeadStatus, event: LeadEvent, context?: StateContext): LeadStatus | null {
    const transition = this.findTransition(from, event, context);
    if (transition) {
      return transition.to;
    }
    return null;
  }

  /**
   * Get all possible events from a given state
   */
  getPossibleEvents(from: LeadStatus): LeadEvent[] {
    const events = new Set<LeadEvent>();
    
    for (const transition of this.transitions) {
      if (transition.from.includes(from)) {
        events.add(transition.event);
      }
    }

    return Array.from(events);
  }

  /**
   * Validate and perform a state transition
   */
  transition(from: LeadStatus, event: LeadEvent, context?: StateContext): {
    success: boolean;
    newState?: LeadStatus;
    error?: string;
  } {
    const nextState = this.getNextState(from, event, context);

    if (nextState) {
      this.logger.log(`State transition: ${from} -> ${nextState} (event: ${event})`);
      return {
        success: true,
        newState: nextState,
      };
    }

    this.logger.warn(`Invalid transition: ${from} + ${event}`);
    return {
      success: false,
      error: `Invalid transition from ${from} with event ${event}`,
    };
  }

  private findTransition(from: LeadStatus, event: LeadEvent, context?: StateContext): StateTransition | null {
    for (const transition of this.transitions) {
      if (transition.from.includes(from) && transition.event === event) {
        // Check condition if present
        if (transition.condition) {
          if (context && transition.condition(context)) {
            return transition;
          }
        } else {
          return transition;
        }
      }
    }
    return null;
  }

  /**
   * Get a visual representation of the state machine for debugging
   */
  getStateGraph(): Record<LeadStatus, LeadEvent[]> {
    const graph: Record<string, LeadEvent[]> = {};

    const allStates: LeadStatus[] = [
      'NEW', 'QUALIFYING', 'PHOTO_REQUESTED', 'PHOTO_COLLECTING', 'PHOTO_QA_FIX',
      'READY_FOR_DOCTOR', 'READY_FOR_SALES', 'WAITING_FOR_USER', 'DORMANT', 
      'HANDOFF_HUMAN', 'CONVERTED', 'CLOSED'
    ];

    for (const state of allStates) {
      graph[state] = this.getPossibleEvents(state);
    }

    return graph as Record<LeadStatus, LeadEvent[]>;
  }

  /**
   * Get human-readable state description
   */
  getStateDescription(status: LeadStatus): string {
    const descriptions: Record<LeadStatus, string> = {
      'NEW': 'New lead - initial contact',
      'QUALIFYING': 'Gathering information (treatment, concerns, timeline, medical history)',
      'PHOTO_REQUESTED': 'Photos requested (optional)',
      'PHOTO_COLLECTING': 'Receiving and validating photos',
      'PHOTO_QA_FIX': 'Photos need fixes (quality issues or missing angles)',
      'READY_FOR_DOCTOR': 'All medical info collected, ready for doctor (photos optional)',
      'READY_FOR_SALES': 'Doctor approved, waiting for sales offer',
      'WAITING_FOR_USER': 'Waiting for user to respond',
      'DORMANT': 'User inactive after multiple follow-ups',
      'HANDOFF_HUMAN': 'Transferred to human agent',
      'CONVERTED': 'Lead converted to customer',
      'CLOSED': 'Lead closed',
    };
    return descriptions[status] || 'Unknown status';
  }

  /**
   * Check if lead can proceed to doctor without photos
   */
  canProceedWithoutPhotos(context: StateContext): boolean {
    return context.medical?.isComplete === true;
  }

  /**
   * Check if lead has any photos
   */
  hasPhotos(context: StateContext): boolean {
    return (context.photos?.count ?? 0) > 0;
  }
}
