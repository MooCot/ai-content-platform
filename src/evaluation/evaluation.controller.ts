import {
  Controller,
  Get,
  Param,
  Query,
  ParseUUIDPipe,
  ParseIntPipe,
  DefaultValuePipe,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiParam, ApiQuery } from '@nestjs/swagger';
import { EvaluationService } from './evaluation.service';

@ApiTags('evaluation')
@Controller('brands/:brandId/evaluations')
export class EvaluationController {
  constructor(private readonly evaluation: EvaluationService) {}

  @Get()
  @ApiOperation({ summary: 'List evaluation records for a brand (newest first)' })
  @ApiParam({ name: 'brandId', type: String })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  listEvaluations(
    @Param('brandId', ParseUUIDPipe) brandId: string,
    @Query('limit', new DefaultValuePipe(50), ParseIntPipe) limit: number,
  ) {
    return this.evaluation.getByBrand(brandId, Math.min(limit, 200));
  }

  @Get('compare')
  @ApiOperation({ summary: 'Compare average composite scores between two model IDs' })
  @ApiParam({ name: 'brandId', type: String })
  @ApiQuery({ name: 'modelA', required: true, type: String })
  @ApiQuery({ name: 'modelB', required: true, type: String })
  compareModels(
    @Param('brandId', ParseUUIDPipe) brandId: string,
    @Query('modelA') modelA: string,
    @Query('modelB') modelB: string,
  ) {
    return this.evaluation.compareModels(brandId, modelA, modelB);
  }
}
