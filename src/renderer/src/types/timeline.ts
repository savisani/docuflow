export type EasingType = 'linear' | 'easeIn' | 'easeOut' | 'easeInOut';

export interface AnimatedProperty {
  property: string;
  startFrame: number;
  endFrame: number;
  from: number;
  to: number;
  easing: EasingType;
}

export interface AssetSegment {
  assetId: string;
  assetUrl: string;
  assetType: 'image' | 'video';
  startFrame: number;
}

export interface LayerState {
  id: string;
  assetId: string;
  assetUrl: string;
  assetType: 'image' | 'video';
  visible: boolean;
  startFrame: number;
  endFrame: number;
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
  cropX: number;
  cropY: number;
  cropWidth: number;
  cropHeight: number;
  zIndex: number;
  animations: AnimatedProperty[];
  assetSegments: AssetSegment[];
}

export interface AudioTrack {
  id: string;
  assetId: string;
  assetUrl: string;
  type: 'voiceover' | 'music' | 'sfx' | 'ambient';
  startFrame: number;
  endFrame: number;
  volume: number;
  fadeIn?: AnimatedProperty;
  fadeOut?: AnimatedProperty;
  volumeAnimations?: AnimatedProperty[];
}

export interface TextLayer {
  id: string;
  content: string;
  startFrame: number;
  endFrame: number;
  x: number;
  y: number;
  fontSize: number;
  fontFamily: string;
  color: string;
  isSubtitle: boolean;
  zIndex: number;
}

export interface CameraState {
  x: number;
  y: number;
  z: number;
  rotationX: number;
  rotationY: number;
  rotationZ: number;
  zoom: number;
  animations?: AnimatedProperty[];
}

export const DEFAULT_CAMERA: CameraState = {
  x: 0,
  y: 0,
  z: 1000,
  rotationX: 0,
  rotationY: 0,
  rotationZ: 0,
  zoom: 1,
};

export interface TimelineState {
  layers: Record<string, LayerState>;
  audioTracks: AudioTrack[];
  textLayers: TextLayer[];
  totalFrames: number;
  camera: CameraState;
}
