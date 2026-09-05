/**
 * Quality Checker
 *
 * Validates generated images before upscaling.
 * Checks image existence, dimensions, brightness, black/blank detection,
 * and optionally person presence and identity similarity.
 */

import type { QualityResult, QualityIssue } from './PipelineTypes';

// ---------------------------------------------------------------------------
// Quality check via main process IPC
// ---------------------------------------------------------------------------

export interface QualityCheckRequest {
  imagePath: string;
  expectedWidth: number;
  expectedHeight: number;
  requirePerson: boolean;
}

export interface QualityCheckResponse {
  passed: boolean;
  score: number;
  issues: QualityIssue[];
  recommendations: string[];
  identitySimilarityScore?: number;
}

/**
 * Run quality checks on an image.
 * Delegates to the main process which reads the image file and performs checks.
 */
export async function checkImageQuality(
  req: QualityCheckRequest,
): Promise<QualityCheckResponse> {
  try {
    const result = await window.docuflow.checkImageQuality(req);
    return result;
  } catch (err) {
    return {
      passed: false,
      score: 0,
      issues: [{
        code: 'QUALITY_CHECK_ERROR',
        severity: 'error',
        message: err instanceof Error ? err.message : 'Quality check failed',
      }],
      recommendations: [],
    };
  }
}

/**
 * Build a QualityResult from a quality check response.
 */
export function buildQualityResult(response: QualityCheckResponse): QualityResult {
  return {
    passed: response.passed,
    score: response.score,
    issues: response.issues,
    recommendations: response.recommendations,
    identitySimilarityScore: response.identitySimilarityScore,
    checkedAt: Date.now(),
  };
}
