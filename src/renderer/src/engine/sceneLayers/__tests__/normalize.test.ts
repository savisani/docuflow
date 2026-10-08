import { describe, it, expect } from 'vitest';
import {
  hasLayerPlan,
  getSceneLayers,
  reindexLayers,
  composableLayers,
  deriveLayeredSceneStatus,
} from '../normalize';
import type { SceneLayer } from '../types';
import type { ProjectScene } from '../../../types/project';

function legacyScene(over: Partial<ProjectScene> = {}): ProjectScene {
  return {
    sceneId: 1,
    startTime: 0,
    endTime: 3,
    transcriptChunk: 'chunk',
    visualDescription: 'a village scene',
    imagePrompt: 'a village scene, cinematic',
    cameraMotion: 'static',
    status: 'done',
    imageId: 'legacy-asset',
    ...over,
  };
}

function layer(over: Partial<SceneLayer> & Pick<SceneLayer, 'id' | 'type' | 'order'>): SceneLayer {
  return {
    name: over.type,
    subject: 'subject',
    prompt: 'prompt',
    status: 'done',
    alphaMode: 'none',
    visible: true,
    ...over,
  };
}

describe('hasLayerPlan', () => {
  it('is true only for explicit layer arrays', () => {
    expect(hasLayerPlan({ layers: [] })).toBe(false);
    expect(hasLayerPlan({})).toBe(false);
    expect(hasLayerPlan({ layers: [layer({ id: 'a', type: 'background', order: 0 })] })).toBe(true);
  });
});

describe('getSceneLayers', () => {
  it('synthesizes a single background layer from a legacy single-image scene', () => {
    const layers = getSceneLayers(legacyScene());
    expect(layers).toHaveLength(1);
    expect(layers[0]).toMatchObject({
      type: 'background',
      assetId: 'legacy-asset',
      alphaMode: 'none',
      status: 'done',
    });
  });

  it('maps legacy scene status onto the synthesized layer', () => {
    expect(getSceneLayers(legacyScene({ status: 'error', error: 'boom' }))[0].status).toBe('error');
    expect(getSceneLayers(legacyScene({ status: 'generating' }))[0].status).toBe('generating');
  });

  it('returns no layers for a legacy scene that never generated an image', () => {
    expect(getSceneLayers(legacyScene({ imageId: undefined, status: 'pending' }))).toEqual([]);
  });

  it('returns explicit layers sorted back to front', () => {
    const scene = legacyScene({
      layers: [
        layer({ id: 'fg', type: 'foreground', order: 2, assetId: 'a3' }),
        layer({ id: 'bg', type: 'background', order: 0, assetId: 'a1' }),
        layer({ id: 'mid', type: 'midground', order: 1, assetId: 'a2' }),
      ],
    });
    expect(getSceneLayers(scene).map((l) => l.id)).toEqual(['bg', 'mid', 'fg']);
  });
});

describe('reindexLayers', () => {
  it('rewrites order from array position', () => {
    const out = reindexLayers([
      layer({ id: 'a', type: 'background', order: 0 }),
      layer({ id: 'b', type: 'midground', order: 7 }),
      layer({ id: 'c', type: 'foreground', order: 99 }),
    ]);
    expect(out.map((l) => l.order)).toEqual([0, 1, 2]);
  });
});

describe('composableLayers', () => {
  it('keeps only visible layers that resolved an asset', () => {
    const scene = legacyScene({
      layers: [
        layer({ id: 'bg', type: 'background', order: 0, assetId: 'a1' }),
        layer({ id: 'mid', type: 'midground', order: 1 }), // pending, no asset
        layer({ id: 'fg', type: 'foreground', order: 2, assetId: 'a3', visible: false }),
      ],
    });
    expect(composableLayers(scene).map((l) => l.id)).toEqual(['bg']);
  });
});

describe('deriveLayeredSceneStatus', () => {
  const L = (status: SceneLayer['status'], assetId?: string) =>
    layer({ id: `l-${status}-${assetId ?? 'x'}`, type: 'midground', order: 0, status, assetId });

  it('is generating while any layer generates', () => {
    expect(deriveLayeredSceneStatus([L('done', 'a'), L('generating')])).toBe('generating');
  });

  it('is done when at least one layer succeeded (partial scenes still build)', () => {
    expect(deriveLayeredSceneStatus([L('done', 'a'), L('error', undefined)])).toBe('done');
    expect(deriveLayeredSceneStatus([L('done', 'a'), L('pending')])).toBe('done');
  });

  it('is error when nothing succeeded and something failed', () => {
    expect(deriveLayeredSceneStatus([L('error'), L('pending')])).toBe('error');
  });

  it('is pending when nothing has started', () => {
    expect(deriveLayeredSceneStatus([L('pending'), L('pending')])).toBe('pending');
  });
});

// Mirrors the SceneLayerPanel list operations: reorder = swap + reindex,
// remove = filter + reindex, add = append with the next order, update = patch in place.
describe('layer list operations', () => {
  const base = () => [
    layer({ id: 'bg', type: 'background', order: 0, assetId: 'a1' }),
    layer({ id: 'mid', type: 'midground', order: 1, assetId: 'a2' }),
    layer({ id: 'fg', type: 'foreground', order: 2, assetId: 'a3' }),
  ];

  it('reorder swaps adjacent layers and keeps orders contiguous', () => {
    const next = [...base()];
    [next[0], next[1]] = [next[1], next[0]];
    const out = reindexLayers(next);
    expect(out.map((l) => l.id)).toEqual(['mid', 'bg', 'fg']);
    expect(out.map((l) => l.order)).toEqual([0, 1, 2]);
  });

  it('remove filters the layer and reindexes the remainder', () => {
    const out = reindexLayers(base().filter((l) => l.id !== 'mid'));
    expect(out.map((l) => l.id)).toEqual(['bg', 'fg']);
    expect(out.map((l) => l.order)).toEqual([0, 1]);
  });

  it('add appends a layer with the next order', () => {
    const layers = base();
    const added = layer({
      id: 'atmo',
      type: 'atmosphere',
      order: layers.length,
      alphaMode: 'luminance',
    });
    const out = reindexLayers([...layers, added]);
    expect(out).toHaveLength(4);
    expect(out[3]).toMatchObject({ id: 'atmo', order: 3 });
  });

  it('update patches a layer in place without touching order', () => {
    const out = base().map((l) => (l.id === 'mid' ? { ...l, visible: false } : l));
    expect(out[1]).toMatchObject({ id: 'mid', order: 1, visible: false });
    expect(out.map((l) => l.id)).toEqual(['bg', 'mid', 'fg']);
  });
});
