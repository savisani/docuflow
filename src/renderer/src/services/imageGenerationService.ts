/**
 * Shared Image Generation Service
 *
 * Central pipeline for all image generation in DocuFlow.
 * Both SceneGenerator and ImageGenerator use this service.
 * All generated images flow through the same store (generatedImages + assets).
 */

import { v4 as uuidv4 } from 'uuid';
import { useDocuFlowStore, GeneratedImage } from '../app/store';
import { Asset } from '../types/assets';
import { generateLogicalId } from '../engine/media/findAsset';
import { generateWithCloudflare, CloudflareConfig } from '../utils/cloudflareApi';
import { generateLocalImage, LocalGenerationProgress } from './localImageProvider';
import { buildScenePrompts } from '../utils/promptBuilder';
import { parsePromptAndNegativePrompt } from '../utils/promptParser';

export type ImageProvider = 'cloudflare' | 'local';

export interface ImageGenerationRequest {
  /** The prompt to generate from */
  prompt: string;
  /** Aspect ratio (e.g., '16:9', '1:1') */
  aspectRatio?: string;
  /** Negative prompt */
  negativePrompt?: string;
  /** Source of the generation */
  source: 'image-generator' | 'scene-generator';
  /** Associated scene ID if source is 'scene-generator' */
  sceneId?: string;
  /** Which provider to use */
  provider?: ImageProvider;
  /** Cloudflare config (for cloudflare provider) */
  cloudflareConfig?: CloudflareConfig;
  /** Model to use */
  model?: string;
  /** Inference steps */
  steps?: number;
  /** Number of images to generate (cloudflare only) */
  count?: number;
  /** Local model path (for local provider) */
  localModelPath?: string;
  /** Device for local generation */
  device?: 'auto' | 'gpu' | 'cpu' | 'directml';
  /** Width for local generation */
  width?: number;
  /** Height for local generation */
  height?: number;
  /** Seed */
  seed?: number;
  /** Progress callback for local generation */
  onProgress?: (progress: LocalGenerationProgress) => void;
  /** If true, unload model from CUDA after generation (for scene generation) */
  unloadAfter?: boolean;
}

export interface ImageGenerationResult {
  success: boolean;
  images: GeneratedImage[];
  error?: string;
}

/**
 * Generate image(s) through the shared pipeline.
 * Registers images in both generatedImages[] and assets[].
 * For scene-generator sources, links the image to the scene.
 */
