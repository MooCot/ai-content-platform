import { Injectable, NestMiddleware } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';
import { randomUUID } from 'crypto';

export const CORRELATION_ID_HEADER = 'x-correlation-id';

@Injectable()
export class CorrelationIdMiddleware implements NestMiddleware {
  use(req: Request, res: Response, next: NextFunction): void {
    const existing = req.headers[CORRELATION_ID_HEADER] as string | undefined;
    const correlationId = existing ?? randomUUID();

    // Normalise: ensure the header is always present on the request object
    req.headers[CORRELATION_ID_HEADER] = correlationId;

    // Echo back so callers can correlate async SSE events with their request
    res.setHeader(CORRELATION_ID_HEADER, correlationId);

    next();
  }
}
