/**
 * Core Job System Types
 *
 * Framework-free job lifecycle types for long-running DocuFlow operations.
 * This module has zero dependencies on React, Zustand, Electron, DOM, or any UI.
 */

import type { DocuFlowError } from '../errors/DocuFlowError';

// ---------------------------------------------------------------------------
// Job Status
// ---------------------------------------------------------------------------

/**
 * Discriminated job status. Mutually exclusive — no boolean combinations.
 *
 * Lifecycle:
 *   queued → running → completed
 *   queued → running → failed
 *   queued → running → cancelled
 *   queued → cancelled (before execution starts)
 */
export type JobStatus = 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';

// ---------------------------------------------------------------------------
// Job ID
// ---------------------------------------------------------------------------

/** Unique job identifier. Collision-resistant via counter + timestamp. */
export type JobId = string;

// ---------------------------------------------------------------------------
// Job Context (passed to executor)
// ---------------------------------------------------------------------------

/**
 * Context provided to a job executor function.
 * The executor uses these to communicate progress and respect cancellation.
 */
export interface JobContext {
  /** AbortSignal that fires when the job is cancelled. */
  signal: AbortSignal;
  /** Report progress as a normalized 0-1 value. Out-of-range values are clamped. */
  reportProgress(progress: number): void;
}

// ---------------------------------------------------------------------------
// Job Executor
// ---------------------------------------------------------------------------

/**
 * A job executor is a pure async function that performs the actual work.
 * It receives a JobContext for cancellation and progress, and returns a result.
 *
 * The executor must:
 * - Check `signal.aborted` periodically for cancellation
 * - Call `reportProgress()` with values 0-1 if progress is available
 * - Return the result on success
 * - Throw on failure (errors are normalized by JobManager)
 */
export type JobExecutor<T> = (context: JobContext) => Promise<T>;

// ---------------------------------------------------------------------------
// Job Info (state snapshot)
// ---------------------------------------------------------------------------

/**
 * Immutable snapshot of a job's current state.
 * Returned by job.getState() and jobManager.get().
 */
export interface JobInfo<TResult = unknown> {
  id: JobId;
  type: string;
  status: JobStatus;
  progress: number;
  result?: TResult;
  error?: DocuFlowError;
  createdAt: number;
  startedAt?: number;
  completedAt?: number;
}

// ---------------------------------------------------------------------------
// Job Handle (returned to caller)
// ---------------------------------------------------------------------------

/**
 * Lightweight handle for a running or completed job.
 * Provides promise-based result, cancellation, and state inspection.
 */
export interface JobHandle<TResult = unknown> {
  /** Unique job ID. */
  id: JobId;
  /** Promise that resolves with the job result or rejects on failure/cancellation. */
  promise: Promise<TResult>;
  /** Cancel the job. Triggers AbortSignal in the executor. */
  cancel(): void;
  /** Get the current state snapshot. */
  getState(): JobInfo<TResult>;
}
