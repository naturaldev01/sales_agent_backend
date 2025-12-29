import { Controller, Get, Param, Query, Logger, ParseUUIDPipe, BadRequestException } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiQuery, ApiParam } from '@nestjs/swagger';
import { PhotosService } from './photos.service';

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

  @Get(':id/url')
  @ApiOperation({ summary: 'Get signed URL for a photo' })
  @ApiParam({ name: 'id', type: String })
  async getSignedUrl(@Param('id', OptionalUUIDPipe) id: string) {
    return this.photosService.getSignedUrl(id);
  }
}

