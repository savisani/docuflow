import { v4 as uuidv4 } from 'uuid';
import { Asset, AssetType } from '../../types/assets';
import { generateLogicalId } from './findAsset';

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
 * Loads asset metadata from a File object (browser drag-and-drop / legacy flow).
 * Creates a blob URL for display.
 */
export async function loadAssetMetadata(
  file: File,
  existingAssets: Asset[]
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

  const url = URL.createObjectURL(file);
  const logicalId = generateLogicalId(assetType, existingAssets);

  const metadata: Partial<Asset> = {
    logicalId,
    filename: file.name,
    type: assetType,
    mimeType,
    url,
  };

  if (assetType === 'image') {
    const dimensions = await getImageDimensions(url);
    metadata.width = dimensions.width;
    metadata.height = dimensions.height;
  } else if (assetType === 'video') {
    const videoInfo = await getVideoDimensions(url);
    metadata.width = videoInfo.width;
    metadata.height = videoInfo.height;
    metadata.duration = videoInfo.duration;
  } else if (assetType === 'audio') {
    const duration = await getAudioDuration(url);
    metadata.duration = duration;
  }

  return metadata;
}

/**
 * Determines asset type from a file path extension.
 */
function assetTypeFromPath(filePath: string): AssetType {
  const ext = filePath.split('.').pop()?.toLowerCase() || '';
  const imageExts = ['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'svg'];
  const videoExts = ['mp4', 'webm', 'mov', 'avi', 'mkv'];
  const audioExts = ['mp3', 'wav', 'ogg', 'flac', 'aac'];

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
    mp4: 'video/mp4', webm: 'video/webm', mov: 'video/quicktime',
    avi: 'video/x-msvideo', mkv: 'video/x-matroska',
    mp3: 'audio/mpeg', wav: 'audio/wav', ogg: 'audio/ogg',
    flac: 'audio/flac', aac: 'audio/aac',
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

  for (const filePath of filePaths) {
    const assetType = assetTypeFromPath(filePath);
    const mimeType = mimeTypeFromPath(filePath);
    const filename = filePath.split(/[/\\]/).pop() || filePath;
    const url = (window as any).docuflow.filePathToAssetUrl(filePath);
    const logicalId = generateLogicalId(assetType, existingAssets);

    const asset: Asset = {
      id: uuidv4(),
      logicalId,
      filename,
      type: assetType,
      mimeType,
      filePath,
      url,
    };

    try {
      if (assetType === 'image') {
        const dimensions = await getImageDimensions(url);
        asset.width = dimensions.width;
        asset.height = dimensions.height;
      } else if (assetType === 'video') {
        const videoInfo = await getVideoDimensions(url);
        asset.width = videoInfo.width;
        asset.height = videoInfo.height;
        asset.duration = videoInfo.duration;
      } else if (assetType === 'audio') {
        const duration = await getAudioDuration(url);
        asset.duration = duration;
      }
    } catch (err) {
      console.warn(`Failed to load metadata for ${filename}:`, err);
    }

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
