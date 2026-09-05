import { describe, test, expect } from 'vitest';
import { AssetSchema, SerializedAssetSchema } from './asset.schema';

describe('AssetSchema', () => {
  const validImage = {
    id: 'asset-1',
    logicalId: 'logical-1',
    filename: 'photo.jpg',
    type: 'image',
    mimeType: 'image/jpeg',
    width: 1920,
    height: 1080,
    filePath: '/path/to/photo.jpg',
  };

  const validAudio = {
    id: 'asset-2',
    logicalId: 'logical-2',
    filename: 'music.mp3',
    type: 'audio',
    mimeType: 'audio/mpeg',
    duration: 180,
    audioRole: 'music',
    sampleRate: 44100,
    channels: 2,
  };

  test('accepts valid image asset', () => {
    const result = AssetSchema.safeParse(validImage);
    expect(result.success).toBe(true);
  });

  test('accepts valid audio asset', () => {
    const result = AssetSchema.safeParse(validAudio);
    expect(result.success).toBe(true);
  });

  test('accepts asset with minimal fields', () => {
    const result = AssetSchema.safeParse({
      id: 'a',
      logicalId: 'l',
      filename: 'f.png',
      type: 'image',
      mimeType: 'image/png',
    });
    expect(result.success).toBe(true);
  });

  test('rejects missing id', () => {
    const result = AssetSchema.safeParse({
      logicalId: 'l',
      filename: 'f.png',
      type: 'image',
      mimeType: 'image/png',
    });
    expect(result.success).toBe(false);
  });

  test('rejects invalid type', () => {
    const result = AssetSchema.safeParse({
      id: 'a',
      logicalId: 'l',
      filename: 'f.png',
      type: 'invalid',
      mimeType: 'image/png',
    });
    expect(result.success).toBe(false);
  });

  test('rejects invalid audioRole', () => {
    const result = AssetSchema.safeParse({
      id: 'a',
      logicalId: 'l',
      filename: 'f.mp3',
      type: 'audio',
      mimeType: 'audio/mpeg',
      audioRole: 'invalid',
    });
    expect(result.success).toBe(false);
  });

  test('accepts all valid audioRole values', () => {
    for (const role of ['voiceover', 'music', 'sfx', 'ambient', 'unassigned']) {
      const result = AssetSchema.safeParse({
        id: 'a',
        logicalId: 'l',
        filename: 'f.mp3',
        type: 'audio',
        mimeType: 'audio/mpeg',
        audioRole: role,
      });
      expect(result.success).toBe(true);
    }
  });
});

describe('SerializedAssetSchema', () => {
  test('accepts valid serialized asset', () => {
    const result = SerializedAssetSchema.safeParse({
      id: 'asset-1',
      logicalId: 'logical-1',
      filename: 'photo.jpg',
      type: 'image',
      mimeType: 'image/jpeg',
    });
    expect(result.success).toBe(true);
  });

  test('rejects invalid type', () => {
    const result = SerializedAssetSchema.safeParse({
      id: 'a',
      logicalId: 'l',
      filename: 'f.png',
      type: 'document',
      mimeType: 'application/pdf',
    });
    expect(result.success).toBe(false);
  });
});
