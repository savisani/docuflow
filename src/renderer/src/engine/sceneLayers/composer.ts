import { v4 as uuidv4 } from 'uuid';
import type { Command, ShowCommand, ScaleCommand, MoveCommand } from '../commands/types';
import type { ComposeSceneOptions, ComposeSceneResult, SceneLayer, SceneCameraMovement, CameraIntensity, SceneLayerType } from './types';
import type { ProjectScene } from '../../types/project';

/**
 * Composes a layered scene into timeline Commands using the existing command
 * / timeline architecture (no separate animation engine).
 *
 * Each layer becomes a `show` on its own z track, and camera movement is
 * expressed as per-layer scale/move animations with depth-dependent rates:
 *
 *   background moves least → midground moderately → foreground most
 *
 * Animation `target`s are the show command ids, which is what buildTimeline
 * keys its layers by (builder.ts: layers[first.id]).
 */

// Parallax rates per depth type for a full-scene push-in (Phase 10).
const SCALE_RATE: Record<SceneLayerType, number> = {
  background: 0.06,
  midground: 0.08,
  foreground: 0.12,
  atmosphere: 0.1,
};

// Horizontal drift in px for a full-scene pan, by depth type.
const PAN_PX: Record<SceneLayerType, number> = {
  background: 10,
  midground: 25,
  foreground: 60,
  atmosphere: 45,
};

const INTENSITY_MULTIPLIER: Record<CameraIntensity, number> = {
  subtle: 1,
  moderate: 1.5,
  strong: 2,
};

const DEFAULT_OPACITY: Record<SceneLayerType, number> = {
  background: 1,
  midground: 1,
  foreground: 1,
  atmosphere: 0.55,
};

/** Scale needed for an intrinsic image size to fully cover the canvas. */
export function coverScale(imgW: number, imgH: number, canvasW: number, canvasH: number): number {
  if (!imgW || !imgH) return 1;
  return Math.max(canvasW / imgW, canvasH / imgH);
}

interface LayerGeometry {
  assetId: string;
  z: number;
  x: number;
  y: number;
  baseScale: number;
  opacity: number;
  blur?: number;
  rotationZ?: number;
  showId: string;
  type: SceneLayerType;
}

export function composeSceneLayers(
  scene: Pick<ProjectScene, 'startTime' | 'endTime' | 'cameraMotion' | 'cameraIntensity' | 'layers'>,
  assetDims: Map<string, { width?: number; height?: number }>,
  options: ComposeSceneOptions,
): ComposeSceneResult {
  const { zBase, width, height } = options;
  const commands: Command[] = [];
  const skippedLayerIds: string[] = [];

  const layers = [...(scene.layers ?? [])]
    .filter((l) => l.visible !== false)
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));

  const start = Math.max(0, scene.startTime ?? 0);
  const end = scene.endTime ?? start;
  const duration = Math.max(end - start, 0.1);

  const intensity = INTENSITY_MULTIPLIER[scene.cameraIntensity ?? 'subtle'];
  const movement: SceneCameraMovement = scene.cameraMotion ?? 'static';

  let usedZ = zBase;
  const geometries: LayerGeometry[] = [];

  for (const layer of layers) {
    if (!layer.assetId) {
      skippedLayerIds.push(layer.id);
      continue;
    }
    const dims = assetDims.get(layer.assetId);
    const cover = coverScale(dims?.width ?? 0, dims?.height ?? 0, width, height);
    const transform = layer.transform ?? {};

    const geo: LayerGeometry = {
      assetId: layer.assetId,
      z: usedZ++,
      x: transform.x ?? 0,
      y: transform.y ?? 0,
      baseScale: cover * (transform.scale ?? 1),
      opacity: transform.opacity ?? DEFAULT_OPACITY[layer.type],
      blur: transform.blur,
      rotationZ: transform.rotation,
      showId: uuidv4(),
      type: layer.type,
    };
    geometries.push(geo);
  }

  // Base show commands — deterministic z ordering: back to front.
  for (const geo of geometries) {
    const show: ShowCommand = {
      id: geo.showId,
      type: 'show',
      asset: geo.assetId,
      start,
      duration,
      layer: geo.z,
      x: geo.x,
      y: geo.y,
      scale: geo.baseScale,
      opacity: geo.opacity,
    };
    if (geo.blur) show.blur = geo.blur;
    if (geo.rotationZ) show.rotationZ = geo.rotationZ;
    commands.push(show);
  }

  // Camera / parallax animations — one per layer, depth-dependent rate.
  for (const geo of geometries) {
      const rate = SCALE_RATE[geo.type] * intensity;

      if (movement === 'zoom_in' || movement === 'zoom_out') {
        const pushIn: ScaleCommand = {
          id: uuidv4(),
          type: 'scale',
          target: geo.showId,
          start,
          duration,
          easing: 'easeInOut',
          from: movement === 'zoom_in' ? geo.baseScale : geo.baseScale * (1 + rate),
          to: movement === 'zoom_in' ? geo.baseScale * (1 + rate) : geo.baseScale,
        };
        commands.push(pushIn);
      } else if (movement === 'pan_left' || movement === 'pan_right') {
        const px = PAN_PX[geo.type] * intensity;
        const dx = movement === 'pan_left' ? -px : px;
        const pan: MoveCommand = {
          id: uuidv4(),
          type: 'move',
          target: geo.showId,
          start,
          duration,
          easing: 'easeInOut',
          from: { x: geo.x, y: geo.y },
          to: { x: geo.x + dx, y: geo.y },
        };
        commands.push(pan);
      } else {
        // Static cinematic shot: never fully frozen — a whisper of push.
        const still: ScaleCommand = {
          id: uuidv4(),
          type: 'scale',
          target: geo.showId,
          start,
          duration,
          easing: 'easeInOut',
          from: geo.baseScale,
          to: geo.baseScale * (1 + rate * 0.3),
        };
        commands.push(still);
      }
  }

  return { commands, usedZ, skippedLayerIds };
}
