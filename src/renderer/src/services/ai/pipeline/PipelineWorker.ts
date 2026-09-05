/**
 * Pipeline Worker
 *
 * Orchestrates stage execution for a batch of SceneJobs.
 * Executes stages in order across all scenes (stage-by-stage batching).
 * Manages model lifecycle by loading/unloading via Python script invocations.
 */

import type {
  SceneJob,
  PipelineStageName,
  PipelineBatchRequest,
  PipelineProgress,
  PipelineConfig,
  PipelineEvent,
  StageProgress,
  DEFAULT_PIPELINE_CONFIG,
} from './PipelineTypes';
import { runStage, type StageResult } from './PipelineStages';

// ---------------------------------------------------------------------------
// Pipeline stages in execution order
// ---------------------------------------------------------------------------

const STAGE_ORDER: PipelineStageName[] = [
  'BACKGROUND',
  'PERSON',
  'POSE',
  'SEGMENT',
  'COMPOSITE',
  'QUALITY',
  'UPSCALE',
];

// ---------------------------------------------------------------------------
// Logging
// ---------------------------------------------------------------------------

function logPipeline(msg: string): void {
  console.log(`[AI PIPELINE] ${msg}`);
}

function logStageStart(stage: PipelineStageName, count: number): void {
  console.log(`[AI PIPELINE] ${stage} stage — ${count} scenes`);
}

// ---------------------------------------------------------------------------
// Progress Tracker
// ---------------------------------------------------------------------------

function createInitialProgress(totalScenes: number): PipelineProgress {
  const stageProgress: Record<PipelineStageName, StageProgress> = {} as any;
  for (const s of STAGE_ORDER) {
    stageProgress[s] = { total: 0, completed: 0, failed: 0, skipped: 0, running: false };
  }
  return {
    pipelineStatus: 'running',
    totalScenes,
    completedScenes: 0,
    failedScenes: 0,
    retriedScenes: 0,
    currentStage: 'BACKGROUND',
    stageProgress,
    elapsedTime: 0,
    overallPercent: 0,
  };
}

// ---------------------------------------------------------------------------
// Pipeline Worker
// ---------------------------------------------------------------------------

export class PipelineWorker {
  private config: PipelineConfig;
  private progress: PipelineProgress;
  private scenes: SceneJob[];
  private startTime: number = 0;
  private cancelled: boolean = false;
  private onProgress?: (progress: PipelineProgress) => void;
  private onEvent?: (event: PipelineEvent) => void;

  constructor(config: Partial<PipelineConfig> = {}) {
    this.config = {
      maxConcurrentGPUJobs: 1,
      maxRetries: 2,
      qualityThreshold: 0.5,
      enableIdentityCheck: false,
      enablePoseControl: true,
      stageTimeoutMs: 600000,
      verboseLogging: true,
      ...config,
    };
    this.scenes = [];
    this.progress = createInitialProgress(0);
  }