export async function generateImage(
  req: ImageGenerationRequest
): Promise<ImageGenerationResult> {
  const {
    prompt,
    aspectRatio = '1:1',
    negativePrompt,
    source,
    sceneId,
    provider = 'cloudflare',
    cloudflareConfig,
    model,
    steps,
    count = 1,
    localModelPath,
    device,
    width,
    height,
    seed,
    onProgress,
    unloadAfter,
  } = req;

  if (!prompt.trim()) {
    return { success: false, images: [], error: 'Prompt is required' };
  }

  // Route to the appropriate provider
  if (provider === 'local') {
    return generateLocal(req);
  }

  // Cloudflare provider
  if (!cloudflareConfig?.workerUrl) {
    return { success: false, images: [], error: 'Cloudflare Worker URL not configured' };
  }

  try {
    const result = await generateWithCloudflare(cloudflareConfig, {
      prompt: prompt.trim(),
      model: model || '@cf/black-forest-labs/flux-1-schnell',
      steps: steps || 4,
      negative_prompt: negativePrompt || undefined,
      count,
    });

    if (!result.success || !result.imageUrls || result.imageUrls.length === 0) {
      return { success: false, images: [], error: result.error || 'Generation failed' };
    }

    const store = useDocuFlowStore.getState();
    const generatedImages: GeneratedImage[] = [];

    for (const imageUrl of result.imageUrls) {
      const imageId = uuidv4();

      // Parse aspect ratio for cropping
      const [ratioW, ratioH] = aspectRatio.split(':').map(Number);
      const croppedUrl = ratioW && ratioH
        ? await cropImageToAspectRatio(imageUrl, ratioW, ratioH)
        : imageUrl;

      // Persist the image to disk so it survives blob URL expiration
      // and can be used by the upscaler and download features
      let diskPath: string | undefined;
      try {
        // Convert the (possibly cropped) URL to base64
        const resp = await fetch(croppedUrl);
        const blob = await resp.blob();
        const arrayBuffer = await blob.arrayBuffer();
        const base64 = btoa(String.fromCharCode(...new Uint8Array(arrayBuffer)));
        const ext = croppedUrl.includes('image/jpeg') ? 'jpg' : 'png';
        const saveResult = await window.docuflow.saveBytes({
          imageBase64: base64,
          filename: `docuflow-${Date.now()}-${imageId.slice(0, 8)}.${ext}`,
        });
        if (saveResult.success && saveResult.path) {
          diskPath = saveResult.path;
        }
      } catch (e) {
        console.warn('Failed to persist Cloudflare image to disk:', e);
      }

      // Create GeneratedImage record
      const generatedImage: GeneratedImage = {
        id: imageId,
        prompt: prompt.trim(),
        style: '',
        aspectRatio,
        url: diskPath ? window.docuflow.filePathToAssetUrl(diskPath) : croppedUrl,
        timestamp: Date.now(),
        source,
        sceneId,
        provider: 'cloudflare',
        model: model || '@cf/black-forest-labs/flux-1-schnell',
      };

      // Register in generatedImages store
      store.addGeneratedImage(generatedImage);
      generatedImages.push(generatedImage);

      // Register as asset
      const currentAssets = useDocuFlowStore.getState().assets;
      const asset: Asset = {
        id: imageId,
        logicalId: generateLogicalId('image', currentAssets),
        filename: `generated-${Date.now()}-${imageId.slice(0, 8)}.png`,
        type: 'image',
        mimeType: 'image/png',
        url: diskPath ? window.docuflow.filePathToAssetUrl(diskPath) : croppedUrl,
        filePath: diskPath,
      };
      store.addAsset(asset);
    }

    return { success: true, images: generatedImages };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return { success: false, images: [], error: message };
  }
}

/**
 * Generate image using local provider.
 */
async function generateLocal(req: ImageGenerationRequest): Promise<ImageGenerationResult> {
  const {
    prompt,
    negativePrompt,
    aspectRatio = '1:1',
    source,
    sceneId,
    localModelPath,
    device = 'auto',
    width: reqWidth,
    height: reqHeight,
    steps,
    seed,
    onProgress,
    unloadAfter,
  } = req;

  if (!localModelPath) {
    return { success: false, images: [], error: 'No local model selected' };
  }

  // Parse aspect ratio to dimensions
  const [ratioW, ratioH] = aspectRatio.split(':').map(Number);
  const w = reqWidth || (ratioW >= ratioH ? 512 : Math.round(512 * ratioW / ratioH));
  const h = reqHeight || (ratioH >= ratioW ? 512 : Math.round(512 * ratioH / ratioW));

  try {
    const result = await generateLocalImage({
      prompt: prompt.trim(),
      negativePrompt: negativePrompt,
      width: w,
      height: h,
      modelPath: localModelPath,
      steps: steps || 10,
      seed,
      device,
      unloadAfter,
    }, onProgress);

    if (!result.success || !result.path) {
      return { success: false, images: [], error: result.error || 'Local generation failed' };
    }

    // Convert file path to asset URL
    const assetUrl = window.docuflow.filePathToAssetUrl(result.path);

    const store = useDocuFlowStore.getState();
    const imageId = uuidv4();

    const generatedImage: GeneratedImage = {
      id: imageId,
      prompt: prompt.trim(),
      style: '',
      aspectRatio,
      url: assetUrl,
      timestamp: Date.now(),
      source,
      sceneId,
      provider: 'local',
      model: localModelPath.split(/[/\\]/).pop() || 'local-model',
    };

    store.addGeneratedImage(generatedImage);

    // Register as asset
    const currentAssets = useDocuFlowStore.getState().assets;
    const asset: Asset = {
      id: imageId,
      logicalId: generateLogicalId('image', currentAssets),
      filename: `local-${Date.now()}-${imageId.slice(0, 8)}.png`,
      type: 'image',
      mimeType: 'image/png',
      url: assetUrl,
      filePath: result.path,
    };
    store.addAsset(asset);

    return { success: true, images: [generatedImage] };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Local generation failed';
    return { success: false, images: [], error: message };
  }
}

