import { describe, it, expect } from 'vitest';
import { ProjectSchema, ProjectSceneSchema } from '../../../schemas/project.schema';
import { CommandSchema } from '../../../schemas/command.schema';
import { migrateProject } from '../../../../../core/project';
import { composeSceneLayers } from '../composer';
import { planScene } from '../planner';
import type { SceneLayer } from '../types';

// ---------------------------------------------------------------------------
// Persistence: layered scenes must survive the save → load cycle unchanged.
// The store serializes with a whitelist (drops only imageUrl) and validates
// with the zod schema; no migration is needed because new fields are optional.
// ---------------------------------------------------------------------------

function sceneFixture(): Record<string, unknown> {
  return {
    sceneId: 3,
    startTime: 6,
    endTime: 11,
    transcriptChunk: 'people used to travel',
    visualDescription: 'villagers with a bullock cart on a dirt road',
    imagePrompt: 'rural India, evening light, documentary still',
    cameraMotion: 'pan_left',
    status: 'done',
    layers: [
      {
        id: 'layer-1',
        type: 'background',
        name: 'Background',
        order: 0,
        subject: 'background plate',
        prompt: 'wide landscape plate',
        status: 'done',
        assetId: 'asset-bg',
        alphaMode: 'none',
        visible: true,
      },
      {
        id: 'layer-2',
        type: 'foreground',
        name: 'Foreground',
        order: 1,
        subject: 'wheat stalks',
        prompt: 'wheat stalks on green',
        status: 'error',
        error: 'Alpha extraction failed: key background was not uniform',
        alphaMode: 'chroma',
        alphaApplied: false,
        visible: false,
        optional: false,
        transform: { scale: 1.2, opacity: 0.9, x: 40, y: -10 },
        updatedAt: 1730000000000,
      },
    ],
    shotType: 'historical_reconstruction',
    cameraIntensity: 'strong',
    visualContext: { period: 'pre-automobile era', location: 'India, rural', lighting: 'warm sunset light' },
  };
}

describe('ProjectSceneSchema — layered scenes', () => {
  it('accepts a fully populated layered scene', () => {
    const result = ProjectSceneSchema.safeParse(sceneFixture());
    expect(result.success, JSON.stringify((result as any).error?.issues)).toBe(true);
  });

  it('still accepts a legacy single-image scene', () => {
    const legacy = {
      sceneId: 1,
      startTime: 0,
      endTime: 3,
      transcriptChunk: 'chunk',
      visualDescription: 'desc',
      imagePrompt: 'prompt',
      cameraMotion: 'zoom_in',
      status: 'done',
      imageUrl: 'docuflow-asset://x.png',
      imageId: 'asset-1',
    };
    expect(ProjectSceneSchema.safeParse(legacy).success).toBe(true);
  });

  it('rejects a layer without id or type', () => {
    const bad = { ...sceneFixture(), layers: [{ name: 'nope' }] };
    expect(ProjectSceneSchema.safeParse(bad).success).toBe(false);
  });
});

describe('save → load round trip', () => {
  it('preserves every layer field exactly (validation output is discarded on load)', () => {
    const original = sceneFixture();

    // Save: whitelist spread drops only imageUrl.
    const saved = { ...original };
    delete saved.imageUrl;
    const serialized = JSON.stringify({ version: 1, scenes: [saved] });

    // Load: JSON parse + zod validation (data is round-tripped, not re-mapped).
    const parsed = JSON.parse(serialized);
    const validation = ProjectSchema.safeParse({
      ...parsed,
      settings: { width: 1920, height: 1080, fps: 30 },
      assets: [],
      commands: [],
    });
    expect(validation.success, JSON.stringify((validation as any).error?.issues)).toBe(true);

    const loadedScene = (validation as any).data.scenes[0];
    expect(loadedScene).toEqual(original);
    expect(loadedScene.layers).toHaveLength(2);
    expect(loadedScene.layers[1].transform).toEqual({ scale: 1.2, opacity: 0.9, x: 40, y: -10 });
    expect(loadedScene.visualContext.period).toBe('pre-automobile era');
  });

  it('a planned scene round-trips with prompts and statuses intact', () => {
    let n = 0;
    const plan = planScene({
      visual: 'farmers with bullock carts on a dusty road in rural India at sunset',
      text: 'Before automobiles, people used to travel like this.',
      idFactory: () => `layer-${++n}`,
    });
    const scene = {
      sceneId: 9,
      startTime: 0,
      endTime: 5,
      transcriptChunk: 'chunk',
      visualDescription: 'plan',
      imagePrompt: 'plan',
      cameraMotion: plan.camera.movement,
      status: 'pending',
      layers: plan.layers,
      shotType: plan.shot,
      visualContext: plan.context,
    };

    const roundTripped = JSON.parse(JSON.stringify(scene));
    expect(ProjectSceneSchema.safeParse(roundTripped).success).toBe(true);
    expect(roundTripped.layers).toEqual(scene.layers);
    roundTripped.layers.forEach((l: SceneLayer, i: number) => {
      expect(l.prompt).toBe(plan.layers[i].prompt);
      expect(l.order).toBe(i);
    });
  });
});

