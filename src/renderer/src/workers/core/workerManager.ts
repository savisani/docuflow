/**
 * WorkerManager — typed Web Worker lifecycle and request/response management.
 *
 * Responsibilities:
 * - Creates and owns a single Web Worker instance
 * - Correlates requests and responses via requestId
 * - Supports cancellation via AbortController
 * - Handles worker errors and unexpected termination
 * - Cleans up pending requests on termination
 *
 * Does NOT know about: React, Zustand, Electron, DOM, Canvas, or any UI.
 */

import type {
  WorkerRequest,
  WorkerResponse,
  WorkerTaskHandle,
  WorkerTaskOptions,
} from './types';
import { normalizeError } from '../../../../core/errors';
import type { ErrorCode } from '../../../../core/errors';

let nextRequestId = 0;
function generateRequestId(): string {
  return `w-${++nextRequestId}-${Date.now()}`;
}

interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (reason: unknown) => void;
  onProgress?: (progress: number) => void;
  abortController: AbortController;
}

/**
 * Defer a promise rejection to the next microtask.
 * This prevents unhandled rejection errors when the caller hasn't
 * yet attached a .catch() handler (e.g., during synchronous terminate/cancel).
 */
function deferredReject(reject: (reason: unknown) => void, reason: unknown): void {
  queueMicrotask(() => reject(reason));
}

/**
 * Manages a single Web Worker and provides a typed request/response API.
 *
 * Usage:
 * ```ts
 * const manager = new WorkerManager(
 *   new URL('../audio/audio.worker.ts', import.meta.url)
 * );
 *
 * const job = manager.run<Float32Array, ExtractPeaksResult>({
 *   type: 'extract-peaks',
 *   payload: { channelData, numBars: 100 },
 *   transfer: [channelData.buffer],
 * });
 *
 * const result = await job.promise;
 * job.cancel(); // optional
 * manager.terminate(); // cleanup
 * ```
 */
export class WorkerManager {
  private worker: Worker | null = null;
  private pending = new Map<string, PendingRequest>();
  private terminated = false;
  private workerUrl: URL;

  constructor(workerUrl: URL) {
    this.workerUrl = workerUrl;
    this.spawnWorker();
  }

  private spawnWorker(): void {
    if (this.terminated) return;

    this.worker = new Worker(this.workerUrl, { type: 'module' });

    this.worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
      const msg = event.data;
      const pending = this.pending.get(msg.requestId);
      if (!pending) return;

      if (msg.type === 'progress') {
        pending.onProgress?.(msg.progress);
        return;
      }

      // Success or error — both resolve the pending request
      this.pending.delete(msg.requestId);

      if (msg.type === 'success') {
        pending.resolve(msg.result);
      } else {
        pending.reject(msg.error);
      }
    };

    this.worker.onerror = (event) => {
      // Worker-level error (uncaught exception in worker)
      // Reject all pending requests
      const err = normalizeError(
        event.message || 'Worker error',
        'WORKER' as ErrorCode
      );
      for (const [id, pending] of this.pending) {
        this.pending.delete(id);
        deferredReject(pending.reject, err);
      }
      // Worker is likely dead — don't respawn automatically
      this.worker = null;
    };
  }

  /**
   * Send a typed request to the worker and return a handle for the promise
   * and optional cancellation.
   */
  run<TTransfer, TResult>(
    options: WorkerTaskOptions<TTransfer>
  ): WorkerTaskHandle<TResult> {
    if (this.terminated || !this.worker) {
      const err = normalizeError(
        'Worker is terminated',
        'WORKER' as ErrorCode
      );
      return {
        promise: Promise.reject(err),
        cancel: () => {},
      };
    }

    const requestId = generateRequestId();
    const abortController = new AbortController();

    // Chain with caller's signal if provided
    if (options.signal) {
      options.signal.addEventListener('abort', () => {
        abortController.abort();
      }, { once: true });
    }

    const promise = new Promise<TResult>((resolve, reject) => {
      const pending: PendingRequest = {
        resolve: resolve as (value: unknown) => void,
        reject,
        onProgress: options.onProgress,
        abortController,
      };
      this.pending.set(requestId, pending);

      // Handle cancellation
      abortController.signal.addEventListener('abort', () => {
        if (this.pending.has(requestId)) {
          this.pending.delete(requestId);
          const err = normalizeError(
            'Worker task cancelled',
            'WORKER' as ErrorCode
          );
          deferredReject(reject, err);
        }
      }, { once: true });

      const request: WorkerRequest = {
        type: options.type,
        requestId,
        payload: options.payload,
      } as WorkerRequest;

      this.worker!.postMessage(request, options.transfer ?? []);
    });

    return {
      promise,
      cancel: () => abortController.abort(),
    };
  }

  /**
   * Terminate the worker and reject all pending requests.
   */
  terminate(): void {
    if (this.terminated) return;
    this.terminated = true;

    const err = normalizeError(
      'Worker terminated',
      'WORKER' as ErrorCode
    );

    for (const [id, pending] of this.pending) {
      this.pending.delete(id);
      deferredReject(pending.reject, err);
    }

    if (this.worker) {
      this.worker.terminate();
      this.worker = null;
    }
  }

  /**
   * Number of pending requests.
   */
  get pendingCount(): number {
    return this.pending.size;
  }

  /**
   * Whether the worker has been terminated.
   */
  get isTerminated(): boolean {
    return this.terminated;
  }
}
