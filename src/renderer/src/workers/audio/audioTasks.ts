/**
 * Audio Worker Tasks
 *
 * Pure computation functions and Zod validation schemas for audio processing.
 * This module is safe to import from both the main thread and the worker.
 * It has zero dependencies on React, Zustand, Electron, DOM, or Canvas.
 */

import { z } from 'zod';

// ---------------------------------------------------------------------------
// Zod Schemas
// ---------------------------------------------------------------------------

/**
 * Note: Float32Array cannot be validated by Zod directly since it's not
 * JSON-serializable. The schema validates the serializable metadata.
 * The Float32Array is validated by runtime type checking in extractPeaks.
 */
export const ExtractPeaksPayloadSchema = z.object({
  numBars: z.number().int().positive(),
});

export const ExtractPeaksResultSchema = z.object({
  peaks: z.array(z.number().min(0).max(1)),
  peakMax: z.number().min(0),
});

// ---------------------------------------------------------------------------
// Pure Computation
// ---------------------------------------------------------------------------

export interface ExtractPeaksInput {
  channelData: Float32Array;
  numBars: number;
}

export interface ExtractPeaksOutput {
  peaks: number[];
  peakMax: number;
}

/**
 * Extract peak amplitudes from audio PCM sample data.
 *
 * Divides the Float32Array into `numBars` equal segments and computes
 * the maximum absolute amplitude in each segment.
 *
 * This is a pure function with no side effects, no DOM access,
 * and no environment dependencies.
 *
 * Preserves the original algorithm from Timeline.tsx exactly:
 * - Each bar covers `samplesPerBar = floor(channelData.length / numBars)` samples
 * - Peak is the max absolute value in each segment
 * - Falls back to 0 for out-of-range samples (|| 0)
 * - peakMax is max of all peaks, clamped to minimum 0.01
 */
export function extractPeaks(input: ExtractPeaksInput): ExtractPeaksOutput {
  const { channelData, numBars } = input;

  if (!(channelData instanceof Float32Array) || channelData.length === 0) {
    return { peaks: new Array(Math.max(1, numBars)).fill(0), peakMax: 0.01 };
  }

  const safeNumBars = Math.max(1, numBars);
  const samplesPerBar = Math.floor(channelData.length / safeNumBars);
  const peaks: number[] = [];

  if (samplesPerBar <= 0) {
    // More bars than samples — fill with zeros
    for (let i = 0; i < safeNumBars; i++) {
      peaks.push(0);
    }
    return { peaks, peakMax: 0.01 };
  }

  for (let i = 0; i < safeNumBars; i++) {
    let max = 0;
    const start = i * samplesPerBar;
    const end = Math.min(start + samplesPerBar, channelData.length);
    for (let j = start; j < end; j++) {
      const val = Math.abs(channelData[j] || 0);
      if (val > max) max = val;
    }
    peaks.push(max);
  }

  const peakMax = Math.max(...peaks, 0.01);

  return { peaks, peakMax };
}

/**
 * Validate that a Float32Array is a valid typed array input.
 */
export function isValidChannelData(data: unknown): data is Float32Array {
  return data instanceof Float32Array && data.length > 0;
}
