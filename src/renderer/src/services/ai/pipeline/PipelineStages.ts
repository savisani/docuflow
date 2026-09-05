/**
 * AI Pipeline Stages
 *
 * Each stage is a pure function that takes a SceneJob and produces results.
 * Stages call out to Python scripts via the main process IPC handlers.
 * No models are kept in memory between stages — each IPC call loads/releases the model.
 */

import type {
  SceneJob,
  SceneAssets,
  QualityResult,
  QualityIssue,
  PipelineStageName,
} from './PipelineTypes';
import { extractErrorMessage } from '../../../../core/errors';

// ---------------------------------------------------------------------------
// Logging helper
// ---------------------------------------------------------------------------

function log(stage: PipelineStageName, sceneId: string, msg: string): void {
  console.log(`[${stage}] Scene ${sceneId} — ${msg}`);
}

function logSkip(sceneId: string, stage: PipelineStageName, reason: string): void {
  console.log(`[${stage}] Scene ${sceneId} — skipped: ${reason}`);
}

// ---------------------------------------------------------------------------
// Stage Result
// ---------------------------------------------------------------------------

export interface StageResult {
  success: boolean;
  assets: Partial<SceneAssets>;
  error?: string;
  qualityResult?: QualityResult;
}

// ---------------------------------------------------------------------------
// Stage 1: Background Generation
// ---------------------------------------------------------------------------

export async function runBackgroundStage(
  job: SceneJob,
  modelPath: string,
  projectName: string,
): Promise<StageResult> {
  if (!job.backgroundRequired) {
    logSkip(job.sceneId, 'BACKGROUND', 'not required');
    return { success: true, assets: {} };
  }

  log('BACKGROUND', job.sceneId, `generating (prompt="${job.prompt.slice(0, 60)}...")`);

  try {
    const outputPath = `%TEMP%\\docuflow\\pipeline\\${projectName}\\${job.sceneId}_background.png`;
    const generationId = `pipeline-bg-${job.sceneId}-${Date.now()}`;

    const result = await window.docuflow.generateLocalImageEnhanced({
      prompt: job.prompt,
      width: job.targetWidth,
      height: job.targetHeight,
      outputPath,
      modelPath,
      steps: job.steps || 10,
      seed: job.seed,
      device: job.device || 'auto',
      generationId,
    });

    if (!result.success || !result.path) {
      return {
        success: false,
        assets: {},
        error: extractErrorMessage(result.error, 'Background generation failed'),
      };
    }

    log('BACKGROUND', job.sceneId, `completed → ${result.path}`);
    return {
      success: true,
      assets: { backgroundPath: result.path },
    };
  } catch (err) {
    return {
      success: false,
      assets: {},
      error: err instanceof Error ? err.message : 'Background generation failed',
    };
  }
}

// ---------------------------------------------------------------------------
// Stage 2: Person / Face Generation
// ---------------------------------------------------------------------------

export async function runPersonStage(
  job: SceneJob,
  modelPath: string,
  projectName: string,
): Promise<StageResult> {
  if (!job.personRequired) {
    logSkip(job.sceneId, 'PERSON', 'not required');
    return { success: true, assets: {} };
  }

  log('PERSON', job.sceneId, `generating person (identity=${job.personIdentityProfileId || 'none'})`);

  try {
    // Person generation uses the same SD 1.5 model but with a person-focused prompt
    const personPrompt = `portrait of a person, ${job.prompt}, high quality, detailed face, realistic`;

    const outputPath = `%TEMP%\\docuflow\\pipeline\\${projectName}\\${job.sceneId}_person.png`;
    const generationId = `pipeline-person-${job.sceneId}-${Date.now()}`;

    const result = await window.docuflow.generateLocalImageEnhanced({
      prompt: personPrompt,
      width: job.targetWidth,
      height: job.targetHeight,
      outputPath,
      modelPath,
      steps: job.steps || 10,
      seed: job.seed !== undefined ? job.seed + 1 : undefined,
      device: job.device || 'auto',
      generationId,
    });

    if (!result.success || !result.path) {
      return {
        success: false,
        assets: {},
        error: extractErrorMessage(result.error, 'Person generation failed'),
      };
    }

    // Generate a simple mask (white rectangle on black background for now)
    const maskPath = await generateSimpleMask(
      job.targetWidth,
      job.targetHeight,
      projectName,
      job.sceneId,
    );

    log('PERSON', job.sceneId, `completed → ${result.path}`);
    return {
      success: true,
      assets: {
        personPath: result.path,
        maskPath: maskPath || undefined,
      },
    };
  } catch (err) {
    return {
      success: false,
      assets: {},
      error: err instanceof Error ? err.message : 'Person generation failed',
    };
  }
}

// ---------------------------------------------------------------------------
// Stage 3: OpenPose Control
// ---------------------------------------------------------------------------

