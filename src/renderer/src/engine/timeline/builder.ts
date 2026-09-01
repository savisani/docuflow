import { Command } from '../commands/types';
import { Asset } from '../../types/assets';
import {
  TimelineState,
  LayerState,
  AudioTrack,
  TextLayer,
  AssetSegment,
  CameraState,
  DEFAULT_CAMERA,
} from '../../types/timeline';
import { ProjectSettings } from '../../types/project';
import { findAsset, getAssetUrl } from '../media/findAsset';

const DEFAULT_IMAGE_DURATION_SEC = 3;
const TEXT_Z_INDEX_BASE = 1000;
const SUBTITLE_Z_INDEX_BASE = 2000;

function makeLayer(
  id: string,
  assetId: string,
  assetUrl: string,
  assetType: 'image' | 'video',
  startFrame: number,
  endFrame: number,
  zIndex: number
): LayerState {
  return {
    id,
    assetId,
    assetUrl,
    assetType,
    visible: true,
    startFrame,
    endFrame,
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
    zIndex,
    animations: [],
    assetSegments: [
      { assetId, assetUrl, assetType, startFrame },
    ],
  };
}

function resolveAssetInfo(assets: Asset[], name: string) {
  const asset = findAsset(assets, name);
  const url = getAssetUrl(assets, name);
  const type = asset?.type === 'video' ? 'video' as const : 'image' as const;
  return { url, type, asset };
}

