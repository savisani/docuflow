import type { ProjectScene } from '../../types/project';
import type { SceneLayer } from './types';

/**
 * Read-time normalization between legacy single-image scenes and layered
 * scenes. Legacy scenes (no `layers` array) remain fully valid: their image
 * is presented as a single background layer. No project migration required.
 */

/** True when the scene carries an explicit layer plan. */
export function hasLayerPlan(scene: Pick<ProjectScene, 'layers'>): boolean {
  return Array.isArray(scene.layers) && scene.layers.length > 0;
}

/**
 * Layers of a scene in stacking order (back → front).
 * Legacy scenes synthesize one background layer from imageId/imagePrompt.
 */
export function getSceneLayers(scene: ProjectScene): SceneLayer[] {
  if (hasLayerPlan(scene)) {
    return [...(scene.layers as SceneLayer[])].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  }

  if (scene.imageId) {
    return [
      {
        id: `legacy-background-${scene.sceneId}`,
        type: 'background',
        name: 'Background',
        order: 0,
        subject: scene.visualDescription,
        prompt: scene.imagePrompt,
        status: scene.status === 'error' ? 'error' : scene.status === 'generating' ? 'generating' : 'done',
        assetId: scene.imageId,
        alphaMode: 'none',
        visible: true,
        error: scene.error,
      },
    ];
  }

  return [];
}

/** Reassign `order` from array position so stacking stays deterministic. */
export function reindexLayers(layers: SceneLayer[]): SceneLayer[] {
  return layers.map((layer, index) => ({ ...layer, order: index }));
}

/** Layers that will actually be composed into the timeline. */
export function composableLayers(scene: ProjectScene): SceneLayer[] {
  return getSceneLayers(scene).filter((l) => l.visible !== false && l.assetId);
}

/**
 * Scene-level status for layered scenes:
 * - 'generating' while any layer generates
 * - 'done' once at least one layer has an asset (partial scenes still build)
 * - 'error' when nothing succeeded and something failed
 * - 'pending' otherwise
 */
export function deriveLayeredSceneStatus(layers: SceneLayer[]): ProjectScene['status'] {
  if (layers.some((l) => l.status === 'generating')) return 'generating';
  const doneCount = layers.filter((l) => l.assetId && l.status === 'done').length;
  if (doneCount > 0) return 'done';
  if (layers.some((l) => l.status === 'error')) return 'error';
  return 'pending';
}
