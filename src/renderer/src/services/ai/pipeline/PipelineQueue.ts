/**
 * Pipeline Queue
 *
 * Manages batch pipeline execution with stage-by-stage processing.
 * Handles retry logic, failed scene isolation, and progress tracking.
 * Integrates with the Zustand store for state updates.
 */

import { v4 as uuidv4 } from 'uuid';
import type {
  SceneJob,
  PipelineBatchRequest,
  PipelineProgress,
  PipelineConfig,
  PipelineEvent,
  PersonIdentityProfile,
  PipelineDefaultSettings,
} from './PipelineTypes';
import { PipelineWorker } from './PipelineWorker';

// ---------------------------------------------------------------------------
// Logging
// ---------------------------------------------------------------------------

function logQueue(msg: string): void {
  console.log(`[AI QUEUE] ${msg}`);
}

// ---------------------------------------------------------------------------
// Pipeline Queue
// ---------------------------------------------------------------------------

export class PipelineQueue {
  private activeWorker: PipelineWorker | null = null;
  private currentBatchId: string | null = null;
  private isRunning: boolean = false;

  /**
   * Create SceneJobs from AI-generated SceneItems.
   */
  static createSceneJobs(
    sceneItems: Array<{
      sceneId: number;
      imagePrompt: string;
      visualDescription?: string;
    }>,
    defaults: PipelineDefaultSettings,
    options?: {
      backgroundRequired?: boolean;
      personRequired?: boolean;
      poseRequired?: boolean;
      compositionRequired?: boolean;
      qualityCheckRequired?: boolean;
      upscaleRequired?: boolean;
      maxRetries?: number;
    },
  ): SceneJob[] {
    return sceneItems.map((item, index) => ({
      sceneId: `scene_${String(item.sceneId).padStart(3, '0')}`,
      sceneIndex: index,
      prompt: item.imagePrompt || item.visualDescription || '',
      backgroundRequired: options?.backgroundRequired ?? true,
      personRequired: options?.personRequired ?? false,
      poseRequired: options?.poseRequired ?? false,
      compositionRequired: options?.compositionRequired ?? false,
      qualityCheckRequired: options?.qualityCheckRequired ?? true,
      upscaleRequired: options?.upscaleRequired ?? true,
      targetWidth: defaults.width,
      targetHeight: defaults.height,
      steps: defaults.steps,
      guidanceScale: defaults.guidanceScale,
      device: defaults.device,
      seed: Math.floor(Math.random() * 2147483647),
      status: 'pending',
      currentStage: null,
      retryCount: 0,
      maxRetries: options?.maxRetries ?? 2,
      assets: {},
    }));
  }

  /**
   * Run a batch of SceneJobs through the pipeline.
   */
  async runBatch(
    request: PipelineBatchRequest,
    callbacks?: {
      onProgress?: (progress: PipelineProgress) => void;
      onEvent?: (event: PipelineEvent) => void;
    },
  ): Promise<PipelineProgress> {
    if (this.isRunning) {
      throw new Error('A batch is already running. Cancel or wait for it to complete.');
    }

    this.isRunning = true;
    this.currentBatchId = uuidv4();
    this.activeWorker = new PipelineWorker();

    logQueue(`Starting batch ${this.currentBatchId}: ${request.scenes.length} scenes`);

    try {
      const progress = await this.activeWorker.runBatch(request, {
        onProgress: callbacks?.onProgress,
        onEvent: (event) => {
          this.handleEvent(event);
          callbacks?.onEvent?.(event);
        },
      });

      logQueue(`Batch ${this.currentBatchId} completed`);
      return progress;
    } finally {
      this.isRunning = false;
      this.activeWorker = null;
      this.currentBatchId = null;
    }
  }

  /**
   * Run retry pass for failed scenes only.
   */
  async runRetry(
    failedScenes: SceneJob[],
    defaults: PipelineDefaultSettings,
    projectName: string,
    callbacks?: {
      onProgress?: (progress: PipelineProgress) => void;
      onEvent?: (event: PipelineEvent) => void;
    },
  ): Promise<PipelineProgress> {
    if (failedScenes.length === 0) {
      return this.createEmptyProgress();
    }

    logQueue(`Retry pass: ${failedScenes.length} failed scenes`);

    // Reset failed scenes for retry
    for (const scene of failedScenes) {
      scene.status = 'pending';
      scene.retryCount = 0;
      scene.error = undefined;
      scene.qualityResult = undefined;
      // Clear only the failed stage's assets
      this.clearFailedStageAssets(scene);
    }

    return this.runBatch(
      {
        scenes: failedScenes,
        defaultSettings: defaults,
        projectName,
      },
      callbacks,
    );
  }

  /**
   * Cancel the current batch.
   */
  cancel(): void {
    if (this.activeWorker) {
      this.activeWorker.cancel();
      logQueue('Batch cancellation requested');
    }
  }

  /**
   * Check if a batch is currently running.
   */
  isBatchRunning(): boolean {
    return this.isRunning;
  }

  /**
   * Get current batch ID.
   */
  getCurrentBatchId(): string | null {
    return this.currentBatchId;
  }

  // --- Private ---

  private handleEvent(event: PipelineEvent): void {
    switch (event.type) {
      case 'scene_complete':
        logQueue(`Scene ${event.sceneId} completed`);
        break;
      case 'scene_error':
        logQueue(`Scene ${event.sceneId} error at ${event.stage}: ${event.error?.message}`);
        break;
      case 'batch_complete':
        logQueue('Batch completed');
        break;
    }
  }

  private clearFailedStageAssets(scene: SceneJob): void {
    // Determine which stage failed and clear that stage's outputs
    const errorStage = scene.error?.stage;
    if (!errorStage) return;

    switch (errorStage) {
      case 'BACKGROUND':
        scene.assets.backgroundPath = undefined;
        break;
      case 'PERSON':
        scene.assets.personPath = undefined;
        scene.assets.maskPath = undefined;
        break;
      case 'POSE':
        scene.assets.posePath = undefined;
        break;
      case 'COMPOSITE':
        scene.assets.compositePath = undefined;
        break;
      case 'QUALITY':
        scene.qualityResult = undefined;
        break;
      case 'UPSCALE':
        scene.assets.upscaledPath = undefined;
        break;
    }
  }

  private createEmptyProgress(): PipelineProgress {
    return {
      pipelineStatus: 'completed',
      totalScenes: 0,
      completedScenes: 0,
      failedScenes: 0,
      retriedScenes: 0,
      currentStage: 'BACKGROUND',
      stageProgress: {} as any,
      elapsedTime: 0,
      overallPercent: 100,
    };
  }
}
