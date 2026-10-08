import { describe, it, expect } from 'vitest';
import { composeSceneLayers, coverScale } from '../composer';
import { buildTimeline } from '../../timeline/builder';
import { CommandSchema } from '../../../schemas/command.schema';
import type { ShowCommand, ScaleCommand, MoveCommand } from '../../commands/types';
import type { ProjectScene } from '../../../types/project';
import type { SceneLayer } from '../types';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function layer(over: Partial<SceneLayer> & Pick<SceneLayer, 'id' | 'type' | 'order'>): SceneLayer {
  return {
    name: over.type,
    subject: 'test layer',
    prompt: 'prompt',
    status: 'done',
    alphaMode: 'none',
    visible: true,
    ...over,
  };
}

function scene(over: Partial<ProjectScene> = {}): Pick<
  ProjectScene,
  'startTime' | 'endTime' | 'cameraMotion' | 'cameraIntensity' | 'layers'
> {
  return {
    startTime: 0,
    endTime: 4,
    cameraMotion: 'zoom_in',
    layers: [
      layer({ id: 'L-bg', type: 'background', order: 0, assetId: 'asset-bg' }),
      layer({ id: 'L-mid', type: 'midground', order: 1, assetId: 'asset-mid' }),
      layer({ id: 'L-fg', type: 'foreground', order: 2, assetId: 'asset-fg' }),
    ],
    ...over,
  };
}

const DIMS = new Map<string, { width?: number; height?: number }>([
  ['asset-bg', { width: 1920, height: 1080 }],
  ['asset-mid', { width: 512, height: 288 }],
  ['asset-fg', { width: 640, height: 640 }],
]);
const OPTS = { zBase: 10, width: 1920, height: 1080 };

function split(commands: ReturnType<typeof composeSceneLayers>['commands']) {
  const shows = commands.filter((c): c is ShowCommand => c.type === 'show');
  const anims = commands.filter(
    (c): c is ScaleCommand | MoveCommand => c.type === 'scale' || c.type === 'move',
  );
  return { shows, anims };
}

// ---------------------------------------------------------------------------

describe('coverScale', () => {
  it('scales a 1:1 image up to cover a 16:9 frame', () => {
    expect(coverScale(1080, 1080, 1920, 1080)).toBeCloseTo(1920 / 1080);
  });

  it('scales a wider-than-frame image to cover height', () => {
    expect(coverScale(3840, 2160, 1920, 1080)).toBeCloseTo(0.5);
  });

  it('returns 1 when dimensions are unknown', () => {
    expect(coverScale(0, 0, 1920, 1080)).toBe(1);
  });
});

