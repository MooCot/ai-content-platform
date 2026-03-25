import { Global, Module } from '@nestjs/common';
import { DegradationService } from './degradation.service';

/**
 * @Global cross-cutting module — mirrors the ObservabilityModule pattern.
 * DegradationService is injectable everywhere without explicit imports.
 * Register once in AppModule.
 */
@Global()
@Module({
  providers: [DegradationService],
  exports: [DegradationService],
})
export class ResilienceModule {}
