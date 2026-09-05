import { describe, test, expect } from 'vitest';
import { findAsset, findAssetByLogicalId, generateLogicalId, getAssetUrl, getAssetById } from './findAsset';
import { Asset } from '../../types/assets';

function makeAsset(id: string, logicalId: string, filename: string, type: Asset['type'] = 'image', audioRole?: string): Asset {
  return {
    id,
    logicalId,
    filename,
    type,
    mimeType: type === 'audio' ? 'audio/mpeg' : 'image/jpeg',
    audioRole: audioRole as any,
  };
}

const assets: Asset[] = [
  makeAsset('uuid-1', 'image1', 'photo.jpg', 'image'),
  makeAsset('uuid-2', 'image2', 'landscape.png', 'image'),
  makeAsset('uuid-3', 'audio1', 'music.mp3', 'audio', 'music'),
  makeAsset('uuid-4', 'audio2', 'voiceover.wav', 'audio', 'voiceover'),
];

describe('findAsset', () => {
  test('finds by id', () => {
    const asset = findAsset(assets, 'uuid-1');
    expect(asset).toBeDefined();
    expect(asset?.id).toBe('uuid-1');
  });

  test('finds by logicalId', () => {
    const asset = findAsset(assets, 'image1');
    expect(asset).toBeDefined();
    expect(asset?.logicalId).toBe('image1');
  });

  test('finds by exact filename', () => {
    const asset = findAsset(assets, 'photo.jpg');
    expect(asset).toBeDefined();
    expect(asset?.filename).toBe('photo.jpg');
  });

  test('finds by filename without extension', () => {
    const asset = findAsset(assets, 'photo');
    expect(asset).toBeDefined();
    expect(asset?.filename).toBe('photo.jpg');
  });

  test('finds case-insensitively by filename', () => {
    const asset = findAsset(assets, 'PHOTO');
    expect(asset).toBeDefined();
    expect(asset?.filename).toBe('photo.jpg');
  });

  test('returns undefined for nonexistent asset', () => {
    const asset = findAsset(assets, 'nonexistent');
    expect(asset).toBeUndefined();
  });

  test('prefers id match over logicalId', () => {
    const mixedAssets = [
      makeAsset('image1', 'other', 'a.jpg'),
      makeAsset('other', 'image1', 'b.jpg'),
    ];
    const asset = findAsset(mixedAssets, 'image1');
    expect(asset?.id).toBe('image1');
  });
});

describe('findAssetByLogicalId', () => {
  test('finds by logicalId', () => {
    const asset = findAssetByLogicalId(assets, 'image1');
    expect(asset).toBeDefined();
    expect(asset?.logicalId).toBe('image1');
  });

  test('returns undefined for nonexistent', () => {
    const asset = findAssetByLogicalId(assets, 'nonexistent');
    expect(asset).toBeUndefined();
  });
});

describe('generateLogicalId', () => {
  test('generates image1 for empty array', () => {
    const id = generateLogicalId('image', []);
    expect(id).toBe('image1');
  });

  test('generates image2 when image1 exists', () => {
    const existing = [makeAsset('a', 'image1', 'a.jpg')];
    const id = generateLogicalId('image', existing);
    expect(id).toBe('image2');
  });

  test('generates audio1 for audio type', () => {
    const id = generateLogicalId('audio', []);
    expect(id).toBe('audio1');
  });

  test('skips gaps', () => {
    const existing = [
      makeAsset('a', 'image1', 'a.jpg'),
      makeAsset('b', 'image2', 'b.jpg'),
      makeAsset('c', 'image4', 'c.jpg'),
    ];
    const id = generateLogicalId('image', existing);
    expect(id).toBe('image3');
  });
});

describe('getAssetUrl', () => {
  test('returns url if present', () => {
    const assetsWithUrl = [
      { ...assets[0], url: 'http://example.com/photo.jpg' },
    ];
    expect(getAssetUrl(assetsWithUrl, 'image1')).toBe('http://example.com/photo.jpg');
  });

  test('returns empty string if no url', () => {
    expect(getAssetUrl(assets, 'image1')).toBe('');
  });

  test('returns empty string for nonexistent', () => {
    expect(getAssetUrl(assets, 'nonexistent')).toBe('');
  });
});

describe('getAssetById', () => {
  test('finds by id', () => {
    const asset = getAssetById(assets, 'uuid-1');
    expect(asset?.id).toBe('uuid-1');
  });

  test('finds by logicalId', () => {
    const asset = getAssetById(assets, 'image1');
    expect(asset?.logicalId).toBe('image1');
  });

  test('returns undefined for nonexistent', () => {
    const asset = getAssetById(assets, 'nonexistent');
    expect(asset).toBeUndefined();
  });
});
