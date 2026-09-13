import { describe, it, expect } from 'vitest';
import { buildTimeline } from '../builder';
import type { Command } from '../../commands/types';
import type { Asset } from '../../../types/assets';

// ── Helpers ─────────────────────────────────────────────────────

function makeShowCommand(
  id: string,
  opts: { start: number; duration: number; asset: string; layer?: number }
): Command {
  return {
    id,
    type: 'show',
    start: opts.start,
    duration: opts.duration,
    asset: opts.asset,
    layer: opts.layer ?? 0,
    x: 0,
    y: 0,
    scale: 1,
    opacity: 1,
  } as Command;
}

function makeMusicCommand(
  id: string,
  opts: { start: number; duration: number; asset: string }
): Command {
  return {
    id,
    type: 'music',
    start: opts.start,
    duration: opts.duration,
    asset: opts.asset,
  } as Command;
}

function makeAsset(id: string, logicalId: string, type: 'image' | 'video' | 'audio', url: string): Asset {
  return {
    id,
    logicalId,
    filename: `${logicalId}.${type === 'video' ? 'mp4' : type === 'audio' ? 'mp3' : 'jpg'}`,
    type,
    mimeType: type === 'video' ? 'video/mp4' : type === 'audio' ? 'audio/mpeg' : 'image/jpeg',
    filePath: `/test/${logicalId}.${type === 'video' ? 'mp4' : type === 'audio' ? 'mp3' : 'jpg'}`,
    url,
  } as Asset;
}

const defaultSettings = { width: 1920, height: 1080, fps: 30, title: 'test' };

// ── Tests ───────────────────────────────────────────────────────

describe('Timeline → media time conversion', () => {
  it('computes correct start/end frames for a video clip', () => {
    const cmd = makeShowCommand('v1', { start: 5, duration: 10, asset: 'video1' });
    const asset = makeAsset('a1', 'video1', 'video', 'docuflow-asset://localhost/test.mp4');
    const tl = buildTimeline([cmd], [asset], defaultSettings);

    const layer = Object.values(tl.layers)[0];
    expect(layer).toBeDefined();
    expect(layer.startFrame).toBe(150); // 5s * 30fps
    expect(layer.endFrame).toBe(450);   // 15s * 30fps
    expect(layer.assetType).toBe('video');
  });

  it('video at timeline time 7s → media time 2s', () => {
    const cmd = makeShowCommand('v1', { start: 5, duration: 10, asset: 'video1' });
    const asset = makeAsset('a1', 'video1', 'video', 'docuflow-asset://localhost/test.mp4');
    const tl = buildTimeline([cmd], [asset], defaultSettings);

    const layer = Object.values(tl.layers)[0];
    // At timeline time 7s = frame 210
    // layer starts at frame 150
    // So the video's internal frame is 210 - 150 = 60 (2s at 30fps)
    expect(layer.startFrame).toBe(150);
    expect(layer.endFrame).toBe(450);
  });
});

describe('Clip visibility at different times', () => {
  it('layer is inactive before clip start', () => {
    const cmd = makeShowCommand('v1', { start: 5, duration: 10, asset: 'video1' });
    const asset = makeAsset('a1', 'video1', 'video', 'docuflow-asset://localhost/test.mp4');
    const tl = buildTimeline([cmd], [asset], defaultSettings);

    const layer = Object.values(tl.layers)[0];
    // Frame 120 = 4s, before clip starts at 5s (frame 150)
    expect(120 >= layer.startFrame && 120 <= layer.endFrame).toBe(false);
  });

  it('layer is active during clip', () => {
    const cmd = makeShowCommand('v1', { start: 5, duration: 10, asset: 'video1' });
    const asset = makeAsset('a1', 'video1', 'video', 'docuflow-asset://localhost/test.mp4');
    const tl = buildTimeline([cmd], [asset], defaultSettings);

    const layer = Object.values(tl.layers)[0];
    // Frame 210 = 7s, during clip (5s-15s)
    expect(210 >= layer.startFrame && 210 <= layer.endFrame).toBe(true);
  });

  it('layer is inactive after clip end', () => {
    const cmd = makeShowCommand('v1', { start: 5, duration: 10, asset: 'video1' });
    const asset = makeAsset('a1', 'video1', 'video', 'docuflow-asset://localhost/test.mp4');
    const tl = buildTimeline([cmd], [asset], defaultSettings);

    const layer = Object.values(tl.layers)[0];
    // Frame 480 = 16s, after clip ends at 15s (frame 450)
    expect(480 >= layer.startFrame && 480 <= layer.endFrame).toBe(false);
  });
});

