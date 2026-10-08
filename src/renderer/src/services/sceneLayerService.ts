import { generateImage, type ImageProvider } from './imageGenerationService';
import { useDocuFlowStore } from '../app/store';
import {
  sampleBorderColor,
  borderUniformity,
  isChromaKeyGreen,
  meanBorderLuminance,
  colorKeyToAlpha,
  luminanceToAlpha,
  transparentRatio,
} from '../engine/sceneLayers/alpha';
import type { SceneLayer } from '../engine/sceneLayers/types';
import type { ProjectScene, ProjectSettings } from '../types/project';
import type { CloudflareConfig } from '../utils/cloudflareApi';
import type { PollinationsConfig } from '../utils/pollinationsApi';
import { extractErrorMessage } from '../../../core/errors';

/**
 * Layer generation for the layered documentary Scene Generator.
 *
 * Wraps the existing (protected) generateImage provider abstraction — no new
 * provider architecture — and adds layer-specific post-processing:
 *
 * 1. generate the layer image through the chosen provider
 * 2. record intrinsic dimensions on the asset (used for cover scaling)
 * 3. extract transparency for midground/foreground (chroma) and atmosphere
 *    (luminance) layers, since no provider emits a real alpha channel
 * 4. reconcile the result into the EXISTING asset on regeneration so the
 *    asset id — and any timeline commands referencing it — stay valid
 *
 * Failures never destroy the previously working layer.
 */

export interface LayerGenerationConfig {
  provider: ImageProvider;
  cloudflareConfig?: CloudflareConfig;
  pollinationsConfig?: PollinationsConfig;
  model?: string;
  steps?: number;
  localModelPath?: string;
  device?: 'auto' | 'gpu' | 'cpu' | 'directml';
  negativePrompt?: string;
  projectPath?: string | null;
  settings: Pick<ProjectSettings, 'width' | 'height'>;
}

/** Validation thresholds for keyable backgrounds (0–255 scale). */
const MAX_BORDER_UNIFORMITY = 45;
const MAX_BLACK_BORDER_LUMA = 55;
const MIN_TRANSPARENT_RATIO = 0.02;
const MAX_TRANSPARENT_RATIO = 0.97;

/**
 * Typed view of the preload API used by this service. The renderer tsconfig
 * does not include src/preload/index.d.ts, so `window.docuflow` is not in
 * scope for the type checker here.
 */
interface SceneLayerDocuflowApi {
  readImageAsBase64(filePath: string): Promise<string>;
  deleteFile(filePath: string): Promise<{ success: boolean; error?: string }>;
  saveBytes(params: {
    imageBase64: string;
    filename?: string;
    baseDir?: string;
    destPath?: string;
  }): Promise<{ success: boolean; path?: string; error?: string }>;
  filePathToAssetUrl(filePath: string): string;
}

function docuflowApi(): SceneLayerDocuflowApi {
  return (window as unknown as { docuflow: SceneLayerDocuflowApi }).docuflow;
}

class LayerAlphaError extends Error {}

interface LoadedPixels {
  imageData: ImageData;
  width: number;
  height: number;
}

function loadImagePixels(url: string): Promise<LoadedPixels> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      try {
        const width = img.naturalWidth;
        const height = img.naturalHeight;
        if (!width || !height) {
          reject(new Error('Generated image has no pixels'));
          return;
        }
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          reject(new Error('Canvas 2D context unavailable'));
          return;
        }
        ctx.drawImage(img, 0, 0);
        const imageData = ctx.getImageData(0, 0, width, height);
        resolve({ imageData, width, height });
      } catch (err) {
        reject(err instanceof Error ? err : new Error(String(err)));
      }
    };
    img.onerror = () => reject(new Error('Failed to load generated layer image'));
    img.src = url;
  });
}

/**
 * Load an asset's pixels. docuflow-asset:// URLs may taint the canvas, so
 * fall back to reading the file as a base64 data URL, which never taints.
 */
async function loadAssetPixels(asset: { url?: string; filePath?: string }): Promise<LoadedPixels> {
  let primaryErr: unknown;
  if (asset.url) {
    try {
      return await loadImagePixels(asset.url);
    } catch (e) {
      primaryErr = e;
    }
  } else {
    primaryErr = new Error('Asset has no readable URL');
  }
  if (asset.filePath) {
    const b64 = await docuflowApi().readImageAsBase64(asset.filePath);
    if (b64) return loadImagePixels(`data:image/png;base64,${b64}`);
  }
  throw primaryErr;
}