export async function runPoseStage(
  job: SceneJob,
  projectName: string,
): Promise<StageResult> {
  if (!job.poseRequired) {
    logSkip(job.sceneId, 'POSE', 'not required');
    return { success: true, assets: {} };
  }

  log('POSE', job.sceneId, 'checking OpenPose availability...');

  // OpenPose is not currently installed — return a clear unavailable state
  // This does NOT crash the pipeline; it skips the pose stage gracefully
  logSkip(job.sceneId, 'POSE', 'OpenPose model not installed — skipping');
  return {
    success: true,
    assets: {},
    error: undefined,
  };
}

// ---------------------------------------------------------------------------
// Stage 4: Segmentation / Mask
// ---------------------------------------------------------------------------

export async function runSegmentStage(
  job: SceneJob,
  assets: SceneAssets,
  projectName: string,
): Promise<StageResult> {
  if (!job.compositionRequired) {
    logSkip(job.sceneId, 'SEGMENT', 'compositing not required');
    return { success: true, assets: {} };
  }

  // If we already have a mask from the person stage, skip segmentation
  if (assets.maskPath) {
    logSkip(job.sceneId, 'SEGMENT', 'mask already exists from person stage');
    return { success: true, assets: {} };
  }

  if (!assets.personPath) {
    logSkip(job.sceneId, 'SEGMENT', 'no person image to segment');
    return { success: true, assets: {} };
  }

  log('SEGMENT', job.sceneId, 'generating mask...');

  // Generate a simple center mask for the person image
  // A proper segmentation model can be plugged in later
  const maskPath = await generateSimpleMask(
    job.targetWidth,
    job.targetHeight,
    projectName,
    job.sceneId,
  );

  if (maskPath) {
    log('SEGMENT', job.sceneId, `completed → ${maskPath}`);
    return {
      success: true,
      assets: { maskPath },
    };
  }

  logSkip(job.sceneId, 'SEGMENT', 'mask generation not available');
  return { success: true, assets: {} };
}

// ---------------------------------------------------------------------------
// Stage 5: Compositing
// ---------------------------------------------------------------------------

export async function runCompositeStage(
  job: SceneJob,
  assets: SceneAssets,
): Promise<StageResult> {
  if (!job.compositionRequired) {
    logSkip(job.sceneId, 'COMPOSITE', 'not required');
    // Use background as the final composite
    return {
      success: true,
      assets: { compositePath: assets.backgroundPath },
    };
  }

  // If we have both background and person, composite them
  if (assets.backgroundPath && assets.personPath) {
    log('COMPOSITE', job.sceneId, 'compositing person onto background...');

    try {
      const result = await window.docuflow.compositeImages({
        backgroundPath: assets.backgroundPath,
        foregroundPath: assets.personPath,
        maskPath: assets.maskPath,
        outputPath: `%TEMP%\\docuflow\\pipeline\\${job.sceneId}_composite.png`,
        width: job.targetWidth,
        height: job.targetHeight,
      });

      if (result.success && result.path) {
        log('COMPOSITE', job.sceneId, `completed → ${result.path}`);
        return {
          success: true,
          assets: { compositePath: result.path },
        };
      }

      // Fallback: use background if compositing fails
      log('COMPOSITE', job.sceneId, `compositing failed: ${extractErrorMessage(result.error)} — using background`);
      return {
        success: true,
        assets: { compositePath: assets.backgroundPath },
      };
    } catch (err) {
      log('COMPOSITE', job.sceneId, `error: ${err} — using background`);
      return {
        success: true,
        assets: { compositePath: assets.backgroundPath },
      };
    }
  }

  // No person — use background directly
  log('COMPOSITE', job.sceneId, 'no person layer — using background as composite');
  return {
    success: true,
    assets: { compositePath: assets.backgroundPath },
  };
}

// ---------------------------------------------------------------------------
// Stage 6: Quality Check
// ---------------------------------------------------------------------------

