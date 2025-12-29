import { Controller, Post, Body, Get, HttpCode, HttpStatus, Logger } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBody } from '@nestjs/swagger';
import { OrchestratorService } from './orchestrator.service';
import { StateMachineService } from './state-machine.service';

class ProcessAiResponseDto {
  leadId: string;
  conversationId: string;
  messageId: string;
  aiRunId: string;
  replyDraft: string;
  intent?: Record<string, unknown>;
  extraction?: Record<string, unknown>;
  desireScore?: number;
  shouldHandoff?: boolean;
  handoffReason?: string;
}

@ApiTags('orchestrator')
@Controller('orchestrator')
export class OrchestratorController {
  private readonly logger = new Logger(OrchestratorController.name);

  constructor(
    private readonly orchestratorService: OrchestratorService,
    private readonly stateMachineService: StateMachineService,
  ) {}

  @Post('ai-response')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Process AI response and send reply' })
  @ApiBody({ type: ProcessAiResponseDto })
  async processAiResponse(@Body() data: ProcessAiResponseDto) {
    this.logger.log(`Processing AI response for lead: ${data.leadId}`);
    await this.orchestratorService.processAiResponse(data);
    return { success: true };
  }

  @Get('state-graph')
  @ApiOperation({ summary: 'Get state machine graph' })
  getStateGraph() {
    return this.stateMachineService.getStateGraph();
  }
}

