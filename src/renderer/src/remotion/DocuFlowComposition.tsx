import React from 'react';
import {
  AbsoluteFill,
  Img,
  Audio,
  Sequence,
  useCurrentFrame,
  useVideoConfig,
} from 'remotion';
import { TimelineState, LayerState, AudioTrack, TextLayer } from '../types/timeline';
import { resolveLayerState, resolveAudioVolume, isAudioActive, isTextActive, resolveCameraState } from '../engine/timeline/resolver';
import { interpolate } from '../engine/animation/interpolation';

interface DocuFlowProps {
  timeline: TimelineState;
}

function getLayerTransform(
  state: { x: number; y: number; z: number; rotationX: number; rotationY: number; rotationZ: number; scale: number; flipH: boolean; flipV: boolean },
): string {
  const scaleX = state.flipH ? -state.scale : state.scale;
  const scaleY = state.flipV ? -state.scale : state.scale;

  return [
    `translate(${state.x}px, ${state.y}px)`,
    `translateZ(${state.z}px)`,
    `rotateX(${state.rotationX}deg)`,
    `rotateY(${state.rotationY}deg)`,
    `rotateZ(${state.rotationZ}deg)`,
    `scale(${scaleX}, ${scaleY})`,
  ].join(' ');
}

function getCameraTransform(
  camera: { x: number; y: number; z: number; rotationX: number; rotationY: number; rotationZ: number; zoom: number },
): string {
  return [
    `rotateX(${camera.rotationX}deg)`,
    `rotateY(${camera.rotationY}deg)`,
    `rotateZ(${camera.rotationZ}deg)`,
    `scale(${camera.zoom})`,
    `translate(${-camera.x}px, ${-camera.y}px)`,
  ].join(' ');
}

export const DocuFlowComposition: React.FC<DocuFlowProps> = ({ timeline }) => {
  const frame = useCurrentFrame();
  const { fps, width, height } = useVideoConfig();

  const sortedLayers = Object.values(timeline.layers).sort(
    (a, b) => a.zIndex - b.zIndex
  );

  const camera = resolveCameraState(timeline.camera, frame);

  const perspective = camera.z;
  const cameraTransform = getCameraTransform(camera);

  return (
    <AbsoluteFill style={{ backgroundColor: '#000' }}>
      <div
        style={{
          position: 'absolute',
          width: `${width}px`,
          height: `${height}px`,
          left: '50%',
          top: '50%',
          transform: 'translate(-50%, -50%)',
          perspective: `${perspective}px`,
          perspectiveOrigin: '50% 50%',
          overflow: 'hidden',
        }}
      >
        <div
          style={{
            position: 'absolute',
            width: `${width}px`,
            height: `${height}px`,
            left: 0,
            top: 0,
            transformStyle: 'preserve-3d',
            transform: cameraTransform,
            transformOrigin: '50% 50%',
          }}
        >
          {sortedLayers.map((layer) => (
            <RenderLayer
              key={layer.id}
              layer={layer}
              frame={frame}
              fps={fps}
            />
          ))}
        </div>
      </div>

      {timeline.audioTracks.map((track) => (
        <RenderAudio key={track.id} track={track} frame={frame} fps={fps} />
      ))}

      {timeline.textLayers.map((text) => (
        <RenderText key={text.id} text={text} frame={frame} fps={fps} />
      ))}
    </AbsoluteFill>
  );
};

const RenderLayer: React.FC<{
  layer: LayerState;
  frame: number;
  fps: number;
}> = ({ layer, frame, fps }) => {
  const state = resolveLayerState(layer, frame);

  if (state.opacity <= 0 || state.scale <= 0) return null;
  if (!state.assetUrl) return null;

  const filterParts: string[] = [];
  if (state.blur > 0) {
    filterParts.push(`blur(${state.blur}px)`);
  }

  const transform = getLayerTransform(state);

  return (
    <div
      style={{
        position: 'absolute',
        left: '50%',
        top: '50%',
        transformStyle: 'preserve-3d',
        transform: `translate(-50%, -50%) ${transform}`,
        transformOrigin: '0 0',
        opacity: state.opacity,
        zIndex: layer.zIndex,
      }}
    >
      <Img
        src={state.assetUrl}
        style={{
          display: 'block',
          filter: filterParts.length > 0 ? filterParts.join(' ') : undefined,
        }}
      />
    </div>
  );
};

const RenderAudio: React.FC<{
  track: AudioTrack;
  frame: number;
  fps: number;
}> = ({ track, frame, fps }) => {
  if (!track.assetUrl) return null;

  const durationInFrames = track.endFrame - track.startFrame;
  if (durationInFrames <= 0) return null;

  return (
    <Sequence from={track.startFrame} durationInFrames={durationInFrames}>
      <Audio
        src={track.assetUrl}
        volume={(f) => {
          const currentFrame = track.startFrame + f;
          if (!isAudioActive(track, currentFrame)) return 0;
          return resolveAudioVolume(track, currentFrame);
        }}
      />
    </Sequence>
  );
};

const RenderText: React.FC<{
  text: TextLayer;
  frame: number;
  fps: number;
}> = ({ text, frame, fps }) => {
  if (!isTextActive(text, frame)) return null;

  const fadeInEnd = text.startFrame + Math.round(0.3 * fps);
  const fadeOutStart = text.endFrame - Math.round(0.3 * fps);

  let opacity = 1;
  if (frame < fadeInEnd) {
    opacity = interpolate(frame, text.startFrame, fadeInEnd, 0, 1, 'easeOut');
  } else if (frame > fadeOutStart) {
    opacity = interpolate(frame, fadeOutStart, text.endFrame, 1, 0, 'easeIn');
  }

  const positionStyle: React.CSSProperties = text.isSubtitle
    ? {
        bottom: text.y !== 950 ? text.y : undefined,
        top: text.y === 950 ? 'auto' : undefined,
        left: '50%',
        transform: 'translateX(-50%)',
      }
    : {
        left: text.x,
        top: text.y,
      };

  return (
    <div
      style={{
        position: 'absolute',
        ...positionStyle,
        color: text.color,
        fontSize: text.fontSize,
        fontFamily: text.fontFamily,
        fontWeight: text.isSubtitle ? 'bold' : 'normal',
        textShadow: '2px 2px 4px rgba(0,0,0,0.8)',
        opacity,
        whiteSpace: 'pre-wrap',
        textAlign: 'center',
        maxWidth: text.isSubtitle ? '80%' : undefined,
        zIndex: text.zIndex,
      }}
    >
      {text.content}
    </div>
  );
};
