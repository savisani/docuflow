import { v4 as uuidv4 } from 'uuid';
import { Asset, AssetType } from '../../types/assets';
import { generateLogicalId } from './findAsset';
import { getMediaCompatibility, getProxyFilename } from './mediaCompatibility';

const ASSET_UPLOAD_URL = 'http://127.0.0.1:8765/assets/upload';

export async function uploadAssetToServer(file: File): Promise<string | null> {
  try {
    const formData = new FormData();
    formData.append('file', file);
    const response = await fetch(ASSET_UPLOAD_URL, { method: 'POST', body: formData });
    if (!response.ok) return null;
    const data = await response.json();
    return data.serverUrl || null;
  } catch {
    return null;
  }
}

/**
 * Probe media file metadata via IPC (ffprobe).
 */
async function probeMediaFile(filePath: string): Promise<{
  format?: string;
  videoCodec?: string;
  videoProfile?: string;
  videoPixFmt?: string;
  audioCodec?: string;
  audioProfile?: string;
  audioSampleRate?: number;
  audioChannels?: number;
  duration?: number;
  width?: number;
  height?: number;
} | null> {
  if (!(window as any).docuflow?.probeMedia) return null;
  try {
    const result = await (window as any).docuflow.probeMedia(filePath);
    if (!result?.success) return null;
    return {
      format: result.format,
      videoCodec: result.videoCodec,
      videoProfile: result.videoProfile,
      videoPixFmt: result.videoPixFmt,
      audioCodec: result.audioCodec,
      audioProfile: result.audioProfile,
      audioSampleRate: result.audioSampleRate,
      audioChannels: result.audioChannels,
      duration: result.duration,
      width: result.videoWidth,
      height: result.videoHeight,
    };
  } catch (err) {
    console.warn('Failed to probe media:', err);
    return null;
  }
}

/**
 * Generate a proxy file for incompatible media.
 */
async function generateProxy(
  inputPath: string,
  proxyDir: string,
  originalFilename: string,
  assetType: 'video' | 'audio'
): Promise<string | null> {
  if (!(window as any).docuflow?.convertMedia) return null;

  const proxyFilename = getProxyFilename(originalFilename);
  const outputPath = `${proxyDir}/${proxyFilename}`;

  // Check if proxy already exists
  const exists = await (window as any).docuflow.proxyExists(outputPath);
  if (exists) return outputPath;

  try {
    const params: any = { inputPath, outputPath };

    if (assetType === 'video') {
      params.videoCodec = 'libx264';
      params.audioCodec = 'aac';
      params.pixelFormat = 'yuv420p';
      params.videoBitrate = '5M';
      params.audioBitrate = '192k';
    } else {
      params.audioCodec = 'libmp3lame';
      params.audioBitrate = '192k';
    }

    const result = await (window as any).docuflow.convertMedia(params);
    if (result?.success && result.outputPath) {
      return result.outputPath;
    }
    console.warn('Proxy generation failed:', result?.error);
    return null;
  } catch (err) {
    console.warn('Failed to generate proxy:', err);
    return null;
  }
}

/**
 * Loads asset metadata from a File object (browser drag-and-drop / legacy flow).
 * When filePath is provided (Electron drag-drop), uses filePathToAssetUrl for persistence.
 * Otherwise creates a blob URL (non-persistent).
 */
