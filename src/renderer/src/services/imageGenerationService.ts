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

      // Create GeneratedImage record
      const generatedImage: GeneratedImage = {
        id: imageId,
        prompt: prompt.trim(),
        style: '',
        aspectRatio,
        url: croppedUrl,
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
        url: croppedUrl,
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
      width: w,
      height: h,
      modelPath: localModelPath,
      steps: steps || 20,
      seed,
      device,
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
      canvas.width = 1024;
      canvas.height = Math.round(1024 / targetRatio);
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
