import { describe, test, expect } from 'vitest';
import { resolveLayerState, resolveAudioVolume, isAudioActive, resolveCameraState } from './resolver';
import { LayerState, AudioTrack, CameraState, DEFAULT_CAMERA, AnimatedProperty } from '../../types/timeline';

const mockLayer: LayerState = {
  id: 'layer1',
  assetId: 'asset1',
  assetUrl: 'test.jpg',
  assetType: 'image',
  visible: true,
  startFrame: 0,
  endFrame: 300,
  x: 0,
  y: 0,
  z: 0,
  scale: 1,
  rotationX: 0,
  rotationY: 0,
  rotationZ: 0,
  opacity: 1,
  blur: 0,
  flipH: false,
  flipV: false,
  cropX: 0,
  cropY: 0,
  cropWidth: 0,
  cropHeight: 0,
  zIndex: 0,
  animations: [
    { property: 'x', startFrame: 30, endFrame: 60, from: 0, to: 100, easing: 'linear' },
    { property: 'opacity', startFrame: 0, endFrame: 30, from: 0, to: 1, easing: 'easeOut' },
    { property: 'scale', startFrame: 60, endFrame: 90, from: 1, to: 2, easing: 'easeInOut' },
    { property: 'rotationZ', startFrame: 0, endFrame: 300, from: 0, to: 360, easing: 'linear' },
  ],
  keyframeTracks: [],
  assetSegments: [{ assetId: 'asset1', assetUrl: 'test.jpg', assetType: 'image', startFrame: 0 }],
};