export async function loadAssetMetadata(
  file: File,
  existingAssets: Asset[],
  filePath?: string
): Promise<Partial<Asset>> {
  const mimeType = file.type;
  let assetType: AssetType;

  if (mimeType.startsWith('image/')) {
    assetType = 'image';
  } else if (mimeType.startsWith('video/')) {
    assetType = 'video';
  } else if (mimeType.startsWith('audio/')) {
    assetType = 'audio';
  } else {
    assetType = 'image';
  }

  const logicalId = generateLogicalId(assetType, existingAssets);

  let url: string;
  let resolvedFilePath: string | undefined;

  if (filePath && window.docuflow) {
    resolvedFilePath = filePath;
    url = window.docuflow.filePathToAssetUrl(filePath);
  } else {
    url = URL.createObjectURL(file);
  }

  const metadata: Partial<Asset> = {
    logicalId,
    filename: file.name,
    type: assetType,
    mimeType,
    url,
    filePath: resolvedFilePath,
  };

  if (assetType === 'image') {
    const dimensions = await getImageDimensions(url);
    metadata.width = dimensions.width;
    metadata.height = dimensions.height;
  } else if (assetType === 'video') {
    // Probe with ffprobe first (more reliable metadata)
    if (resolvedFilePath) {
      const probeResult = await probeMediaFile(resolvedFilePath);
      if (probeResult) {
        metadata.width = probeResult.width;
        metadata.height = probeResult.height;
        metadata.duration = probeResult.duration;
        metadata.probeResult = {
          format: probeResult.format,
          videoCodec: probeResult.videoCodec,
          videoProfile: probeResult.videoProfile,
          videoPixFmt: probeResult.videoPixFmt,
          audioCodec: probeResult.audioCodec,
          audioProfile: probeResult.audioProfile,
          audioSampleRate: probeResult.audioSampleRate,
          audioChannels: probeResult.audioChannels,
        };
      } else {
        // Fallback to HTML5 video metadata
        const videoInfo = await getVideoDimensions(url);
        metadata.width = videoInfo.width;
        metadata.height = videoInfo.height;
        metadata.duration = videoInfo.duration;
      }
    } else {
      const videoInfo = await getVideoDimensions(url);
      metadata.width = videoInfo.width;
      metadata.height = videoInfo.height;
      metadata.duration = videoInfo.duration;
    }
  } else if (assetType === 'audio') {
    if (resolvedFilePath) {
      const probeResult = await probeMediaFile(resolvedFilePath);
      if (probeResult) {
        metadata.duration = probeResult.duration;
        metadata.probeResult = {
          format: probeResult.format,
          audioCodec: probeResult.audioCodec,
          audioProfile: probeResult.audioProfile,
          audioSampleRate: probeResult.audioSampleRate,
          audioChannels: probeResult.audioChannels,
        };
        metadata.sampleRate = probeResult.audioSampleRate;
        metadata.channels = probeResult.audioChannels;
      } else {
        const duration = await getAudioDuration(url);
        metadata.duration = duration;
      }
    } else {
      const duration = await getAudioDuration(url);
      metadata.duration = duration;
    }
  }

  return metadata;
}

/**
 * Determines asset type from a file path extension.
 */
