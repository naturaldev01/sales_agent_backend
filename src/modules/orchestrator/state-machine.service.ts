import { Injectable, Logger } from '@nestjs/common';

export type LeadStatus =
  | 'NEW'
  | 'QUALIFYING'
  | 'PHOTO_REQUESTED'
  | 'PHOTO_COLLECTING'
  | 'READY_FOR_DOCTOR'
  | 'WAITING_FOR_USER'
  | 'DORMANT'
  | 'HANDOFF_HUMAN'
  | 'CONVERTED'
  | 'CLOSED';

export type LeadEvent =
  | 'MESSAGE_RECEIVED'
  | 'PHOTO_RECEIVED'
  | 'QUALIFYING_COMPLETE'
  | 'PHOTOS_COMPLETE'
  | 'FOLLOWUP_SENT'
  | 'MAX_FOLLOWUPS_REACHED'
  | 'HANDOFF_REQUESTED'
  | 'DOCTOR_APPROVED'
  | 'CONVERTED'
  | 'CLOSED_BY_USER'
  | 'CLOSED_BY_ADMIN';

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
  };
  conversation?: {
    message_count: number;
    last_user_message_at?: string;
  };
  photos?: {
    count: number;
    required: number;
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
    // New lead receives first message
    {
      from: ['NEW'],
      to: 'QUALIFYING',
      event: 'MESSAGE_RECEIVED',
    },

    // Qualifying lead receives message
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

    // Qualifying complete, request photos
    {
      from: ['QUALIFYING'],
      to: 'PHOTO_REQUESTED',
      event: 'QUALIFYING_COMPLETE',
      condition: (ctx) => !!ctx.lead.treatment_category,
    },

    // Photo received after request
    {
      from: ['PHOTO_REQUESTED'],
      to: 'PHOTO_COLLECTING',
      event: 'PHOTO_RECEIVED',
    },

    // More photos received
    {
      from: ['PHOTO_COLLECTING'],
      to: 'PHOTO_COLLECTING',
      event: 'PHOTO_RECEIVED',
      condition: (ctx) => ctx.photos!.count < ctx.photos!.required,
    },

    // All photos complete
    {
      from: ['PHOTO_COLLECTING'],
      to: 'READY_FOR_DOCTOR',
      event: 'PHOTOS_COMPLETE',
      condition: (ctx) => ctx.photos!.count >= ctx.photos!.required,
    },

    // Any state can wait for user
    {
      from: ['QUALIFYING', 'PHOTO_REQUESTED', 'PHOTO_COLLECTING'],
      to: 'WAITING_FOR_USER',
      event: 'FOLLOWUP_SENT',
    },

    // Max follow-ups reached
    {
      from: ['WAITING_FOR_USER'],
      to: 'DORMANT',
      event: 'MAX_FOLLOWUPS_REACHED',
    },

    // Handoff from any active state
    {
      from: ['QUALIFYING', 'PHOTO_REQUESTED', 'PHOTO_COLLECTING', 'WAITING_FOR_USER'],
      to: 'HANDOFF_HUMAN',
      event: 'HANDOFF_REQUESTED',
    },

    // Doctor approves
    {
      from: ['READY_FOR_DOCTOR'],
      to: 'CONVERTED',
      event: 'DOCTOR_APPROVED',
    },

    // Lead converts
    {
      from: ['HANDOFF_HUMAN', 'READY_FOR_DOCTOR'],
      to: 'CONVERTED',
      event: 'CONVERTED',
    },

    // Close from any state
    {
      from: ['NEW', 'QUALIFYING', 'PHOTO_REQUESTED', 'PHOTO_COLLECTING', 'READY_FOR_DOCTOR', 'WAITING_FOR_USER', 'DORMANT', 'HANDOFF_HUMAN'],
      to: 'CLOSED',
      event: 'CLOSED_BY_USER',
    },
    {
      from: ['NEW', 'QUALIFYING', 'PHOTO_REQUESTED', 'PHOTO_COLLECTING', 'READY_FOR_DOCTOR', 'WAITING_FOR_USER', 'DORMANT', 'HANDOFF_HUMAN'],
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
      'NEW', 'QUALIFYING', 'PHOTO_REQUESTED', 'PHOTO_COLLECTING',
      'READY_FOR_DOCTOR', 'WAITING_FOR_USER', 'DORMANT', 
      'HANDOFF_HUMAN', 'CONVERTED', 'CLOSED'
    ];

    for (const state of allStates) {
      graph[state] = this.getPossibleEvents(state);
    }

    return graph as Record<LeadStatus, LeadEvent[]>;
  }
}

