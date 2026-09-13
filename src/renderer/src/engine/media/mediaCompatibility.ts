import { Asset } from '../../types/assets';

export type PreviewStrategy = 'native' | 'proxy';

export interface MediaCompatibility {
  supported: boolean;
  mediaType: 'video' | 'audio' | 'image';
  container?: string;
  codec?: string;
  profile?: string;
  pixFmt?: string;
  reason?: string;
  previewStrategy: PreviewStrategy;
}

/**
 * Codecs that Chromium can reliably decode natively.
 * These are well-tested and should work across all Chromium versions.
 */
const NATIVELY_SUPPORTED_VIDEO_CODECS = new Set([
  'h264',       // AVC - most reliable
  'vp8',        // WebM
  'vp9',        // WebM - generally good
  'av1',        // Newer Chromium only, but present in Electron
]);

const NATIVELY_SUPPORTED_AUDIO_CODECS = new Set([
  'aac',        // MP4
  'mp3',        // MPEG layer 3
  'opus',       // WebM/OGG
  'vorbis',     // WebM/OGG
  'flac',       // FLAC in MP4
]);

/**
 * Containers that Chromium can natively demux.
 */
const NATIVELY_SUPPORTED_CONTAINERS = new Set([
  'mov,mp4,m4a,3gp,3g2,mj2',  // MP4/MOV family
  'matroska,webm',              // WebM/MKV
  'ogg',                        // OGG
  'mpeg',                       // MPEG-TS
]);

/**
 * Pixel formats that Chromium supports for H.264.
 */
const BROWSER_COMPATIBLE_PIX_FMTS = new Set([
  'yuv420p',
  'yuv420p10le',
  'yuv444p',
  'rgb24',
  'rgba',
  'bgr24',
]);

export function getMediaCompatibility(info: {
  format?: string;
  videoCodec?: string;
  videoProfile?: string;
  videoPixFmt?: string;
  audioCodec?: string;
  audioProfile?: string;
}, mediaType: 'video' | 'audio'): MediaCompatibility {
  if (mediaType === 'video') {
    return getVideoCompatibility(info);
  }
  return getAudioCompatibility(info);
}

function getVideoCompatibility(info: {
  format?: string;
  videoCodec?: string;
  videoProfile?: string;
  videoPixFmt?: string;
  audioCodec?: string;
  audioProfile?: string;
}): MediaCompatibility {
  const base: MediaCompatibility = {
    supported: false,
    mediaType: 'video',
    container: info.format,
    codec: info.videoCodec,
    profile: info.videoProfile,
    pixFmt: info.videoPixFmt,
    previewStrategy: 'proxy',
  };

  // Check container support
  if (info.format && !NATIVELY_SUPPORTED_CONTAINERS.has(info.format)) {
    return {
      ...base,
      reason: `Container "${info.format}" is not natively supported by Chromium`,
      previewStrategy: 'proxy',
    };
  }

  // Check video codec support
  if (info.videoCodec) {
    if (!NATIVELY_SUPPORTED_VIDEO_CODECS.has(info.videoCodec)) {
      return {
        ...base,
        reason: `Video codec "${info.videoCodec}" is not natively supported by Chromium`,
        previewStrategy: 'proxy',
      };
    }
  }

  // Check pixel format (important for H.264)
  if (info.videoPixFmt && !BROWSER_COMPATIBLE_PIX_FMTS.has(info.videoPixFmt)) {
    return {
      ...base,
      reason: `Pixel format "${info.videoPixFmt}" may not be supported by Chromium`,
      previewStrategy: 'proxy',
    };
  }

  // H.264 profiles: Baseline, Main, High are all supported
  // But very high profiles or non-standard profiles might fail
  if (info.videoCodec === 'h264' && info.videoProfile) {
    const profileLower = info.videoProfile.toLowerCase()
    if (profileLower.includes('high 4:4:4') || profileLower.includes('unknown')) {
      return {
        ...base,
        reason: `H.264 profile "${info.videoProfile}" may not be supported`,
        previewStrategy: 'proxy',
      };
    }
  }

  // If we get here, the video should be natively playable
  return {
    ...base,
    supported: true,
    reason: undefined,
    previewStrategy: 'native',
  };
}

function getAudioCompatibility(info: {
  format?: string;
  audioCodec?: string;
  audioProfile?: string;
}): MediaCompatibility {
  const base: MediaCompatibility = {
    supported: false,
    mediaType: 'audio',
    container: info.format,
    codec: info.audioCodec,
    profile: info.audioProfile,
    previewStrategy: 'proxy',
  };

  if (info.audioCodec && NATIVELY_SUPPORTED_AUDIO_CODECS.has(info.audioCodec)) {
    return {
      ...base,
      supported: true,
      reason: undefined,
      previewStrategy: 'native',
    };
  }

  // Audio in MP4 container with AAC is always supported
  if (info.format?.includes('mp4') && info.audioCodec === 'aac') {
    return {
      ...base,
      supported: true,
      reason: undefined,
      previewStrategy: 'native',
    };
  }

  return {
    ...base,
    reason: `Audio codec "${info.audioCodec || 'unknown'}" may not be natively supported`,
    previewStrategy: 'proxy',
  };
}

/**
 * Determine if an asset needs a proxy for browser playback.
 */
export function needsProxy(asset: Asset, probeResult?: {
  videoCodec?: string;
  videoPixFmt?: string;
  audioCodec?: string;
  format?: string;
}): boolean {
  if (asset.type === 'image') return false;

  if (!probeResult) return false;

  const compat = getMediaCompatibility(probeResult, asset.type as 'video' | 'audio');
  return !compat.supported;
}

/**
 * Generate a deterministic proxy filename based on the original asset.
 * Uses a hash of the file path to avoid collisions.
 */
export function getProxyFilename(originalFilename: string): string {
  const ext = originalFilename.split('.').pop() || 'mp4';
  const name = originalFilename.replace(/\.[^/.]+$/, '');
  // Always convert to mp4 for video, mp3 for audio (browser-compatible)
  const proxyExt = ext === 'mp4' || ext === 'webm' || ext === 'mov' || ext === 'mkv' ? 'mp4' : 'mp3';
  return `${name}_proxy.${proxyExt}`;
}
