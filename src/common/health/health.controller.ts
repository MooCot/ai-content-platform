import { Controller, Get } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { ApiTags, ApiOperation } from '@nestjs/swagger';

@ApiTags('health')
@Controller('health')
export class HealthController {
  constructor(
    @InjectDataSource()
    private readonly dataSource: DataSource,
  ) {}

  @Get()
  @ApiOperation({ summary: 'Liveness + readiness health check' })
  async check() {
    const dbOk = await this.dataSource
      .query('SELECT 1')
      .then(() => true)
      .catch(() => false);

    const status = dbOk ? 'ok' : 'degraded';
    const code = dbOk ? 200 : 503;

    return {
      status,
      timestamp: new Date().toISOString(),
      version: process.env.npm_package_version ?? 'unknown',
      checks: {
        database: dbOk ? 'ok' : 'error',
      },
    };
  }
}
