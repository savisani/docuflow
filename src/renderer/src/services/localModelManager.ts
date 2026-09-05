/**
 * Local Model Manager
 *
 * Central manager for local diffusion model lifecycle.
 * Enforces GPU exclusivity: at most ONE model on CUDA at any time.
 *
 * Features:
 * - Mutex for exclusive GPU access
 * - Persistent Python worker (model reuse across generations)
 * - Batch mode (keep model loaded across batch)
 * - Manual mode (unload after scene generation)
 * - CUDA memory telemetry
 */

import { spawn, ChildProcess } from 'child_process';
import { existsSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ExecutionMode = 'manual' | 'batch';

export type ModelState =
  | 'idle'          // No model loaded
  | 'loading'       // Model being loaded onto CUDA
  | 'loaded'        // Model ready on CUDA
  | 'generating'    // Generation in progress
  | 'unloading'     // Model being removed from CUDA
  | 'error';        // Error state

export interface ModelInfo {
  id: string;
  displayName: string;
  path: string;
  format: 'diffusers' | 'single-file' | 'safetensors-dir';
}

export interface VRAMSnapshot {
  cuda: boolean;
  label?: string;
  total_vram_gb: number;
  allocated_vram_gb: number;
  reserved_vram_gb: number;
  free_vram_gb: number;
  peak_allocated_vram_gb?: number;
  peak_reserved_vram_gb?: number;
}

export interface RAMSnapshot {
  label?: string;
  sys_total_gb?: number;
  sys_available_gb?: number;
  sys_used_gb?: number;
  sys_percent?: number;
  proc_rss_gb?: number;
  proc_vms_gb?: number;
  proc_percent?: number;
  pagefile_total_gb?: number;
  pagefile_used_gb?: number;
  pagefile_percent?: number;
}

export interface LoadResult {
  success: boolean;
  action: 'loaded' | 'reused' | 'error';
  model?: string;
  load_time_s?: number;
  vram?: VRAMSnapshot;
  error?: string;
}

export interface GenerateResult {
  success: boolean;
  path?: string;
  device?: string;
  gpu?: string;
  dtype?: string;
  steps?: number;
  resolution?: string;
  generation_time_s?: number;
  vram_after_generate_gb?: number;
  peak_allocated_vram_gb?: number;
  peak_reserved_vram_gb?: number;
  mean_pixel?: number;
  max_pixel?: number;
  pid?: number;
  gen_id?: string;
  model?: string;
  generation_id?: string;
  error?: string;
}

export interface UnloadResult {
  success: boolean;
  action: 'unloaded' | 'noop';
  model?: string;
  vram?: VRAMSnapshot;
}

export interface StatusResult {
  loaded: boolean;
  model?: string;
  model_path?: string;
  dtype?: string;
  generation_count?: number;
  vram?: VRAMSnapshot;
  pid?: number;
}

// ---------------------------------------------------------------------------
// Worker Communication
// ---------------------------------------------------------------------------

interface PendingRequest {
  resolve: (result: any) => void;
  reject: (error: Error) => void;
}

// ---------------------------------------------------------------------------
// LocalModelManager
// ---------------------------------------------------------------------------

export class LocalModelManager {
  private worker: ChildProcess | null = null;
  private pendingRequests: Map<string, PendingRequest> = new Map();
  private requestCounter = 0;

  // State
  private _state: ModelState = 'idle';
  private _activeModel: string | null = null;
  private _executionMode: ExecutionMode = 'manual';
  private _batchActive = false;
  private _gpuMutexLocked = false;
  private _gpuMutexQueue: Array<() => void> = [];

  // Callbacks
  private _onStateChange?: (state: ModelState, model: string | null) => void;
  private _onProgress?: (data: any) => void;
  private _onVRAMUpdate?: (vram: VRAMSnapshot) => void;

  // Configuration
  private readonly PYTHON_PATH: string;
  private readonly SCRIPT_PATH: string;

  constructor() {
    // Resolve paths
    const isDev = !existsSync(join(__dirname, '..', '..', 'release'));
    const basePath = isDev
      ? join(__dirname, '..', '..', '..', 'scripts')
      : join((process as any).resourcesPath, 'scripts');

    this.PYTHON_PATH = join(basePath, '.venv', 'Scripts', 'python.exe');
    this.SCRIPT_PATH = join(basePath, 'model_manager.py');
  }

  // -------------------------------------------------------------------------
  // Public API
  // -------------------------------------------------------------------------

  /** Set callbacks */
  onStateChange(cb: (state: ModelState, model: string | null) => void): void {
    this._onStateChange = cb;
  }

  onProgress(cb: (data: any) => void): void {
    this._onProgress = cb;
  }

  onVRAMUpdate(cb: (vram: VRAMSnapshot) => void): void {
    this._onVRAMUpdate = cb;
  }

  /** Get current state */
  get state(): ModelState { return this._state; }
  get activeModel(): string | null { return this._activeModel; }
  get executionMode(): ExecutionMode { return this._executionMode; }
  get isBatchActive(): boolean { return this._batchActive; }

  /**
   * Load a model onto CUDA.
   * If a different model is loaded, unloads it first.
   * Reuses existing pipeline if same model is requested.
   */
  async loadModel(modelPath: string): Promise<LoadResult> {
    // Normalize path to match Python's os.path.normpath() for reliable comparison
    const normalizedPath = modelPath.replace(/\\/g, '/').replace(/\/+/g, '/').replace(/\/$/, '');
    return this._withGPUMutex(async () => {
      this._setState('loading', normalizedPath);

      const result = await this._sendCommand({
        command: 'load',
        model_path: normalizedPath,
      });

      if (result.success) {
        this._activeModel = normalizedPath;
        this._setState('loaded', normalizedPath);
        if (result.vram) this._onVRAMUpdate?.(result.vram);
      } else {
        this._setState('error', null);
      }

      return result;
    });
  }

  /**
   * Explicitly unload the current model from CUDA.
   */
  async unloadModel(): Promise<UnloadResult> {
    return this._withGPUMutex(async () => {
      this._setState('unloading', this._activeModel);

      const result = await this._sendCommand({
        command: 'unload',
      });

      this._activeModel = null;
      this._setState('idle', null);
      if (result.vram) this._onVRAMUpdate?.(result.vram);

      return result;
    });
  }

  /**
   * Switch to a different model.
   * Unloads current model, then loads the target model.
   * Atomic operation under the GPU mutex.
   */
  async switchModel(targetModelPath: string): Promise<LoadResult> {
    // Normalize path to match Python's os.path.normpath()
    const normalizedTarget = targetModelPath.replace(/\\/g, '/').replace(/\/+/g, '/').replace(/\/$/, '');
    return this._withGPUMutex(async () => {
      // If same model, just return existing
      if (this._activeModel === normalizedTarget && this._state === 'loaded') {
        this._log('SWITCH', `Same model requested: ${normalizedTarget}, reusing`);
        const status = await this._sendCommand({ command: 'status' });
        return {
          success: true,
          action: 'reused',
          model: normalizedTarget.split(/[/\\]/).pop(),
          vram: status.vram,
        };
      }

      // Unload previous if any
      if (this._state === 'loaded' || this._state === 'generating') {
        this._log('SWITCH', `Unloading previous model before loading ${normalizedTarget}`);
        this._setState('unloading', this._activeModel);
        await this._sendCommand({ command: 'unload' });
        this._activeModel = null;
      }

      // Load target
      this._setState('loading', normalizedTarget);
      const result = await this._sendCommand({
        command: 'load',
        model_path: normalizedTarget,
      });

      if (result.success) {
        this._activeModel = normalizedTarget;
        this._setState('loaded', normalizedTarget);
        if (result.vram) this._onVRAMUpdate?.(result.vram);
      } else {
        this._setState('error', null);
      }

      return result;
    });
  }

  /**
   * Generate an image using the currently loaded model.
   * Model must be loaded first.
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
  }): Promise<GenerateResult> {
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

      // After generation, model stays loaded (for reuse)
      if (this._state === 'generating') {
        this._setState('loaded', this._activeModel);
      }

      if (result.vram_after_generate_gb !== undefined) {
        this._onVRAMUpdate?.({
          cuda: true,
          total_vram_gb: 4.0,
          allocated_vram_gb: result.vram_after_generate_gb,
          reserved_vram_gb: 0,
          free_vram_gb: 4.0 - result.vram_after_generate_gb,
        });
      }

      return result;
    });
  }

  /**
   * Get current model status and VRAM.
   */
  async getStatus(): Promise<StatusResult> {
    const result = await this._sendCommand({ command: 'status' });
    if (result.vram) this._onVRAMUpdate?.(result.vram);
    return result;
  }

  /**
   * Validate a model directory without loading.
   */
  async validateModel(modelPath: string): Promise<{ valid: boolean; error?: string; format?: string }> {
    return this._sendCommand({ command: 'validate', model_path: modelPath });
  }

  // -------------------------------------------------------------------------
  // Batch Mode
  // -------------------------------------------------------------------------

  /**
   * Begin a batch generation session.
   * The model will be kept loaded across all generations in the batch.
   */
  async beginBatch(modelPath: string): Promise<void> {
    this._log('BATCH', `Beginning batch session with model: ${modelPath}`);
    this._executionMode = 'batch';
    this._batchActive = true;
    await this.loadModel(modelPath);
  }

  /**
   * End the current batch session.
   * Unloads the model from CUDA.
   */
  async endBatch(): Promise<void> {
    this._log('BATCH', 'Ending batch session, unloading model');
    await this.unloadModel();
    this._batchActive = false;
    this._executionMode = 'manual';
  }

  // -------------------------------------------------------------------------
  // Scene Generation (Manual Mode)
  // -------------------------------------------------------------------------

  /**
   * Generate a scene with background + person.
   * In manual mode: load SD1.5 → generate bg → unload SD1.5 → load RV6 → generate person → unload RV6
   * Each model switch is atomic under the GPU mutex.
   */
  async generateScenePair(params: {
    backgroundPrompt: string;
    personPrompt: string;
    backgroundNegativePrompt?: string;
    personNegativePrompt?: string;
    sd15ModelPath: string;
    rv6ModelPath: string;
    width?: number;
    height?: number;
    steps?: number;
    backgroundSeed?: number;
    personSeed?: number;
    backgroundOutputPath: string;
    personOutputPath: string;
    sceneId?: string;
  }): Promise<{
    success: boolean;
    background?: GenerateResult;
    person?: GenerateResult;
    error?: string;
  }> {
    this._log('SCENE', `Generating scene pair (manual mode)`);

    // Phase 1: Background with SD1.5
    this._log('SCENE', 'Phase 1: Loading SD1.5 for background');
    const bgLoad = await this.loadModel(params.sd15ModelPath);
    if (!bgLoad.success) {
      return { success: false, error: `Failed to load SD1.5: ${bgLoad.error}` };
    }

    const bgResult = await this.generate({
      prompt: params.backgroundPrompt,
      negativePrompt: params.backgroundNegativePrompt,
      width: params.width,
      height: params.height,
      steps: params.steps,
      seed: params.backgroundSeed,
      outputPath: params.backgroundOutputPath,
      generationId: params.sceneId ? `scene-bg-${params.sceneId}` : undefined,
    });

    if (!bgResult.success) {
      return { success: false, background: bgResult, error: `Background generation failed: ${bgResult.error}` };
    }

    // Unload SD1.5 before loading RV6
    this._log('SCENE', 'Unloading SD1.5 before loading RV6');
    await this.unloadModel();

    // Wait for VRAM to be fully released before loading next model
    await new Promise(resolve => setTimeout(resolve, 500));

    // Phase 2: Person with RV6
    this._log('SCENE', 'Phase 2: Loading RV6 for person');
    const pLoad = await this.loadModel(params.rv6ModelPath);
    if (!pLoad.success) {
      return { success: false, background: bgResult, error: `Failed to load RV6: ${pLoad.error}` };
    }

    const pResult = await this.generate({
      prompt: params.personPrompt,
      negativePrompt: params.personNegativePrompt,
      width: params.width,
      height: params.height,
      steps: params.steps,
      seed: params.personSeed,
      outputPath: params.personOutputPath,
      generationId: params.sceneId ? `scene-person-${params.sceneId}` : undefined,
    });

    if (!pResult.success) {
      return { success: false, background: bgResult, person: pResult, error: `Person generation failed: ${pResult.error}` };
    }

    // Unload RV6
    this._log('SCENE', 'Unloading RV6 after person generation');
    await this.unloadModel();

    return { success: true, background: bgResult, person: pResult };
  }

  // -------------------------------------------------------------------------
  // Shutdown
  // -------------------------------------------------------------------------

  async shutdown(): Promise<void> {
    this._log('SHUTDOWN', 'Shutting down model manager');

    // Unload model if any
    if (this._state !== 'idle') {
      try {
        await this.unloadModel();
      } catch {}
    }

    // Quit worker
    try {
      await this._sendCommand({ command: 'quit' });
    } catch {}

    // Kill worker process
    if (this.worker) {
      this.worker.kill('SIGTERM');
      this.worker = null;
    }
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
      const MUTEX_TIMEOUT_MS = 660000; // 11 minutes
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

    this._log('WORKER', `Starting Python worker: ${this.SCRIPT_PATH}`);

    this.worker = spawn(this.PYTHON_PATH, [this.SCRIPT_PATH], {
      stdio: ['pipe', 'pipe', 'pipe'],
    });

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
      // tqdm and other output goes to stderr
    });

    this.worker.on('close', (code) => {
      this._log('WORKER', `Worker exited with code ${code}`);
      this.worker = null;
      this._state = 'idle';
      this._activeModel = null;
      // Reject all pending requests so callers fail fast
      for (const [id, req] of this.pendingRequests) {
        req.reject(new Error(`Worker exited unexpectedly with code ${code}`));
      }
      this.pendingRequests.clear();
    });

    this.worker.on('error', (err) => {
      this._log('WORKER ERROR', err.message);
      this.worker = null;
      this._state = 'error';
      // Reject all pending requests
      for (const [id, req] of this.pendingRequests) {
        req.reject(new Error(`Worker error: ${err.message}`));
      }
      this.pendingRequests.clear();
    });
  }

  private _handleWorkerMessage(msg: any): void {
    // Log messages (type='log') — forward VRAM updates but don't resolve promises
    if (msg.type === 'log') {
      console.log(`[model-manager][${msg.tag}] ${msg.message}`);
      if (msg.allocated_vram_gb !== undefined) {
        this._onVRAMUpdate?.({
          cuda: true,
          label: msg.label,
          total_vram_gb: msg.total_vram_gb || 4.0,
          allocated_vram_gb: msg.allocated_vram_gb,
          reserved_vram_gb: msg.reserved_vram_gb,
          free_vram_gb: msg.free_vram_gb,
        });
      }
      return; // Don't treat log messages as command responses
    }

    // Progress messages (type='progress')
    if (msg.type === 'progress') {
      this._onProgress?.(msg);
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
    if (msg.success !== undefined && !msg.tag) {
      for (const [id, req] of this.pendingRequests) {
        req.resolve(msg);
        this.pendingRequests.delete(id);
        break;
      }
    }
  }

  private _sendCommand(cmd: any): Promise<any> {
    return new Promise((resolve, reject) => {
      this._ensureWorker();

      const id = `req-${++this.requestCounter}`;
      const timeout = setTimeout(() => {
        this.pendingRequests.delete(id);
        reject(new Error(`Command timed out after 600s: ${cmd.command}`));
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
        reject(err);
      }
    });
  }

  // -------------------------------------------------------------------------
  // Helpers
  // -------------------------------------------------------------------------

  private _setState(state: ModelState, model: string | null): void {
    this._state = state;
    this._onStateChange?.(state, model);
  }

  private _log(tag: string, msg: string): void {
    console.log(`[model-manager][${tag}] ${msg}`);
  }
}

// ---------------------------------------------------------------------------
// Singleton
// ---------------------------------------------------------------------------

let _instance: LocalModelManager | null = null;

export function getLocalModelManager(): LocalModelManager {
  if (!_instance) {
    _instance = new LocalModelManager();
  }
  return _instance;
}
