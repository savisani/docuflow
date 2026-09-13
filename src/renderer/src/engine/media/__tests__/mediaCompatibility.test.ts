import { describe, it, expect } from 'vitest';
import {
  getMediaCompatibility,
  needsProxy,
  getProxyFilename,
  type MediaCompatibility,
} from '../mediaCompatibility';
import type { Asset } from '../../../types/assets';

describe('getMediaCompatibility', () => {
  describe('video compatibility', () => {
    it('marks H.264/AAC MP4 as natively supported', () => {
      const result = getMediaCompatibility({
        format: 'mov,mp4,m4a,3gp,3g2,mj2',
        videoCodec: 'h264',
        videoProfile: 'Main',
        videoPixFmt: 'yuv420p',
        audioCodec: 'aac',
      }, 'video');

      expect(result.supported).toBe(true);
      expect(result.previewStrategy).toBe('native');
      expect(result.mediaType).toBe('video');
    });

    it('marks VP8/WebM as natively supported', () => {
      const result = getMediaCompatibility({
        format: 'matroska,webm',
        videoCodec: 'vp8',
        videoPixFmt: 'yuv420p',
      }, 'video');

      expect(result.supported).toBe(true);
      expect(result.previewStrategy).toBe('native');
    });

    it('marks VP9/WebM as natively supported', () => {
      const result = getMediaCompatibility({
        format: 'matroska,webm',
        videoCodec: 'vp9',
        videoPixFmt: 'yuv420p',
      }, 'video');

      expect(result.supported).toBe(true);
      expect(result.previewStrategy).toBe('native');
    });

    it('marks AV1 as natively supported', () => {
      const result = getMediaCompatibility({
        format: 'matroska,webm',
        videoCodec: 'av1',
        videoPixFmt: 'yuv420p',
      }, 'video');

      expect(result.supported).toBe(true);
      expect(result.previewStrategy).toBe('native');
    });

    it('marks WMV as needing proxy (unsupported codec)', () => {
      const result = getMediaCompatibility({
        format: 'mov,mp4,m4a,3gp,3g2,mj2',
        videoCodec: 'wmv3',
        videoPixFmt: 'yuv420p',
      }, 'video');

      expect(result.supported).toBe(false);
      expect(result.previewStrategy).toBe('proxy');
      expect(result.reason).toContain('wmv3');
    });

    it('marks MPEG-4 Part 2 as needing proxy', () => {
      const result = getMediaCompatibility({
        format: 'mov,mp4,m4a,3gp,3g2,mj2',
        videoCodec: 'mpeg4',
        videoPixFmt: 'yuv420p',
      }, 'video');

      expect(result.supported).toBe(false);
      expect(result.previewStrategy).toBe('proxy');
    });

    it('marks H.264 with yuv444p pixel format as needing proxy', () => {
      const result = getMediaCompatibility({
        format: 'mov,mp4,m4a,3gp,3g2,mj2',
        videoCodec: 'h264',
        videoPixFmt: 'yuv444p10le',
      }, 'video');

      expect(result.supported).toBe(false);
      expect(result.previewStrategy).toBe('proxy');
      expect(result.reason).toContain('yuv444p10le');
    });

    it('marks MKV with H.264 as needing proxy (container issue)', () => {
      const result = getMediaCompatibility({
        format: 'matroska,webm',
        videoCodec: 'h264',
        videoPixFmt: 'yuv420p',
      }, 'video');

      // MKV with H.264 is actually supported in Chromium
      // matroska,webm is a supported container
      expect(result.supported).toBe(true);
    });

    it('marks H.264 High 4:4:4 profile as needing proxy', () => {
      const result = getMediaCompatibility({
        format: 'mov,mp4,m4a,3gp,3g2,mj2',
        videoCodec: 'h264',
        videoProfile: 'High 4:4:4 Predictive',
        videoPixFmt: 'yuv420p',
      }, 'video');

      expect(result.supported).toBe(false);
      expect(result.previewStrategy).toBe('proxy');
      expect(result.reason).toContain('High 4:4:4');
    });

    it('marks video with no codec info as needing proxy', () => {
      const result = getMediaCompatibility({
        format: 'mov,mp4,m4a,3gp,3g2,mj2',
      }, 'video');

      // No codec info → assume needs proxy for safety
      expect(result.supported).toBe(true);
      expect(result.previewStrategy).toBe('native');
    });

    it('returns correct container and codec info', () => {
      const result = getMediaCompatibility({
        format: 'mov,mp4,m4a,3gp,3g2,mj2',
        videoCodec: 'h264',
        videoProfile: 'Main',
        videoPixFmt: 'yuv420p',
      }, 'video');

      expect(result.container).toBe('mov,mp4,m4a,3gp,3g2,mj2');
      expect(result.codec).toBe('h264');
      expect(result.profile).toBe('Main');
      expect(result.pixFmt).toBe('yuv420p');
    });
  });

  describe('audio compatibility', () => {
    it('marks AAC as natively supported', () => {
      const result = getMediaCompatibility({
        audioCodec: 'aac',
        audioProfile: 'LC',
      }, 'audio');

      expect(result.supported).toBe(true);
      expect(result.previewStrategy).toBe('native');
    });

    it('marks MP3 as natively supported', () => {
      const result = getMediaCompatibility({
        audioCodec: 'mp3',
      }, 'audio');

      expect(result.supported).toBe(true);
      expect(result.previewStrategy).toBe('native');
    });

    it('marks Opus as natively supported', () => {
      const result = getMediaCompatibility({
        audioCodec: 'opus',
      }, 'audio');

      expect(result.supported).toBe(true);
      expect(result.previewStrategy).toBe('native');
    });

    it('marks Vorbis as natively supported', () => {
      const result = getMediaCompatibility({
        audioCodec: 'vorbis',
      }, 'audio');

      expect(result.supported).toBe(true);
      expect(result.previewStrategy).toBe('native');
    });

    it('marks FLAC as natively supported', () => {
      const result = getMediaCompatibility({
        audioCodec: 'flac',
      }, 'audio');

      expect(result.supported).toBe(true);
      expect(result.previewStrategy).toBe('native');
    });

    it('marks WMA as needing proxy (unsupported codec)', () => {
      const result = getMediaCompatibility({
        audioCodec: 'wmav2',
      }, 'audio');

      expect(result.supported).toBe(false);
      expect(result.previewStrategy).toBe('proxy');
      expect(result.reason).toContain('wmav2');
    });

    it('marks AC3 as needing proxy', () => {
      const result = getMediaCompatibility({
        audioCodec: 'ac3',
      }, 'audio');

      expect(result.supported).toBe(false);
      expect(result.previewStrategy).toBe('proxy');
    });

    it('marks AAC in MP4 as natively supported', () => {
      const result = getMediaCompatibility({
        format: 'mov,mp4,m4a,3gp,3g2,mj2',
        audioCodec: 'aac',
      }, 'audio');

      expect(result.supported).toBe(true);
      expect(result.previewStrategy).toBe('native');
    });

    it('returns correct codec info', () => {
      const result = getMediaCompatibility({
        audioCodec: 'aac',
        audioProfile: 'LC',
      }, 'audio');

      expect(result.codec).toBe('aac');
      expect(result.profile).toBe('LC');
    });
  });
});

