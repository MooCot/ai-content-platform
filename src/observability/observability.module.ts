import { Global, Module, Controller, Get, Res } from '@nestjs/common';
import { Response } from 'express';
import { MetricsService } from './metrics.service';
import { TracingService } from './tracing.service';

@Controller('metrics')
class MetricsController {
  constructor(private readonly metrics: MetricsService) {}

  @Get()
  async scrape(@Res() res: Response): Promise<void> {
    const body = await this.metrics.getMetrics();
    res.setHeader('Content-Type', 'text/plain; version=0.0.4; charset=utf-8');
    res.end(body);
  }
}

/**
 * Global observability module — no explicit import needed in feature modules.
 * Provides MetricsService and TracingService everywhere via DI.
 */
@Global()
@Module({
  controllers: [MetricsController],
  providers: [MetricsService, TracingService],
  exports: [MetricsService, TracingService],
})
export class ObservabilityModule {}
