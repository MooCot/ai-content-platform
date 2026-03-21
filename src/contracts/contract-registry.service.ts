import { Injectable, Logger } from '@nestjs/common';
import { ZodSchema, ZodError } from 'zod';
import { ContractViolationException } from '../common/exceptions/domain.exceptions';

/**
 * Central contract enforcement service.
 *
 * Provides two modes of validation:
 *   - `validate()` — hard enforcement: throws ContractViolationException on violation.
 *     Use at system entry points (enqueue, API boundaries).
 *   - `validateSafe()` — soft enforcement: returns null on violation with a logged warning.
 *     Use inside pipelines where partial degradation is preferable to full failure.
 *
 * All violations are logged at ERROR level and carry the contract name for tracing.
 */
@Injectable()
export class ContractRegistryService {
  private readonly logger = new Logger(ContractRegistryService.name);

  /**
   * Validate `data` against `schema`.
   * Returns the parsed (and potentially transformed) value on success.
   * Throws `ContractViolationException` (HTTP 422) on failure.
   */
  validate<T>(schema: ZodSchema<T>, data: unknown, contractName: string): T {
    const result = schema.safeParse(data);
    if (!result.success) {
      const issues = this.formatIssues(result.error);
      this.logger.error(`Contract violation [${contractName}]: ${issues}`);
      throw new ContractViolationException(contractName, issues);
    }
    return result.data;
  }

  /**
   * Validate `data` against `schema`.
   * Returns the parsed value on success, or `null` on failure (with a warning log).
   * Use in non-critical paths where the pipeline should degrade gracefully.
   */
  validateSafe<T>(schema: ZodSchema<T>, data: unknown, contractName: string): T | null {
    const result = schema.safeParse(data);
    if (!result.success) {
      const issues = this.formatIssues(result.error);
      this.logger.warn(`Contract mismatch [${contractName}] — item dropped: ${issues}`);
      return null;
    }
    return result.data;
  }

  /**
   * Filter an array, dropping items that fail validation.
   * Useful for RAG results, memory events, and other collections
   * where partial data is still useful.
   */
  filterValid<T>(schema: ZodSchema<T>, items: unknown[], contractName: string): T[] {
    const valid: T[] = [];
    for (const item of items) {
      const result = this.validateSafe(schema, item, contractName);
      if (result !== null) valid.push(result);
    }

    if (valid.length < items.length) {
      this.logger.warn(
        `[${contractName}] Filtered ${items.length - valid.length}/${items.length} invalid items`,
      );
    }

    return valid;
  }

  private formatIssues(error: ZodError): string {
    return error.issues
      .map((i) => {
        const path = i.path.length ? `${i.path.join('.')}: ` : '';
        return `${path}${i.message}`;
      })
      .join('; ');
  }
}
