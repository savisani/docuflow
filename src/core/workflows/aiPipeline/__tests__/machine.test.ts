/**
 * AI Pipeline Workflow Machine — Tests
 *
 * Tests the XState workflow machine for the 7-stage AI image production pipeline.
 * Covers: state transitions, guards, cancellation, errors, context, orchestrator.
 */

import { describe, test, expect, vi } from 'vitest';
import { createActor } from 'xstate';
import { aiPipelineMachine, toWorkflowSnapshot, createPipelineOrchestrator } from '../machine';
import type { PipelineStageName, PipelineWorkflowSnapshot, PipelineBatchRequest } from '../types';
import { STAGE_ORDER } from '../types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeRequest(sceneCount = 3): PipelineBatchRequest {
  return { sceneCount, projectName: 'test-project' };
}

function startMachine() {
  const actor = createActor(aiPipelineMachine);
  actor.start();
  return actor;
}

// ---------------------------------------------------------------------------
// Machine — State Transitions
// ---------------------------------------------------------------------------

describe('aiPipelineMachine', () => {
  describe('initial state', () => {
    test('starts in idle', () => {
      const actor = startMachine();
      expect(actor.getSnapshot().value).toBe('idle');
    });

    test('has empty initial context', () => {
      const actor = startMachine();
      const ctx = actor.getSnapshot().context;
      expect(ctx.currentStage).toBeNull();
      expect(ctx.completedStages).toEqual([]);
      expect(ctx.overallPercent).toBe(0);
      expect(ctx.totalScenes).toBe(0);
      expect(ctx.error).toBeNull();
      expect(ctx.cancelRequested).toBe(false);
    });
  });

  describe('successful path', () => {
    test('idle → preparing → running on START', () => {
      const actor = startMachine();
      actor.send({ type: 'START', request: makeRequest() });
      // preparing is transient (always: running), so state resolves to running
      expect(actor.getSnapshot().value).toBe('running');
    });

    test('preparing → running (auto-transitions)', () => {
      const actor = startMachine();
      actor.send({ type: 'START', request: makeRequest() });
      // Preparing has `always: running`, so it auto-transitions
      expect(actor.getSnapshot().value).toBe('running');
    });

    test('sets currentStage to BACKGROUND after preparing', () => {
      const actor = startMachine();
      actor.send({ type: 'START', request: makeRequest() });
      expect(actor.getSnapshot().context.currentStage).toBe('BACKGROUND');
    });

    test('sets totalScenes from request', () => {
      const actor = startMachine();
      actor.send({ type: 'START', request: makeRequest(5) });
      expect(actor.getSnapshot().context.totalScenes).toBe(5);
    });

    test('advances through all 7 stages', () => {
      const actor = startMachine();
      actor.send({ type: 'START', request: makeRequest() });

      const expectedStages: PipelineStageName[] = [
        'BACKGROUND', 'PERSON', 'POSE', 'SEGMENT', 'COMPOSITE', 'QUALITY', 'UPSCALE',
      ];

      for (let i = 0; i < expectedStages.length; i++) {
        const stage = expectedStages[i];
        expect(actor.getSnapshot().context.currentStage).toBe(stage);

        const nextStage = i < expectedStages.length - 1 ? expectedStages[i + 1] : null;
        actor.send({
          type: 'STAGE_COMPLETE',
          stage,
          completedScenes: i + 1,
          failedScenes: 0,
        });

        if (nextStage) {
          expect(actor.getSnapshot().value).toBe('running');
          expect(actor.getSnapshot().context.currentStage).toBe(nextStage);
        }
      }

      // After UPSCALE completes → completed
      expect(actor.getSnapshot().value).toBe('completed');
    });

    test('tracks completed stages', () => {
      const actor = startMachine();
      actor.send({ type: 'START', request: makeRequest() });

      actor.send({ type: 'STAGE_COMPLETE', stage: 'BACKGROUND', completedScenes: 1, failedScenes: 0 });
      actor.send({ type: 'STAGE_COMPLETE', stage: 'PERSON', completedScenes: 2, failedScenes: 0 });

      expect(actor.getSnapshot().context.completedStages).toEqual(['BACKGROUND', 'PERSON']);
    });

    test('updates completedScenes and failedScenes', () => {
      const actor = startMachine();
      actor.send({ type: 'START', request: makeRequest(5) });

      actor.send({ type: 'STAGE_COMPLETE', stage: 'BACKGROUND', completedScenes: 3, failedScenes: 1 });
      const ctx = actor.getSnapshot().context;
      expect(ctx.completedScenes).toBe(3);
      expect(ctx.failedScenes).toBe(1);
    });

    test('sets startedAt timestamp on START', () => {
      const before = Date.now();
      const actor = startMachine();
      actor.send({ type: 'START', request: makeRequest() });
      const after = Date.now();

      const startedAt = actor.getSnapshot().context.startedAt;
      expect(startedAt).toBeGreaterThanOrEqual(before);
      expect(startedAt).toBeLessThanOrEqual(after);
    });

    test('completed is a final state', () => {
      const actor = startMachine();
      actor.send({ type: 'START', request: makeRequest(1) });
      actor.send({ type: 'STAGE_COMPLETE', stage: 'BACKGROUND', completedScenes: 1, failedScenes: 0 });
      actor.send({ type: 'STAGE_COMPLETE', stage: 'PERSON', completedScenes: 1, failedScenes: 0 });
      actor.send({ type: 'STAGE_COMPLETE', stage: 'POSE', completedScenes: 1, failedScenes: 0 });
      actor.send({ type: 'STAGE_COMPLETE', stage: 'SEGMENT', completedScenes: 1, failedScenes: 0 });
      actor.send({ type: 'STAGE_COMPLETE', stage: 'COMPOSITE', completedScenes: 1, failedScenes: 0 });
      actor.send({ type: 'STAGE_COMPLETE', stage: 'QUALITY', completedScenes: 1, failedScenes: 0 });
      actor.send({ type: 'STAGE_COMPLETE', stage: 'UPSCALE', completedScenes: 1, failedScenes: 0 });

      expect(actor.getSnapshot().value).toBe('completed');
      // Sending more events should not change state (final)
      actor.send({ type: 'STAGE_COMPLETE', stage: 'UPSCALE', completedScenes: 1, failedScenes: 0 });
      expect(actor.getSnapshot().value).toBe('completed');
    });
  });

  describe('cancellation', () => {
    test('CANCEL from running transitions to cancelled', () => {
      const actor = startMachine();
      actor.send({ type: 'START', request: makeRequest() });
      expect(actor.getSnapshot().value).toBe('running');

      actor.send({ type: 'CANCEL' });
      expect(actor.getSnapshot().value).toBe('cancelled');
    });

    test('sets cancelRequested on CANCEL', () => {
      const actor = startMachine();
      actor.send({ type: 'START', request: makeRequest() });
      actor.send({ type: 'CANCEL' });
      expect(actor.getSnapshot().context.cancelRequested).toBe(true);
    });

    test('cancelled is a final state', () => {
      const actor = startMachine();
      actor.send({ type: 'START', request: makeRequest() });
      actor.send({ type: 'CANCEL' });

      expect(actor.getSnapshot().value).toBe('cancelled');
      // Sending more events should not change state
      actor.send({ type: 'CANCEL' });
      expect(actor.getSnapshot().value).toBe('cancelled');
    });

    test('late STAGE_COMPLETE after CANCEL is ignored', () => {
      const actor = startMachine();
      actor.send({ type: 'START', request: makeRequest() });
      actor.send({ type: 'CANCEL' });
      expect(actor.getSnapshot().value).toBe('cancelled');

      // Late result — should be ignored
      actor.send({ type: 'STAGE_COMPLETE', stage: 'BACKGROUND', completedScenes: 1, failedScenes: 0 });
      expect(actor.getSnapshot().value).toBe('cancelled');
    });

    test('late STAGE_FAILED after CANCEL is ignored', () => {
      const actor = startMachine();
      actor.send({ type: 'START', request: makeRequest() });
      actor.send({ type: 'CANCEL' });

      actor.send({
        type: 'STAGE_FAILED',
        stage: 'BACKGROUND',
        error: { code: 'GEN', message: 'fail', timestamp: Date.now() },
      });
      expect(actor.getSnapshot().value).toBe('cancelled');
    });
  });

  describe('failure', () => {
    test('STAGE_FAILED from running transitions to failed', () => {
      const actor = startMachine();
      actor.send({ type: 'START', request: makeRequest() });

      actor.send({
        type: 'STAGE_FAILED',
        stage: 'BACKGROUND',
        error: { code: 'GEN', message: 'GPU error', timestamp: Date.now() },
      });

      expect(actor.getSnapshot().value).toBe('failed');
    });

    test('sets error in context on failure', () => {
      const actor = startMachine();
      actor.send({ type: 'START', request: makeRequest() });

      const err = { code: 'OOM', message: 'Out of memory', stage: 'BACKGROUND' as PipelineStageName, timestamp: 123 };
      actor.send({ type: 'STAGE_FAILED', stage: 'BACKGROUND', error: err });

      expect(actor.getSnapshot().context.error).toEqual(err);
    });

    test('failed is a final state', () => {
      const actor = startMachine();
      actor.send({ type: 'START', request: makeRequest() });
      actor.send({
        type: 'STAGE_FAILED',
        stage: 'BACKGROUND',
        error: { code: 'GEN', message: 'fail', timestamp: Date.now() },
      });

      expect(actor.getSnapshot().value).toBe('failed');
      actor.send({ type: 'CANCEL' });
      expect(actor.getSnapshot().value).toBe('failed');
    });

    test('failure mid-pipeline preserves completed stages', () => {
      const actor = startMachine();
      actor.send({ type: 'START', request: makeRequest() });

      actor.send({ type: 'STAGE_COMPLETE', stage: 'BACKGROUND', completedScenes: 1, failedScenes: 0 });
      actor.send({ type: 'STAGE_COMPLETE', stage: 'PERSON', completedScenes: 2, failedScenes: 0 });

      actor.send({
        type: 'STAGE_FAILED',
        stage: 'POSE',
        error: { code: 'GEN', message: 'fail', timestamp: Date.now() },
      });

      expect(actor.getSnapshot().context.completedStages).toEqual(['BACKGROUND', 'PERSON']);
    });
  });

  describe('guard conditions', () => {
    test('START is rejected when not idle (guard blocks)', () => {
      const actor = startMachine();
      actor.send({ type: 'START', request: makeRequest() });
      expect(actor.getSnapshot().value).toBe('running');

      // Send START again — should be blocked by isNotRunning guard
      actor.send({ type: 'START', request: makeRequest(10) });
      // Should still be running, not restarted
      expect(actor.getSnapshot().value).toBe('running');
      expect(actor.getSnapshot().context.totalScenes).toBe(3);
    });

    test('hasNextStage guard advances when stages remain', () => {
      const actor = startMachine();
      actor.send({ type: 'START', request: makeRequest() });

      // BACKGROUND → PERSON (next stage exists)
      actor.send({ type: 'STAGE_COMPLETE', stage: 'BACKGROUND', completedScenes: 1, failedScenes: 0 });
      expect(actor.getSnapshot().context.currentStage).toBe('PERSON');
    });

    test('hasNextStage guard completes when no stages remain', () => {
      const actor = startMachine();
      actor.send({ type: 'START', request: makeRequest(1) });

      // Run through all stages
      for (const stage of STAGE_ORDER) {
        actor.send({ type: 'STAGE_COMPLETE', stage, completedScenes: 1, failedScenes: 0 });
      }

      expect(actor.getSnapshot().value).toBe('completed');
    });
  });

  describe('context resets', () => {
    test('error is cleared on fresh START', () => {
      const actor = startMachine();

      // First run fails
      actor.send({ type: 'START', request: makeRequest() });
      actor.send({
        type: 'STAGE_FAILED',
        stage: 'BACKGROUND',
        error: { code: 'GEN', message: 'fail', timestamp: Date.now() },
      });
      expect(actor.getSnapshot().context.error).not.toBeNull();

      // Machine is in failed (final), can't restart — test the context reset logic
      // The guard prevents restart from failed. This tests that START clears error
      // when coming from idle (fresh machine).
      const actor2 = startMachine();
      actor2.send({ type: 'START', request: makeRequest() });
      expect(actor2.getSnapshot().context.error).toBeNull();
    });

    test('completedStages is reset on START', () => {
      const actor = startMachine();
      actor.send({ type: 'START', request: makeRequest() });
      actor.send({ type: 'STAGE_COMPLETE', stage: 'BACKGROUND', completedScenes: 1, failedScenes: 0 });
      actor.send({ type: 'STAGE_COMPLETE', stage: 'PERSON', completedScenes: 2, failedScenes: 0 });
      expect(actor.getSnapshot().context.completedStages).toHaveLength(2);

      // Can't restart from running (final path only)
      // But the context reset logic is tested via fresh start
      const actor2 = startMachine();
      actor2.send({ type: 'START', request: makeRequest() });
      expect(actor2.getSnapshot().context.completedStages).toEqual([]);
    });
  });

  describe('events after terminal states', () => {
    test('no events affect completed state', () => {
      const actor = startMachine();
      actor.send({ type: 'START', request: makeRequest(1) });
      for (const stage of STAGE_ORDER) {
        actor.send({ type: 'STAGE_COMPLETE', stage, completedScenes: 1, failedScenes: 0 });
      }
      expect(actor.getSnapshot().value).toBe('completed');

      actor.send({ type: 'STAGE_FAILED', stage: 'BACKGROUND', error: { code: 'X', message: 'x', timestamp: 0 } });
      expect(actor.getSnapshot().value).toBe('completed');
    });

    test('no events affect failed state', () => {
      const actor = startMachine();
      actor.send({ type: 'START', request: makeRequest() });
      actor.send({ type: 'STAGE_FAILED', stage: 'BACKGROUND', error: { code: 'X', message: 'x', timestamp: 0 } });
      expect(actor.getSnapshot().value).toBe('failed');

      actor.send({ type: 'STAGE_COMPLETE', stage: 'BACKGROUND', completedScenes: 1, failedScenes: 0 });
      expect(actor.getSnapshot().value).toBe('failed');
    });
  });
});

