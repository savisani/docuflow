/**
 * Worker Communication Types
 *
 * Typed request/response contract for Web Worker communication.
 * All messages use requestId for correlation.
 * No untyped `any` — every message has a discriminated type.
 */

import type { SerializedDocuFlowError } from '../../core/errors/DocuFlowError';

// ---------------------------------------------------------------------------
// Request Types
// ---------------------------------------------------------------------------

export interface ExtractPeaksRequest {
  type: 'extract-peaks';
  requestId: string;
  payload: {
    channelData: Float32Array;
    numBars: number;
  };
}

export type WorkerRequest = ExtractPeaksRequest;

// ---------------------------------------------------------------------------
// Response Types
// ---------------------------------------------------------------------------

export interface WorkerSuccessResponse<T = unknown> {
  requestId: string;
  type: 'success';
  result: T;
}

export interface WorkerErrorResponse {
  requestId: string;
  type: 'error';
  error: SerializedDocuFlowError;
}

export interface WorkerProgressResponse {
  requestId: string;
  type: 'progress';
  progress: number;
}

export type WorkerResponse =
  | WorkerSuccessResponse
  | WorkerErrorResponse
  | WorkerProgressResponse;

// ---------------------------------------------------------------------------
// Result Types
// ---------------------------------------------------------------------------

export interface ExtractPeaksResult {
  peaks: number[];
  peakMax: number;
}

// ---------------------------------------------------------------------------
// Task Handle
// ---------------------------------------------------------------------------

export interface WorkerTaskHandle<R> {
  promise: Promise<R>;
  cancel(): void;
}

// ---------------------------------------------------------------------------
// Worker Manager Options
// ---------------------------------------------------------------------------

export interface WorkerTaskOptions<T> {
  type: string;
  payload: T;
  transfer?: Transferable[];
  signal?: AbortSignal;
  onProgress?: (progress: number) => void;
}