describe('composer output persists as project commands', () => {
  it('every composed command validates against CommandSchema', () => {
    const scene = {
      startTime: 0,
      endTime: 4,
      cameraMotion: 'zoom_in' as const,
      layers: [
        {
          id: 'l1',
          type: 'background' as const,
          name: 'Background',
          order: 0,
          subject: 'plate',
          prompt: 'plate',
          status: 'done' as const,
          assetId: 'a1',
          alphaMode: 'none' as const,
        },
        {
          id: 'l2',
          type: 'atmosphere' as const,
          name: 'Atmosphere',
          order: 1,
          subject: 'haze',
          prompt: 'haze',
          status: 'done' as const,
          assetId: 'a2',
          alphaMode: 'luminance' as const,
          optional: true,
        },
      ],
    };
    const { commands } = composeSceneLayers(
      scene,
      new Map([['a1', { width: 1920, height: 1080 }], ['a2', { width: 1920, height: 1080 }]]),
      { zBase: 5, width: 1920, height: 1080 },
    );

    const project = {
      version: 1,
      settings: { width: 1920, height: 1080, fps: 30 },
      assets: [],
      commands,
    };
    const result = ProjectSchema.safeParse(project);
    expect(result.success, JSON.stringify((result as any).error?.issues)).toBe(true);

    for (const cmd of commands) {
      expect(CommandSchema.safeParse(cmd).success).toBe(true);
    }
  });
});

describe('store save -> migrate -> load pipeline', () => {
  it('preserves visualContext, layers and camera settings through the real load path', () => {
    // Scene exactly as it exists in the store after Plan Layers.
    let n = 0;
    const plan = planScene({
      visual: 'farmers with bullock carts on a dusty road in rural India at sunset',
      text: 'Before automobiles, people used to travel like this.',
      idFactory: () => `layer-${++n}`,
    });
    const sceneInStore = {
      sceneId: 1,
      startTime: 0,
      endTime: 5,
      transcriptChunk: 'Before automobiles, people used to travel like this.',
      visualDescription: 'farmers with bullock carts on a dusty road in rural India at sunset',
      imagePrompt: 'rural India dirt road, documentary still',
      cameraMotion: 'zoom_in',
      status: 'pending',
      imageUrl: 'docuflow-asset://generated/images/scene-1.png', // runtime-only
      imageId: 'asset-1',
      layers: plan.layers,
      shotType: plan.shot,
      cameraIntensity: plan.camera.intensity,
      visualContext: plan.context,
    };

    // saveProject: scenes whitelist drops only imageUrl (same spread as store).
    const projectData = {
      version: 1,
      settings: { width: 1920, height: 1080, fps: 30 },
      assets: [
        {
          id: 'asset-1',
          logicalId: 'image1',
          filename: 'scene-1.png',
          type: 'image',
          mimeType: 'image/png',
          filePath: '/projects/demo/generated/images/scene-1.png',
        },
      ],
      commands: [],
      scenes: [(({ imageUrl: _imageUrl, ...rest }) => rest)(sceneInStore as any)],
    };

    // Disk round trip.
    const raw = JSON.parse(JSON.stringify(projectData));

    // openProjectFromDialog: migrateProject first (v1 -> v1 is a no-op).
    const migration = migrateProject(raw);
    expect('error' in migration).toBe(false);
    const migrated = (migration as any).project;

    // Validation runs but the raw data is what gets restored.
    const validation = ProjectSchema.safeParse(migrated);
    expect(validation.success, JSON.stringify((validation as any).error?.issues)).toBe(true);

    // restore: {...scene} with imageUrl rehydrated from the asset url map.
    const assetUrlMap = new Map([['asset-1', 'docuflow-asset://rehydrated/scene-1.png']]);
    const restored = (migrated.scenes || []).map((scene: any) => ({
      ...scene,
      imageUrl: scene.imageId ? assetUrlMap.get(scene.imageId) : scene.imageUrl,
    }));

    expect(restored).toHaveLength(1);
    const out = restored[0];
    expect(out.visualContext).toEqual(plan.context);
    expect(out.visualContext.period).toBeTruthy();
    expect(out.layers).toEqual(plan.layers);
    expect(out.shotType).toBe(plan.shot);
    expect(out.cameraIntensity).toBe(plan.camera.intensity);
    expect(out.cameraMotion).toBe('zoom_in');
    expect(out.imageUrl).toBe('docuflow-asset://rehydrated/scene-1.png');
  });
});
