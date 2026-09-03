import { LayerState, AudioTrack, AssetSegment, AnimatedProperty, CameraState, DEFAULT_CAMERA, KeyframeTrack } from '../../types/timeline';
import { interpolate } from '../animation/interpolation';

function resolveAssetForFrame(layer: LayerState, frame: number): AssetSegment {
  const segments = layer.assetSegments;
  if (segments.length === 0) {
    return { assetId: layer.assetId, assetUrl: layer.assetUrl, assetType: layer.assetType, startFrame: layer.startFrame };
  }
  let result = segments[0];
  for (const seg of segments) {
    if (frame >= seg.startFrame) {
      result = seg;
    }
  }
  return result;
}

function evaluateAnimation(anim: AnimatedProperty, frame: number, baseValue: number): number {
  if (frame < anim.startFrame) return baseValue;
  if (frame >= anim.endFrame) return anim.to;
  return interpolate(frame, anim.startFrame, anim.endFrame, anim.from, anim.to, anim.easing);
}

function resolveKeyframeTrack(track: KeyframeTrack, frame: number): number | null {
  const kfs = track.keyframes;
  if (kfs.length === 0) return null;
  if (kfs.length === 1) return kfs[0].value;

  // Before first keyframe
  if (frame <= kfs[0].time) return kfs[0].value;

  // After last keyframe
  if (frame >= kfs[kfs.length - 1].time) return kfs[kfs.length - 1].value;

  // Between keyframes - find the pair
  for (let i = 0; i < kfs.length - 1; i++) {
    const kf1 = kfs[i];
    const kf2 = kfs[i + 1];
    if (frame >= kf1.time && frame <= kf2.time) {
      return interpolate(frame, kf1.time, kf2.time, kf1.value, kf2.value, kf2.easing);
    }
  }

  return kfs[kfs.length - 1].value;
}

function resolveProperty(layer: LayerState, property: string, frame: number, baseValue: number): number {
  // Check keyframe tracks first (higher priority)
  const kfTrack = layer.keyframeTracks.find(t => t.property === property);
  if (kfTrack) {
    const kfValue = resolveKeyframeTrack(kfTrack, frame);
    if (kfValue !== null) return kfValue;
  }

  // Fall back to command-driven animations
  let value = baseValue;
  for (const anim of layer.animations) {
    if (anim.property !== property) continue;
    if (frame < anim.startFrame) continue;
    if (frame >= anim.endFrame) {
      value = anim.to;
    } else {
      value = interpolate(frame, anim.startFrame, anim.endFrame, anim.from, anim.to, anim.easing);
      break;
    }
  }
  return value;
}

export function resolveLayerState(
  layer: LayerState,
  frame: number
): {
  x: number;
  y: number;
  z: number;
  scale: number;
  rotationX: number;
  rotationY: number;
  rotationZ: number;
  opacity: number;
  blur: number;
  flipH: boolean;
  flipV: boolean;
  assetUrl: string;
  assetId: string;
  assetType: 'image' | 'video';
} {
  const visible = frame >= layer.startFrame && frame <= layer.endFrame && layer.visible;
  if (!visible) {
    return {
      x: 0, y: 0, z: 0, scale: 0, rotationX: 0, rotationY: 0, rotationZ: 0, opacity: 0, blur: 0,
      flipH: false, flipV: false,
      assetUrl: '', assetId: '', assetType: 'image',
    };
  }

  const segment = resolveAssetForFrame(layer, frame);

  return {
    x: resolveProperty(layer, 'x', frame, layer.x),
    y: resolveProperty(layer, 'y', frame, layer.y),
    z: resolveProperty(layer, 'z', frame, layer.z),
    scale: resolveProperty(layer, 'scale', frame, layer.scale),
    rotationX: resolveProperty(layer, 'rotationX', frame, layer.rotationX),
    rotationY: resolveProperty(layer, 'rotationY', frame, layer.rotationY),
    rotationZ: resolveProperty(layer, 'rotationZ', frame, layer.rotationZ),
    opacity: resolveProperty(layer, 'opacity', frame, layer.opacity),
    blur: resolveProperty(layer, 'blur', frame, layer.blur),
    flipH: layer.flipH,
    flipV: layer.flipV,
    assetUrl: segment.assetUrl,
    assetId: segment.assetId,
    assetType: segment.assetType,
  };
}

export function resolveAudioVolume(
  track: AudioTrack,
  frame: number
): number {
  let vol = track.volume;

  if (track.fadeIn && frame >= track.fadeIn.startFrame && frame < track.fadeIn.endFrame) {
    vol = interpolate(
      frame,
      track.fadeIn.startFrame,
      track.fadeIn.endFrame,
      track.fadeIn.from,
      track.fadeIn.to,
      track.fadeIn.easing
    );
  }

  if (track.fadeOut && frame >= track.fadeOut.startFrame && frame < track.fadeOut.endFrame) {
    vol = interpolate(
      frame,
      track.fadeOut.startFrame,
      track.fadeOut.endFrame,
      track.fadeOut.from,
      track.fadeOut.to,
      track.fadeOut.easing
    );
  }

  if (track.volumeAnimations && track.volumeAnimations.length > 0) {
    for (const anim of track.volumeAnimations) {
      if (frame < anim.startFrame) continue;
      if (frame >= anim.endFrame) {
        vol = anim.to;
      } else {
        vol = interpolate(
          frame,
          anim.startFrame,
          anim.endFrame,
          anim.from,
          anim.to,
          anim.easing
        );
        break;
      }
    }
  }

  return vol;
}

export function isAudioActive(track: AudioTrack, frame: number): boolean {
  return frame >= track.startFrame && frame < track.endFrame;
}

export function isTextActive(text: { startFrame: number; endFrame: number }, frame: number): boolean {
  return frame >= text.startFrame && frame < text.endFrame;
}

export function resolveCameraState(
  camera: CameraState,
  frame: number
): CameraState {
  const result = { ...camera };

  if (!camera.animations || camera.animations.length === 0) {
    return result;
  }

  for (const anim of camera.animations) {
    if (frame < anim.startFrame) continue;
    if (frame >= anim.endFrame) {
      (result as any)[anim.property] = anim.to;
    } else {
      (result as any)[anim.property] = interpolate(
        frame, anim.startFrame, anim.endFrame, anim.from, anim.to, anim.easing
      );
    }
  }

  return result;
}