export function buildTimeline(
  commands: Command[],
  assets: Asset[],
  settings: ProjectSettings,
  primaryAudioDuration?: number
): TimelineState {
  const fps = settings.fps;
  const hasPrimaryAudio = typeof primaryAudioDuration === 'number' && primaryAudioDuration > 0;
  const maxAllowedFrames = hasPrimaryAudio ? Math.round(primaryAudioDuration * fps) : Infinity;
  const layers: Record<string, LayerState> = {};
  const audioTracks: AudioTrack[] = [];
  const textLayers: TextLayer[] = [];

  const sorted = [...commands].sort((a, b) => a.start - b.start);

  let maxFrame = 0;
  let zIndex = 0;
  let textIndex = 0;
  let subtitleIndex = 0;

  for (const cmd of sorted) {
    const startFrame = Math.round(cmd.start * fps);
    const durationFrames = cmd.duration ? Math.round(cmd.duration * fps) : 0;

    switch (cmd.type) {
      case 'show': {
        const { url, type } = resolveAssetInfo(assets, cmd.asset);
        const defaultEnd = startFrame + Math.round(DEFAULT_IMAGE_DURATION_SEC * fps);
        const layerZIndex = cmd.layer ?? zIndex;
        zIndex++;
        const layer = makeLayer(
          cmd.id,
          cmd.asset,
          url,
          type,
          startFrame,
          durationFrames > 0 ? startFrame + durationFrames : defaultEnd,
          layerZIndex
        );
        if (type === 'video') {
          const asset = findAsset(assets, cmd.asset);
          if (asset?.duration && !cmd.duration) {
            layer.endFrame = startFrame + Math.round(asset.duration * fps);
          }
        }
        layers[cmd.id] = layer;
        const cmdAny = cmd as any;
        if (typeof cmdAny.x === 'number') layer.x = cmdAny.x;
        if (typeof cmdAny.y === 'number') layer.y = cmdAny.y;
        if (typeof cmdAny.scale === 'number') layer.scale = cmdAny.scale;
        if (typeof cmdAny.rotationZ === 'number') layer.rotationZ = cmdAny.rotationZ;
        if (typeof cmdAny.rotationX === 'number') layer.rotationX = cmdAny.rotationX;
        if (typeof cmdAny.rotationY === 'number') layer.rotationY = cmdAny.rotationY;
        if (typeof cmdAny.opacity === 'number') layer.opacity = cmdAny.opacity;
        if (typeof cmdAny.blur === 'number') layer.blur = cmdAny.blur;
        if (typeof cmdAny.z === 'number') layer.z = cmdAny.z;
        if (typeof cmdAny.flipH === 'boolean') layer.flipH = cmdAny.flipH;
        if (typeof cmdAny.flipV === 'boolean') layer.flipV = cmdAny.flipV;
        if (layer.endFrame > maxFrame) maxFrame = layer.endFrame;
        break;
      }

      case 'hide': {
        const layer = layers[cmd.target];
        if (layer) {
          layer.endFrame = startFrame;
        }
        break;
      }

      case 'replace': {
        const layer = layers[cmd.target];
        if (layer) {
          const { url, type } = resolveAssetInfo(assets, cmd.asset);
          layer.assetSegments.push({
            assetId: cmd.asset,
            assetUrl: url,
            assetType: type,
            startFrame,
          });
          if (durationFrames > 0) {
            layer.endFrame = startFrame + durationFrames;
          } else {
            const defaultEnd = startFrame + Math.round(DEFAULT_IMAGE_DURATION_SEC * fps);
            if (layer.endFrame < defaultEnd) {
              layer.endFrame = defaultEnd;
            }
          }
          if (layer.endFrame > maxFrame) maxFrame = layer.endFrame;
        }
        break;
      }

      case 'scale': {
        const layer = layers[cmd.target];
        if (layer) {
          layer.animations.push({
            property: 'scale',
            startFrame,
            endFrame: startFrame + durationFrames,
            from: cmd.from,
            to: cmd.to,
            easing: cmd.easing || 'linear',
          });
          if (startFrame + durationFrames > maxFrame) maxFrame = startFrame + durationFrames;
        }
        break;
      }

      case 'rotate': {
        const layer = layers[cmd.target];
        if (layer) {
          layer.animations.push({
            property: 'rotationZ',
            startFrame,
            endFrame: startFrame + durationFrames,
            from: cmd.from,
            to: cmd.to,
            easing: cmd.easing || 'linear',
          });
          if (startFrame + durationFrames > maxFrame) maxFrame = startFrame + durationFrames;
        }
        break;
      }

      case 'move': {
        const layer = layers[cmd.target];
        if (layer) {
          layer.animations.push({
            property: 'x',
            startFrame,
            endFrame: startFrame + durationFrames,
            from: cmd.from.x,
            to: cmd.to.x,
            easing: cmd.easing || 'linear',
          });
          layer.animations.push({
            property: 'y',
            startFrame,
            endFrame: startFrame + durationFrames,
            from: cmd.from.y,
            to: cmd.to.y,
            easing: cmd.easing || 'linear',
          });
          if (startFrame + durationFrames > maxFrame) maxFrame = startFrame + durationFrames;
        }
        break;
      }

      case 'opacity': {
        const layer = layers[cmd.target];
        if (layer) {
          layer.animations.push({
            property: 'opacity',
            startFrame,
            endFrame: startFrame + durationFrames,
            from: cmd.from,
            to: cmd.to,
            easing: cmd.easing || 'linear',
          });
          if (startFrame + durationFrames > maxFrame) maxFrame = startFrame + durationFrames;
        }
        break;
      }

      case 'fadeIn': {
        const layer = layers[cmd.target];
        if (layer) {
          const dur = Math.round(cmd.duration * fps);
          layer.animations.push({
            property: 'opacity',
            startFrame,
            endFrame: startFrame + dur,
            from: 0,
            to: 1,
            easing: 'easeOut',
          });
          if (startFrame + dur > maxFrame) maxFrame = startFrame + dur;
        }
        break;
      }

      case 'fadeOut': {
        const layer = layers[cmd.target];
        if (layer) {
          const dur = Math.round(cmd.duration * fps);
          layer.animations.push({
            property: 'opacity',
            startFrame,
            endFrame: startFrame + dur,
            from: 1,
            to: 0,
            easing: 'easeIn',
          });
          if (startFrame + dur > maxFrame) maxFrame = startFrame + dur;
        }
        break;
      }

      case 'blur': {
        const layer = layers[cmd.target];
        if (layer) {
          layer.animations.push({
            property: 'blur',
            startFrame,
            endFrame: startFrame + durationFrames,
            from: cmd.from,
            to: cmd.to,
            easing: cmd.easing || 'linear',
          });
          if (startFrame + durationFrames > maxFrame) maxFrame = startFrame + durationFrames;
        }
        break;
      }

      case 'flipHorizontal': {
        const layer = layers[cmd.target];
        if (layer) {
          layer.flipH = true;
        }
        break;
      }

      case 'flipVertical': {
        const layer = layers[cmd.target];
        if (layer) {
          layer.flipV = true;
        }
        break;
      }

      case 'move3D': {
        const layer = layers[cmd.target];
        if (layer) {
          layer.animations.push(
            { property: 'x', startFrame, endFrame: startFrame + durationFrames, from: cmd.from.x, to: cmd.to.x, easing: cmd.easing || 'linear' },
            { property: 'y', startFrame, endFrame: startFrame + durationFrames, from: cmd.from.y, to: cmd.to.y, easing: cmd.easing || 'linear' },
            { property: 'z', startFrame, endFrame: startFrame + durationFrames, from: cmd.from.z, to: cmd.to.z, easing: cmd.easing || 'linear' }
          );
          if (startFrame + durationFrames > maxFrame) maxFrame = startFrame + durationFrames;
        }
        break;
      }

      case 'rotate3D': {
        const layer = layers[cmd.target];
        if (layer) {
          layer.animations.push(
            { property: 'rotationX', startFrame, endFrame: startFrame + durationFrames, from: cmd.from.x, to: cmd.to.x, easing: cmd.easing || 'linear' },
            { property: 'rotationY', startFrame, endFrame: startFrame + durationFrames, from: cmd.from.y, to: cmd.to.y, easing: cmd.easing || 'linear' },
            { property: 'rotationZ', startFrame, endFrame: startFrame + durationFrames, from: cmd.from.z, to: cmd.to.z, easing: cmd.easing || 'linear' }
          );
          if (startFrame + durationFrames > maxFrame) maxFrame = startFrame + durationFrames;
        }
        break;
      }

      case 'depth': {
        const layer = layers[cmd.target];
        if (layer) {
          layer.animations.push({
            property: 'z',
            startFrame,
            endFrame: startFrame + durationFrames,
            from: cmd.from,
            to: cmd.to,
            easing: cmd.easing || 'linear',
          });
          if (startFrame + durationFrames > maxFrame) maxFrame = startFrame + durationFrames;
        }
        break;
      }

      case 'music': {
        const { url } = resolveAssetInfo(assets, cmd.asset);
        const asset = findAsset(assets, cmd.asset);
        const endFrame = asset?.duration
          ? startFrame + Math.round(asset.duration * fps)
          : startFrame + durationFrames;
        const track: AudioTrack = {
          id: cmd.id,
          assetId: cmd.asset,
          assetUrl: url,
          type: 'music',
          startFrame,
          endFrame: cmd.duration ? startFrame + durationFrames : endFrame,
          volume: cmd.volume ?? 0.5,
        };
        if (cmd.fadeIn) {
          track.fadeIn = {
            property: 'volume',
            startFrame,
            endFrame: startFrame + Math.round(cmd.fadeIn * fps),
            from: 0,
            to: cmd.volume ?? 0.5,
            easing: 'easeOut',
          };
        }
        if (cmd.fadeOut) {
          track.fadeOut = {
            property: 'volume',
            startFrame: track.endFrame - Math.round(cmd.fadeOut * fps),
            endFrame: track.endFrame,
            from: cmd.volume ?? 0.5,
            to: 0,
            easing: 'easeIn',
          };
        }
        audioTracks.push(track);
        if (track.endFrame > maxFrame) maxFrame = track.endFrame;
        break;
      }

      case 'sfx': {
        const { url } = resolveAssetInfo(assets, cmd.asset);
        const asset = findAsset(assets, cmd.asset);
        let endFrame: number;
        if (durationFrames > 0) {
          endFrame = startFrame + durationFrames;
        } else if (asset?.duration) {
          endFrame = startFrame + Math.round(asset.duration * fps);
        } else {
          endFrame = startFrame + Math.round(2 * fps);
        }
        audioTracks.push({
          id: cmd.id,
          assetId: cmd.asset,
          assetUrl: url,
          type: 'sfx',
          startFrame,
          endFrame,
          volume: cmd.volume ?? 0.7,
        });
        if (endFrame > maxFrame) maxFrame = endFrame;
        break;
      }

      case 'ambient': {
        const { url } = resolveAssetInfo(assets, cmd.asset);
        const asset = findAsset(assets, cmd.asset);
        const endFrame = asset?.duration
          ? startFrame + Math.round(asset.duration * fps)
          : startFrame + durationFrames;
        const track: AudioTrack = {
          id: cmd.id,
          assetId: cmd.asset,
          assetUrl: url,
          type: 'ambient',
          startFrame,
          endFrame: cmd.duration ? startFrame + durationFrames : endFrame,
          volume: cmd.volume ?? 0.5,
        };
        if (cmd.fadeIn) {
          track.fadeIn = {
            property: 'volume',
            startFrame,
            endFrame: startFrame + Math.round(cmd.fadeIn * fps),
            from: 0,
            to: cmd.volume ?? 0.5,
            easing: 'easeOut',
          };
        }
        if (cmd.fadeOut) {
          track.fadeOut = {
            property: 'volume',
            startFrame: track.endFrame - Math.round(cmd.fadeOut * fps),
            endFrame: track.endFrame,
            from: cmd.volume ?? 0.5,
            to: 0,
            easing: 'easeIn',
          };
        }
        audioTracks.push(track);
        if (track.endFrame > maxFrame) maxFrame = track.endFrame;
        break;
      }

      case 'crossfade': {
        const targetLayer = layers[cmd.target];
        const { url, type } = resolveAssetInfo(assets, (cmd as any).toAsset);
        if (targetLayer) {
          const newLayerZIndex = zIndex++;
          const newLayer = makeLayer(
            cmd.id,
            (cmd as any).toAsset,
            url,
            type,
            startFrame,
            startFrame + durationFrames,
            newLayerZIndex
          );
          newLayer.opacity = 0;
          newLayer.animations.push({
            property: 'opacity',
            startFrame,
            endFrame: startFrame + durationFrames,
            from: 0,
            to: 1,
            easing: 'easeInOut',
          });
          layers[cmd.id] = newLayer;

          targetLayer.animations.push({
            property: 'opacity',
            startFrame,
            endFrame: startFrame + durationFrames,
            from: 1,
            to: 0,
            easing: 'easeInOut',
          });
          if (startFrame + durationFrames > maxFrame) maxFrame = startFrame + durationFrames;
        }
        break;
      }

      case 'slide': {
        const slideCmd = cmd as any;
        const { url, type } = resolveAssetInfo(assets, slideCmd.target);
        const targetLayer = layers[slideCmd.target];
        let fromX = 0;
        let fromY = 0;
        const direction = slideCmd.direction;
        const canvasWidth = settings.width;
        const canvasHeight = settings.height;

        switch (direction) {
          case 'left': fromX = -canvasWidth; break;
          case 'right': fromX = canvasWidth; break;
          case 'top': fromY = -canvasHeight; break;
          case 'bottom': fromY = canvasHeight; break;
        }

        const newLayerZIndex = zIndex++;
        const newLayer = makeLayer(
          cmd.id,
          slideCmd.target,
          url,
          type,
          startFrame,
          startFrame + durationFrames,
          newLayerZIndex
        );
        newLayer.x = fromX;
        newLayer.y = fromY;
        newLayer.animations.push({
          property: 'x',
          startFrame,
          endFrame: startFrame + durationFrames,
          from: fromX,
          to: 0,
          easing: 'easeOut',
        });
        newLayer.animations.push({
          property: 'y',
          startFrame,
          endFrame: startFrame + durationFrames,
          from: fromY,
          to: 0,
          easing: 'easeOut',
        });
        layers[cmd.id] = newLayer;

        if (targetLayer) {
          let toX = 0;
          let toY = 0;
          switch (direction) {
            case 'left': toX = canvasWidth; break;
            case 'right': toX = -canvasWidth; break;
            case 'top': toY = canvasHeight; break;
            case 'bottom': toY = -canvasHeight; break;
          }
          targetLayer.animations.push({
            property: 'x',
            startFrame,
            endFrame: startFrame + durationFrames,
            from: targetLayer.x,
            to: toX,
            easing: 'easeIn',
          });
          targetLayer.animations.push({
            property: 'y',
            startFrame,
            endFrame: startFrame + durationFrames,
            from: targetLayer.y,
            to: toY,
            easing: 'easeIn',
          });
        }
        if (startFrame + durationFrames > maxFrame) maxFrame = startFrame + durationFrames;
        break;
      }

      case 'wipe': {
        const wipeCmd = cmd as any;
        const { url, type } = resolveAssetInfo(assets, wipeCmd.toAsset || wipeCmd.target);
        const direction = wipeCmd.direction;
        const canvasWidth = settings.width;
        const canvasHeight = settings.height;

        const newLayerZIndex = zIndex++;
        const newLayer = makeLayer(
          cmd.id,
          wipeCmd.toAsset || wipeCmd.target,
          url,
          type,
          startFrame,
          startFrame + durationFrames,
          newLayerZIndex
        );
        layers[cmd.id] = newLayer;

        if (startFrame + durationFrames > maxFrame) maxFrame = startFrame + durationFrames;
        break;
      }

      case 'cut': {
        const layer = layers[cmd.target];
        if (layer) {
          layer.endFrame = startFrame;
        }
        break;
      }

      case 'volume': {
        const volCmd = cmd as any;
        const track = audioTracks.find(t => t.assetId === volCmd.target);
        if (track) {
          track.volumeAnimations = track.volumeAnimations || [];
          track.volumeAnimations.push({
            property: 'volume',
            startFrame,
            endFrame: startFrame + durationFrames,
            from: volCmd.from,
            to: volCmd.to,
            easing: volCmd.easing || 'linear',
          });
          if (startFrame + durationFrames > maxFrame) maxFrame = startFrame + durationFrames;
        }
        break;
      }

      case 'fadeAudioIn': {
        const fadeCmd = cmd as any;
        const track = audioTracks.find(t => t.assetId === fadeCmd.target);
        if (track) {
          const durFrames = Math.round(fadeCmd.duration * fps);
          track.fadeIn = {
            property: 'volume',
            startFrame,
            endFrame: startFrame + durFrames,
            from: 0,
            to: track.volume,
            easing: 'easeOut',
          };
          if (startFrame + durFrames > maxFrame) maxFrame = startFrame + durFrames;
        }
        break;
      }

      case 'fadeAudioOut': {
        const fadeCmd = cmd as any;
        const track = audioTracks.find(t => t.assetId === fadeCmd.target);
        if (track) {
          const durFrames = Math.round(fadeCmd.duration * fps);
          track.fadeOut = {
            property: 'volume',
            startFrame,
            endFrame: startFrame + durFrames,
            from: track.volume,
            to: 0,
            easing: 'easeIn',
          };
          if (startFrame + durFrames > maxFrame) maxFrame = startFrame + durFrames;
        }
        break;
      }

      case 'text':
      case 'subtitle': {
        const isSub = cmd.type === 'subtitle';
        const textCmd = isSub ? null : cmd as Extract<Command, { type: 'text' }>;
        const endFrame = startFrame + durationFrames;
        const textZIndex = isSub
          ? SUBTITLE_Z_INDEX_BASE + subtitleIndex++
          : TEXT_Z_INDEX_BASE + textIndex++;
        textLayers.push({
          id: cmd.id,
          content: cmd.content,
          startFrame,
          endFrame,
          x: cmd.x ?? (isSub ? 960 : 100),
          y: cmd.y ?? (isSub ? 950 : 100),
          fontSize: textCmd?.fontSize ?? (isSub ? 48 : 36),
          fontFamily: textCmd?.fontFamily ?? 'Arial',
          color: textCmd?.color ?? '#FFFFFF',
          isSubtitle: isSub,
          zIndex: textZIndex,
        });
        if (endFrame > maxFrame) maxFrame = endFrame;
        break;
      }

      case 'cameraMove':
      case 'cameraRotate': {
        if (durationFrames > 0) {
          if (startFrame + durationFrames > maxFrame) maxFrame = startFrame + durationFrames;
        }
        break;
      }
    }
  }

  for (const layer of Object.values(layers)) {
    let maxEnd = layer.endFrame;
    for (const anim of layer.animations) {
      if (anim.endFrame > maxEnd) maxEnd = anim.endFrame;
    }
    if (maxEnd > layer.endFrame) layer.endFrame = maxEnd;
  }

  const camera: CameraState = { ...DEFAULT_CAMERA };
  for (const cmd of sorted) {
    const startFrame = Math.round(cmd.start * fps);
    const durationFrames = cmd.duration ? Math.round(cmd.duration * fps) : 0;

    if (cmd.type === 'cameraMove' && durationFrames > 0) {
      const endFrame = startFrame + durationFrames;
      camera.animations = camera.animations || [];
      camera.animations.push(
        { property: 'x', startFrame, endFrame, from: cmd.from.x, to: cmd.to.x, easing: cmd.easing || 'linear' },
        { property: 'y', startFrame, endFrame, from: cmd.from.y, to: cmd.to.y, easing: cmd.easing || 'linear' },
        { property: 'z', startFrame, endFrame, from: cmd.from.z, to: cmd.to.z, easing: cmd.easing || 'linear' }
      );
    }

    if (cmd.type === 'cameraRotate' && durationFrames > 0) {
      const endFrame = startFrame + durationFrames;
      camera.animations = camera.animations || [];
      camera.animations.push(
        { property: 'rotationX', startFrame, endFrame, from: cmd.from.x, to: cmd.to.x, easing: cmd.easing || 'linear' },
        { property: 'rotationY', startFrame, endFrame, from: cmd.from.y, to: cmd.to.y, easing: cmd.easing || 'linear' },
        { property: 'rotationZ', startFrame, endFrame, from: cmd.from.z, to: cmd.to.z, easing: cmd.easing || 'linear' }
      );
    }
  }

  // ---------------------------------------------------------------------------
  // Clamp all end frames to primary audio duration when provided
  // ---------------------------------------------------------------------------
  if (hasPrimaryAudio) {
    for (const layer of Object.values(layers)) {
      if (layer.endFrame > maxAllowedFrames) layer.endFrame = maxAllowedFrames;
      for (const anim of layer.animations) {
        if (anim.endFrame > maxAllowedFrames) anim.endFrame = maxAllowedFrames;
      }
      for (const seg of layer.assetSegments) {
        // segments don't have endFrame but ensure startFrame is within bounds
      }
    }
    for (const track of audioTracks) {
      if (track.endFrame > maxAllowedFrames) track.endFrame = maxAllowedFrames;
      if (track.fadeIn && track.fadeIn.endFrame > maxAllowedFrames) track.fadeIn.endFrame = maxAllowedFrames;
      if (track.fadeOut && track.fadeOut.startFrame > maxAllowedFrames) track.fadeOut.startFrame = maxAllowedFrames;
      if (track.fadeOut && track.fadeOut.endFrame > maxAllowedFrames) track.fadeOut.endFrame = maxAllowedFrames;
      if (track.volumeAnimations) {
        for (const va of track.volumeAnimations) {
          if (va.endFrame > maxAllowedFrames) va.endFrame = maxAllowedFrames;
        }
      }
    }
    for (const text of textLayers) {
      if (text.endFrame > maxAllowedFrames) text.endFrame = maxAllowedFrames;
    }
    if (camera.animations) {
      for (const anim of camera.animations) {
        if (anim.endFrame > maxAllowedFrames) anim.endFrame = maxAllowedFrames;
      }
    }

    // Recalculate maxFrame after clamping
    maxFrame = 0;
    for (const layer of Object.values(layers)) {
      if (layer.endFrame > maxFrame) maxFrame = layer.endFrame;
      for (const anim of layer.animations) {
        if (anim.endFrame > maxFrame) maxFrame = anim.endFrame;
      }
    }
    for (const track of audioTracks) {
      if (track.endFrame > maxFrame) maxFrame = track.endFrame;
    }
    for (const text of textLayers) {
      if (text.endFrame > maxFrame) maxFrame = text.endFrame;
    }
  }

  let totalFrames: number;
  if (hasPrimaryAudio) {
    // Primary audio is the source of truth — no padding
    totalFrames = maxAllowedFrames;
  } else {
    // Fallback: add 2 seconds padding for projects without primary audio
    const paddingFrames = Math.round(2 * fps);
    totalFrames = Math.max(Math.round(fps * 0.5), maxFrame + paddingFrames);
  }

  // Dev-time validation
  if (hasPrimaryAudio && process.env.NODE_ENV !== 'production') {
    const tolerance = 1; // 1 frame tolerance for floating-point rounding
    if (maxFrame > maxAllowedFrames + tolerance) {
      console.warn(
        `[buildTimeline] Scene timeline extends beyond primary audio: ` +
        `maxFrame=${maxFrame} (${(maxFrame / fps).toFixed(3)}s) > ` +
        `maxAllowedFrames=${maxAllowedFrames} (${primaryAudioDuration}s)`
      );
    }
    if (totalFrames !== maxAllowedFrames) {
      console.warn(
        `[buildTimeline] totalFrames (${totalFrames}) !== maxAllowedFrames (${maxAllowedFrames})`
      );
    }
  }

  return {
    layers,
    audioTracks,
    textLayers,
    totalFrames,
    camera,
  };
}