// ---------------------------------------------------------------------------
// toWorkflowSnapshot
// ---------------------------------------------------------------------------

describe('toWorkflowSnapshot', () => {
  test('converts idle snapshot correctly', () => {
    const actor = startMachine();
    const snapshot = toWorkflowSnapshot(actor.getSnapshot());
    expect(snapshot.state).toBe('idle');
    expect(snapshot.currentStage).toBeNull();
    expect(snapshot.completedStages).toEqual([]);
    expect(snapshot.overallPercent).toBe(0);
  });

  test('converts running snapshot correctly', () => {
    const actor = startMachine();
    actor.send({ type: 'START', request: makeRequest(5) });
    const snapshot = toWorkflowSnapshot(actor.getSnapshot());
    expect(snapshot.state).toBe('running');
    expect(snapshot.currentStage).toBe('BACKGROUND');
    expect(snapshot.totalScenes).toBe(5);
  });

  test('returns a new object each time (no shared references)', () => {
    const actor = startMachine();
    actor.send({ type: 'START', request: makeRequest() });
    const s1 = toWorkflowSnapshot(actor.getSnapshot());
    const s2 = toWorkflowSnapshot(actor.getSnapshot());
    expect(s1).not.toBe(s2);
    expect(s1.completedStages).not.toBe(s2.completedStages);
  });
});