describe('composeSceneLayers — structure', () => {
  it('emits one show per visible layer with contiguous back-to-front z', () => {
    const { commands, usedZ, skippedLayerIds } = composeSceneLayers(scene(), DIMS, OPTS);
    const { shows } = split(commands);

    expect(shows).toHaveLength(3);
    expect(shows.map((s) => s.layer)).toEqual([10, 11, 12]);
    expect(usedZ).toBe(13);
    expect(skippedLayerIds).toEqual([]);

    expect(shows[0].asset).toBe('asset-bg');
    expect(shows[1].asset).toBe('asset-mid');
    expect(shows[2].asset).toBe('asset-fg');
    shows.forEach((s) => {
      expect(s.start).toBe(0);
      expect(s.duration).toBe(4);
    });
  });

  it('uses cover scaling so each layer fills the frame', () => {
    const { commands } = composeSceneLayers(scene(), DIMS, OPTS);
    const { shows } = split(commands);
    expect(shows[0].scale).toBeCloseTo(1); // 1920x1080 on 1920x1080
    expect(shows[1].scale).toBeCloseTo(1920 / 512); // 512x288 upscaled
    expect(shows[2].scale).toBeCloseTo(1920 / 640);
  });

  it('skips layers without an asset and reports them', () => {
    const s = scene({
      layers: [
        layer({ id: 'L-bg', type: 'background', order: 0, assetId: 'asset-bg' }),
        layer({ id: 'L-mid', type: 'midground', order: 1 }), // no asset yet
      ],
    });
    const { usedZ, skippedLayerIds, commands } = composeSceneLayers(s, DIMS, OPTS);
    expect(skippedLayerIds).toEqual(['L-mid']);
    expect(usedZ).toBe(11);
    expect(split(commands).shows).toHaveLength(1);
  });

  it('excludes hidden layers without reporting them as skipped', () => {
    const s = scene({
      layers: [
        layer({ id: 'L-bg', type: 'background', order: 0, assetId: 'asset-bg' }),
        layer({ id: 'L-mid', type: 'midground', order: 1, assetId: 'asset-mid', visible: false }),
      ],
    });
    const { skippedLayerIds, commands } = composeSceneLayers(s, DIMS, OPTS);
    expect(skippedLayerIds).toEqual([]);
    expect(split(commands).shows).toHaveLength(1);
  });

  it('gives the atmosphere layer its default translucent opacity', () => {
    const s = scene({
      layers: [
        layer({ id: 'L-bg', type: 'background', order: 0, assetId: 'asset-bg' }),
        layer({ id: 'L-atmo', type: 'atmosphere', order: 1, assetId: 'asset-mid', alphaMode: 'luminance' }),
      ],
    });
    const { shows } = split(composeSceneLayers(s, DIMS, OPTS).commands);
    expect(shows[1].opacity).toBe(0.55);
  });

  it('produces commands that validate against the persisted CommandSchema', () => {
    const { commands } = composeSceneLayers(scene(), DIMS, OPTS);
    for (const cmd of commands) {
      const result = CommandSchema.safeParse(cmd);
      expect(result.success, `command ${cmd.type} failed schema: ${JSON.stringify(cmd)}`).toBe(true);
    }
  });
});

describe('composeSceneLayers — parallax camera', () => {
  function rates(commands: ReturnType<typeof composeSceneLayers>['commands']) {
    const { shows, anims } = split(commands);
    return shows.map((show, i) => {
      const anim = anims.find((a) => (a as ScaleCommand).target === show.id) as ScaleCommand;
      return (anim.to - anim.from) / anim.from;
    });
  }

  it('zoom_in pushes each layer in, slower the deeper it sits', () => {
    const { commands } = composeSceneLayers(scene(), DIMS, OPTS);
    const [bg, mid, fg] = rates(commands);
    expect(bg).toBeCloseTo(0.06);
    expect(mid).toBeCloseTo(0.08);
    expect(fg).toBeCloseTo(0.12);
    expect(bg).toBeLessThan(mid);
    expect(mid).toBeLessThan(fg);
  });

  it('zoom_out pulls out from the pushed-in state back to base', () => {
    const { commands } = composeSceneLayers(scene({ cameraMotion: 'zoom_out' }), DIMS, OPTS);
    const { shows, anims } = split(commands);
    const anim = anims.find((a) => (a as ScaleCommand).target === shows[0].id) as ScaleCommand;
    expect(anim.from).toBeCloseTo(shows[0].scale! * 1.06);
    expect(anim.to).toBeCloseTo(shows[0].scale!);
  });

  it('pan_left drifts layers left with depth-dependent distance', () => {
    const { commands } = composeSceneLayers(scene({ cameraMotion: 'pan_left' }), DIMS, OPTS);
    const { shows, anims } = split(commands);
    const dxs = shows.map((s) => {
      const anim = anims.find((a) => (a as MoveCommand).target === s.id) as MoveCommand;
      return anim.to.x - anim.from.x;
    });
    expect(dxs).toEqual([-10, -25, -60]);
  });

  it('pan_right mirrors pan_left', () => {
    const { commands } = composeSceneLayers(scene({ cameraMotion: 'pan_right' }), DIMS, OPTS);
    const { shows, anims } = split(commands);
    const anim = anims.find((a) => (a as MoveCommand).target === shows[0].id) as MoveCommand;
    expect(anim.to.x - anim.from.x).toBe(10);
  });

  it('static still gets a whisper of motion instead of freezing', () => {
    const { commands } = composeSceneLayers(scene({ cameraMotion: 'static' }), DIMS, OPTS);
    const { shows, anims } = split(commands);
    const anim = anims.find((a) => (a as ScaleCommand).target === shows[0].id) as ScaleCommand;
    expect(anim.from).toBeCloseTo(shows[0].scale!);
    expect(anim.to).toBeGreaterThan(anim.from);
    expect((anim.to - anim.from) / anim.from).toBeCloseTo(0.06 * 0.3);
  });

  it('strong intensity doubles every animation distance', () => {
    const subtle = rates(
      composeSceneLayers(scene({ cameraIntensity: 'subtle' }), DIMS, OPTS).commands,
    );
    const strong = rates(
      composeSceneLayers(scene({ cameraIntensity: 'strong' }), DIMS, OPTS).commands,
    );
    expect(strong[0]).toBeCloseTo(subtle[0] * 2);
    expect(strong[2]).toBeCloseTo(subtle[2] * 2);
  });

  it('animates every layer exactly once', () => {
    const { commands } = composeSceneLayers(scene(), DIMS, OPTS);
    const { shows, anims } = split(commands);
    expect(anims).toHaveLength(shows.length);
    const targets = anims.map((a) => a.target);
    expect(new Set(targets).size).toBe(targets.length);
    shows.forEach((s) => expect(targets).toContain(s.id));
  });
});