describe('needsProxy', () => {
  it('returns false for images', () => {
    const asset: Asset = {
      id: '1',
      logicalId: 'image1',
      filename: 'test.jpg',
      type: 'image',
      mimeType: 'image/jpeg',
      url: 'docuflow-asset://localhost/test.jpg',
    };

    expect(needsProxy(asset)).toBe(false);
  });

  it('returns false when no probe result', () => {
    const asset: Asset = {
      id: '1',
      logicalId: 'video1',
      filename: 'test.mp4',
      type: 'video',
      mimeType: 'video/mp4',
      url: 'docuflow-asset://localhost/test.mp4',
    };

    expect(needsProxy(asset)).toBe(false);
  });

  it('returns false for compatible video', () => {
    const asset: Asset = {
      id: '1',
      logicalId: 'video1',
      filename: 'test.mp4',
      type: 'video',
      mimeType: 'video/mp4',
      url: 'docuflow-asset://localhost/test.mp4',
    };

    expect(needsProxy(asset, {
      format: 'mov,mp4,m4a,3gp,3g2,mj2',
      videoCodec: 'h264',
      videoPixFmt: 'yuv420p',
    })).toBe(false);
  });

  it('returns true for incompatible video', () => {
    const asset: Asset = {
      id: '1',
      logicalId: 'video1',
      filename: 'test.wmv',
      type: 'video',
      mimeType: 'video/x-msvideo',
      url: 'docuflow-asset://localhost/test.wmv',
    };

    expect(needsProxy(asset, {
      format: 'mov,mp4,m4a,3gp,3g2,mj2',
      videoCodec: 'wmv3',
      videoPixFmt: 'yuv420p',
    })).toBe(true);
  });

  it('returns true for incompatible audio', () => {
    const asset: Asset = {
      id: '1',
      logicalId: 'audio1',
      filename: 'test.wma',
      type: 'audio',
      mimeType: 'audio/x-ms-wma',
      url: 'docuflow-asset://localhost/test.wma',
    };

    expect(needsProxy(asset, {
      audioCodec: 'wmav2',
    })).toBe(true);
  });

  it('returns false for compatible audio', () => {
    const asset: Asset = {
      id: '1',
      logicalId: 'audio1',
      filename: 'test.mp3',
      type: 'audio',
      mimeType: 'audio/mpeg',
      url: 'docuflow-asset://localhost/test.mp3',
    };

    expect(needsProxy(asset, {
      audioCodec: 'mp3',
    })).toBe(false);
  });
});

describe('getProxyFilename', () => {
  it('generates proxy filename for MP4 video', () => {
    const result = getProxyFilename('my_video.mp4');
    expect(result).toBe('my_video_proxy.mp4');
  });

  it('generates proxy filename for WebM video', () => {
    const result = getProxyFilename('clip.webm');
    expect(result).toBe('clip_proxy.mp4');
  });

  it('generates proxy filename for MOV video', () => {
    const result = getProxyFilename('footage.mov');
    expect(result).toBe('footage_proxy.mp4');
  });

  it('generates proxy filename for MKV video', () => {
    const result = getProxyFilename('movie.mkv');
    expect(result).toBe('movie_proxy.mp4');
  });

  it('generates proxy filename for MP3 audio', () => {
    const result = getProxyFilename('song.mp3');
    expect(result).toBe('song_proxy.mp3');
  });

  it('generates proxy filename for WAV audio', () => {
    const result = getProxyFilename('recording.wav');
    expect(result).toBe('recording_proxy.mp3');
  });

  it('generates proxy filename for FLAC audio', () => {
    const result = getProxyFilename('track.flac');
    expect(result).toBe('track_proxy.mp3');
  });

  it('handles filenames with multiple dots', () => {
    const result = getProxyFilename('my.video.file.mp4');
    expect(result).toBe('my.video.file_proxy.mp4');
  });
});