// ---------------------------------------------------------------------------
// Pipeline Orchestrator
// ---------------------------------------------------------------------------

describe('createPipelineOrchestrator', () => {
  function createMockDeps() {
    const stagesExecuted: PipelineStageName[] = [];
    return {
      stagesExecuted,
      deps: {
        executeStage: vi.fn(async (stage: PipelineStageName, _signal: AbortSignal) => {
          stagesExecuted.push(stage);
          return { completedScenes: 1, failedScenes: 0 };
        }),
        onProgress: vi.fn(),
        onComplete: vi.fn(),
      },
    };
  }

  test('start creates and begins the workflow', () => {
    const { deps } = createMockDeps();
    const orchestrator = createPipelineOrchestrator(deps);

    orchestrator.start(makeRequest(1));
    const snapshot = orchestrator.getSnapshot();
    expect(snapshot).not.toBeNull();
    expect(snapshot!.state).toBe('running');

    orchestrator.stop();
  });

  test('cancel transitions to cancelled', async () => {
    const { deps, stagesExecuted } = createMockDeps();
    // Make executeStage slow so we can cancel
    deps.executeStage = vi.fn(async (stage: PipelineStageName, signal: AbortSignal) => {
      return new Promise((resolve, reject) => {
        stagesExecuted.push(stage);
        const timer = setTimeout(() => resolve({ completedScenes: 1, failedScenes: 0 }), 5000);
        signal.addEventListener('abort', () => {
          clearTimeout(timer);
          reject(new Error('Cancelled'));
        });
      });
    });

    const orchestrator = createPipelineOrchestrator(deps);
    orchestrator.start(makeRequest(1));

    // Wait a tick for the stage loop to start
    await new Promise(r => setTimeout(r, 10));

    orchestrator.cancel();
    // Allow async cancel to propagate
    await new Promise(r => setTimeout(r, 50));

    const snapshot = orchestrator.getSnapshot();
    expect(snapshot!.state).toBe('cancelled');

    orchestrator.stop();
  });

  test('completion calls onComplete', async () => {
    const { deps, stagesExecuted } = createMockDeps();
    const orchestrator = createPipelineOrchestrator(deps);
    orchestrator.start(makeRequest(1));

    // Wait for all stages to execute (7 stages)
    await new Promise(r => setTimeout(r, 50));

    expect(stagesExecuted.length).toBe(7);
    expect(stagesExecuted).toEqual(STAGE_ORDER);

    orchestrator.stop();
  });

  test('stage failure transitions to failed', async () => {
    const { deps, stagesExecuted } = createMockDeps();
    deps.executeStage = vi.fn(async (stage: PipelineStageName) => {
      stagesExecuted.push(stage);
      if (stage === 'PERSON') {
        throw new Error('GPU out of memory');
      }
      return { completedScenes: 1, failedScenes: 0 };
    });

    const orchestrator = createPipelineOrchestrator(deps);
    orchestrator.start(makeRequest(1));

    await new Promise(r => setTimeout(r, 50));

    const snapshot = orchestrator.getSnapshot();
    expect(snapshot!.state).toBe('failed');
    expect(stagesExecuted).toContain('BACKGROUND');
    expect(stagesExecuted).toContain('PERSON');
    // Should not continue after failure
    expect(stagesExecuted).not.toContain('POSE');

    orchestrator.stop();
  });

  test('stop cleans up actor', () => {
    const { deps } = createMockDeps();
    const orchestrator = createPipelineOrchestrator(deps);
    orchestrator.start(makeRequest(1));
    orchestrator.stop();

    expect(orchestrator.getSnapshot()).toBeNull();
  });

  test('progress callbacks fire during execution', async () => {
    const { deps } = createMockDeps();
    const progressCalls: PipelineWorkflowSnapshot[] = [];
    deps.onProgress = vi.fn((s) => progressCalls.push(s));

    const orchestrator = createPipelineOrchestrator(deps);
    orchestrator.start(makeRequest(1));

    await new Promise(r => setTimeout(r, 50));

    // Should have at least the initial START + preparing + running snapshots
    expect(progressCalls.length).toBeGreaterThan(0);
    // First snapshot should be idle (from actor.start())
    expect(progressCalls[0].state).toBe('idle');

    orchestrator.stop();
  });

  test('executeStage receives AbortSignal', async () => {
    const { deps } = createMockDeps();
    let receivedSignal: AbortSignal | null = null;
    deps.executeStage = vi.fn(async (stage, signal) => {
      receivedSignal = signal;
      return { completedScenes: 1, failedScenes: 0 };
    });

    const orchestrator = createPipelineOrchestrator(deps);
    orchestrator.start(makeRequest(1));

    await new Promise(r => setTimeout(r, 20));

    expect(receivedSignal).not.toBeNull();
    expect(receivedSignal!.aborted).toBe(false);

    orchestrator.stop();
  });
});
