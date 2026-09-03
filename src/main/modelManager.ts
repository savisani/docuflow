/**
 * Model Manager Runner
 *
 * Runs in the Electron main process. Manages the persistent Python worker
 * that keeps exactly ONE diffusion model on CUDA at any time.
 *
 * Enforces GPU exclusivity via mutex. Supports batch and manual modes.
 */

import { spawn, ChildProcess } from 'child_process';
import { existsSync } from 'fs';
import { join } from 'path';
import { BrowserWindow } from 'electron';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ModelState = 'idle' | 'loading' | 'loaded' | 'generating' | 'unloading' | 'error';
export type ExecutionMode = 'manual' | 'batch';

export interface VRAMSnapshot {
  cuda: boolean;
  label?: string;
  total_vram_gb: number;
  allocated_vram_gb: number;
  reserved_vram_gb: number;
  free_vram_gb: number;
}

export interface ModelManagerResult {
  success: boolean;
  error?: string;
  model?: string;
  action?: string;
  vram?: VRAMSnapshot;
  load_time_s?: number;
  generation_time_s?: number;
  path?: string;
  [key: string]: any;
}

// ---------------------------------------------------------------------------
// ModelManagerRunner
// ---------------------------------------------------------------------------

export class ModelManagerRunner {
  private worker: ChildProcess | null = null;
  private requestCounter = 0;
  private pendingRequests: Map<number, {
    resolve: (result: ModelManagerResult) => void;
    reject: (error: Error) => void;
  }> = new Map();

  // State
  private _state: ModelState = 'idle';
  private _activeModel: string | null = null;
  private _executionMode: ExecutionMode = 'manual';
  private _batchActive = false;
  private _gpuMutexLocked = false;
  private _gpuMutexQueue: Array<() => void> = [];
  private _shuttingDown = false;
  private _workerPid: number | null = null;

  // Window reference for sending events
  private _window: BrowserWindow | null = null;

  // Paths
  private readonly PYTHON_PATH: string;
  private readonly SCRIPT_PATH: string;

  constructor(basePath: string) {
    this.PYTHON_PATH = join(basePath, '.venv', 'Scripts', 'python.exe');
    this.SCRIPT_PATH = join(basePath, 'model_manager.py');
  }

  /** Set the BrowserWindow for sending progress events */
  setWindow(win: BrowserWindow): void {
    this._window = win;
  }

  /** Get current state */
  get state(): ModelState { return this._state; }
  get activeModel(): string | null { return this._activeModel; }
  get executionMode(): ExecutionMode { return this._executionMode; }
  get isBatchActive(): boolean { return this._batchActive; }
  get workerPid(): number | null { return this._workerPid; }

  // -------------------------------------------------------------------------
  // Public API
  // -------------------------------------------------------------------------

  /**
   * Load a model onto CUDA.
   * If a different model is loaded, unloads it first (atomic under mutex).
   */
  async loadModel(modelPath: string): Promise<ModelManagerResult> {
    return this._withGPUMutex(async () => {
      this._setState('loading', modelPath);

      const result = await this._sendCommand({
        command: 'load',
        model_path: modelPath,
      });

      if (result.success) {
        this._activeModel = modelPath;
        this._setState('loaded', modelPath);
      } else {
        this._setState('error', null);
      }

      return result;
    });
  }

  /**
   * Explicitly unload the current model from CUDA.
   */
  async unloadModel(): Promise<ModelManagerResult> {
    return this._withGPUMutex(async () => {
      this._setState('unloading', this._activeModel);

      const result = await this._sendCommand({ command: 'unload' });

      this._activeModel = null;
      this._setState('idle', null);

      return result;
    });
  }

  /**
   * Switch to a different model.
   * Unloads current model, then loads the target model.
   */
  async switchModel(targetModelPath: string): Promise<ModelManagerResult> {
    return this._withGPUMutex(async () => {
      // Same model? Reuse
      if (this._activeModel === targetModelPath && this._state === 'loaded') {
        this._log('SWITCH', `Same model: ${targetModelPath}, reusing`);
        const status = await this._sendCommand({ command: 'status' });
        return {
          success: true,
          action: 'reused',
          model: targetModelPath.split(/[/\\]/).pop(),
          vram: status.vram,
        };
      }

      // Unload previous
      if (this._state !== 'idle') {
        this._log('SWITCH', `Unloading previous: ${this._activeModel}`);
        this._setState('unloading', this._activeModel);
        await this._sendCommand({ command: 'unload' });
        this._activeModel = null;
      }

      // Load target
      this._setState('loading', targetModelPath);
      const result = await this._sendCommand({
        command: 'load',
        model_path: targetModelPath,
      });

      if (result.success) {
        this._activeModel = targetModelPath;
        this._setState('loaded', targetModelPath);
      } else {
        this._setState('error', null);
      }

      return result;
    });
  }

