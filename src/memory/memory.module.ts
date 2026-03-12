import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { MemoryEventEntity } from './entities/memory-event.entity';
import { MemoryService } from './memory.service';
import { LLMModule } from '../llm/llm.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([MemoryEventEntity]),
    LLMModule, // for LLMRouterService.embed()
  ],
  providers: [MemoryService],
  exports: [MemoryService],
})
export class MemoryModule {}
