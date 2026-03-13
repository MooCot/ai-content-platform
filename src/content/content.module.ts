import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ContentJobEntity } from './entities/content-job.entity';
import { ContentService } from './content.service';
import { ContentController } from './content.controller';
import { BrandsModule } from '../brands/brands.module';
import { QueueModule } from '../queue/queue.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([ContentJobEntity]),
    BrandsModule,
    QueueModule, // provides QueueService; processor inside QueueModule owns the pipeline
  ],
  controllers: [ContentController],
  providers: [ContentService],
})
export class ContentModule {}
