import {
  Controller,
  Get,
  Post,
  Param,
  Body,
  ParseUUIDPipe,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiParam } from '@nestjs/swagger';
import { ContentService } from './content.service';
import { GenerateContentDto } from './dto/content.dto';

@ApiTags('content')
@Controller('brands/:brandId/content')
export class ContentController {
  constructor(private readonly contentService: ContentService) {}

  @Post('generate')
  @ApiOperation({ summary: 'Start a content generation job' })
  @ApiParam({ name: 'brandId', type: String })
  async generate(
    @Param('brandId', ParseUUIDPipe) brandId: string,
    @Body() dto: GenerateContentDto,
  ) {
    const job = await this.contentService.createJob(brandId, dto);
    return {
      jobId: job.id,
      status: job.status,
      streamUrl: `/stream/${job.id}`,
      message: 'Content generation started. Connect to streamUrl for live updates.',
    };
  }

  @Get()
  @ApiOperation({ summary: 'List all content jobs for a brand' })
  @ApiParam({ name: 'brandId', type: String })
  listJobs(@Param('brandId', ParseUUIDPipe) brandId: string) {
    return this.contentService.listJobs(brandId);
  }

  @Get(':jobId')
  @ApiOperation({ summary: 'Get a content job status and result' })
  @ApiParam({ name: 'brandId', type: String })
  @ApiParam({ name: 'jobId', type: String })
  getJob(
    @Param('brandId', ParseUUIDPipe) brandId: string,
    @Param('jobId', ParseUUIDPipe) jobId: string,
  ) {
    return this.contentService.getJob(jobId, brandId);
  }
}
