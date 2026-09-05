import { describe, test, expect } from 'vitest';
import { extractPeaks, isValidChannelData, ExtractPeaksPayloadSchema, ExtractPeaksResultSchema } from '../audio/audioTasks';
import type { ExtractPeaksInput } from '../audio/audioTasks';

describe('extractPeaks', () => {
  test('extracts peaks from a simple signal', () => {
    // 4 bars, 8 samples total → 2 samples per bar
    const data = new Float32Array([0.5, 0.8, 0.3, 0.1, 0.9, 0.2, 0.4, 0.7]);
    const result = extractPeaks({ channelData: data, numBars: 4 });

    expect(result.peaks).toHaveLength(4);
    expect(result.peaks[0]).toBeCloseTo(0.8, 5);
    expect(result.peaks[1]).toBeCloseTo(0.3, 5);
    expect(result.peaks[2]).toBeCloseTo(0.9, 5);
    expect(result.peaks[3]).toBeCloseTo(0.7, 5);
    expect(result.peakMax).toBeCloseTo(0.9, 5);
  });

  test('handles single bar', () => {
    const data = new Float32Array([0.1, 0.5, 0.3, 0.9]);
    const result = extractPeaks({ channelData: data, numBars: 1 });

    expect(result.peaks).toHaveLength(1);
    expect(result.peaks[0]).toBeCloseTo(0.9, 5);
    expect(result.peakMax).toBeCloseTo(0.9, 5);
  });

  test('handles all zeros', () => {
    const data = new Float32Array([0, 0, 0, 0]);
    const result = extractPeaks({ channelData: data, numBars: 2 });

    expect(result.peaks).toEqual([0, 0]);
    expect(result.peakMax).toBe(0.01); // minimum floor
  });

  test('handles negative values (takes absolute)', () => {
    const data = new Float32Array([-0.8, -0.3, 0.5, -0.9]);
    const result = extractPeaks({ channelData: data, numBars: 2 });

    expect(result.peaks[0]).toBeCloseTo(0.8, 5);
    expect(result.peaks[1]).toBeCloseTo(0.9, 5);
  });

  test('handles empty Float32Array', () => {
    const data = new Float32Array([]);
    const result = extractPeaks({ channelData: data, numBars: 4 });

    expect(result.peaks).toEqual([0, 0, 0, 0]);
    expect(result.peakMax).toBe(0.01);
  });

  test('handles more bars than samples', () => {
    const data = new Float32Array([0.5]);
    const result = extractPeaks({ channelData: data, numBars: 4 });

    // samplesPerBar = floor(1/4) = 0, so all bars are 0
    expect(result.peaks).toEqual([0, 0, 0, 0]);
    expect(result.peakMax).toBe(0.01);
  });

  test('preserves exact algorithm from original Timeline.tsx', () => {
    // Replicate the exact loop from Timeline.tsx lines 1055-1062
    const channelData = new Float32Array([0.2, 0.6, 0.1, 0.8, 0.4, 0.9, 0.3, 0.7]);
    const numBars = 4;
    const samplesPerBar = Math.floor(channelData.length / numBars);

    // Original algorithm
    const originalPeaks: number[] = [];
    for (let i = 0; i < numBars; i++) {
      let max = 0;
      for (let j = 0; j < samplesPerBar; j++) {
        const val = Math.abs(channelData[i * samplesPerBar + j] || 0);
        if (val > max) max = val;
      }
      originalPeaks.push(max);
    }

    // Our implementation
    const result = extractPeaks({ channelData, numBars });

    expect(result.peaks).toEqual(originalPeaks);
  });

  test('handles large input efficiently', () => {
    // Simulate a 3-minute 44.1kHz audio file
    const size = 44100 * 60 * 3;
    const data = new Float32Array(size);
    for (let i = 0; i < size; i++) {
      data[i] = Math.sin(i / 1000) * 0.5;
    }

    const result = extractPeaks({ channelData: data, numBars: 1000 });

    expect(result.peaks).toHaveLength(1000);
    expect(result.peakMax).toBeGreaterThan(0);
    expect(result.peakMax).toBeLessThanOrEqual(1);
  });

  test('numBars of 0 is treated as 1', () => {
    const data = new Float32Array([0.5, 0.3]);
    const result = extractPeaks({ channelData: data, numBars: 0 });

    expect(result.peaks).toHaveLength(1);
  });
});

describe('isValidChannelData', () => {
  test('returns true for valid Float32Array', () => {
    expect(isValidChannelData(new Float32Array([1, 2, 3]))).toBe(true);
  });

  test('returns false for empty Float32Array', () => {
    expect(isValidChannelData(new Float32Array([]))).toBe(false);
  });

  test('returns false for regular Array', () => {
    expect(isValidChannelData([1, 2, 3])).toBe(false);
  });

  test('returns false for null', () => {
    expect(isValidChannelData(null)).toBe(false);
  });

  test('returns false for undefined', () => {
    expect(isValidChannelData(undefined)).toBe(false);
  });

  test('returns false for plain object', () => {
    expect(isValidChannelData({ length: 3 })).toBe(false);
  });
});

describe('ExtractPeaksPayloadSchema', () => {
  test('accepts valid payload', () => {
    const result = ExtractPeaksPayloadSchema.safeParse({ numBars: 100 });
    expect(result.success).toBe(true);
  });

  test('rejects non-integer numBars', () => {
    const result = ExtractPeaksPayloadSchema.safeParse({ numBars: 1.5 });
    expect(result.success).toBe(false);
  });

  test('rejects zero numBars', () => {
    const result = ExtractPeaksPayloadSchema.safeParse({ numBars: 0 });
    expect(result.success).toBe(false);
  });

  test('rejects negative numBars', () => {
    const result = ExtractPeaksPayloadSchema.safeParse({ numBars: -1 });
    expect(result.success).toBe(false);
  });

  test('rejects missing numBars', () => {
    const result = ExtractPeaksPayloadSchema.safeParse({});
    expect(result.success).toBe(false);
  });
});

describe('ExtractPeaksResultSchema', () => {
  test('accepts valid result', () => {
    const result = ExtractPeaksResultSchema.safeParse({
      peaks: [0.5, 0.8, 0.3],
      peakMax: 0.8,
    });
    expect(result.success).toBe(true);
  });

  test('rejects negative peak values', () => {
    const result = ExtractPeaksResultSchema.safeParse({
      peaks: [-0.5],
      peakMax: 0.5,
    });
    expect(result.success).toBe(false);
  });

  test('rejects peak values > 1', () => {
    const result = ExtractPeaksResultSchema.safeParse({
      peaks: [1.5],
      peakMax: 1.5,
    });
    expect(result.success).toBe(false);
  });

  test('rejects negative peakMax', () => {
    const result = ExtractPeaksResultSchema.safeParse({
      peaks: [0.5],
      peakMax: -1,
    });
    expect(result.success).toBe(false);
  });
});
