import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { TypeOrmModule } from '@nestjs/typeorm';
import { QueueService } from './queue.service';
import { ContentPipelineProcessor } from './processors/content-pipeline.processor';
import { CONTENT_PIPELINE_QUEUE } from './queue.constants';
import { ContentJobEntity } from '../content/entities/content-job.entity';
import { BrandsModule } from '../brands/brands.module';
import { AgentsModule } from '../agents/agents.module';
import { StreamingModule } from '../streaming/streaming.module';
import { EvaluationModule } from '../evaluation/evaluation.module';

@Module({
  imports: [
    BullModule.registerQueue({ name: CONTENT_PIPELINE_QUEUE }),
    TypeOrmModule.forFeature([ContentJobEntity]),
    BrandsModule,
    AgentsModule,
    StreamingModule,
    EvaluationModule,
  ],
  providers: [QueueService, ContentPipelineProcessor],
  exports: [QueueService],
})
export class QueueModule {}
