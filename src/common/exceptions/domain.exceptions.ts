import { HttpException, HttpStatus } from '@nestjs/common';

export class BrandNotFoundException extends HttpException {
  constructor(brandId: string) {
    super(`Brand '${brandId}' not found`, HttpStatus.NOT_FOUND);
  }
}

export class DocumentNotFoundException extends HttpException {
  constructor(docId: string) {
    super(`Document '${docId}' not found`, HttpStatus.NOT_FOUND);
  }
}

export class ContentJobNotFoundException extends HttpException {
  constructor(jobId: string) {
    super(`Content job '${jobId}' not found`, HttpStatus.NOT_FOUND);
  }
}

export class LLMProviderExhaustedException extends HttpException {
  constructor(tried: string[]) {
    super(
      `All LLM providers exhausted. Tried: ${tried.join(', ')}`,
      HttpStatus.SERVICE_UNAVAILABLE,
    );
  }
}

export class DocumentProcessingException extends HttpException {
  constructor(docId: string, reason: string) {
    super(`Document '${docId}' processing failed: ${reason}`, HttpStatus.UNPROCESSABLE_ENTITY);
  }
}

export class StreamNotFoundException extends HttpException {
  constructor(streamId: string) {
    super(`Stream '${streamId}' not found`, HttpStatus.NOT_FOUND);
  }
}

export class ContractViolationException extends HttpException {
  constructor(contractName: string, issues: string) {
    super(`Contract violation [${contractName}]: ${issues}`, HttpStatus.UNPROCESSABLE_ENTITY);
  }
}
