import type { ErrorCode } from './errorCodes';

/**
 * Serializable representation of a DocuFlowError.
 * This is the shape that crosses IPC boundaries.
 */
export interface SerializedDocuFlowError {
  code: ErrorCode;
  message: string;
  recoverable: boolean;
  context?: Record<string, unknown>;
}

/**
 * Structured error for all DocuFlow operations.
 *
 * Features:
 * - Stable error codes for programmatic handling
 * - Recoverable vs non-recoverable classification
 * - Optional context metadata for debugging
 * - Proper Error inheritance with cause chaining
 * - Safe IPC serialization via toSerializable()
 *
 * Usage:
 * ```ts
 * throw new DocuFlowError(ErrorCode.MEDIA_LOAD, 'Failed to load video', {
 *   recoverable: true,
 *   cause: originalError,
 *   context: { filePath: '/path/to/video.mp4' },
 * });
 * ```
 */
export class DocuFlowError extends Error {
  readonly code: ErrorCode;
  readonly recoverable: boolean;
  readonly context?: Record<string, unknown>;
  readonly cause?: unknown;

  constructor(
    code: ErrorCode,
    message: string,
    options?: {
      recoverable?: boolean;
      cause?: unknown;
      context?: Record<string, unknown>;
    }
  ) {
    super(message);
    this.name = 'DocuFlowError';
    this.code = code;
    this.recoverable = options?.recoverable ?? false;
    this.context = options?.context;

    // Preserve cause for debugging (ES2022+ Error cause support)
    if (options?.cause !== undefined) {
      (this as unknown as Record<string, unknown>).cause = options.cause;
    }

    // Fix prototype chain for instanceof checks
    Object.setPrototypeOf(this, new.target.prototype);
  }

  /**
   * Convert to a plain object safe for Electron IPC serialization.
   * Strips stack traces, cause chains, and any non-serializable data.
   */
  toSerializable(): SerializedDocuFlowError {
    const result: SerializedDocuFlowError = {
      code: this.code,
      message: this.message,
      recoverable: this.recoverable,
    };
    if (this.context && Object.keys(this.context).length > 0) {
      result.context = { ...this.context };
    }
    return result;
  }

  /**
   * Create a DocuFlowError from a serialized IPC payload.
   */
  static fromSerializable(data: SerializedDocuFlowError): DocuFlowError {
    return new DocuFlowError(data.code, data.message, {
      recoverable: data.recoverable,
      context: data.context,
    });
  }
}