  /**
   * Run a batch of scenes through the full pipeline.
   */
  async runBatch(
    request: PipelineBatchRequest,
    callbacks?: {
      onProgress?: (progress: PipelineProgress) => void;
      onEvent?: (event: PipelineEvent) => void;
    },
  ): Promise<PipelineProgress> {
    this.onProgress = callbacks?.onProgress;
    this.onEvent = callbacks?.onEvent;
    this.scenes = request.scenes.map((s, i) => ({
      ...s,
      sceneIndex: s.sceneIndex ?? i,
    }));
    this.cancelled = false;
    this.startTime = Date.now();

    const totalScenes = this.scenes.length;
    this.progress = createInitialProgress(totalScenes);

    logPipeline(`Batch started: ${totalScenes} scenes`);

    try {
      // Stage-by-stage execution
      for (const stage of STAGE_ORDER) {
        if (this.cancelled) break;

        const scenesForStage = this.getScenesForStage(stage);
        if (scenesForStage.length === 0) continue;

        this.progress.currentStage = stage;
        this.progress.stageProgress[stage].total = scenesForStage.length;
        this.progress.stageProgress[stage].running = true;

        logStageStart(stage, scenesForStage.length);
        this.emitEvent({ type: 'stage_start', stage, progress: { ...this.progress } });

        // GPU-heavy stages are serialized (one at a time)
        const isGPUStage = ['BACKGROUND', 'PERSON', 'POSE', 'UPSCALE'].includes(stage);

        if (isGPUStage) {
          // Process one scene at a time for GPU-heavy stages
          for (const scene of scenesForStage) {
            if (this.cancelled) break;
            await this.processSceneStage(scene, stage, request);
            this.updateProgressPercent();
            this.emitProgress();
          }
        } else {
          // CPU stages can process all scenes
          for (const scene of scenesForStage) {
            if (this.cancelled) break;
            await this.processSceneStage(scene, stage, request);
            this.updateProgressPercent();
            this.emitProgress();
          }
        }

        this.progress.stageProgress[stage].running = false;
        this.emitEvent({ type: 'stage_complete', stage, progress: { ...this.progress } });
      }

      // Final status
      if (this.cancelled) {
        this.progress.pipelineStatus = 'cancelled';
        logPipeline('Batch cancelled');
      } else {
        this.progress.pipelineStatus = 'completed';
        const successCount = this.progress.completedScenes;
        const failCount = this.progress.failedScenes;
        logPipeline(`Batch completed — Success: ${successCount}, Failed: ${failCount}`);
      }
    } catch (err) {
      this.progress.pipelineStatus = 'failed';
      logPipeline(`Batch failed: ${err}`);
    }

    this.progress.elapsedTime = Date.now() - this.startTime;
    this.emitProgress();
    this.emitEvent({
      type: 'batch_complete',
      progress: { ...this.progress },
    });

    return this.progress;
  }

  /**
   * Cancel the running pipeline.
   */
  cancel(): void {
    this.cancelled = true;
    logPipeline('Cancellation requested');
  }

  /**
   * Get current progress.
   */
  getProgress(): PipelineProgress {
    return { ...this.progress };
  }

  // --- Private ---

  private getScenesForStage(stage: PipelineStageName): SceneJob[] {
    return this.scenes.filter((scene) => {
      // Skip failed/cancelled scenes
      if (scene.status === 'failed' || scene.status === 'cancelled') return false;
      // Skip scenes that have already passed this stage
      if (this.hasPassedStage(scene, stage)) return false;
      // Check if this stage is needed for the scene
      return this.isStageRequired(stage, scene);
    });
  }

  private isStageRequired(stage: PipelineStageName, scene: SceneJob): boolean {
    switch (stage) {
      case 'BACKGROUND': return scene.backgroundRequired;
      case 'PERSON': return scene.personRequired;
      case 'POSE': return scene.poseRequired && this.config.enablePoseControl;
      case 'SEGMENT': return scene.compositionRequired && !!scene.personRequired;
      case 'COMPOSITE': return scene.compositionRequired;
      case 'QUALITY': return scene.qualityCheckRequired;
      case 'UPSCALE': return scene.upscaleRequired;
      default: return false;
    }
  }

  private hasPassedStage(scene: SceneJob, stage: PipelineStageName): boolean {
    switch (stage) {
      case 'BACKGROUND': return !!scene.assets.backgroundPath;
      case 'PERSON': return !!scene.assets.personPath;
      case 'POSE': return !!scene.assets.posePath;
      case 'SEGMENT': return !!scene.assets.maskPath;
      case 'COMPOSITE': return !!scene.assets.compositePath;
      case 'QUALITY': return !!scene.qualityResult?.passed;
      case 'UPSCALE': return !!scene.assets.upscaledPath;
      default: return false;
    }
  }