  /**
   * Generate an image using the currently loaded model.
   */
  async generate(params: {
    prompt: string;
    negativePrompt?: string;
    width?: number;
    height?: number;
    steps?: number;
    seed?: number;
    outputPath: string;
    generationId?: string;
  }): Promise<ModelManagerResult> {
    return this._withGPUMutex(async () => {
      if (this._state !== 'loaded') {
        return { success: false, error: 'No model loaded. Call loadModel first.' };
      }

      this._setState('generating', this._activeModel);

      const result = await this._sendCommand({
        command: 'generate',
        prompt: params.prompt,
        negative_prompt: params.negativePrompt,
        width: params.width || 512,
        height: params.height || 512,
        steps: params.steps || 10,
        seed: params.seed ?? -1,
        output_path: params.outputPath,
        generation_id: params.generationId,
      });

      // Model stays loaded after generation (for reuse)
      this._setState('loaded', this._activeModel);

      return result;
    });
  }

  /**
   * Get current status and VRAM.
   */
  async getStatus(): Promise<ModelManagerResult> {
    return this._sendCommand({ command: 'status' });
  }

  /**
   * Validate a model directory without loading.
   */
  async validateModel(modelPath: string): Promise<ModelManagerResult> {
    return this._sendCommand({ command: 'validate', model_path: modelPath });
  }

  // -------------------------------------------------------------------------
  // Batch Mode
  // -------------------------------------------------------------------------

  async beginBatch(modelPath: string): Promise<ModelManagerResult> {
    this._log('BATCH', `Beginning batch with model: ${modelPath}`);
    this._executionMode = 'batch';
    this._batchActive = true;
    return this.loadModel(modelPath);
  }

  async endBatch(): Promise<ModelManagerResult> {
    this._log('BATCH', 'Ending batch, unloading model');
    this._batchActive = false;
    this._executionMode = 'manual';
    return this.unloadModel();
  }

  // -------------------------------------------------------------------------
  // Shutdown
  // -------------------------------------------------------------------------

  /**
   * Idempotent shutdown. Safe to call multiple times. Rejects with the
   * underlying reason for diagnostic logging.
   */
  async shutdown(reason: 'user' | 'app_exit' | 'before_quit' | 'error' | 'oom' | 'generation_cancelled' | 'worker_exit' | 'unknown' = 'unknown', caller: string = 'unknown'): Promise<void> {
    if (this._shuttingDown) {
      this._log('SHUTDOWN', `already shutting down (reason=${reason} caller=${caller})`);
      return;
    }
    this._shuttingDown = true;
    this._log('SHUTDOWN', `reason=${reason} caller=${caller}`);

    // Unload model if any (best-effort, ignore errors)
    if (this._state !== 'idle' && this._state !== 'unloading') {
      try {
        await this.unloadModel();
      } catch (e) {
        this._log('SHUTDOWN', `unload error: ${(e as Error).message}`);
      }
    }

    // Try to tell the worker to quit gracefully
    try {
      await this._sendCommand({ command: 'quit', reason, caller });
    } catch {}

    // Always SIGTERM the worker as a fallback
    if (this.worker) {
      try {
        this.worker.kill('SIGTERM');
      } catch {}
      this.worker = null;
      this._workerPid = null;
    }
    this._state = 'idle';
    this._activeModel = null;
  }

  // -------------------------------------------------------------------------
  // GPU Mutex
  // -------------------------------------------------------------------------

  private async _withGPUMutex<T>(fn: () => Promise<T>): Promise<T> {
    if (!this._gpuMutexLocked) {
      this._gpuMutexLocked = true;
      try {
        return await fn();
      } finally {
        this._gpuMutexLocked = false;
        this._drainMutexQueue();
      }
    }

    return new Promise<T>((resolve, reject) => {
      this._gpuMutexQueue.push(async () => {
        this._gpuMutexLocked = true;
        try {
          resolve(await fn());
        } catch (err) {
          reject(err);
        } finally {
          this._gpuMutexLocked = false;
          this._drainMutexQueue();
        }
      });
    });
  }

  private _drainMutexQueue(): void {
    if (this._gpuMutexQueue.length > 0 && !this._gpuMutexLocked) {
      const next = this._gpuMutexQueue.shift()!;
      next();
    }
  }

  // -------------------------------------------------------------------------
  // Worker Management
  // -------------------------------------------------------------------------

