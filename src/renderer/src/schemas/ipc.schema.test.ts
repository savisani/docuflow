import { describe, test, expect } from 'vitest';
import {
  GenerateLocalEnhancedSchema,
  TranscribeAudioSchema,
  BatchGenerateSchema,
  BatchUpscaleSchema,
  CompositeSchema,
  UpscaleSchema,
  SaveImageSchema,
} from './ipc.schema';

describe('GenerateLocalEnhancedSchema', () => {
  test('accepts valid params', () => {
    const result = GenerateLocalEnhancedSchema.safeParse({
      prompt: 'a beautiful landscape',
      width: 512,
      height: 512,
      outputPath: '/tmp/output.png',
      modelPath: '/models/sd15',
    });
    expect(result.success).toBe(true);
  });

  test('accepts with all optional fields', () => {
    const result = GenerateLocalEnhancedSchema.safeParse({
      prompt: 'a beautiful landscape',
      negativePrompt: 'blurry',
      width: 512,
      height: 512,
      outputPath: '/tmp/output.png',
      modelPath: '/models/sd15',
      steps: 20,
      seed: 42,
      device: 'cuda',
      generationId: 'gen-1',
      unloadAfter: true,
    });
    expect(result.success).toBe(true);
  });

  test('rejects empty prompt', () => {
    const result = GenerateLocalEnhancedSchema.safeParse({
      prompt: '',
      width: 512,
      height: 512,
      outputPath: '/tmp/output.png',
      modelPath: '/models/sd15',
    });
    expect(result.success).toBe(false);
  });

  test('rejects zero width', () => {
    const result = GenerateLocalEnhancedSchema.safeParse({
      prompt: 'test',
      width: 0,
      height: 512,
      outputPath: '/tmp/output.png',
      modelPath: '/models/sd15',
    });
    expect(result.success).toBe(false);
  });

  test('rejects missing modelPath', () => {
    const result = GenerateLocalEnhancedSchema.safeParse({
      prompt: 'test',
      width: 512,
      height: 512,
      outputPath: '/tmp/output.png',
    });
    expect(result.success).toBe(false);
  });
});

describe('TranscribeAudioSchema', () => {
  test('accepts valid params', () => {
    const result = TranscribeAudioSchema.safeParse({
      audioPath: '/path/to/audio.wav',
    });
    expect(result.success).toBe(true);
  });

  test('accepts with modelSize', () => {
    const result = TranscribeAudioSchema.safeParse({
      audioPath: '/path/to/audio.wav',
      modelSize: 'medium',
    });
    expect(result.success).toBe(true);
  });

  test('rejects empty audioPath', () => {
    const result = TranscribeAudioSchema.safeParse({
      audioPath: '',
    });
    expect(result.success).toBe(false);
  });
});

describe('BatchGenerateSchema', () => {
  test('accepts valid params', () => {
    const result = BatchGenerateSchema.safeParse({
      jobs: [
        { sceneId: 's1', prompt: 'a forest' },
        { sceneId: 's2', prompt: 'a mountain' },
      ],
      modelPath: '/models/sd15',
      outputDir: '/tmp/output',
    });
    expect(result.success).toBe(true);
  });

  test('rejects empty jobs', () => {
    const result = BatchGenerateSchema.safeParse({
      jobs: [],
      modelPath: '/models/sd15',
      outputDir: '/tmp/output',
    });
    expect(result.success).toBe(false);
  });

  test('rejects job without sceneId', () => {
    const result = BatchGenerateSchema.safeParse({
      jobs: [{ prompt: 'a forest' }],
      modelPath: '/models/sd15',
      outputDir: '/tmp/output',
    });
    expect(result.success).toBe(false);
  });

  test('rejects missing modelPath', () => {
    const result = BatchGenerateSchema.safeParse({
      jobs: [{ sceneId: 's1', prompt: 'a forest' }],
      outputDir: '/tmp/output',
    });
    expect(result.success).toBe(false);
  });
});

describe('BatchUpscaleSchema', () => {
  test('accepts valid params', () => {
    const result = BatchUpscaleSchema.safeParse({
      jobs: [
        { sceneId: 's1', inputPath: '/tmp/img1.png' },
      ],
      outputDir: '/tmp/output',
    });
    expect(result.success).toBe(true);
  });

  test('rejects empty jobs', () => {
    const result = BatchUpscaleSchema.safeParse({
      jobs: [],
      outputDir: '/tmp/output',
    });
    expect(result.success).toBe(false);
  });
});

describe('CompositeSchema', () => {
  test('accepts valid params', () => {
    const result = CompositeSchema.safeParse({
      backgroundPath: '/tmp/bg.png',
      foregroundPath: '/tmp/fg.png',
      outputPath: '/tmp/out.png',
      width: 512,
      height: 512,
    });
    expect(result.success).toBe(true);
  });

  test('accepts with maskPath', () => {
    const result = CompositeSchema.safeParse({
      backgroundPath: '/tmp/bg.png',
      foregroundPath: '/tmp/fg.png',
      maskPath: '/tmp/mask.png',
      outputPath: '/tmp/out.png',
      width: 512,
      height: 512,
    });
    expect(result.success).toBe(true);
  });

  test('rejects zero width', () => {
    const result = CompositeSchema.safeParse({
      backgroundPath: '/tmp/bg.png',
      foregroundPath: '/tmp/fg.png',
      outputPath: '/tmp/out.png',
      width: 0,
      height: 512,
    });
    expect(result.success).toBe(false);
  });
});

describe('UpscaleSchema', () => {
  test('accepts valid params', () => {
    const result = UpscaleSchema.safeParse({
      inputPath: '/tmp/input.png',
      outputPath: '/tmp/output.png',
    });
    expect(result.success).toBe(true);
  });

  test('accepts with scale and device', () => {
    const result = UpscaleSchema.safeParse({
      inputPath: '/tmp/input.png',
      outputPath: '/tmp/output.png',
      scale: 4,
      device: 'cuda',
    });
    expect(result.success).toBe(true);
  });
});

describe('SaveImageSchema', () => {
  test('accepts valid params', () => {
    const result = SaveImageSchema.safeParse({
      imageBase64: 'iVBORw0KGgoAAAANSUhEUg==',
    });
    expect(result.success).toBe(true);
  });

  test('rejects empty base64', () => {
    const result = SaveImageSchema.safeParse({
      imageBase64: '',
    });
    expect(result.success).toBe(false);
  });
});