/**
 * Regenerate an existing image.
 * Preserves the original until the new image succeeds.
 * Updates both generatedImages[] and the linked asset.
 */
export async function regenerateImage(
  imageId: string,
  newPrompt: string,
  options?: {
    provider?: ImageProvider;
    cloudflareConfig?: CloudflareConfig;
    model?: string;
    steps?: number;
    negativePrompt?: string;
    localModelPath?: string;
    device?: 'auto' | 'gpu' | 'cpu' | 'directml';
    onProgress?: (progress: { type: string; percent?: number; message?: string }) => void;
  }
): Promise<ImageGenerationResult> {
  const store = useDocuFlowStore.getState();
  const existing = store.generatedImages.find((img) => img.id === imageId);
  if (!existing) {
    return { success: false, images: [], error: 'Image not found' };
  }

  const result = await generateImage({
    prompt: newPrompt,
    aspectRatio: existing.aspectRatio,
    negativePrompt: options?.negativePrompt,
    source: existing.source,
    sceneId: existing.sceneId,
    provider: options?.provider || existing.provider || 'cloudflare',
    cloudflareConfig: options?.cloudflareConfig,
    model: options?.model,
    steps: options?.steps,
    localModelPath: options?.localModelPath,
    device: options?.device,
    onProgress: options?.onProgress,
  });

  if (result.success && result.images.length > 0) {
    const newImage = result.images[0];

    // Remove the newly added image from store (we'll replace the original)
    store.updateGeneratedImage(imageId, {
      prompt: newPrompt,
      url: newImage.url,
      timestamp: Date.now(),
      model: options?.model,
    });

    // Remove the duplicate we just added
    const state = useDocuFlowStore.getState();
    const duplicateIdx = state.generatedImages.findIndex(
      (img) => img.id === newImage.id && img.id !== imageId
    );
    if (duplicateIdx >= 0) {
      useDocuFlowStore.setState({
        generatedImages: state.generatedImages.filter((_, i) => i !== duplicateIdx),
      });
    }

    // Update the linked asset
    const asset = state.assets.find((a) => a.id === imageId);
    if (asset) {
      store.updateAsset(imageId, { url: newImage.url });
    }

    // Return the updated original image
    const updatedImage = useDocuFlowStore.getState().generatedImages.find((img) => img.id === imageId);
    return { success: true, images: updatedImage ? [updatedImage] : [] };
  }

  // On failure, preserve original — do nothing
  return result;
}

/**
 * Crop an image to the target aspect ratio using canvas.
 * Preserves original resolution (no downscaling).
 */
function cropImageToAspectRatio(imageUrl: string, ratioW: number, ratioH: number): Promise<string> {
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      const srcW = img.naturalWidth;
      const srcH = img.naturalHeight;
      const targetRatio = ratioW / ratioH;
      const srcRatio = srcW / srcH;

      let sx: number, sy: number, sw: number, sh: number;
      if (srcRatio > targetRatio) {
        sh = srcH;
        sw = srcH * targetRatio;
        sy = 0;
        sx = (srcW - sw) / 2;
      } else {
        sw = srcW;
        sh = srcW / targetRatio;
        sx = 0;
        sy = (srcH - sh) / 2;
      }

      const canvas = document.createElement('canvas');
      // Preserve original resolution instead of forcing 1024px
      canvas.width = Math.round(sw);
      canvas.height = Math.round(sh);
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        resolve(imageUrl);
        return;
      }
      ctx.drawImage(img, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);
      resolve(canvas.toDataURL('image/png'));
    };
    img.onerror = () => resolve(imageUrl);
    img.src = imageUrl;
  });
}

// ---------------------------------------------------------------------------
// Scene Generation (background + person)
// ---------------------------------------------------------------------------