  private _ensureWorker(): void {
    if (this.worker) return;

    if (!existsSync(this.PYTHON_PATH)) {
      throw new Error(`Python not found: ${this.PYTHON_PATH}`);
    }
    if (!existsSync(this.SCRIPT_PATH)) {
      throw new Error(`Model manager script not found: ${this.SCRIPT_PATH}`);
    }

    this._log('WORKER', `Starting Python worker`);
    this._shuttingDown = false; // reset for fresh worker

    this.worker = spawn(this.PYTHON_PATH, [this.SCRIPT_PATH], {
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    this._workerPid = this.worker.pid ?? null;
    this._log('WORKER', `PID=${this._workerPid}`);

    this.worker.stdout!.on('data', (data: Buffer) => {
      const lines = data.toString().trim().split('\n');
      for (const line of lines) {
        if (!line) continue;
        try {
          const msg = JSON.parse(line);
          this._handleWorkerMessage(msg);
        } catch {}
      }
    });

    this.worker.stderr!.on('data', (data: Buffer) => {
      // tqdm output goes to stderr — capture to a separate stream for diagnostics
      const msg = data.toString().trim();
      if (msg) this._log('WORKER STDERR', msg);
    });

    this.worker.on('close', (code, signal) => {
      const wasGraceful = this._shuttingDown;
      this._log(
        'WORKER',
        `Worker exited code=${code} signal=${signal} graceful=${wasGraceful}`
      );
      this.worker = null;
      this._workerPid = null;
      this._state = 'idle';
      this._activeModel = null;
      if (!wasGraceful) {
        this._log(
          'WORKER',
          'UNEXPECTED WORKER EXIT — possible crash, OOM, or external termination'
        );
        // Reject all pending requests so callers fail fast
        for (const [, req] of this.pendingRequests) {
          req.reject(new Error('Worker exited unexpectedly'));
        }
        this.pendingRequests.clear();
      }
    });

    this.worker.on('error', (err) => {
      this._log('WORKER ERROR', err.message);
      this.worker = null;
      this._workerPid = null;
    });
  }

  private _handleWorkerMessage(msg: any): void {
    // Log messages from worker
    if (msg.type === 'log') {
      this._log(msg.tag || 'WORKER', msg.message);

      // Forward VRAM updates to renderer
      if (msg.allocated_vram_gb !== undefined && this._window) {
        this._window.webContents.send('local-generation:progress', {
          type: 'vram',
          vram: {
            cuda: true,
            label: msg.label,
            total_vram_gb: msg.total_vram_gb || 4.0,
            allocated_vram_gb: msg.allocated_vram_gb,
            reserved_vram_gb: msg.reserved_vram_gb,
            free_vram_gb: msg.free_vram_gb,
          },
        });
      }
    } else if (msg.type === 'progress') {
      // Forward generation progress to renderer
      if (this._window) {
        this._window.webContents.send('local-generation:progress', msg);
      }
    } else {
      // This is a command response — match by checking pending requests
      for (const [id, req] of this.pendingRequests) {
        req.resolve(msg);
        this.pendingRequests.delete(id);
        break;
      }
    }
  }

  private _sendCommand(cmd: any): Promise<ModelManagerResult> {
    return new Promise((resolve, reject) => {
      this._ensureWorker();

      const id = ++this.requestCounter;
      const timeout = setTimeout(() => {
        this.pendingRequests.delete(id);
        reject(new Error(`Command timed out: ${cmd.command}`));
      }, 600000);

      this.pendingRequests.set(id, {
        resolve: (result) => {
          clearTimeout(timeout);
          resolve(result);
        },
        reject: (err) => {
          clearTimeout(timeout);
          reject(err);
        },
      });

      try {
        this.worker!.stdin!.write(JSON.stringify(cmd) + '\n');
      } catch (err) {
        this.pendingRequests.delete(id);
        clearTimeout(timeout);
        reject(err instanceof Error ? err : new Error(String(err)));
      }
    });
  }

  // -------------------------------------------------------------------------
  // Helpers
  // -------------------------------------------------------------------------

  private _setState(state: ModelState, model: string | null): void {
    this._state = state;
    // Notify renderer of state change
    if (this._window) {
      this._window.webContents.send('local-generation:progress', {
        type: 'state-change',
        state,
        model,
      });
    }
  }

  private _log(tag: string, msg: string): void {
    console.log(`[model-manager][${tag}] ${msg}`);
  }
}

// ---------------------------------------------------------------------------
// Singleton
// ---------------------------------------------------------------------------

let _instance: ModelManagerRunner | null = null;

export function getModelManager(basePath?: string): ModelManagerRunner {
  if (!_instance) {
    if (!basePath) {
      throw new Error('basePath required for first initialization');
    }
    _instance = new ModelManagerRunner(basePath);
  }
  return _instance;
}
