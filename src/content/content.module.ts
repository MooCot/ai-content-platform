import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ContentJobEntity } from './entities/content-job.entity';
import { ContentService } from './content.service';
import { ContentController } from './content.controller';
import { BrandsModule } from '../brands/brands.module';
import { AgentsModule } from '../agents/agents.module';
import { StreamingModule } from '../streaming/streaming.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([ContentJobEntity]),
    BrandsModule,
    AgentsModule,
    StreamingModule,
  ],
  controllers: [ContentController],
  providers: [ContentService],
})
export class ContentModule {}
