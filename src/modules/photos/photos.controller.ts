import { Controller, Get, Patch, Param, Query, Body, Res, Req, Logger, ParseUUIDPipe, BadRequestException, NotFoundException, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiQuery, ApiParam, ApiBody } from '@nestjs/swagger';
import { Response, Request } from 'express';
import { PhotosService } from './photos.service';
import { AuthGuard } from '../../common/guards/auth.guard';

const OptionalUUIDPipe = new ParseUUIDPipe({
  exceptionFactory: () => new BadRequestException('Invalid UUID format'),
});

@ApiTags('photos')
@Controller('photos')
export class PhotosController {
  private readonly logger = new Logger(PhotosController.name);

  constructor(private readonly photosService: PhotosService) {}

  @Get()
  @ApiOperation({ summary: 'Get all photos with signed URLs' })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  async findAll(@Query('limit') limit?: number) {
    return this.photosService.findAllWithUrls(
      limit ? parseInt(String(limit), 10) : undefined,
    );
  }

  @Get('categories')
  @ApiOperation({ summary: 'Get all available treatment categories with photo checklists' })
  async getCategories() {
    const categories = await this.photosService.getAvailableTreatmentCategories();
    return { categories };
  }

  @Get('checklist/:treatmentCategory')
  @ApiOperation({ summary: 'Get photo checklist with template for a treatment category' })
  @ApiParam({ name: 'treatmentCategory', type: String })
  @ApiQuery({ name: 'language', required: false, type: String })
  async getChecklist(
    @Param('treatmentCategory') treatmentCategory: string,
    @Query('language') language?: string,
  ) {
    const checklist = await this.photosService.getPhotoChecklistWithTemplate(
      treatmentCategory,
      language || 'en',
    );
    return checklist;
  }

  @Get('template/:treatmentCategory')
  @ApiOperation({ summary: 'Get template image for a treatment category' })
  @ApiParam({ name: 'treatmentCategory', type: String })
  @ApiQuery({ name: 'language', required: false, type: String })
  async getTemplateImage(
    @Param('treatmentCategory') treatmentCategory: string,
    @Query('language') language: string = 'en',
    @Res() res: Response,
  ) {
    const imageData = await this.photosService.getTemplateImageBuffer(treatmentCategory, language);
    
    if (!imageData) {
      throw new NotFoundException(`Template image not found for ${treatmentCategory}/${language}`);
    }

    res.set({
      'Content-Type': imageData.mimeType,
      'Content-Disposition': `inline; filename="${imageData.filename}"`,
      'Cache-Control': 'public, max-age=86400', // Cache for 24 hours
    });

    res.send(imageData.buffer);
  }

  @Get(':id/url')
  @ApiOperation({ summary: 'Get signed URL for a photo' })
  @ApiParam({ name: 'id', type: String })
  async getSignedUrl(@Param('id', OptionalUUIDPipe) id: string) {
    return this.photosService.getSignedUrl(id);
  }

  @Patch(':id/verify')
  @UseGuards(AuthGuard)
  @ApiOperation({ summary: 'Verify (approve) a photo' })
  @ApiParam({ name: 'id', type: String })
  async verifyPhoto(
    @Param('id', OptionalUUIDPipe) id: string,
    @Req() req: Request,
  ) {
    const userId = (req as any).user?.id || 'system';
    this.logger.log(`Verifying photo ${id} by user ${userId}`);
    return this.photosService.verifyPhoto(id, userId);
  }

  @Patch(':id/reject')
  @UseGuards(AuthGuard)
  @ApiOperation({ summary: 'Reject a photo and notify the user' })
  @ApiParam({ name: 'id', type: String })
  @ApiBody({ schema: { type: 'object', properties: { reason: { type: 'string' } }, required: ['reason'] } })
  async rejectPhoto(
    @Param('id', OptionalUUIDPipe) id: string,
    @Body() body: { reason: string },
    @Req() req: Request,
  ) {
    const userId = (req as any).user?.id || 'system';
    
    if (!body.reason || body.reason.trim() === '') {
      throw new BadRequestException('Rejection reason is required');
    }
    
    this.logger.log(`Rejecting photo ${id} by user ${userId}. Reason: ${body.reason}`);
    return this.photosService.rejectPhoto(id, userId, body.reason);
  }
}

