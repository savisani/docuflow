import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import { WorkerManager } from '../core/workerManager';
import type { WorkerResponse } from '../core/types';

// ---------------------------------------------------------------------------
// Mock Worker
// ---------------------------------------------------------------------------

class MockWorker {
  static instances: MockWorker[] = [];
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  terminated = false;
  postedMessages: { message: unknown; transfer?: Transferable[] }[] = [];

  constructor() {
    MockWorker.instances.push(this);
  }

  postMessage(message: unknown, transfer?: Transferable[]): void {
    this.postedMessages.push({ message, transfer });
  }

  terminate(): void {
    this.terminated = true;
  }

  /** Simulate a response from the "worker" */
  simulateResponse(response: WorkerResponse): void {
    this.onmessage?.({ data: response } as MessageEvent);
  }

  /** Simulate a worker-level error */
  simulateError(message: string): void {
    this.onerror?.({ message } as ErrorEvent);
  }
}

// Replace the global Worker with our mock
const OriginalWorker = globalThis.Worker;

beforeEach(() => {
  MockWorker.instances = [];
  (globalThis as any).Worker = MockWorker;
});

afterEach(() => {
  (globalThis as any).Worker = OriginalWorker;
});

// Helper: suppress unhandled rejection warnings from intentionally rejected promises
function suppressRejection(promise: Promise<unknown>): void {
  promise.catch(() => {});
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('WorkerManager', () => {
  function createManager(): { manager: WorkerManager; worker: MockWorker } {
    const url = new URL('data:text/javascript,');
    const manager = new WorkerManager(url);
    const worker = MockWorker.instances[0];
    return { manager, worker };
  }

  describe('successful request', () => {
    test('correlates response by requestId', async () => {
      const { manager, worker } = createManager();

      const job = manager.run<string, string>({
        type: 'test',
        payload: 'hello',
      });

      expect(worker.postedMessages).toHaveLength(1);
      const posted = worker.postedMessages[0].message as any;
      expect(posted.type).toBe('test');
      expect(posted.requestId).toBeDefined();
      expect(posted.payload).toBe('hello');

      worker.simulateResponse({
        requestId: posted.requestId,
        type: 'success',
        result: 'world',
      });

      const result = await job.promise;
      expect(result).toBe('world');

      manager.terminate();
    });

    test('handles multiple concurrent requests', async () => {
      const { manager, worker } = createManager();

      const job1 = manager.run<string, string>({ type: 'a', payload: '1' });
      const job2 = manager.run<string, string>({ type: 'b', payload: '2' });

      expect(worker.postedMessages).toHaveLength(2);
      const msg1 = worker.postedMessages[0].message as any;
      const msg2 = worker.postedMessages[1].message as any;

      worker.simulateResponse({ requestId: msg2.requestId, type: 'success', result: 'result-2' });
      worker.simulateResponse({ requestId: msg1.requestId, type: 'success', result: 'result-1' });

      const [r1, r2] = await Promise.all([job1.promise, job2.promise]);
      expect(r1).toBe('result-1');
      expect(r2).toBe('result-2');

      manager.terminate();
    });
  });

  describe('error handling', () => {
    test('rejects promise on error response', async () => {
      const { manager, worker } = createManager();

      const job = manager.run<string, string>({ type: 'test', payload: 'x' });
      const msg = worker.postedMessages[0].message as any;

      worker.simulateResponse({
        requestId: msg.requestId,
        type: 'error',
        error: {
          name: 'DocuFlowError',
          message: 'something failed',
          code: 'WORKER',
          timestamp: Date.now(),
        },
      });

      await expect(job.promise).rejects.toMatchObject({
        message: 'something failed',
      });

      manager.terminate();
    });

    test('rejects all pending on worker error', async () => {
      const { manager, worker } = createManager();

      const job1 = manager.run<string, string>({ type: 'a', payload: '1' });
      const job2 = manager.run<string, string>({ type: 'b', payload: '2' });

      worker.simulateError('fatal error');

      await expect(job1.promise).rejects.toMatchObject({
        message: 'fatal error',
      });
      await expect(job2.promise).rejects.toMatchObject({
        message: 'fatal error',
      });

      manager.terminate();
    });
  });

  describe('cancellation', () => {
    test('cancel() rejects the promise', async () => {
      const { manager, worker } = createManager();

      const job = manager.run<string, string>({ type: 'test', payload: 'x' });
      suppressRejection(job.promise);

      job.cancel();

      await expect(job.promise).rejects.toMatchObject({
        message: 'Worker task cancelled',
      });

      manager.terminate();
    });

    test('cancel removes pending request', () => {
      const { manager } = createManager();

      const job = manager.run<string, string>({ type: 'test', payload: 'x' });
      suppressRejection(job.promise);
      expect(manager.pendingCount).toBe(1);

      job.cancel();
      expect(manager.pendingCount).toBe(0);

      manager.terminate();
    });

    test('external AbortSignal cancels the request', async () => {
      const { manager } = createManager();
      const controller = new AbortController();

      const job = manager.run<string, string>({
        type: 'test',
        payload: 'x',
        signal: controller.signal,
      });
      suppressRejection(job.promise);

      controller.abort();

      await expect(job.promise).rejects.toMatchObject({
        message: 'Worker task cancelled',
      });

      manager.terminate();
    });
  });

  describe('lifecycle', () => {
    test('terminate() rejects all pending requests', async () => {
      const { manager } = createManager();

      const job1 = manager.run<string, string>({ type: 'a', payload: '1' });
      const job2 = manager.run<string, string>({ type: 'b', payload: '2' });
      suppressRejection(job1.promise);
      suppressRejection(job2.promise);

      manager.terminate();

      await expect(job1.promise).rejects.toMatchObject({
        message: 'Worker terminated',
      });
      await expect(job2.promise).rejects.toMatchObject({
        message: 'Worker terminated',
      });
    });

    test('terminate() is idempotent', () => {
      const { manager } = createManager();
      manager.terminate();
      manager.terminate();
      expect(manager.isTerminated).toBe(true);
    });

    test('run() after terminate() rejects immediately', async () => {
      const { manager } = createManager();
      manager.terminate();

      const job = manager.run<string, string>({ type: 'test', payload: 'x' });
      suppressRejection(job.promise);
      await expect(job.promise).rejects.toMatchObject({
        message: 'Worker is terminated',
      });
    });

    test('pendingCount tracks active requests', () => {
      const { manager } = createManager();

      expect(manager.pendingCount).toBe(0);

      const job1 = manager.run<string, string>({ type: 'a', payload: '1' });
      suppressRejection(job1.promise);
      expect(manager.pendingCount).toBe(1);

      const job2 = manager.run<string, string>({ type: 'b', payload: '2' });
      suppressRejection(job2.promise);
      expect(manager.pendingCount).toBe(2);

      job1.cancel();
      expect(manager.pendingCount).toBe(1);

      manager.terminate();
    });

    test('completed request is removed from pending', async () => {
      const { manager, worker } = createManager();

      const job = manager.run<string, string>({ type: 'test', payload: 'x' });
      expect(manager.pendingCount).toBe(1);

      const msg = worker.postedMessages[0].message as any;
      worker.simulateResponse({
        requestId: msg.requestId,
        type: 'success',
        result: 'done',
      });

      await job.promise;
      expect(manager.pendingCount).toBe(0);

      manager.terminate();
    });
  });

  describe('transfer', () => {
    test('passes transfer list to postMessage', () => {
      const { manager, worker } = createManager();

      const buffer = new ArrayBuffer(1024);
      const arr = new Float32Array(buffer);

      const job = manager.run<Float32Array, unknown>({
        type: 'test',
        payload: arr,
        transfer: [buffer],
      });
      suppressRejection(job.promise);

      expect(worker.postedMessages[0].transfer).toEqual([buffer]);

      manager.terminate();
    });
  });

  describe('onProgress', () => {
    test('calls onProgress callback', async () => {
      const { manager, worker } = createManager();
      const progressFn = vi.fn();

      const job = manager.run<string, string>({
        type: 'test',
        payload: 'x',
        onProgress: progressFn,
      });

      const msg = worker.postedMessages[0].message as any;

      worker.simulateResponse({
        requestId: msg.requestId,
        type: 'progress',
        progress: 0.5,
      });

      worker.simulateResponse({
        requestId: msg.requestId,
        type: 'success',
        result: 'done',
      });

      await job.promise;
      expect(progressFn).toHaveBeenCalledWith(0.5);

      manager.terminate();
    });
  });
});
