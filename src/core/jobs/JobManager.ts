/**
 * JobManager — lightweight application-level job lifecycle management.
 *
 * Responsibilities:
 * - Creating jobs with unique IDs
 * - Tracking job state (queued → running → completed/failed/cancelled)
 * - Progress reporting (0-1)
 * - Cancellation via AbortController
 * - Error normalization using existing DocuFlowError
 * - Concurrent job support
 * - Job lookup and cleanup
 *
 * Does NOT know about: React, Zustand, Electron, DOM, Worker, IPC, or any UI.
 * Does NOT replace WorkerManager — wraps executors that may use WorkerManager internally.
 */

import { normalizeError } from '../errors';
import type { DocuFlowError } from '../errors/DocuFlowError';
import type {
  JobId,
  JobStatus,
  JobInfo,
  JobHandle,
  JobContext,
  JobExecutor,
} from './types';

// ---------------------------------------------------------------------------
// Internal Job Record
// ---------------------------------------------------------------------------

interface JobRecord<TResult = unknown> {
  id: JobId;
  type: string;
  status: JobStatus;
  progress: number;
  result?: TResult;
  error?: DocuFlowError;
  createdAt: number;
  startedAt?: number;
  completedAt?: number;
  abortController: AbortController;
  promise: Promise<TResult>;
  resolve: (value: TResult) => void;
  reject: (reason: unknown) => void;
}

// ---------------------------------------------------------------------------
// ID Generation
// ---------------------------------------------------------------------------

let nextJobId = 0;
function generateJobId(): JobId {
  return `job-${++nextJobId}-${Date.now()}`;
}

// ---------------------------------------------------------------------------
// Progress Clamping
// ---------------------------------------------------------------------------

function clampProgress(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

// ---------------------------------------------------------------------------
// Terminal State Check
// ---------------------------------------------------------------------------

const TERMINAL_STATES: ReadonlySet<JobStatus> = new Set<JobStatus>([
  'completed',
  'failed',
  'cancelled',
]);

function isTerminal(status: JobStatus): boolean {
  return TERMINAL_STATES.has(status);
}

// ---------------------------------------------------------------------------
// Deferred Reject
// ---------------------------------------------------------------------------

function deferredReject(reject: (reason: unknown) => void, reason: unknown): void {
  queueMicrotask(() => reject(reason));
}

// ---------------------------------------------------------------------------
// JobManager
// ---------------------------------------------------------------------------

export class JobManager {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private jobs = new Map<JobId, JobRecord<any>>();
  private disposed = false;

  /**
   * Create and start a job.
   * Returns a handle with promise, cancel, and state inspection.
   */
  run<TResult>(options: {
    type: string;
    execute: JobExecutor<TResult>;
  }): JobHandle<TResult> {
    if (this.disposed) {
      const err = normalizeError('JobManager is disposed', 'UNKNOWN');
      const id = generateJobId();
      return {
        id,
        promise: Promise.reject(err),
        cancel: () => {},
        getState: () => ({
          id,
          type: options.type,
          status: 'failed' as JobStatus,
          progress: 0,
          error: err,
          createdAt: Date.now(),
        }),
      };
    }

    const id = generateJobId();
    const abortController = new AbortController();

    const record: JobRecord<TResult> = {
      id,
      type: options.type,
      status: 'queued',
      progress: 0,
      createdAt: Date.now(),
      abortController,
      promise: null!,
      resolve: null!,
      reject: null!,
    };

    const promise = new Promise<TResult>((resolve, reject) => {
      record.resolve = resolve;
      record.reject = reject;
    });
    record.promise = promise;

    // Register the job
    this.jobs.set(id, record);

    // Handle cancellation
    abortController.signal.addEventListener('abort', () => {
      if (!isTerminal(record.status)) {
        this.transitionTo(record, 'cancelled');
        const err = normalizeError('Job cancelled', 'UNKNOWN');
        record.error = err;
        deferredReject(record.reject, err);
      }
    }, { once: true });

    // Start execution asynchronously
    this.startExecution(record, options.execute);

    const handle: JobHandle<TResult> = {
      id,
      promise,
      cancel: () => {
        if (!isTerminal(record.status)) {
          abortController.abort();
        }
      },
      getState: () => this.snapshot(record) as JobInfo<TResult>,
    };

    return handle;
  }

  private async startExecution<TResult>(
    record: JobRecord<TResult>,
    execute: JobExecutor<TResult>,
  ): Promise<void> {
    this.transitionTo(record, 'running');
    record.startedAt = Date.now();

    const context: JobContext = {
      signal: record.abortController.signal,
      reportProgress: (progress: number) => {
        if (!isTerminal(record.status)) {
          record.progress = clampProgress(progress);
        }
      },
    };

    try {
      const result = await execute(context);

      if (record.abortController.signal.aborted) return;

      if (!isTerminal(record.status)) {
        record.result = result;
        record.progress = 1;
        this.transitionTo(record, 'completed');
        record.resolve(result);
      }
    } catch (err) {
      if (record.abortController.signal.aborted) return;

      if (!isTerminal(record.status)) {
        const normalized = normalizeError(err, 'UNKNOWN');
        record.error = normalized;
        this.transitionTo(record, 'failed');
        deferredReject(record.reject, normalized);
      }
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private transitionTo(record: JobRecord<any>, status: JobStatus): void {
    if (isTerminal(record.status)) return;
    record.status = status;
    if (isTerminal(status)) {
      record.completedAt = Date.now();
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private snapshot(record: JobRecord<any>): JobInfo {
    return {
      id: record.id,
      type: record.type,
      status: record.status,
      progress: record.progress,
      result: record.result,
      error: record.error,
      createdAt: record.createdAt,
      startedAt: record.startedAt,
      completedAt: record.completedAt,
    };
  }

  get(id: JobId): JobInfo | undefined {
    const record = this.jobs.get(id);
    return record ? this.snapshot(record) : undefined;
  }

  getAll(): JobInfo[] {
    const results: JobInfo[] = [];
    this.jobs.forEach((record) => {
      results.push(this.snapshot(record));
    });
    return results;
  }

  getActive(): JobInfo[] {
    const results: JobInfo[] = [];
    this.jobs.forEach((record) => {
      if (!isTerminal(record.status)) {
        results.push(this.snapshot(record));
      }
    });
    return results;
  }

  cancel(id: JobId): boolean {
    const record = this.jobs.get(id);
    if (!record) return false;
    if (isTerminal(record.status)) return false;
    record.abortController.abort();
    return true;
  }

  remove(id: JobId): boolean {
    const record = this.jobs.get(id);
    if (!record) return false;
    if (!isTerminal(record.status)) return false;
    this.jobs.delete(id);
    return true;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.jobs.forEach((record) => {
      if (!isTerminal(record.status)) {
        record.abortController.abort();
      }
    });
    this.jobs.clear();
  }

  get size(): number {
    return this.jobs.size;
  }

  get activeCount(): number {
    let count = 0;
    this.jobs.forEach((record) => {
      if (!isTerminal(record.status)) count++;
    });
    return count;
  }

  get isDisposed(): boolean {
    return this.disposed;
  }
}
