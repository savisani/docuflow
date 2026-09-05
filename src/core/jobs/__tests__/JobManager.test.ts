import { describe, test, expect, vi, beforeEach } from 'vitest';
import { JobManager } from '../JobManager';
import type { JobContext, JobExecutor } from '../types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function wait(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function immediate(): Promise<void> {
  return Promise.resolve();
}

function suppressRejection(promise: Promise<unknown>): void {
  promise.catch(() => {});
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('JobManager', () => {
  let manager: JobManager;

  beforeEach(() => {
    manager = new JobManager();
  });

  // -------------------------------------------------------------------------
  // Basic lifecycle
  // -------------------------------------------------------------------------

  describe('lifecycle', () => {
    test('queued → running → completed', async () => {
      const job = manager.run<string>({
        type: 'test',
        execute: async () => 'hello',
      });

      // Immediately running (startExecution is synchronous before first await)
      expect(job.getState().status).toBe('running');

      const result = await job.promise;

      expect(result).toBe('hello');
      expect(job.getState().status).toBe('completed');
      expect(job.getState().result).toBe('hello');
      expect(job.getState().progress).toBe(1);
      expect(job.getState().completedAt).toBeTypeOf('number');
    });

    test('queued → running → failed', async () => {
      const job = manager.run<string>({
        type: 'test',
        execute: async () => {
          throw new Error('boom');
        },
      });

      suppressRejection(job.promise);

      await expect(job.promise).rejects.toMatchObject({
        message: 'boom',
      });

      expect(job.getState().status).toBe('failed');
      expect(job.getState().error).toBeDefined();
      expect(job.getState().error!.message).toBe('boom');
    });

    test('failed job has DocuFlowError', async () => {
      const job = manager.run<string>({
        type: 'test',
        execute: async () => {
          throw new Error('something broke');
        },
      });

      suppressRejection(job.promise);

      await expect(job.promise).rejects.toThrow();

      const state = job.getState();
      expect(state.status).toBe('failed');
      expect(state.error).toBeDefined();
      expect(state.error!.name).toBe('DocuFlowError');
    });

    test('timestamps are set correctly', async () => {
      const before = Date.now();
      const job = manager.run<string>({
        type: 'test',
        execute: async () => 'done',
      });

      await job.promise;
      const state = job.getState();

      expect(state.createdAt).toBeGreaterThanOrEqual(before);
      expect(state.startedAt).toBeGreaterThanOrEqual(before);
      expect(state.completedAt).toBeGreaterThanOrEqual(state.startedAt!);
    });
  });

  // -------------------------------------------------------------------------
  // Cancellation
  // -------------------------------------------------------------------------

  describe('cancellation', () => {
    test('cancel queued job', async () => {
      const job = manager.run<string>({
        type: 'test',
        execute: async () => 'done',
      });

      job.cancel();

      suppressRejection(job.promise);

      await expect(job.promise).rejects.toMatchObject({
        message: 'Job cancelled',
      });

      expect(job.getState().status).toBe('cancelled');
    });

    test('cancel running job', async () => {
      let resume!: () => void;
      const waiting = new Promise<void>(r => { resume = r; });

      const job = manager.run<string>({
        type: 'test',
        execute: async ({ signal }) => {
          await waiting;
          if (signal.aborted) throw new Error('aborted');
          return 'done';
        },
      });

      suppressRejection(job.promise);

      // Wait for execution to start
      await wait(10);
      expect(job.getState().status).toBe('running');

      job.cancel();
      resume(); // let the executor continue

      await wait(10);

      expect(job.getState().status).toBe('cancelled');
    });

    test('cancel does not affect other jobs', async () => {
      const jobA = manager.run<string>({
        type: 'a',
        execute: async () => 'a',
      });
      const jobB = manager.run<string>({
        type: 'b',
        execute: async () => 'b',
      });
      const jobC = manager.run<string>({
        type: 'c',
        execute: async () => 'c',
      });

      suppressRejection(jobB.promise);

      jobB.cancel();

      const [resultA, resultC] = await Promise.all([jobA.promise, jobC.promise]);

      expect(resultA).toBe('a');
      expect(resultC).toBe('c');
      expect(jobA.getState().status).toBe('completed');
      expect(jobB.getState().status).toBe('cancelled');
      expect(jobC.getState().status).toBe('completed');
    });

    test('cancel returns true for active job', () => {
      const job = manager.run<string>({
        type: 'test',
        execute: async () => 'done',
      });

      suppressRejection(job.promise);
      expect(manager.cancel(job.id)).toBe(true);
    });

    test('cancel returns false for unknown id', () => {
      expect(manager.cancel('nonexistent')).toBe(false);
    });

    test('cancel returns false for completed job', async () => {
      const job = manager.run<string>({
        type: 'test',
        execute: async () => 'done',
      });

      await job.promise;

      expect(manager.cancel(job.id)).toBe(false);
    });

    test('cancel via manager.cancel(id)', async () => {
      const job = manager.run<string>({
        type: 'test',
        execute: async ({ signal }) => {
          await new Promise(resolve => {
            signal.addEventListener('abort', () => resolve(undefined), { once: true });
          });
          throw new Error('should not reach');
        },
      });

      suppressRejection(job.promise);

      manager.cancel(job.id);

      await wait(10);

      expect(job.getState().status).toBe('cancelled');
    });

    test('signal.aborted is true after cancellation', async () => {
      let capturedSignal: AbortSignal | null = null;

      const job = manager.run<string>({
        type: 'test',
        execute: async ({ signal }) => {
          capturedSignal = signal;
          await new Promise(resolve => setTimeout(resolve, 50));
          return 'done';
        },
      });

      suppressRejection(job.promise);

      await wait(5);
      job.cancel();
      await wait(10);

      expect(capturedSignal).not.toBeNull();
      expect(capturedSignal!.aborted).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // Progress
  // -------------------------------------------------------------------------

  describe('progress', () => {
    test('reports progress correctly', async () => {
      let resolveStep!: () => void;
      let stepPromise = new Promise<void>(r => { resolveStep = r; });

      const job = manager.run<number>({
        type: 'test',
        execute: async ({ reportProgress }) => {
          reportProgress(0.25);
          await stepPromise;
          reportProgress(0.5);
          stepPromise = new Promise<void>(r => { resolveStep = r; });
          await stepPromise;
          reportProgress(0.75);
          stepPromise = new Promise<void>(r => { resolveStep = r; });
          await stepPromise;
          reportProgress(1);
          return 42;
        },
      });

      await wait(1);
      expect(job.getState().progress).toBe(0.25);
      resolveStep();
      await wait(1);
      expect(job.getState().progress).toBe(0.5);
      resolveStep();
      await wait(1);
      expect(job.getState().progress).toBe(0.75);
      resolveStep();
      await job.promise;
      expect(job.getState().progress).toBe(1);
    });

    test('clamps progress > 1 to 1', async () => {
      const job = manager.run<number>({
        type: 'test',
        execute: async ({ reportProgress }) => {
          reportProgress(1.5);
          await wait(10);
          return 1;
        },
      });

      await wait(1);
      expect(job.getState().progress).toBe(1);
      await job.promise;
    });

    test('clamps negative progress to 0', async () => {
      const job = manager.run<number>({
        type: 'test',
        execute: async ({ reportProgress }) => {
          reportProgress(-0.5);
          await wait(10);
          return 1;
        },
      });

      await wait(1);
      expect(job.getState().progress).toBe(0);
      await job.promise;
    });

    test('clamps NaN progress to 0', async () => {
      const job = manager.run<number>({
        type: 'test',
        execute: async ({ reportProgress }) => {
          reportProgress(NaN);
          await wait(10);
          return 1;
        },
      });

      await wait(1);
      expect(job.getState().progress).toBe(0);
      await job.promise;
    });

    test('clamps Infinity progress to 0', async () => {
      const job = manager.run<number>({
        type: 'test',
        execute: async ({ reportProgress }) => {
          reportProgress(Infinity);
          await wait(10);
          return 1;
        },
      });

      await wait(1);
      expect(job.getState().progress).toBe(0);
      await job.promise;
    });

    test('jobs without progress stay at 0', async () => {
      const job = manager.run<string>({
        type: 'test',
        execute: async () => 'no progress reported',
      });

      expect(job.getState().progress).toBe(0);
      await job.promise;
      // After completion, progress is set to 1
      expect(job.getState().progress).toBe(1);
    });
  });

  // -------------------------------------------------------------------------
  // Result
  // -------------------------------------------------------------------------

  describe('result', () => {
    test('successful job returns result via promise', async () => {
      const job = manager.run<{ count: number }>({
        type: 'test',
        execute: async () => ({ count: 42 }),
      });

      const result = await job.promise;
      expect(result).toEqual({ count: 42 });
      expect(job.getState().result).toEqual({ count: 42 });
    });

    test('failed job rejects with DocuFlowError', async () => {
      const job = manager.run<string>({
        type: 'test',
        execute: async () => {
          throw new Error('test error');
        },
      });

      suppressRejection(job.promise);

      try {
        await job.promise;
        expect.unreachable('should have thrown');
      } catch (err) {
        expect(err).toMatchObject({
          message: 'test error',
          name: 'DocuFlowError',
        });
      }
    });

    test('cancelled job rejects with cancellation error', async () => {
      const job = manager.run<string>({
        type: 'test',
        execute: async ({ signal }) => {
          await new Promise(resolve => {
            signal.addEventListener('abort', () => resolve(undefined), { once: true });
          });
          return 'done';
        },
      });

      suppressRejection(job.promise);

      job.cancel();

      await expect(job.promise).rejects.toMatchObject({
        message: 'Job cancelled',
      });
    });
  });

  // -------------------------------------------------------------------------
  // Concurrent jobs
  // -------------------------------------------------------------------------

  describe('concurrent jobs', () => {
    test('multiple jobs run independently', async () => {
      const jobA = manager.run<number>({
        type: 'a',
        execute: async () => 1,
      });
      const jobB = manager.run<number>({
        type: 'b',
        execute: async () => 2,
      });
      const jobC = manager.run<number>({
        type: 'c',
        execute: async () => 3,
      });

      const [a, b, c] = await Promise.all([jobA.promise, jobB.promise, jobC.promise]);

      expect(a).toBe(1);
      expect(b).toBe(2);
      expect(c).toBe(3);
    });

    test('concurrent jobs have independent state', async () => {
      const jobA = manager.run<string>({
        type: 'a',
        execute: async () => 'a',
      });
      const jobB = manager.run<string>({
        type: 'b',
        execute: async () => { throw new Error('b failed'); },
      });

      suppressRejection(jobB.promise);

      const [resultA] = await Promise.allSettled([jobA.promise, jobB.promise]);

      expect(resultA.status).toBe('fulfilled');
      expect(jobA.getState().status).toBe('completed');
      expect(jobB.getState().status).toBe('failed');
    });
  });

  // -------------------------------------------------------------------------
  // Job lookup
  // -------------------------------------------------------------------------

  describe('job lookup', () => {
    test('get returns job info by id', async () => {
      const job = manager.run<string>({
        type: 'test',
        execute: async () => 'done',
      });

      const info = manager.get(job.id);
      expect(info).toBeDefined();
      expect(info!.id).toBe(job.id);
      expect(info!.type).toBe('test');
    });

    test('get returns undefined for unknown id', () => {
      expect(manager.get('nonexistent')).toBeUndefined();
    });

    test('getAll returns all jobs', async () => {
      const jobA = manager.run<string>({ type: 'a', execute: async () => 'a' });
      const jobB = manager.run<string>({ type: 'b', execute: async () => 'b' });

      await Promise.all([jobA.promise, jobB.promise]);

      const all = manager.getAll();
      expect(all).toHaveLength(2);
    });

    test('getActive returns only non-terminal jobs', async () => {
      const jobA = manager.run<string>({ type: 'a', execute: async () => 'a' });
      // Long-running job so it stays active
      const jobB = manager.run<string>({
        type: 'b',
        execute: async () => {
          await wait(500);
          return 'b';
        },
      });

      suppressRejection(jobB.promise);

      await jobA.promise;

      const active = manager.getActive();
      expect(active).toHaveLength(1);
      expect(active[0].id).toBe(jobB.id);

      jobB.cancel();
      await wait(10);
    });

    test('size reflects total tracked jobs', async () => {
      expect(manager.size).toBe(0);

      const jobA = manager.run<string>({ type: 'a', execute: async () => 'a' });
      expect(manager.size).toBe(1);

      const jobB = manager.run<string>({ type: 'b', execute: async () => 'b' });
      expect(manager.size).toBe(2);

      await Promise.all([jobA.promise, jobB.promise]);
      expect(manager.size).toBe(2); // terminal jobs still tracked
    });

    test('activeCount tracks active jobs', async () => {
      expect(manager.activeCount).toBe(0);

      const jobA = manager.run<string>({ type: 'a', execute: async () => 'a' });
      expect(manager.activeCount).toBe(1);

      await jobA.promise;
      expect(manager.activeCount).toBe(0);
    });
  });

  // -------------------------------------------------------------------------
  // Cleanup
  // -------------------------------------------------------------------------

  describe('cleanup', () => {
    test('remove deletes terminal job', async () => {
      const job = manager.run<string>({
        type: 'test',
        execute: async () => 'done',
      });

      await job.promise;

      expect(manager.size).toBe(1);
      expect(manager.remove(job.id)).toBe(true);
      expect(manager.size).toBe(0);
      expect(manager.get(job.id)).toBeUndefined();
    });

    test('remove fails for active job', () => {
      const job = manager.run<string>({
        type: 'test',
        execute: async () => 'done',
      });

      expect(manager.remove(job.id)).toBe(false);
      expect(manager.size).toBe(1);
    });

    test('remove fails for unknown id', () => {
      expect(manager.remove('nonexistent')).toBe(false);
    });

    test('dispose cancels all active jobs and clears', async () => {
      const jobA = manager.run<string>({ type: 'a', execute: async () => 'a' });
      const jobB = manager.run<string>({ type: 'b', execute: async () => 'b' });

      suppressRejection(jobA.promise);
      suppressRejection(jobB.promise);

      manager.dispose();

      expect(manager.isDisposed).toBe(true);
      expect(manager.size).toBe(0);

      await wait(10);

      expect(jobA.getState().status).toBe('cancelled');
      expect(jobB.getState().status).toBe('cancelled');
    });

    test('dispose is idempotent', () => {
      manager.dispose();
      manager.dispose(); // should not throw
      expect(manager.isDisposed).toBe(true);
    });

    test('run after dispose returns rejected handle', async () => {
      manager.dispose();

      const job = manager.run<string>({
        type: 'test',
        execute: async () => 'done',
      });

      suppressRejection(job.promise);

      await expect(job.promise).rejects.toMatchObject({
        message: 'JobManager is disposed',
      });

      expect(job.getState().status).toBe('failed');
    });
  });

  // -------------------------------------------------------------------------
  // Terminal state immutability
  // -------------------------------------------------------------------------

  describe('terminal state immutability', () => {
    test('completed job cannot transition to failed', async () => {
      let resolveFn!: (value: string) => void;
      const job = manager.run<string>({
        type: 'test',
        execute: async () => {
          return new Promise<string>(r => { resolveFn = r; });
        },
      });

      resolveFn('done');
      await job.promise;
      expect(job.getState().status).toBe('completed');

      // Try to cancel — should have no effect
      job.cancel();
      expect(job.getState().status).toBe('completed');
    });

    test('failed job cannot transition to completed', async () => {
      const job = manager.run<string>({
        type: 'test',
        execute: async () => {
          throw new Error('fail');
        },
      });

      suppressRejection(job.promise);

      await expect(job.promise).rejects.toThrow();
      expect(job.getState().status).toBe('failed');

      // Cancel should have no effect
      job.cancel();
      expect(job.getState().status).toBe('failed');
    });

    test('cancelled job cannot transition to completed', async () => {
      const job = manager.run<string>({
        type: 'test',
        execute: async ({ signal }) => {
          await new Promise(resolve => {
            signal.addEventListener('abort', () => resolve(undefined), { once: true });
          });
          return 'done';
        },
      });

      suppressRejection(job.promise);
      job.cancel();
      await wait(10);

      expect(job.getState().status).toBe('cancelled');
    });
  });

  // -------------------------------------------------------------------------
  // Error normalization
  // -------------------------------------------------------------------------

  describe('error normalization', () => {
    test('plain Error becomes DocuFlowError', async () => {
      const job = manager.run<string>({
        type: 'test',
        execute: async () => {
          throw new Error('plain error');
        },
      });

      suppressRejection(job.promise);

      await expect(job.promise).rejects.toMatchObject({
        name: 'DocuFlowError',
        message: 'plain error',
      });
    });

    test('string throw becomes DocuFlowError', async () => {
      const job = manager.run<string>({
        type: 'test',
        execute: async () => {
          throw 'string error';
        },
      });

      suppressRejection(job.promise);

      await expect(job.promise).rejects.toMatchObject({
        name: 'DocuFlowError',
      });
    });

    test('DocuFlowError passes through', async () => {
      const job = manager.run<string>({
        type: 'test',
        execute: async () => {
          const err = new Error('original');
          err.name = 'DocuFlowError';
          throw err;
        },
      });

      suppressRejection(job.promise);

      await expect(job.promise).rejects.toMatchObject({
        message: 'original',
      });
    });
  });

  // -------------------------------------------------------------------------
  // Unique IDs
  // -------------------------------------------------------------------------

  describe('unique IDs', () => {
    test('each job gets a unique ID', () => {
      const ids = new Set<string>();
      for (let i = 0; i < 100; i++) {
        const job = manager.run<string>({
          type: 'test',
          execute: async () => 'x',
        });
        ids.add(job.id);
      }
      expect(ids.size).toBe(100);
    });
  });
});