describe('Frame Resolver', () => {
  describe('resolveLayerState', () => {
    test('returns zero state when layer is not visible (before start)', () => {
      const state = resolveLayerState(mockLayer, -1);
      expect(state.opacity).toBe(0);
      expect(state.scale).toBe(0);
      expect(state.assetUrl).toBe('');
    });

    test('returns zero state when layer is not visible (after end)', () => {
      const state = resolveLayerState(mockLayer, 301);
      expect(state.opacity).toBe(0);
      expect(state.scale).toBe(0);
    });

    test('returns base values before animations start', () => {
      const state = resolveLayerState(mockLayer, 10);
      expect(state.x).toBe(0);
      // easeOut at t=1/3: 1 - (2/3)^3 = 1 - 8/27 = 19/27 ≈ 0.704
      expect(state.opacity).toBeCloseTo(19/27, 2);
      expect(state.scale).toBe(1);
      expect(state.rotationZ).toBeCloseTo(12, 0); // linear at 10/300 * 360
    });

    test('interpolates x animation during active range', () => {
      const state = resolveAtFrame(45); // middle of 30-60
      expect(state.x).toBeCloseTo(50, 0);
    });

    test('retains final value after x animation ends', () => {
      const state = resolveLayerState(mockLayer, 90);
      expect(state.x).toBe(100);
    });

    test('interpolates opacity with easeOut easing', () => {
      const state = resolveAtFrame(15); // middle of 0-30 with easeOut
      // easeOut at t=0.5: 1 - (1-0.5)^3 = 1 - 0.125 = 0.875
      expect(state.opacity).toBeCloseTo(0.875, 2);
    });

    test('interpolates scale with easeInOut easing', () => {
      const state = resolveAtFrame(75); // middle of 60-90
      // easeInOut at t=0.5: 4 * 0.5^3 = 0.5
      expect(state.scale).toBeCloseTo(1.5, 1);
    });

    test('interpolates rotationZ linearly over full duration', () => {
      const state = resolveAtFrame(150); // middle of 0-300
      expect(state.rotationZ).toBeCloseTo(180, 0);
    });

    test('includes asset info', () => {
      const state = resolveAtFrame(50);
      expect(state.assetId).toBe('asset1');
      expect(state.assetUrl).toBe('test.jpg');
      expect(state.assetType).toBe('image');
    });
  });

  describe('resolveAudioVolume', () => {
    const mockTrackWithFade: AudioTrack = {
      id: 'track1',
      assetId: 'audio1',
      assetUrl: 'test.mp3',
      type: 'music',
      startFrame: 0,
      endFrame: 300,
      volume: 0.5,
      fadeIn: {
        property: 'volume',
        startFrame: 0,
        endFrame: 30,
        from: 0,
        to: 0.5,
        easing: 'easeOut',
      },
      fadeOut: {
        property: 'volume',
        startFrame: 270,
        endFrame: 300,
        from: 0.5,
        to: 0,
        easing: 'easeIn',
      },
    };

    const mockTrackWithVolumeAnim: AudioTrack = {
      id: 'track2',
      assetId: 'audio2',
      assetUrl: 'test2.mp3',
      type: 'music',
      startFrame: 0,
      endFrame: 300,
      volume: 0.5,
      volumeAnimations: [
        {
          property: 'volume',
          startFrame: 60,
          endFrame: 120,
          from: 0.5,
          to: 1.0,
          easing: 'linear',
        },
      ],
    };

    test('applies fadeIn at start', () => {
      const vol = resolveAudioVolume(mockTrackWithFade, 15);
      // easeOut at t=0.5: 1 - 0.5^3 = 0.875, so volume = 0 + 0.5 * 0.875 = 0.4375
      expect(vol).toBeCloseTo(0.4375, 3);
    });

    test('applies fadeOut at end', () => {
      const vol = resolveAudioVolume(mockTrackWithFade, 285); // middle of 270-300
      // easeIn at t=0.5: 0.5^3 = 0.125, so volume = 0.5 + (0 - 0.5) * 0.125 = 0.4375
      expect(vol).toBeCloseTo(0.4375, 3);
    });

    test('applies volume animation during its range', () => {
      const vol = resolveAudioVolume(mockTrackWithVolumeAnim, 90); // middle of 60-120
      // linear interpolation: 0.5 + (1.0 - 0.5) * 0.5 = 0.75
      expect(vol).toBeCloseTo(0.75, 2);
    });

    test('retains final volume animation value after it ends', () => {
      const vol = resolveAudioVolume(mockTrackWithVolumeAnim, 150); // after volume animation ends
      expect(vol).toBeCloseTo(1.0, 2);
    });

    test('returns base volume when no animations active', () => {
      const trackNoAnim: AudioTrack = { ...mockTrackWithFade, fadeIn: undefined, fadeOut: undefined };
      const vol = resolveAudioVolume(trackNoAnim, 150);
      expect(vol).toBe(0.5);
    });
  });

  describe('isAudioActive', () => {
    const track: AudioTrack = {
      id: 'track1',
      assetId: 'audio1',
      assetUrl: 'test.mp3',
      type: 'sfx',
      startFrame: 30,
      endFrame: 60,
      volume: 1.0,
    };

    test('returns false before startFrame', () => {
      expect(isAudioActive(track, 29)).toBe(false);
    });

    test('returns true at startFrame', () => {
      expect(isAudioActive(track, 30)).toBe(true);
    });

    test('returns true during track', () => {
      expect(isAudioActive(track, 45)).toBe(true);
    });

    test('returns false at endFrame (exclusive)', () => {
      expect(isAudioActive(track, 60)).toBe(false);
    });

    test('returns false after endFrame', () => {
      expect(isAudioActive(track, 61)).toBe(false);
    });
  });

  describe('resolveCameraState', () => {
    const camera: CameraState = {
      ...DEFAULT_CAMERA,
      animations: [
        { property: 'z', startFrame: 0, endFrame: 300, from: 1200, to: 800, easing: 'linear' },
        { property: 'x', startFrame: 100, endFrame: 200, from: 0, to: 100, easing: 'easeInOut' },
      ],
    };

    test('interpolates z linearly over full duration', () => {
      const cam = resolveCameraState(camera, 150);
      expect(cam.z).toBe(1000);
    });

    test('interpolates x with easeInOut during its range', () => {
      const cam = resolveCameraState(camera, 150); // middle of 100-200
      // easeInOut at t=0.5: 0.5
      expect(cam.x).toBeCloseTo(50, 1);
    });

    test('retains final values after animations end', () => {
      const cam = resolveCameraState(camera, 350);
      expect(cam.z).toBe(800);
      expect(cam.x).toBe(100);
    });

    test('returns defaults when no animations', () => {
      const cam = resolveCameraState(DEFAULT_CAMERA, 100);
      expect(cam.x).toBe(0);
      expect(cam.y).toBe(0);
      expect(cam.z).toBe(1000);
      expect(cam.zoom).toBe(1);
    });
  });
});

function resolveAtFrame(frame: number) {
  return resolveLayerState(mockLayer, frame);
}