export async function runQualityStage(
  job: SceneJob,
  assets: SceneAssets,
  qualityThreshold: number,
): Promise<StageResult> {
  if (!job.qualityCheckRequired) {
    logSkip(job.sceneId, 'QUALITY', 'not required');
    return {
      success: true,
      assets: { qualityPassedPath: assets.compositePath || assets.backgroundPath },
    };
  }

  const imagePath = assets.compositePath || assets.backgroundPath;
  if (!imagePath) {
    return {
      success: false,
      assets: {},
      qualityResult: {
        passed: false,
        score: 0,
        issues: [{ code: 'NO_IMAGE', severity: 'error', message: 'No image to check' }],
        recommendations: ['Generate a background first'],
        checkedAt: Date.now(),
      },
    };
  }

  log('QUALITY', job.sceneId, 'checking image quality...');

  try {
    const result = await window.docuflow.checkImageQuality({
      imagePath,
      expectedWidth: job.targetWidth,
      expectedHeight: job.targetHeight,
      requirePerson: job.personRequired,
    });

    const qualityResult: QualityResult = {
      passed: result.passed && result.score >= qualityThreshold,
      score: result.score,
      issues: result.issues || [],
      recommendations: result.recommendations || [],
      identitySimilarityScore: result.identitySimilarityScore,
      checkedAt: Date.now(),
    };

    if (qualityResult.passed) {
      log('QUALITY', job.sceneId, `PASSED (score=${qualityResult.score.toFixed(2)})`);
    } else {
      log('QUALITY', job.sceneId, `FAILED (score=${qualityResult.score.toFixed(2)}, issues=${qualityResult.issues.length})`);
    }

    return {
      success: qualityResult.passed,
      assets: qualityResult.passed
        ? { qualityPassedPath: imagePath }
        : {},
      qualityResult,
    };
  } catch (err) {
    return {
      success: false,
      assets: {},
      qualityResult: {
        passed: false,
        score: 0,
        issues: [{
          code: 'QUALITY_CHECK_ERROR',
          severity: 'error',
          message: err instanceof Error ? err.message : 'Quality check failed',
        }],
        recommendations: [],
        checkedAt: Date.now(),
      },
    };
  }
}

// ---------------------------------------------------------------------------
// Stage 7: Upscale (Real-ESRGAN)
// ---------------------------------------------------------------------------

export async function runUpscaleStage(
  job: SceneJob,
  assets: SceneAssets,
): Promise<StageResult> {
  if (!job.upscaleRequired) {
    logSkip(job.sceneId, 'UPSCALE', 'not required');
    return {
      success: true,
      assets: { upscaledPath: assets.qualityPassedPath || assets.compositePath },
    };
  }

  const inputPath = assets.qualityPassedPath || assets.compositePath;
  if (!inputPath) {
    return {
      success: false,
      assets: {},
      error: 'No image to upscale',
    };
  }

  log('UPSCALE', job.sceneId, `upscaling ${inputPath}...`);

  try {
    const outputPath = `%TEMP%\\docuflow\\pipeline\\${job.sceneId}_upscaled.png`;

    const result = await window.docuflow.upscaleImage({
      inputPath,
      outputPath,
      scale: 2,
      device: job.device || 'auto',
    });

    if (result.success && result.path) {
      log('UPSCALE', job.sceneId, `completed ${result.inputSize} → ${result.outputSize} (${result.time}s)`);
      return {
        success: true,
        assets: { upscaledPath: result.path },
      };
    }

    return {
      success: false,
      assets: {},
      error: result.error || 'Upscale failed',
    };
  } catch (err) {
    return {
      success: false,
      assets: {},
      error: err instanceof Error ? err.message : 'Upscale failed',
    };
  }
}

// ---------------------------------------------------------------------------
// Stage Orchestrator — runs a single stage on a job
// ---------------------------------------------------------------------------

export async function runStage(
  stage: PipelineStageName,
  job: SceneJob,
  config: {
    modelPath: string;
    projectName: string;
    qualityThreshold: number;
  },
): Promise<StageResult> {
  switch (stage) {
    case 'BACKGROUND':
      return runBackgroundStage(job, config.modelPath, config.projectName);
    case 'PERSON':
      return runPersonStage(job, config.modelPath, config.projectName);
    case 'POSE':
      return runPoseStage(job, config.projectName);
    case 'SEGMENT':
      return runSegmentStage(job, job.assets, config.projectName);
    case 'COMPOSITE':
      return runCompositeStage(job, job.assets);
    case 'QUALITY':
      return runQualityStage(job, job.assets, config.qualityThreshold);
    case 'UPSCALE':
      return runUpscaleStage(job, job.assets);
    default:
      return { success: false, assets: {}, error: `Unknown stage: ${stage}` };
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Generate a simple center mask using canvas.
 * Returns the file path of the saved mask.
 */
async function generateSimpleMask(
  width: number,
  height: number,
  projectName: string,
  sceneId: string,
): Promise<string | null> {
  try {
    // Create a simple oval mask in the center of the image
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;

    // Black background
    ctx.fillStyle = '#000000';
    ctx.fillRect(0, 0, width, height);

    // White oval in center (person region)
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.ellipse(
      width / 2,
      height / 2,
      width * 0.3,
      height * 0.45,
      0,
      0,
      Math.PI * 2,
    );
    ctx.fill();

    // Convert to blob and save
    const blob = await new Promise<Blob | null>((resolve) => {
      canvas.toBlob(resolve, 'image/png');
    });

    if (!blob) return null;

    const arrayBuffer = await blob.arrayBuffer();
    const base64 = btoa(String.fromCharCode(...new Uint8Array(arrayBuffer)));
    const filename = `${sceneId}_mask.png`;

    const result = await window.docuflow.saveBytes({
      imageBase64: base64,
      filename,
    });

    return result.success && result.path ? result.path : null;
  } catch {
    return null;
  }
}
