/**
 * AI Pipeline Workflow Machine
 *
 * XState v5 state machine that orchestrates the 7-stage AI image production pipeline.
 * Owns workflow-level state transitions. Individual job execution delegated to JobManager.
 *
 * Architecture:
 *   UI → XState machine → JobManager.run() → stage executor → IPC / WorkerManager
 */

import { createMachine, createActor, assign } from 'xstate';
import type {
  PipelineMachineContext,
  PipelineMachineEvent,
  PipelineStageName,
  WorkflowError,
  PipelineWorkflowSnapshot,
  PipelineBatchRequest,
} from './types';
import { STAGE_ORDER } from './types';

// ---------------------------------------------------------------------------
// Initial Context
// ---------------------------------------------------------------------------

function createInitialContext(): PipelineMachineContext {
  return {
    currentStage: null,
    completedStages: [],
    overallPercent: 0,
    completedScenes: 0,
    failedScenes: 0,
    totalScenes: 0,
    elapsedTime: 0,
    startedAt: null,
    error: null,
    cancelRequested: false,
  };
}

// ---------------------------------------------------------------------------
// Stage Helpers
// ---------------------------------------------------------------------------

/** Get the next stage in the pipeline order, or null if at the end */
function nextStage(current: PipelineStageName): PipelineStageName | null {
  const idx = STAGE_ORDER.indexOf(current);
  return idx >= 0 && idx < STAGE_ORDER.length - 1 ? STAGE_ORDER[idx + 1] : null;
}

// ---------------------------------------------------------------------------
// Machine Definition
// ---------------------------------------------------------------------------

export const aiPipelineMachine = createMachine({
  id: 'aiPipeline',
  initial: 'idle',
  context: createInitialContext(),

  states: {
    // --- Terminal states ---------------------------------------------------

    completed: {
      type: 'final',
      entry: assign({
        overallPercent: 100,
        elapsedTime: ({ context }) =>
          context.startedAt ? Date.now() - context.startedAt : 0,
      }),
    },

    failed: {
      type: 'final',
      entry: assign({
        elapsedTime: ({ context }) =>
          context.startedAt ? Date.now() - context.startedAt : 0,
      }),
    },

    cancelled: {
      type: 'final',
      entry: assign({
        elapsedTime: ({ context }) =>
          context.startedAt ? Date.now() - context.startedAt : 0,
      }),
    },

    // --- Active states -----------------------------------------------------

    idle: {
      on: {
        START: {
          target: 'preparing',
          guard: 'isNotRunning',
          actions: assign({
            totalScenes: ({ event }) => event.request.sceneCount,
            startedAt: () => Date.now(),
            cancelRequested: () => false,
            error: () => null,
            completedStages: () => [],
            completedScenes: () => 0,
            failedScenes: () => 0,
            overallPercent: () => 0,
          }),
        },
      },
    },

    preparing: {
      entry: assign({ currentStage: () => STAGE_ORDER[0] }),
      always: { target: 'running' },
    },

    running: {
      entry: assign({
        overallPercent: ({ context }) => {
          if (context.totalScenes === 0) return 0;
          return Math.round(
            ((context.completedScenes + context.failedScenes) /
              context.totalScenes) *
              100,
          );
        },
      }),
      on: {
        STAGE_COMPLETE: [
          {
            // Stage done and more stages remain → advance to next stage
            guard: 'hasNextStage',
            actions: assign({
              currentStage: ({ context }) =>
                nextStage(context.currentStage!),
              completedStages: ({ context, event }) => [
                ...context.completedStages,
                event.stage,
              ],
              completedScenes: ({ event }) => event.completedScenes,
              failedScenes: ({ event }) => event.failedScenes,
            }),
          },
          {
            // Stage done and no more stages → completed
            target: 'completed',
            actions: assign({
              completedStages: ({ context, event }) => [
                ...context.completedStages,
                event.stage,
              ],
              completedScenes: ({ event }) => event.completedScenes,
              failedScenes: ({ event }) => event.failedScenes,
            }),
          },
        ],
        STAGE_FAILED: {
          target: 'failed',
          actions: assign({
            error: ({ event }) => event.error,
          }),
        },
        CANCEL: {
          target: 'cancelled',
          actions: assign({ cancelRequested: () => true }),
        },
      },
    },
  },
}, {
  guards: {
    /** Cannot start if already running (not idle) */
    isNotRunning: ({ context }) => context.cancelRequested === false,
    /** Whether there is a next stage after the current one */
    hasNextStage: ({ context }) => {
      const cur = context.currentStage;
      return cur !== null && nextStage(cur) !== null;
    },
  },
});

// ---------------------------------------------------------------------------
// Snapshot Converter
// ---------------------------------------------------------------------------

/**
 * Convert an XState snapshot to a lightweight workflow snapshot
 * that external consumers (UI, store) can observe.
 */