function encodePng(imageData: ImageData): string {
  const canvas = document.createElement('canvas');
  canvas.width = imageData.width;
  canvas.height = imageData.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas 2D context unavailable');
  ctx.putImageData(imageData, 0, 0);
  return canvas.toDataURL('image/png');
}

/**
 * Extract transparency from generated layer pixels.
 * Throws LayerAlphaError with an actionable message when the provider did
 * not honor the requested keyable background — surfaced to the user, never
 * silently swallowed.
 */
function extractTransparency(layer: SceneLayer, loaded: LoadedPixels): { dataUrl: string; ratio: number } {
  const { imageData, width, height } = loaded;
  const data = imageData.data;

  if (layer.alphaMode === 'chroma') {
    const uniformity = borderUniformity(data, width, height);
    if (uniformity > MAX_BORDER_UNIFORMITY) {
      throw new LayerAlphaError(
        'Background removal failed: the image background is not flat (model ignored the solid green background instruction). Retry, or regenerate with a clearer prompt.',
      );
    }
    const key = sampleBorderColor(data, width, height);
    if (!isChromaKeyGreen(key)) {
      throw new LayerAlphaError(
        'Background removal failed: the generated background is not chroma green. Retry, or hide this layer and regenerate.',
      );
    }
    const ratio = colorKeyToAlpha(data, width, height, key);
    if (ratio < MIN_TRANSPARENT_RATIO) {
      throw new LayerAlphaError('Background removal failed: almost no background was keyed out. Retry this layer.');
    }
    if (ratio > MAX_TRANSPARENT_RATIO) {
      throw new LayerAlphaError('Background removal failed: the layer content itself became transparent. Retry this layer.');
    }
    return { dataUrl: encodePng(imageData), ratio };
  }

  // luminance
  const borderLuma = meanBorderLuminance(data, width, height);
  if (borderLuma > MAX_BLACK_BORDER_LUMA) {
    throw new LayerAlphaError(
      'Atmosphere extraction failed: the effect was not generated on a black background. Retry this layer.',
    );
  }
  const ratio = luminanceToAlpha(data, width, height);
  if (ratio < MIN_TRANSPARENT_RATIO) {
    throw new LayerAlphaError('Atmosphere extraction failed: the effect is too dense to blend. Retry this layer.');
  }
  if (ratio > MAX_TRANSPARENT_RATIO) {
    throw new LayerAlphaError('Atmosphere extraction failed: the effect is nearly invisible. Retry this layer.');
  }
  return { dataUrl: encodePng(imageData), ratio };
}

function removeStrayGeneratedImage(id: string): void {
  useDocuFlowStore.setState((state) => ({
    generatedImages: state.generatedImages.filter((img) => img.id !== id),
  }));
}

async function deleteFileQuietly(filePath?: string): Promise<void> {
  if (!filePath) return;
  try {
    await docuflowApi().deleteFile(filePath);
  } catch {
    // best-effort cleanup only
  }
}

/**
 * Generate (or regenerate) one scene layer.
 *
 * On failure the layer keeps its previous assetId, so a broken regeneration
 * never destroys a working scene (Phase 15 — per-layer error isolation).
 */