  private async processSceneStage(
    scene: SceneJob,
    stage: PipelineStageName,
    request: PipelineBatchRequest,
  ): Promise<void> {
    const sp = this.progress.stageProgress[stage];

    scene.status = 'running';
    scene.currentStage = stage;
    this.progress.activeSceneId = scene.sceneId;
    this.progress.activeSceneDetail = `Scene ${scene.sceneIndex + 1} — ${stage}`;

    try {
      const result = await runStage(stage, scene, {
        modelPath: request.defaultSettings.modelPath,
        projectName: request.projectName,
        qualityThreshold: this.config.qualityThreshold,
      });

      this.applyStageResult(scene, stage, result);

      if (result.success) {
        sp.completed++;
        scene.status = 'pending'; // Ready for next stage
      } else {
        // Attempt retry within this stage
        const retried = await this.retryStage(scene, stage, request, result);
        if (!retried) {
          sp.failed++;
          this.progress.failedScenes = this.scenes.filter((s) => s.status === 'failed').length;
        }
      }
    } catch (err) {
      sp.failed++;
      scene.status = 'failed';
      scene.error = {
        code: 'GENERATION_FAILED',
        message: err instanceof Error ? err.message : 'Unknown error',
        stage,
        timestamp: Date.now(),
      };
      this.progress.failedScenes = this.scenes.filter((s) => s.status === 'failed').length;

      this.emitEvent({
        type: 'scene_error',
        sceneId: scene.sceneId,
        stage,
        error: scene.error,
      });
    }
  }

  private async retryStage(
    scene: SceneJob,
    stage: PipelineStageName,
    request: PipelineBatchRequest,
    firstResult: StageResult,
  ): Promise<boolean> {
    // Retry logic: try again with a new seed
    const sp = this.progress.stageProgress[stage];

    while (scene.retryCount < this.config.maxRetries) {
      scene.retryCount++;
      scene.seed = (scene.seed || 0) + 1; // Change seed for retry

      logPipeline(
        `Scene ${scene.sceneId} retrying ${stage} — attempt ${scene.retryCount}/${this.config.maxRetries}`,
      );
      this.progress.retriedScenes = this.scenes.filter(
        (s) => s.status === 'retry_pending' || s.status === 'running',
      ).length;
      this.emitProgress();

      try {
        const result = await runStage(stage, scene, {
          modelPath: request.defaultSettings.modelPath,
          projectName: request.projectName,
          qualityThreshold: this.config.qualityThreshold,
        });

        this.applyStageResult(scene, stage, result);

        if (result.success) {
          sp.completed++;
          scene.status = 'pending';
          logPipeline(`Scene ${scene.sceneId} ${stage} PASSED on retry ${scene.retryCount}`);
          return true;
        }
        // Continue retrying
      } catch (err) {
        // Continue retrying
      }
    }

    // All retries exhausted
    scene.status = 'failed';
    scene.error = {
      code: firstResult.error ? 'GENERATION_FAILED' : 'QUALITY_FAILED',
      message: firstResult.error || `Failed after ${this.config.maxRetries} retries`,
      stage,
      timestamp: Date.now(),
    };

    this.emitEvent({
      type: 'scene_error',
      sceneId: scene.sceneId,
      stage,
      error: scene.error,
    });

    return false;
  }

  private applyStageResult(
    scene: SceneJob,
    stage: PipelineStageName,
    result: StageResult,
  ): void {
    // Merge assets
    Object.assign(scene.assets, result.assets);

    // Apply quality result
    if (result.qualityResult) {
      scene.qualityResult = result.qualityResult;
    }
  }

  private updateProgressPercent(): void {
    const completed = this.scenes.filter(
      (s) => s.status === 'completed' || s.assets.upscaledPath,
    ).length;
    this.progress.completedScenes = completed;
    this.progress.overallPercent = this.progress.totalScenes > 0
      ? Math.round((completed / this.progress.totalScenes) * 100)
      : 0;

    // Estimate remaining time
    const elapsed = Date.now() - this.startTime;
    const scenesProcessed = completed + this.progress.failedScenes;
    if (scenesProcessed > 0) {
      const avgTimePerScene = elapsed / scenesProcessed;
      const remaining = this.progress.totalScenes - scenesProcessed;
      this.progress.estimatedRemaining = Math.round(avgTimePerScene * remaining);
    }
  }

  private emitProgress(): void {
    this.progress.elapsedTime = Date.now() - this.startTime;
    this.onProgress?.({ ...this.progress });
  }

  private emitEvent(event: PipelineEvent): void {
    this.onEvent?.(event);
  }
}