describe('Video switching between clips', () => {
  it('correctly identifies active video at different times', () => {
    const cmdA = makeShowCommand('va', { start: 0, duration: 5, asset: 'videoA', layer: 0 });
    const cmdB = makeShowCommand('vb', { start: 5, duration: 5, asset: 'videoB', layer: 0 });
    const cmdC = makeShowCommand('vc', { start: 10, duration: 5, asset: 'videoC', layer: 0 });

    const assets = [
      makeAsset('aa', 'videoA', 'video', 'docuflow-asset://localhost/a.mp4'),
      makeAsset('ab', 'videoB', 'video', 'docuflow-asset://localhost/b.mp4'),
      makeAsset('ac', 'videoC', 'video', 'docuflow-asset://localhost/c.mp4'),
    ];

    const tl = buildTimeline([cmdA, cmdB, cmdC], assets, defaultSettings);
    const layer = Object.values(tl.layers)[0];

    // 3 segments: A (0-5s), B (5-10s), C (10-15s)
    expect(layer.assetSegments.length).toBe(3);

    // At frame 75 (2.5s) → segment 0 (videoA)
    // At frame 225 (7.5s) → segment 1 (videoB)
    // At frame 375 (12.5s) → segment 2 (videoC)
    const seg0 = layer.assetSegments[0];
    const seg1 = layer.assetSegments[1];
    const seg2 = layer.assetSegments[2];

    expect(seg0.startFrame).toBe(0);
    expect(seg1.startFrame).toBe(150); // 5s * 30fps
    expect(seg2.startFrame).toBe(300); // 10s * 30fps

    expect(seg0.assetId).toBe('videoA');
    expect(seg1.assetId).toBe('videoB');
    expect(seg2.assetId).toBe('videoC');
  });
});

describe('Audio switching between clips', () => {
  it('correctly identifies active audio at different times', () => {
    const cmdA = makeMusicCommand('a1', { start: 0, duration: 8, asset: 'musicA' });
    const cmdB = makeMusicCommand('a2', { start: 8, duration: 8, asset: 'musicB' });

    const assets = [
      makeAsset('ma', 'musicA', 'audio', 'docuflow-asset://localhost/musicA.mp3'),
      makeAsset('mb', 'musicB', 'audio', 'docuflow-asset://localhost/musicB.mp3'),
    ];

    const tl = buildTimeline([cmdA, cmdB], assets, defaultSettings);

    expect(tl.audioTracks.length).toBe(2);

    const trackA = tl.audioTracks.find(t => t.assetId === 'musicA');
    const trackB = tl.audioTracks.find(t => t.assetId === 'musicB');

    expect(trackA).toBeDefined();
    expect(trackA!.startFrame).toBe(0);
    expect(trackA!.endFrame).toBe(240); // 8s * 30fps

    expect(trackB).toBeDefined();
    expect(trackB!.startFrame).toBe(240);
    expect(trackB!.endFrame).toBe(480);
  });
});

describe('Multiple clips on different tracks', () => {
  it('does not hard-code to first track', () => {
    const cmdTrack1 = makeShowCommand('t1', { start: 0, duration: 5, asset: 'imageA', layer: 0 });
    const cmdTrack2 = makeShowCommand('t2', { start: 0, duration: 5, asset: 'imageB', layer: 1 });

    const assets = [
      makeAsset('ia', 'imageA', 'image', 'docuflow-asset://localhost/a.jpg'),
      makeAsset('ib', 'imageB', 'image', 'docuflow-asset://localhost/b.jpg'),
    ];

    const tl = buildTimeline([cmdTrack1, cmdTrack2], assets, defaultSettings);

    const layers = Object.values(tl.layers);
    expect(layers.length).toBe(2);

    const layer0 = layers.find(l => l.zIndex === 0);
    const layer1 = layers.find(l => l.zIndex === 1);

    expect(layer0).toBeDefined();
    expect(layer0!.assetId).toBe('imageA');

    expect(layer1).toBeDefined();
    expect(layer1!.assetId).toBe('imageB');
  });
});

describe('Asset URL resolution', () => {
  it('resolves video asset URL through the timeline', () => {
    const cmd = makeShowCommand('v1', { start: 0, duration: 5, asset: 'video1' });
    const asset = makeAsset('a1', 'video1', 'video', 'docuflow-asset://localhost/C%3A%5Ctest%5Cvideo.mp4');
    const tl = buildTimeline([cmd], [asset], defaultSettings);

    const layer = Object.values(tl.layers)[0];
    expect(layer.assetUrl).toBe('docuflow-asset://localhost/C%3A%5Ctest%5Cvideo.mp4');
    expect(layer.assetType).toBe('video');
  });

  it('resolves audio asset URL through the timeline', () => {
    const cmd = makeMusicCommand('m1', { start: 0, duration: 5, asset: 'music1' });
    const asset = makeAsset('a1', 'music1', 'audio', 'docuflow-asset://localhost/C%3A%5Ctest%5Cmusic.mp3');
    const tl = buildTimeline([cmd], [asset], defaultSettings);

    const track = tl.audioTracks[0];
    expect(track.assetUrl).toBe('docuflow-asset://localhost/C%3A%5Ctest%5Cmusic.mp3');
  });
});

describe('Video layer assetType', () => {
  it('sets assetType to video for video commands', () => {
    const cmd = makeShowCommand('v1', { start: 0, duration: 5, asset: 'video1' });
    const asset = makeAsset('a1', 'video1', 'video', 'docuflow-asset://localhost/test.mp4');
    const tl = buildTimeline([cmd], [asset], defaultSettings);

    const layer = Object.values(tl.layers)[0];
    expect(layer.assetType).toBe('video');
  });

  it('sets assetType to image for image commands', () => {
    const cmd = makeShowCommand('i1', { start: 0, duration: 5, asset: 'image1' });
    const asset = makeAsset('a1', 'image1', 'image', 'docuflow-asset://localhost/test.jpg');
    const tl = buildTimeline([cmd], [asset], defaultSettings);

    const layer = Object.values(tl.layers)[0];
    expect(layer.assetType).toBe('image');
  });
});
