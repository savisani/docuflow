import { DocuFlowError } from './DocuFlowError';
import type { ErrorCode } from './errorCodes';
import { ErrorCode as EC } from './errorCodes';

/**
 * Normalize any thrown value into a DocuFlowError.
 *
 * Handles:
 * - DocuFlowError (returned as-is)
 * - Error instances (wrapped with UNKNOWN code)
 * - ZodError instances (converted to VALIDATION with structured issues)
 * - Plain strings (wrapped with message)
 * - null / undefined (wrapped with fallback message)
 * - Unknown objects (converted via String())
 *
 * The original cause is always preserved.
 *
 * Usage:
 * ```ts
 * try {
 *   await someOperation();
 * } catch (error) {
 *   const err = normalizeError(error, ErrorCode.MEDIA_LOAD);
 *   // err is always a DocuFlowError
 * }
 * ```
 */
export function normalizeError(
  error: unknown,
  fallbackCode: ErrorCode = EC.UNKNOWN,
  options?: { context?: Record<string, unknown> }
): DocuFlowError {
  // Already a DocuFlowError — return as-is
  if (error instanceof DocuFlowError) {
    return error;
  }

  // ZodError — convert to structured VALIDATION error
  if (isZodError(error)) {
    const issues = error.issues.map((issue) => ({
      path: issue.path.join('.'),
      message: issue.message,
      code: issue.code,
    }));
    return new DocuFlowError(EC.VALIDATION, formatZodMessage(error), {
      recoverable: true,
      cause: error,
      context: { issues, totalIssues: error.issues.length },
    });
  }

  // Standard Error — preserve message and cause
  if (error instanceof Error) {
    return new DocuFlowError(fallbackCode, error.message, {
      cause: error,
      context: options?.context,
    });
  }

  // Plain string
  if (typeof error === 'string') {
    return new DocuFlowError(fallbackCode, error, { cause: error, context: options?.context });
  }

  // null, undefined, or unknown object
  const message =
    error == null
      ? 'An unknown error occurred'
      : typeof error === 'object'
        ? String(error)
        : `Unexpected error: ${String(error)}`;

  return new DocuFlowError(fallbackCode, message, { cause: error, context: options?.context });
}

/**
 * Check if a value looks like a ZodError without importing Zod directly.
 * This avoids a hard dependency on Zod in the core error module.
 */
function isZodError(error: unknown): error is { issues: Array<{ path: (string | number)[]; message: string; code: string }> } {
  return (
    typeof error === 'object' &&
    error !== null &&
    'issues' in error &&
    Array.isArray((error as Record<string, unknown>).issues) &&
    typeof (error as Record<string, unknown>).name === 'string' &&
    (error as Record<string, unknown>).name === 'ZodError'
  );
}

/**
 * Format a ZodError into a human-readable message.
 */
function formatZodMessage(error: { issues: Array<{ path: (string | number)[]; message: string }> }): string {
  if (error.issues.length === 0) return 'Validation failed';
  if (error.issues.length === 1) {
    const issue = error.issues[0];
    const path = issue.path.length > 0 ? `${issue.path.join('.')}: ` : '';
    return `Validation failed: ${path}${issue.message}`;
  }
  return `Validation failed: ${error.issues.length} issues (${error.issues.slice(0, 3).map((i) => i.path.join('.') || i.message).join(', ')}${error.issues.length > 3 ? ', ...' : ''})`;
}
