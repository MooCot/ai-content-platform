import { Global, Module } from '@nestjs/common';
import { ContractRegistryService } from './contract-registry.service';

/**
 * Global contract enforcement module.
 *
 * Marked @Global so ContractRegistryService is injectable everywhere
 * without explicit imports — mirrors the ObservabilityModule pattern.
 *
 * Must be registered in AppModule before any domain module that uses
 * contract validation.
 */
@Global()
@Module({
  providers: [ContractRegistryService],
  exports: [ContractRegistryService],
})
export class ContractsModule {}
