import { DocuFlowError } from './DocuFlowError';
import type { ErrorCode } from './errorCodes';
import { ErrorCode as EC } from './errorCodes';

/**
 * Safely serialize a DocuFlowError for Electron IPC.
 *
 * Electron's structured clone algorithm does NOT preserve Error objects.
 * This produces a plain object that can cross the IPC boundary.
 *
 * Security: Strips stack traces, cause chains, and non-serializable data.
 * Sensitive context keys are redacted.
 */
export function serializeError(error: DocuFlowError): {
  code: ErrorCode;
  message: string;
  recoverable: boolean;
  context?: Record<string, unknown>;
} {
  return error.toSerializable();
}

/**
 * Deserialize an IPC error payload back into a DocuFlowError.
 *
 * Handles both:
 * - SerializedDocuFlowError objects (from serializeError)
 * - Legacy plain strings (from old IPC handlers)
 */
export function deserializeError(
  data: unknown
): DocuFlowError {
  // Already a DocuFlowError (e.g., same process)
  if (data instanceof DocuFlowError) {
    return data;
  }

  // Serialized structured error
  if (
    typeof data === 'object' &&
    data !== null &&
    'code' in data &&
    'message' in data &&
    'recoverable' in data
  ) {
    const obj = data as Record<string, unknown>;
    return DocuFlowError.fromSerializable({
      code: obj.code as ErrorCode,
      message: obj.message as string,
      recoverable: obj.recoverable as boolean,
      context: obj.context as Record<string, unknown> | undefined,
    });
  }

  // Legacy string error
  if (typeof data === 'string') {
    return new DocuFlowError(EC.UNKNOWN, data);
  }

  // Unknown shape
  return new DocuFlowError(EC.UNKNOWN, 'Received malformed error from IPC');
}

/**
 * Redact sensitive keys from a context object before serialization.
 * Used when sending errors across IPC to avoid leaking secrets.
 */
export function redactContext(
  context: Record<string, unknown> | undefined
): Record<string, unknown> | undefined {
  if (!context || Object.keys(context).length === 0) return undefined;

  const SENSITIVE_KEYS = new Set([
    'token',
    'apikey',
    'api_key',
    'secret',
    'password',
    'credential',
    'authorization',
    'auth',
    'accesstoken',
    'access_token',
    'refreshtoken',
    'refresh_token',
  ]);

  const redacted: Record<string, unknown> = {};
  let hasRedacted = false;

  for (const [key, value] of Object.entries(context)) {
    if (SENSITIVE_KEYS.has(key.toLowerCase().replace(/[_-]/g, ''))) {
      redacted[key] = '[REDACTED]';
      hasRedacted = true;
    } else {
      redacted[key] = value;
    }
  }

  return hasRedacted ? redacted : context;
}