export interface SceneGenerationRequest {
  backgroundDescription: string;
  personDescription: string;
  /** User-provided negative prompt for background (may contain inline "Negative prompt:" — will be parsed) */
  backgroundNegativePrompt?: string;
  /** User-provided negative prompt for person (may contain inline "Negative prompt:" — will be parsed) */
  personNegativePrompt?: string;
  aspectRatio?: string;
  source?: 'image-generator' | 'scene-generator';
  provider?: ImageProvider;
  cloudflareConfig?: CloudflareConfig;
  model?: string;
  steps?: number;
  localModelPath?: string;
  device?: 'auto' | 'gpu' | 'cpu' | 'directml';
  width?: number;
  height?: number;
  seed?: number;
  onProgress?: (phase: 'background' | 'person', progress: LocalGenerationProgress) => void;
}

export interface SceneGenerationResult {
  success: boolean;
  background?: GeneratedImage;
  person?: GeneratedImage;
  error?: string;
}

/**
 * Generate a background + person image pair.
 * Builds two independent prompts and generates them sequentially
 * through the existing single-image pipeline.
 */
export async function generateScenePair(
  req: SceneGenerationRequest,
): Promise<SceneGenerationResult> {
  const {
    backgroundDescription,
    personDescription,
    backgroundNegativePrompt: rawBackgroundNegative,
    personNegativePrompt: rawPersonNegative,
    aspectRatio = '1:1',
    source = 'image-generator',
    provider = 'cloudflare',
    cloudflareConfig,
    model,
    steps,
    localModelPath,
    device,
    width,
    height,
    seed,
    onProgress,
  } = req;

  if (!backgroundDescription.trim() || !personDescription.trim()) {
    return { success: false, error: 'Both background and person descriptions are required' };
  }

  // Parse any inline "Negative prompt:" from user input
  const parsedBg = parsePromptAndNegativePrompt(rawBackgroundNegative || '');
  const parsedPerson = parsePromptAndNegativePrompt(rawPersonNegative || '');

  // Merge user negative prompts with system defaults (deduplicated)
  const prompts = buildScenePrompts(
    backgroundDescription,
    personDescription,
    parsedBg.negativePrompt || undefined,
    parsedPerson.negativePrompt || undefined,
  );

  // Debug logging — proves negative prompts reach the pipeline
  console.log('[SceneGen] BACKGROUND PROMPT:', prompts.backgroundPrompt.slice(0, 120));
  console.log('[SceneGen] BACKGROUND NEGATIVE:', prompts.backgroundNegative);
  console.log('[SceneGen] PERSON PROMPT:', prompts.personPrompt.slice(0, 120));
  console.log('[SceneGen] PERSON NEGATIVE:', prompts.personNegative);

  // Phase 1 — Background
  onProgress?.('background', { type: 'status', message: 'Generating background...' });

  const bgResult = await generateImage({
    prompt: prompts.backgroundPrompt,
    negativePrompt: prompts.backgroundNegative,
    aspectRatio,
    source,
    provider,
    cloudflareConfig,
    model,
    steps,
    localModelPath,
    device,
    width,
    height,
    seed,
    unloadAfter: provider === 'local', // Unload model after background to free CUDA for person model
  });

  if (!bgResult.success || bgResult.images.length === 0) {
    return {
      success: false,
      error: `Background generation failed: ${bgResult.error || 'Unknown error'}`,
    };
  }

  // Tag the background image
  const bgImage = bgResult.images[0];
  const store = useDocuFlowStore.getState();
  store.updateGeneratedImage(bgImage.id, { generationType: 'scene-background' });

  // Phase 2 — Person
  onProgress?.('person', { type: 'status', message: 'Generating person...' });

  const personResult = await generateImage({
    prompt: prompts.personPrompt,
    negativePrompt: prompts.personNegative,
    aspectRatio,
    source,
    provider,
    cloudflareConfig,
    model,
    steps,
    localModelPath,
    device,
    width,
    height,
    seed: seed !== undefined ? seed + 1 : undefined,
  });

  if (!personResult.success || personResult.images.length === 0) {
    return {
      success: false,
      background: bgImage,
      error: `Person generation failed: ${personResult.error || 'Unknown error'}`,
    };
  }

  // Tag the person image
  const personImage = personResult.images[0];
  const store2 = useDocuFlowStore.getState();
  store2.updateGeneratedImage(personImage.id, { generationType: 'scene-person' });

  onProgress?.('person', { type: 'status', message: 'Scene generation complete' });

  return {
    success: true,
    background: bgImage,
    person: personImage,
  };
}
