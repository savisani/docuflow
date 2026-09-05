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
export type LocalModelType = 'diffusion' | 'ollama' | 'none';

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
  private _activeModelType: LocalModelType = 'none';
  private _executionMode: ExecutionMode = 'manual';
  private _batchActive = false;
  private _gpuMutexLocked = false;
  private _gpuMutexQueue: Array<() => void> = [];
  private _shuttingDown = false;
  private _workerPid: number | null = null;
  private _ollamaProcess: ChildProcess | null = null;
  private _ollamaModel: string | null = null;

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
    // Normalize path to match Python's os.path.normpath()
    const normalizedPath = modelPath.replace(/\\/g, '/').replace(/\/+/g, '/').replace(/\/$/, '');
    return this._withGPUMutex(async () => {
      if (this._activeModelType === 'ollama') {
        await this.stopOllamaServer();
      }

      this._setState('loading', normalizedPath);

      const result = await this._sendCommand({
        command: 'load',
        model_path: normalizedPath,
      });

      if (result.success) {
        this._activeModel = normalizedPath;
        this._activeModelType = 'diffusion';
        this._setState('loaded', normalizedPath);
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
      this._activeModelType = 'none';
      this._setState('idle', null);

      return result;
    });
  }

  /**
   * Switch to a different model.
   * Unloads current model, then loads the target model.
   */
  async switchModel(targetModelPath: string): Promise<ModelManagerResult> {
    // Normalize path to match Python's os.path.normpath()
    const normalizedTarget = targetModelPath.replace(/\\/g, '/').replace(/\/+/g, '/').replace(/\/$/, '');
    return this._withGPUMutex(async () => {
      if (this._activeModelType === 'ollama') {
        await this.stopOllamaServer();
      }

      if (this._activeModel === normalizedTarget && this._state === 'loaded') {
        this._log('SWITCH', `Same model: ${normalizedTarget}, reusing`);
        const status = await this._sendCommand({ command: 'status' });
        return {
          success: true,
          action: 'reused',
          model: normalizedTarget.split(/[/\\]/).pop(),
          vram: status.vram,
        };
      }

      if (this._state !== 'idle') {
        this._log('SWITCH', `Unloading previous: ${this._activeModel}`);
        this._setState('unloading', this._activeModel);
        await this._sendCommand({ command: 'unload' });
        this._activeModel = null;
      }

      this._setState('loading', normalizedTarget);
      const result = await this._sendCommand({
        command: 'load',
        model_path: normalizedTarget,
      });

      if (result.success) {
        this._activeModel = normalizedTarget;
        this._activeModelType = 'diffusion';
        this._setState('loaded', normalizedTarget);
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
  // Ollama Management
  // -------------------------------------------------------------------------

  /**
   * Check if Ollama server is running.
   */
  async isOllamaRunning(): Promise<boolean> {
    try {
      const response = await fetch('http://localhost:11434/api/tags', {
        method: 'GET',
        signal: AbortSignal.timeout(2000),
      });
      return response.ok;
    } catch {
      return false;
    }
  }

  /**
   * Start Ollama server and load a model.
   * If a diffusion model is active, unload it first.
   */
  async loadOllamaModel(modelName: string): Promise<{ success: boolean; error?: string }> {
    return this._withGPUMutex(async () => {
      if (this._activeModelType === 'diffusion') {
        if (this._state !== 'idle' && this._state !== 'unloading') {
          await this.unloadModel();
        }
      }

      if (!this._ollamaProcess) {
        this._log('OLLAMA', 'Starting Ollama server');
        this._ollamaProcess = spawn('ollama', ['serve'], {
          stdio: 'ignore',
          detached: true,
        });

        this._ollamaProcess.on('error', (err) => {
          this._log('OLLAMA ERROR', err.message);
          this._ollamaProcess = null;
        });

        this._ollamaProcess.on('exit', (code) => {
          this._log('OLLAMA', `Ollama server exited with code ${code}`);
          this._ollamaProcess = null;
          if (this._activeModelType === 'ollama') {
            this._activeModelType = 'none';
            this._ollamaModel = null;
          }
        });

        for (let i = 0; i < 30; i++) {
          await new Promise((resolve) => setTimeout(resolve, 1000));
          if (await this.isOllamaRunning()) break;
        }

        if (!this._ollamaProcess) {
          return { success: false, error: 'Failed to start Ollama server' };
        }
      }

      try {
        const response = await fetch('http://localhost:11434/api/chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model: modelName,
            messages: [{ role: 'user', content: 'ping' }],
            stream: false,
          }),
          signal: AbortSignal.timeout(60000),
        });

        if (response.ok) {
          this._activeModelType = 'ollama';
          this._ollamaModel = modelName;
          this._log('OLLAMA', `Loaded model: ${modelName}`);
          return { success: true };
        } else {
          const errorText = await response.text();
          return { success: false, error: `Ollama error: ${response.status} - ${errorText}` };
        }
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : String(err);
        return { success: false, error: `Failed to load Ollama model: ${errorMessage}` };
      }
    });
  }

  /**
   * Stop Ollama server (releases all Ollama models from VRAM).
   * If a diffusion model is active, this has no effect on it.
   */
  async stopOllamaServer(): Promise<{ success: boolean; error?: string }> {
    return this._withGPUMutex(async () => {
      if (this._ollamaProcess) {
        this._log('OLLAMA', 'Stopping Ollama server');
        try {
          process.kill(-this._ollamaProcess.pid!, 'SIGTERM');
        } catch {
          try {
            this._ollamaProcess.kill('SIGTERM');
          } catch {}
        }
        this._ollamaProcess = null;
        this._ollamaModel = null;
        if (this._activeModelType === 'ollama') {
          this._activeModelType = 'none';
        }
        return { success: true };
      }
      return { success: true };
    });
  }

  /**
   * Get the currently active model type and name.
   */
  getActiveModelInfo(): { type: LocalModelType; model: string | null } {
    if (this._activeModelType === 'ollama') {
      return { type: 'ollama', model: this._ollamaModel };
    }
    return { type: this._activeModelType, model: this._activeModel };
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

    if (this._activeModelType === 'ollama') {
      try {
        await this.stopOllamaServer();
      } catch (e) {
        this._log('SHUTDOWN', `stopOllamaServer error: ${(e as Error).message}`);
      }
    } else if (this._state !== 'idle' && this._state !== 'unloading') {
      try {
        await this.unloadModel();
      } catch (e) {
        this._log('SHUTDOWN', `unload error: ${(e as Error).message}`);
      }
    }

    try {
      await this._sendCommand({ command: 'quit', reason, caller });
    } catch {}

    if (this.worker) {
      try {
        this.worker.kill('SIGTERM');
      } catch {}
      this.worker = null;
      this._workerPid = null;
    }
    this._state = 'idle';
    this._activeModel = null;
    this._activeModelType = 'none';
  }

  // -------------------------------------------------------------------------
  // GPU Mutex
  // -------------------------------------------------------------------------

  private async _withGPUMutex<T>(fn: () => Promise<T>): Promise<T> {
    // If mutex is free, acquire immediately
    if (!this._gpuMutexLocked) {
      this._gpuMutexLocked = true;
      try {
        return await fn();
      } finally {
        this._gpuMutexLocked = false;
        this._drainMutexQueue();
      }
    }

    // Mutex is locked — wait with timeout to prevent deadlocks
    return new Promise<T>((resolve, reject) => {
      const MUTEX_TIMEOUT_MS = 660000; // 11 minutes (slightly longer than command timeout)
      const startTime = Date.now();

      const tryAcquire = () => {
        if (!this._gpuMutexLocked) {
          this._gpuMutexLocked = true;
          const elapsed = Date.now() - startTime;
          if (elapsed > MUTEX_TIMEOUT_MS) {
            this._gpuMutexLocked = false;
            this._drainMutexQueue();
            reject(new Error(`GPU mutex timeout after ${elapsed}ms`));
            return;
          }
          fn()
            .then(resolve)
            .catch(reject)
            .finally(() => {
              this._gpuMutexLocked = false;
              this._drainMutexQueue();
            });
        } else {
          const elapsed = Date.now() - startTime;
          if (elapsed > MUTEX_TIMEOUT_MS) {
            reject(new Error(`GPU mutex timeout after ${elapsed}ms — possible deadlock`));
            return;
          }
          setTimeout(tryAcquire, 50);
        }
      };

      tryAcquire();
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
    // Log messages from worker (type='log')
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
      return; // Don't treat log messages as command responses
    }

    // Progress messages from worker (type='progress')
    if (msg.type === 'progress') {
      // Forward generation progress to renderer
      if (this._window) {
        this._window.webContents.send('local-generation:progress', msg);
      }
      return; // Don't treat progress messages as command responses
    }

    // Command responses (type='response') — resolve the oldest pending request
    if (msg.type === 'response') {
      for (const [id, req] of this.pendingRequests) {
        // Strip the type field before resolving (callers don't expect it)
        const { type: _, ...responseMsg } = msg;
        req.resolve(responseMsg);
        this.pendingRequests.delete(id);
        break;
      }
      return;
    }

    // Fallback: backward-compatible matching for responses without type field
    // (e.g., if an older Python worker is running)
    if (!msg.tag && msg.success !== undefined) {
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
