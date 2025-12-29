import {
  Controller,
  Get,
  Param,
  Post,
  Query,
  Logger,
  ParseUUIDPipe,
  BadRequestException,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiParam, ApiQuery } from '@nestjs/swagger';
import { ConversationsService } from './conversations.service';

const OptionalUUIDPipe = new ParseUUIDPipe({
  exceptionFactory: () => new BadRequestException('Invalid UUID format'),
});

@ApiTags('conversations')
@Controller('conversations')
export class ConversationsController {
  private readonly logger = new Logger(ConversationsController.name);

  constructor(private readonly conversationsService: ConversationsService) {}

  @Get()
  @ApiOperation({ summary: 'Get all conversations' })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  async findAll(@Query('limit') limit?: number) {
    return this.conversationsService.findAll(
      limit ? parseInt(String(limit), 10) : undefined,
    );
  }

  @Get('lead/:leadId')
  @ApiOperation({ summary: 'Get conversations by lead ID' })
  @ApiParam({ name: 'leadId', type: String })
  async findByLeadId(@Param('leadId', OptionalUUIDPipe) leadId: string) {
    return this.conversationsService.findByLeadId(leadId);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get conversation by ID' })
  @ApiParam({ name: 'id', type: String })
  async findById(@Param('id', OptionalUUIDPipe) id: string) {
    return this.conversationsService.findById(id);
  }

  @Get(':id/messages')
  @ApiOperation({ summary: 'Get conversation messages' })
  @ApiParam({ name: 'id', type: String })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  async getMessages(
    @Param('id', OptionalUUIDPipe) id: string,
    @Query('limit') limit?: number,
  ) {
    return this.conversationsService.getMessages(
      id,
      limit ? parseInt(String(limit), 10) : undefined,
    );
  }

  @Post(':id/close')
  @ApiOperation({ summary: 'Close conversation' })
  @ApiParam({ name: 'id', type: String })
  async closeConversation(@Param('id', OptionalUUIDPipe) id: string) {
    return this.conversationsService.closeConversation(id);
  }
}

