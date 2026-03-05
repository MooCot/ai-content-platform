import {
  Controller,
  Get,
  Delete,
  Param,
  Res,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { Response } from 'express';
import { ApiTags, ApiOperation, ApiParam } from '@nestjs/swagger';
import { StreamingService } from './streaming.service';

@ApiTags('streaming')
@Controller('stream')
export class StreamingController {
  constructor(private readonly streamingService: StreamingService) {}

  @Get(':jobId')
  @ApiOperation({
    summary: 'Open SSE stream for a content job',
    description: 'Returns a Server-Sent Events stream with token and agent step events.',
  })
  @ApiParam({ name: 'jobId', type: String })
  openStream(@Param('jobId') jobId: string, @Res() res: Response): void {
    // The content service registers the stream before job runs.
    // If the client connects before registration, they'll receive events once registered.
    // For simplicity, we register here too (idempotent if already registered).
    if (!this.streamingService.isActive(jobId)) {
      this.streamingService.register(jobId, res);
    } else {
      // Re-attach (noop — stream already has res handle)
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');
      res.flushHeaders();
    }
  }

  @Delete(':jobId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Cancel an active SSE stream' })
  cancelStream(@Param('jobId') jobId: string): void {
    this.streamingService.cancel(jobId);
  }
}
