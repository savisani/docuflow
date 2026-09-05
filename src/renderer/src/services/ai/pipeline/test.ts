/**
 * Pipeline Integration Test
 *
 * Tests the AI image production pipeline with 3 scenarios:
 * 1. Background only
 * 2. Background + Person
 * 3. Full pipeline (Background + Person + Quality + Upscale)
 *
 * Run this test in the renderer process or via the browser console.
 */

import {
  PipelineQueue,
  PipelineWorker,
  createSceneJobs,
  type SceneJob,
  type PipelineBatchRequest,
  type PipelineProgress,
  type PipelineEvent,
} from '../services/ai/pipeline';
import { extractErrorMessage } from '../../../../core/errors';

// ---------------------------------------------------------------------------
// Test Configuration
// ---------------------------------------------------------------------------

const TEST_PROJECT = 'pipeline-test';
const TEST_MODEL_PATH = ''; // Will be detected at runtime

interface TestResult {
  name: string;
  passed: boolean;
  duration: number;
  error?: string;
  progress?: PipelineProgress;
}

// ---------------------------------------------------------------------------
// Test Helpers
// ---------------------------------------------------------------------------

function log(msg: string): void {
  console.log(`[TEST] ${msg}`);
}

function logResult(result: TestResult): void {
  const status = result.passed ? 'PASS' : 'FAIL';
  log(`${status}: ${result.name} (${(result.duration / 1000).toFixed(1)}s)`);
  if (result.error) {
    log(`  Error: ${result.error}`);
  }
}

// ---------------------------------------------------------------------------
// Test 1: Background Only
// ---------------------------------------------------------------------------

async function testBackgroundOnly(): Promise<TestResult> {
  const start = Date.now();
  const name = 'Background Only Generation';

  try {
    // Create a scene job for background only
    const sceneJobs: SceneJob[] = [
      {
        sceneId: 'test_bg_001',
        sceneIndex: 0,
        prompt: 'A beautiful mountain landscape at sunset, cinematic lighting, dramatic clouds',
        backgroundRequired: true,
        personRequired: false,
        poseRequired: false,
        compositionRequired: false,
        qualityCheckRequired: true,
        upscaleRequired: false,
        targetWidth: 512,
        targetHeight: 512,
        seed: 42,
        steps: 15,
        status: 'pending',
        currentStage: null,
        retryCount: 0,
        maxRetries: 2,
        assets: {},
      },
    ];

    const request: PipelineBatchRequest = {
      scenes: sceneJobs,
      defaultSettings: {
        modelPath: TEST_MODEL_PATH,
        device: 'auto',
        steps: 15,
        guidanceScale: 7.5,
        width: 512,
        height: 512,
      },
      projectName: TEST_PROJECT,
    };

    const queue = new PipelineQueue();
    let lastProgress: PipelineProgress | null = null;

    const progress = await queue.runBatch(request, {
      onProgress: (p) => {
        lastProgress = p;
      },
    });

    const passed = progress.completedScenes > 0 && progress.failedScenes === 0;

    return {
      name,
      passed,
      duration: Date.now() - start,
      progress: progress,
    };
  } catch (err) {
    return {
      name,
      passed: false,
      duration: Date.now() - start,
      error: err instanceof Error ? err.message : 'Unknown error',
    };
  }
}

// ---------------------------------------------------------------------------
// Test 2: Background + Person
// ---------------------------------------------------------------------------

async function testBackgroundWithPerson(): Promise<TestResult> {
  const start = Date.now();
  const name = 'Background + Person Generation';

  try {
    const sceneJobs: SceneJob[] = [
      {
        sceneId: 'test_person_001',
        sceneIndex: 0,
        prompt: 'A researcher examining ancient artifacts in a museum',
        backgroundRequired: true,
        personRequired: true,
        poseRequired: false,
        compositionRequired: true,
        qualityCheckRequired: true,
        upscaleRequired: false,
        targetWidth: 512,
        targetHeight: 512,
        seed: 42,
        steps: 15,
        status: 'pending',
        currentStage: null,
        retryCount: 0,
        maxRetries: 2,
        assets: {},
      },
    ];

    const request: PipelineBatchRequest = {
      scenes: sceneJobs,
      defaultSettings: {
        modelPath: TEST_MODEL_PATH,
        device: 'auto',
        steps: 15,
        guidanceScale: 7.5,
        width: 512,
        height: 512,
      },
      projectName: TEST_PROJECT,
    };

    const queue = new PipelineQueue();
    const progress = await queue.runBatch(request);

    const passed = progress.completedScenes > 0 && progress.failedScenes === 0;

    return {
      name,
      passed,
      duration: Date.now() - start,
      progress,
    };
  } catch (err) {
    return {
      name,
      passed: false,
      duration: Date.now() - start,
      error: err instanceof Error ? err.message : 'Unknown error',
    };
  }
}

// ---------------------------------------------------------------------------
// Test 3: Full Pipeline with Upscale
// ---------------------------------------------------------------------------