describe('composeSceneLayers → buildTimeline integration', () => {
  it('builds one z track per layer with animations bound to the show ids', () => {
    const { commands } = composeSceneLayers(scene(), DIMS, OPTS);
    const assets = [
      { id: 'asset-bg', logicalId: 'image1', filename: 'bg.png', type: 'image' as const, mimeType: 'image/png', url: 'docuflow-asset://bg.png' },
      { id: 'asset-mid', logicalId: 'image2', filename: 'mid.png', type: 'image' as const, mimeType: 'image/png', url: 'docuflow-asset://mid.png' },
      { id: 'asset-fg', logicalId: 'image3', filename: 'fg.png', type: 'image' as const, mimeType: 'image/png', url: 'docuflow-asset://fg.png' },
    ];
    const settings = { width: 1920, height: 1080, fps: 30 };

    const timeline = buildTimeline(commands, assets, settings);
    const { shows, anims } = split(commands);

    // One track per layer, z kept in depth order.
    expect(Object.keys(timeline.layers).sort()).toEqual(shows.map((s) => s.id).sort());
    const byZ = Object.values(timeline.layers).sort((a, b) => a.zIndex - b.zIndex);
    expect(byZ.map((l) => l.zIndex)).toEqual([10, 11, 12]);

    // Scale animation attached to the correct track (target = show id).
    for (const show of shows) {
      const track = timeline.layers[show.id];
      expect(track).toBeDefined();
      const scaleAnim = track.animations.find((a) => a.property === 'scale');
      expect(scaleAnim).toBeDefined();
      expect(scaleAnim!.startFrame).toBe(0);
      expect(scaleAnim!.endFrame).toBe(120); // 4s @ 30fps
      const src = anims.find((a) => (a as ScaleCommand).target === show.id) as ScaleCommand;
      expect(scaleAnim!.from).toBeCloseTo(src.from);
      expect(scaleAnim!.to).toBeCloseTo(src.to);
      expect(track.assetId).toBe(show.asset);
      expect(track.assetSegments[0].commandId).toBe(show.id);
    }
  });

  it('does not collide with explicit z of other scenes', () => {
    // Another scene already uses z 0..9.
    const existing: ShowCommand = {
      id: 'other-show',
      type: 'show',
      asset: 'asset-other',
      start: 0,
      duration: 4,
      layer: 9,
    };
    const { commands } = composeSceneLayers(scene(), DIMS, OPTS);
    const assets = [
      { id: 'asset-other', logicalId: 'image9', filename: 'other.png', type: 'image' as const, mimeType: 'image/png', url: 'x' },
      { id: 'asset-bg', logicalId: 'image1', filename: 'bg.png', type: 'image' as const, mimeType: 'image/png', url: 'x' },
    ];
    const timeline = buildTimeline([existing, ...commands], assets, { width: 1920, height: 1080, fps: 30 });
    const zSet = Object.values(timeline.layers).map((l) => l.zIndex);
    expect(new Set(zSet).size).toBe(zSet.length);
    expect(zSet).toContain(9);
    expect(zSet).toContain(10);
  });
});
