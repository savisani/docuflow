/**
 * AI Pipeline Workflow
 *
 * XState-based workflow orchestration for the 7-stage AI image production pipeline.
 * Separates workflow state (XState) from individual job execution (JobManager).
 */

export { aiPipelineMachine, toWorkflowSnapshot, createPipelineOrchestrator } from './machine';
export type { PipelineOrchestratorDeps } from './machine';
export type {
  PipelineStageName,
  PipelineMachineContext,
  PipelineMachineEvent,
  PipelineBatchRequest,
  PipelineWorkflowSnapshot,
  WorkflowError,
  WorkflowState,
} from './types';
export { STAGE_ORDER } from './types';
