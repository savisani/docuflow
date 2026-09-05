import type { SerializedDocuFlowError } from './DocuFlowError';

/**
 * Safely extract a human-readable error message from an IPC error response.
 *
 * Handles both:
 * - Legacy string errors: `"Something went wrong"`
 * - Structured errors: `{ code: "AI_GENERATION", message: "Failed", recoverable: false }`
 *
 * Usage:
 * ```ts
 * const result = await window.docuflow.someCall(params);
 * if (!result.success) {
 *   const message = extractErrorMessage(result.error, 'Operation failed');
 *   setError(message);
 * }
 * ```
 */
export function extractErrorMessage(
  error: unknown,
  fallback: string = 'An unknown error occurred'
): string {
  if (error == null) return fallback;

  // String error (legacy IPC format)
  if (typeof error === 'string') return error;

  // Structured SerializedDocuFlowError
  if (typeof error === 'object' && 'message' in error && typeof (error as Record<string, unknown>).message === 'string') {
    return (error as { message: string }).message;
  }

  // Standard Error object
  if (error instanceof Error) return error.message;

  // Fallback
  return fallback;
}

/**
 * Check if an IPC error response is a structured SerializedDocuFlowError
 * (as opposed to a legacy plain string).
 */
export function isStructuredError(error: unknown): error is SerializedDocuFlowError {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    'message' in error &&
    'recoverable' in error
  );
}
