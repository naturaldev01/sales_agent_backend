import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  Headers,
  ParseUUIDPipe,
  Logger,
  UnauthorizedException,
  ForbiddenException,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiParam, ApiHeader } from '@nestjs/swagger';
import { IsString, IsOptional, IsBoolean, MinLength } from 'class-validator';
import { CommentsService } from './comments.service';
import { AuthService, User } from '../auth/auth.service';

// Roles allowed to add doctor comments
const DOCTOR_COMMENT_ROLES = ['doctor', 'admin'];

class CreateCommentDto {
  @IsString()
  @MinLength(1)
  comment: string;

  @IsOptional()
  @IsString()
  comment_type?: string;

  @IsOptional()
  @IsBoolean()
  is_pinned?: boolean;
}

class UpdateCommentDto {
  @IsOptional()
  @IsString()
  comment?: string;

  @IsOptional()
  @IsString()
  comment_type?: string;

  @IsOptional()
  @IsBoolean()
  is_pinned?: boolean;
}

@ApiTags('comments')
@Controller('comments')
export class CommentsController {
  private readonly logger = new Logger(CommentsController.name);

  constructor(
    private readonly commentsService: CommentsService,
    private readonly authService: AuthService,
  ) {}

  private async getUser(authHeader: string): Promise<User> {
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      throw new UnauthorizedException('No token provided');
    }
    return this.authService.validateToken(authHeader.substring(7));
  }

  private checkDoctorRole(user: User): void {
    if (!DOCTOR_COMMENT_ROLES.includes(user.role)) {
      throw new ForbiddenException(
        `Only doctors and admins can add comments. Your role: ${user.role}`,
      );
    }
  }

  @Get('lead/:leadId')
  @ApiOperation({ summary: 'Get comments for a lead' })
  @ApiParam({ name: 'leadId', type: String })
  @ApiHeader({ name: 'Authorization', description: 'Bearer token' })
  async getLeadComments(
    @Param('leadId', ParseUUIDPipe) leadId: string,
    @Headers('authorization') authHeader: string,
  ) {
    await this.getUser(authHeader); // Validate auth
    return this.commentsService.getLeadComments(leadId);
  }

  @Post('lead/:leadId')
  @ApiOperation({ summary: 'Add comment to a lead (doctors and admins only)' })
  @ApiParam({ name: 'leadId', type: String })
  @ApiHeader({ name: 'Authorization', description: 'Bearer token' })
  async addComment(
    @Param('leadId', ParseUUIDPipe) leadId: string,
    @Body() dto: CreateCommentDto,
    @Headers('authorization') authHeader: string,
  ) {
    const user = await this.getUser(authHeader);
    this.checkDoctorRole(user); // Only doctors and admins can add comments
    return this.commentsService.createComment(leadId, user.id, dto);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update a comment' })
  @ApiParam({ name: 'id', type: String })
  @ApiHeader({ name: 'Authorization', description: 'Bearer token' })
  async updateComment(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateCommentDto,
    @Headers('authorization') authHeader: string,
  ) {
    const user = await this.getUser(authHeader);
    return this.commentsService.updateComment(id, user.id, dto);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Delete a comment' })
  @ApiParam({ name: 'id', type: String })
  @ApiHeader({ name: 'Authorization', description: 'Bearer token' })
  async deleteComment(
    @Param('id', ParseUUIDPipe) id: string,
    @Headers('authorization') authHeader: string,
  ) {
    const user = await this.getUser(authHeader);
    return this.commentsService.deleteComment(id, user.id);
  }

  @Patch(':id/pin')
  @ApiOperation({ summary: 'Toggle pin status of a comment' })
  @ApiParam({ name: 'id', type: String })
  @ApiHeader({ name: 'Authorization', description: 'Bearer token' })
  async togglePin(
    @Param('id', ParseUUIDPipe) id: string,
    @Headers('authorization') authHeader: string,
  ) {
    const user = await this.getUser(authHeader);
    return this.commentsService.togglePin(id, user.id);
  }
}