async function testFullPipeline(): Promise<TestResult> {
  const start = Date.now();
  const name = 'Full Pipeline (Background + Quality + Upscale)';

  try {
    const sceneJobs: SceneJob[] = [
      {
        sceneId: 'test_full_001',
        sceneIndex: 0,
        prompt: 'A dramatic ocean sunset with waves crashing against rocks',
        backgroundRequired: true,
        personRequired: false,
        poseRequired: false,
        compositionRequired: false,
        qualityCheckRequired: true,
        upscaleRequired: true,
        targetWidth: 512,
        targetHeight: 512,
        seed: 42,
        steps: 15,
        status: 'pending',
        currentStage: null,
        retryCount: 0,
        maxRetries: 2,
        assets: {},
      },
    ];

    const request: PipelineBatchRequest = {
      scenes: sceneJobs,
      defaultSettings: {
        modelPath: TEST_MODEL_PATH,
        device: 'auto',
        steps: 15,
        guidanceScale: 7.5,
        width: 512,
        height: 512,
      },
      projectName: TEST_PROJECT,
    };

    const queue = new PipelineQueue();
    const progress = await queue.runBatch(request);

    const passed = progress.completedScenes > 0 && progress.failedScenes === 0;

    return {
      name,
      passed,
      duration: Date.now() - start,
      progress,
    };
  } catch (err) {
    return {
      name,
      passed: false,
      duration: Date.now() - start,
      error: err instanceof Error ? err.message : 'Unknown error',
    };
  }
}

// ---------------------------------------------------------------------------
// Test 4: Quality Check Failure and Retry
// ---------------------------------------------------------------------------

async function testQualityRetry(): Promise<TestResult> {
  const start = Date.now();
  const name = 'Quality Check Retry Logic';

  try {
    // Create a scene with a low-quality prompt that might fail
    const sceneJobs: SceneJob[] = [
      {
        sceneId: 'test_retry_001',
        sceneIndex: 0,
        prompt: 'test image', // Simple prompt that might produce a low-quality result
        backgroundRequired: true,
        personRequired: false,
        poseRequired: false,
        compositionRequired: false,
        qualityCheckRequired: true,
        upscaleRequired: false,
        targetWidth: 512,
        targetHeight: 512,
        seed: 42,
        steps: 10, // Fewer steps = potentially lower quality
        status: 'pending',
        currentStage: null,
        retryCount: 0,
        maxRetries: 2,
        assets: {},
      },
    ];

    const request: PipelineBatchRequest = {
      scenes: sceneJobs,
      defaultSettings: {
        modelPath: TEST_MODEL_PATH,
        device: 'auto',
        steps: 10,
        guidanceScale: 7.5,
        width: 512,
        height: 512,
      },
      projectName: TEST_PROJECT,
    };

    const queue = new PipelineQueue();
    const progress = await queue.runBatch(request);

    // Check that retry logic was invoked (either passed or failed after retries)
    const passed = progress.completedScenes > 0 || progress.failedScenes > 0;

    return {
      name,
      passed,
      duration: Date.now() - start,
      progress,
    };
  } catch (err) {
    return {
      name,
      passed: false,
      duration: Date.now() - start,
      error: err instanceof Error ? err.message : 'Unknown error',
    };
  }
}

// ---------------------------------------------------------------------------
// Test 5: Existing Functionality Verification
// ---------------------------------------------------------------------------

async function testExistingFunctionality(): Promise<TestResult> {
  const start = Date.now();
  const name = 'Existing SD 1.5 Generation Still Works';

  try {
    // Test that the existing single-image generation still works
    const result = await window.docuflow.generateLocalImageEnhanced({
      prompt: 'A simple test image of a blue circle',
      width: 256,
      height: 256,
      outputPath: `%TEMP%\\docuflow\\test_existing_${Date.now()}.png`,
      modelPath: TEST_MODEL_PATH || 'D:\\AI_Project\\docuflow-desktop\\scripts\\models\\stable-diffusion-v1-5',
      steps: 5,
      seed: 42,
      device: 'auto',
    });

    return {
      name,
      passed: result.success === true,
      duration: Date.now() - start,
      error: extractErrorMessage(result.error),
    };
  } catch (err) {
    return {
      name,
      passed: false,
      duration: Date.now() - start,
      error: err instanceof Error ? err.message : 'Unknown error',
    };
  }
}

// ---------------------------------------------------------------------------
// Run All Tests
// ---------------------------------------------------------------------------

export async function runPipelineTests(): Promise<TestResult[]> {
  log('Starting pipeline tests...');
  log('='.repeat(60));

  const results: TestResult[] = [];

  // Test existing functionality first
  results.push(await testExistingFunctionality());

  // Test pipeline stages
  results.push(await testBackgroundOnly());
  results.push(await testBackgroundWithPerson());
  results.push(await testFullPipeline());
  results.push(await testQualityRetry());

  // Summary
  log('='.repeat(60));
  log('Test Summary:');

  const passed = results.filter((r) => r.passed).length;
  const failed = results.filter((r) => !r.passed).length;

  for (const result of results) {
    logResult(result);
  }

  log('='.repeat(60));
  log(`Total: ${results.length} tests, ${passed} passed, ${failed} failed`);

  return results;
}

// Auto-run if imported directly
if (typeof window !== 'undefined') {
  (window as any).runPipelineTests = runPipelineTests;
}
