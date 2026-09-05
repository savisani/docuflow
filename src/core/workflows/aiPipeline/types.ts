/**
 * AI Pipeline Workflow — Type Definitions
 *
 * XState machine types for orchestrating the 7-stage AI image production pipeline.
 * This layer owns workflow state; individual job execution is delegated to JobManager.
 */

// ---------------------------------------------------------------------------
// Pipeline Stages (re-exports for convenience)
// ---------------------------------------------------------------------------

export type PipelineStageName =
  | 'BACKGROUND'
  | 'PERSON'
  | 'POSE'
  | 'SEGMENT'
  | 'COMPOSITE'
  | 'QUALITY'
  | 'UPSCALE';

export const STAGE_ORDER: PipelineStageName[] = [
  'BACKGROUND',
  'PERSON',
  'POSE',
  'SEGMENT',
  'COMPOSITE',
  'QUALITY',
  'UPSCALE',
];

// ---------------------------------------------------------------------------
// Workflow States
// ---------------------------------------------------------------------------

export type WorkflowState =
  | 'idle'
  | 'preparing'
  | 'running'
  | 'completed'
  | 'failed'
  | 'cancelled';

// ---------------------------------------------------------------------------
// Machine Context
// ---------------------------------------------------------------------------

export interface PipelineMachineContext {
  /** Current stage being executed */
  currentStage: PipelineStageName | null;
  /** Stages that have completed successfully */
  completedStages: PipelineStageName[];
  /** Overall progress percent (0-100) */
  overallPercent: number;
  /** Number of completed scenes */
  completedScenes: number;
  /** Number of failed scenes */
  failedScenes: number;
  /** Total scenes in batch */
  totalScenes: number;
  /** Elapsed time in ms */
  elapsedTime: number;
  /** Start timestamp */
  startedAt: number | null;
  /** Error that caused failure */
  error: WorkflowError | null;
  /** Whether cancellation was requested */
  cancelRequested: boolean;
}

// ---------------------------------------------------------------------------
// Machine Events
// ---------------------------------------------------------------------------

export type PipelineMachineEvent =
  | { type: 'START'; request: PipelineBatchRequest }
  | { type: 'STAGE_COMPLETE'; stage: PipelineStageName; completedScenes: number; failedScenes: number }
  | { type: 'STAGE_FAILED'; stage: PipelineStageName; error: WorkflowError }
  | { type: 'CANCEL' }
  | { type: 'RESET' };

// ---------------------------------------------------------------------------
// Workflow Error (lightweight, reuses DocuFlowError patterns)
// ---------------------------------------------------------------------------

export interface WorkflowError {
  code: string;
  message: string;
  stage?: PipelineStageName;
  detail?: string;
  timestamp: number;
}

// ---------------------------------------------------------------------------
// Batch Request (minimal — actual scene data stays in the caller)
// ---------------------------------------------------------------------------

export interface PipelineBatchRequest {
  /** Total number of scenes */
  sceneCount: number;
  /** Project name */
  projectName: string;
  /** Stop on first failure */
  stopOnError?: boolean;
}

// ---------------------------------------------------------------------------
// Workflow Snapshot (what external consumers observe)
// ---------------------------------------------------------------------------

export interface PipelineWorkflowSnapshot {
  state: WorkflowState;
  currentStage: PipelineStageName | null;
  completedStages: PipelineStageName[];
  overallPercent: number;
  completedScenes: number;
  failedScenes: number;
  totalScenes: number;
  elapsedTime: number;
  error: WorkflowError | null;
}