function assetTypeFromPath(filePath: string): AssetType {
  const ext = filePath.split('.').pop()?.toLowerCase() || '';
  const imageExts = ['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'svg'];
  const videoExts = ['mp4', 'm4v', 'webm', 'mov', 'avi', 'mkv', 'ts', 'mts', 'm2ts'];
  const audioExts = ['mp3', 'wav', 'ogg', 'flac', 'aac', 'm4a', 'opus', 'wma'];

  if (imageExts.includes(ext)) return 'image';
  if (videoExts.includes(ext)) return 'video';
  if (audioExts.includes(ext)) return 'audio';
  return 'image';
}

/**
 * Infers MIME type from a file path extension.
 */
function mimeTypeFromPath(filePath: string): string {
  const ext = filePath.split('.').pop()?.toLowerCase() || '';
  const mimeMap: Record<string, string> = {
    jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png',
    gif: 'image/gif', webp: 'image/webp', bmp: 'image/bmp', svg: 'image/svg+xml',
    mp4: 'video/mp4', m4v: 'video/mp4', webm: 'video/webm',
    mov: 'video/quicktime', avi: 'video/x-msvideo', mkv: 'video/x-matroska',
    ts: 'video/mp2t', mts: 'video/mp2t', m2ts: 'video/mp2t',
    mp3: 'audio/mpeg', wav: 'audio/wav', ogg: 'audio/ogg',
    flac: 'audio/flac', aac: 'audio/aac', m4a: 'audio/mp4',
    opus: 'audio/opus', wma: 'audio/x-ms-wma',
  };
  return mimeMap[ext] || 'application/octet-stream';
}

/**
 * Imports assets via the native Electron file dialog.
 * Returns fully constructed Asset objects ready to add to the store.
 */
export async function importNativeAssets(
  projectName: string,
  existingAssets: Asset[]
): Promise<Asset[]> {
  if (!(window as any).docuflow) {
    console.error('window.docuflow is not defined — preload may not have loaded');
    return [];
  }

  const filePaths: string[] = await (window as any).docuflow.importAsset(projectName);
  if (!filePaths || filePaths.length === 0) return [];

  const assets: Asset[] = [];
  const allAssets = [...existingAssets];

  // Get project assets dir for proxy generation
  const assetsDir = await (window as any).docuflow.getAssetsDir(projectName);

  for (const filePath of filePaths) {
    // Deduplication: skip if asset with same normalized filePath already exists
    const normalizedIncoming = filePath.replace(/\\/g, '/').toLowerCase();
    const duplicate = allAssets.find((a) => {
      if (!a.filePath) return false;
      return a.filePath.replace(/\\/g, '/').toLowerCase() === normalizedIncoming;
    });
    if (duplicate) continue;

    const assetType = assetTypeFromPath(filePath);
    const mimeType = mimeTypeFromPath(filePath);
    const filename = filePath.split(/[/\\]/).pop() || filePath;
    const url = (window as any).docuflow.filePathToAssetUrl(filePath);
    const logicalId = generateLogicalId(assetType, allAssets);

    const asset: Asset = {
      id: uuidv4(),
      logicalId,
      filename,
      type: assetType,
      mimeType,
      filePath,
      url,
      audioRole: assetType === 'audio' ? 'music' : undefined,
    };

    try {
      if (assetType === 'image') {
        const dimensions = await getImageDimensions(url);
        asset.width = dimensions.width;
        asset.height = dimensions.height;
      } else if (assetType === 'video') {
        const probeResult = await probeMediaFile(filePath);
        if (probeResult) {
          asset.width = probeResult.width;
          asset.height = probeResult.height;
          asset.duration = probeResult.duration;
          asset.probeResult = {
            format: probeResult.format,
            videoCodec: probeResult.videoCodec,
            videoProfile: probeResult.videoProfile,
            videoPixFmt: probeResult.videoPixFmt,
            audioCodec: probeResult.audioCodec,
            audioProfile: probeResult.audioProfile,
            audioSampleRate: probeResult.audioSampleRate,
            audioChannels: probeResult.audioChannels,
          };

          // Check if proxy is needed
          const compat = getMediaCompatibility(probeResult, 'video');
          if (!compat.supported) {
            console.log(`[AssetImport] Video needs proxy: ${filename} (${compat.reason})`);
            const proxyDir = await (window as any).docuflow.getProxyDir(assetsDir);
            const proxyPath = await generateProxy(filePath, proxyDir, filename, 'video');
            if (proxyPath) {
              asset.proxyFilePath = proxyPath;
              asset.proxyUrl = (window as any).docuflow.filePathToAssetUrl(proxyPath);
              asset.hasProxy = true;
              console.log(`[AssetImport] Proxy generated: ${proxyPath}`);
            }
          }
        } else {
          // Fallback to HTML5 video metadata
          const videoInfo = await getVideoDimensions(url);
          asset.width = videoInfo.width;
          asset.height = videoInfo.height;
          asset.duration = videoInfo.duration;
        }
      } else if (assetType === 'audio') {
        const probeResult = await probeMediaFile(filePath);
        if (probeResult) {
          asset.duration = probeResult.duration;
          asset.sampleRate = probeResult.audioSampleRate;
          asset.channels = probeResult.audioChannels;
          asset.probeResult = {
            format: probeResult.format,
            audioCodec: probeResult.audioCodec,
            audioProfile: probeResult.audioProfile,
            audioSampleRate: probeResult.audioSampleRate,
            audioChannels: probeResult.audioChannels,
          };

          // Check if proxy is needed
          const compat = getMediaCompatibility(probeResult, 'audio');
          if (!compat.supported) {
            console.log(`[AssetImport] Audio needs proxy: ${filename} (${compat.reason})`);
            const proxyDir = await (window as any).docuflow.getProxyDir(assetsDir);
            const proxyPath = await generateProxy(filePath, proxyDir, filename, 'audio');
            if (proxyPath) {
              asset.proxyFilePath = proxyPath;
              asset.proxyUrl = (window as any).docuflow.filePathToAssetUrl(proxyPath);
              asset.hasProxy = true;
              console.log(`[AssetImport] Proxy generated: ${proxyPath}`);
            }
          }
        } else {
          const duration = await getAudioDuration(url);
          asset.duration = duration;
        }
      }
    } catch (err) {
      console.warn(`Failed to load metadata for ${filename}:`, err);
    }

    allAssets.push(asset);
    assets.push(asset);
  }

  return assets;
}

function getImageDimensions(url: string): Promise<{ width: number; height: number }> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight });
    img.onerror = () => resolve({ width: 0, height: 0 });
    img.src = url;
  });
}

function getVideoDimensions(url: string): Promise<{ width: number; height: number; duration: number }> {
  return new Promise((resolve) => {
    const video = document.createElement('video');
    video.preload = 'metadata';
    video.onloadedmetadata = () => {
      resolve({
        width: video.videoWidth,
        height: video.videoHeight,
        duration: video.duration,
      });
    };
    video.onerror = () => resolve({ width: 0, height: 0, duration: 0 });
    video.src = url;
  });
}

function getAudioDuration(url: string): Promise<number> {
  return new Promise((resolve) => {
    const audio = new Audio();
    audio.preload = 'metadata';
    audio.onloadedmetadata = () => {
      resolve(audio.duration);
    };
    audio.onerror = () => resolve(0);
    audio.src = url;
  });
}