export async function generateSceneLayer(
  scene: Pick<ProjectScene, 'sceneId'>,
  layer: SceneLayer,
  config: LayerGenerationConfig,
): Promise<SceneLayer> {
  const previousAssetId = layer.assetId;
  const stamp = Date.now();

  if (!layer.prompt || !layer.prompt.trim()) {
    return { ...layer, status: 'error', error: 'Layer prompt is empty.', updatedAt: stamp };
  }

  const result = await generateImage({
    prompt: layer.prompt.trim(),
    negativePrompt: config.negativePrompt || undefined,
    aspectRatio: `${config.settings.width}:${config.settings.height}`,
    source: 'scene-generator',
    sceneId: String(scene.sceneId),
    provider: config.provider,
    cloudflareConfig: config.provider === 'cloudflare' ? config.cloudflareConfig : undefined,
    pollinationsConfig: config.provider === 'pollinations' ? config.pollinationsConfig : undefined,
    model: config.model,
    steps: config.steps,
    localModelPath: config.provider === 'local' ? config.localModelPath : undefined,
    device: config.provider === 'local' ? config.device : undefined,
    unloadAfter: false,
    projectPath: config.projectPath ?? undefined,
  });

  if (!result.success || result.images.length === 0) {
    return {
      ...layer,
      status: 'error',
      error: extractErrorMessage(result.error, 'Layer generation failed'),
      assetId: previousAssetId,
      updatedAt: stamp,
    };
  }

  const generatedId = result.images[0].id;
  const store = useDocuFlowStore.getState();
  const generatedAsset = store.assets.find((a) => a.id === generatedId);
  if (!generatedAsset) {
    return {
      ...layer,
      status: 'error',
      error: 'Generated image could not be registered as an asset.',
      assetId: previousAssetId,
      updatedAt: stamp,
    };
  }

  let finalUrl = generatedAsset.url;
  let finalPath = generatedAsset.filePath;
  let width = generatedAsset.width;
  let height = generatedAsset.height;
  let alphaApplied = false;

  try {
    if (layer.alphaMode !== 'none') {
      const loaded = await loadAssetPixels(generatedAsset);
      width = loaded.width;
      height = loaded.height;

      const { dataUrl } = extractTransparency(layer, loaded);
      const base64 = dataUrl.slice(dataUrl.indexOf(',') + 1);
      const save = await docuflowApi().saveBytes({
        imageBase64: base64,
        filename: `${layer.type}-${stamp}-${generatedId.slice(0, 8)}.png`,
        baseDir: config.projectPath ?? undefined,
      });
      if (!save.success || !save.path) {
        throw new LayerAlphaError(
          `Transparent layer could not be saved to disk: ${save.error || 'unknown error'}`,
        );
      }
      finalPath = save.path;
      finalUrl = docuflowApi().filePathToAssetUrl(save.path);
      alphaApplied = true;
      // The opaque original is no longer needed.
      if (generatedAsset.filePath && generatedAsset.filePath !== save.path) {
        await deleteFileQuietly(generatedAsset.filePath);
      }
    } else {
      // Opaque layers only need their dimensions for cover scaling — never
      // fail an otherwise good generation when pixels can't be read.
      try {
        const loaded = await loadAssetPixels(generatedAsset);
        width = loaded.width;
        height = loaded.height;
      } catch {
        // keep undefined dims; composer falls back to scale 1
      }
    }
  } catch (err) {
    // Clean up the freshly generated asset, keep the previous layer intact.
    if (generatedId !== previousAssetId) {
      useDocuFlowStore.getState().removeAsset(generatedId);
      removeStrayGeneratedImage(generatedId);
      await deleteFileQuietly(generatedAsset.filePath);
    }
    return {
      ...layer,
      status: 'error',
      error: err instanceof Error ? err.message : String(err),
      assetId: previousAssetId,
      alphaApplied: false,
      updatedAt: stamp,
    };
  }

  const patch = { url: finalUrl, filePath: finalPath, width, height, mimeType: 'image/png' };

  if (previousAssetId && previousAssetId !== generatedId) {
    // Regeneration: reconcile into the existing asset so timeline commands
    // referencing the old id keep resolving to fresh pixels.
    const state = useDocuFlowStore.getState();
    const previousAsset = state.assets.find((a) => a.id === previousAssetId);
    state.updateAsset(previousAssetId, patch);
    if (previousAsset?.filePath && previousAsset.filePath !== finalPath) {
      await deleteFileQuietly(previousAsset.filePath);
    }
    state.removeAsset(generatedId);
    removeStrayGeneratedImage(generatedId);
    state.updateGeneratedImage(previousAssetId, { url: finalUrl, prompt: layer.prompt });

    return {
      ...layer,
      status: 'done',
      assetId: previousAssetId,
      alphaApplied,
      error: undefined,
      updatedAt: stamp,
    };
  }

  useDocuFlowStore.getState().updateAsset(generatedId, patch);

  return {
    ...layer,
    status: 'done',
    assetId: generatedId,
    alphaApplied,
    error: undefined,
    updatedAt: stamp,
  };
}