export function toWorkflowSnapshot(
  snapshot: ReturnType<typeof aiPipelineMachine['provide']>,
): PipelineWorkflowSnapshot;
export function toWorkflowSnapshot(snapshot: unknown): PipelineWorkflowSnapshot {
  const s = snapshot as {
    value: string;
    context: PipelineMachineContext;
  };
  return {
    state: s.value as PipelineWorkflowSnapshot['state'],
    currentStage: s.context.currentStage,
    completedStages: [...s.context.completedStages],
    overallPercent: s.context.overallPercent,
    completedScenes: s.context.completedScenes,
    failedScenes: s.context.failedScenes,
    totalScenes: s.context.totalScenes,
    elapsedTime: s.context.elapsedTime,
    error: s.context.error,
  };
}

// ---------------------------------------------------------------------------
// Workflow Orchestrator
// ---------------------------------------------------------------------------

/**
 * Creates and runs a pipeline workflow, bridging XState → JobManager.
 *
 * Usage:
 * ```ts
 * const orchestrator = createPipelineOrchestrator({
 *   executeStage: async (stage, signal) => { ... },
 *   onProgress: (snapshot) => { ... },
 * });
 * await orchestrator.start(request);
 * orchestrator.cancel();
 * ```
 */
export interface PipelineOrchestratorDeps {
  /** Execute a single pipeline stage. Returns { completedScenes, failedScenes } or throws. */
  executeStage: (
    stage: PipelineStageName,
    signal: AbortSignal,
  ) => Promise<{ completedScenes: number; failedScenes: number }>;
  /** Called whenever the workflow snapshot changes */
  onProgress?: (snapshot: PipelineWorkflowSnapshot) => void;
  /** Called when workflow reaches a terminal state */
  onComplete?: (snapshot: PipelineWorkflowSnapshot) => void;
}

export function createPipelineOrchestrator(
  deps: PipelineOrchestratorDeps,
) {
  const { executeStage, onProgress, onComplete } = deps;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let actor: any = null;
  let abortController: AbortController | null = null;

  function emit() {
    if (!actor) return;
    const snapshot = toWorkflowSnapshot(actor.getSnapshot());
    onProgress?.(snapshot);
  }

  function handleTerminal() {
    if (!actor) return;
    const snapshot = toWorkflowSnapshot(actor.getSnapshot());
    onComplete?.(snapshot);
  }

  async function runStageLoop() {
    if (!actor) return;

    while (true) {
      const snapshot = actor.getSnapshot();

      // Only run stages when in 'running' state
      if (snapshot.value !== 'running') {
        if (
          snapshot.value === 'completed' ||
          snapshot.value === 'failed' ||
          snapshot.value === 'cancelled'
        ) {
          handleTerminal();
        }
        return;
      }

      const stage = snapshot.context.currentStage;
      if (!stage) {
        actor.send({ type: 'STAGE_COMPLETE', stage: 'BACKGROUND', completedScenes: 0, failedScenes: 0 });
        continue;
      }

      if (!abortController || abortController.signal.aborted) return;

      try {
        const result = await executeStage(stage, abortController.signal);

        // Check if cancelled during execution
        if (!actor || actor.getSnapshot().value === 'cancelled') {
          return;
        }

        actor.send({
          type: 'STAGE_COMPLETE',
          stage,
          completedScenes: result.completedScenes,
          failedScenes: result.failedScenes,
        });

        emit();
      } catch (err) {
        // Check if cancelled during execution
        if (!actor || actor.getSnapshot().value === 'cancelled') {
          return;
        }

        const error: WorkflowError = {
          code: err instanceof Error ? err.name : 'UNKNOWN',
          message: err instanceof Error ? err.message : String(err),
          stage,
          timestamp: Date.now(),
        };

        actor.send({ type: 'STAGE_FAILED', stage, error });
        emit();
        return;
      }
    }
  }

  return {
    /** Start the workflow */
    start(request: PipelineBatchRequest) {
      actor = createActor(aiPipelineMachine);
      abortController = new AbortController();

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      actor.subscribe((snapshot: any) => {
        onProgress?.(toWorkflowSnapshot(snapshot));
      });

      actor.start();
      actor.send({ type: 'START', request });

      // Begin stage loop
      runStageLoop();

      return actor.getSnapshot().context;
    },

    /** Cancel the workflow */
    cancel() {
      abortController?.abort();
      if (actor && actor.getSnapshot().value !== 'cancelled') {
        actor.send({ type: 'CANCEL' });
        emit();
      }
    },

    /** Get current snapshot */
    getSnapshot(): PipelineWorkflowSnapshot | null {
      return actor ? toWorkflowSnapshot(actor.getSnapshot()) : null;
    },

    /** Stop the actor */
    stop() {
      abortController?.abort();
      actor?.stop();
      actor = null;
      abortController = null;
    },
  };
}
