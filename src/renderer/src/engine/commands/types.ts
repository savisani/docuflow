export type EasingType = 'linear' | 'easeIn' | 'easeOut' | 'easeInOut';

interface BaseCommand {
  id: string;
  type: string;
  start: number;
  duration?: number;
}

export interface ShowCommand extends BaseCommand {
  type: 'show';
  asset: string;
  layer?: number;
  x?: number;
  y?: number;
  z?: number;
  scale?: number;
  rotationX?: number;
  rotationY?: number;
  rotationZ?: number;
  opacity?: number;
  blur?: number;
  flipH?: boolean;
  flipV?: boolean;
}

export interface HideCommand extends BaseCommand {
  type: 'hide';
  target: string;
}

export interface ReplaceCommand extends BaseCommand {
  type: 'replace';
  target: string;
  asset: string;
}

export interface CutCommand extends BaseCommand {
  type: 'cut';
  target: string;
}

export interface MoveCommand extends BaseCommand {
  type: 'move';
  target: string;
  from: { x: number; y: number };
  to: { x: number; y: number };
  easing?: EasingType;
}

export interface ScaleCommand extends BaseCommand {
  type: 'scale';
  target: string;
  from: number;
  to: number;
  easing?: EasingType;
}

export interface RotateCommand extends BaseCommand {
  type: 'rotate';
  target: string;
  from: number;
  to: number;
  easing?: EasingType;
}

export interface FlipHCommand extends BaseCommand {
  type: 'flipHorizontal';
  target: string;
}

export interface FlipVCommand extends BaseCommand {
  type: 'flipVertical';
  target: string;
}

export interface CropCommand extends BaseCommand {
  type: 'crop';
  target: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface OpacityCommand extends BaseCommand {
  type: 'opacity';
  target: string;
  from: number;
  to: number;
  easing?: EasingType;
}

export interface FadeInCommand extends BaseCommand {
  type: 'fadeIn';
  target: string;
  duration: number;
}

export interface FadeOutCommand extends BaseCommand {
  type: 'fadeOut';
  target: string;
  duration: number;
}

export interface BlurCommand extends BaseCommand {
  type: 'blur';
  target: string;
  from: number;
  to: number;
  easing?: EasingType;
}

export interface CrossfadeCommand extends BaseCommand {
  type: 'crossfade';
  target: string;
  toAsset: string;
  duration: number;
}

export interface SlideCommand extends BaseCommand {
  type: 'slide';
  target: string;
  fromAsset?: string;
  direction: 'left' | 'right' | 'top' | 'bottom';
}

export interface WipeCommand extends BaseCommand {
  type: 'wipe';
  target: string;
  toAsset?: string;
  direction: 'left' | 'right' | 'top' | 'bottom';
}

export interface MusicCommand extends BaseCommand {
  type: 'music';
  asset: string;
  volume?: number;
  fadeIn?: number;
  fadeOut?: number;
}

export interface SfxCommand extends BaseCommand {
  type: 'sfx';
  asset: string;
  volume?: number;
}

export interface AmbientCommand extends BaseCommand {
  type: 'ambient';
  asset: string;
  volume?: number;
  fadeIn?: number;
  fadeOut?: number;
}

export interface VolumeCommand extends BaseCommand {
  type: 'volume';
  target: string;
  from: number;
  to: number;
  easing?: EasingType;
}

export interface FadeAudioInCommand extends BaseCommand {
  type: 'fadeAudioIn';
  target: string;
  duration: number;
}

export interface FadeAudioOutCommand extends BaseCommand {
  type: 'fadeAudioOut';
  target: string;
  duration: number;
}

export interface TextCommand extends BaseCommand {
  type: 'text';
  content: string;
  x?: number;
  y?: number;
  fontSize?: number;
  fontFamily?: string;
  color?: string;
  duration: number;
}

export interface SubtitleCommand extends BaseCommand {
  type: 'subtitle';
  content: string;
  duration: number;
  x?: number;
  y?: number;
  style?: 'default' | 'large' | 'small';
}

export interface Move3DCommand extends BaseCommand {
  type: 'move3D';
  target: string;
  from: { x: number; y: number; z: number };
  to: { x: number; y: number; z: number };
  easing?: EasingType;
}

export interface Rotate3DCommand extends BaseCommand {
  type: 'rotate3D';
  target: string;
  from: { x: number; y: number; z: number };
  to: { x: number; y: number; z: number };
  easing?: EasingType;
}

export interface DepthCommand extends BaseCommand {
  type: 'depth';
  target: string;
  from: number;
  to: number;
  easing?: EasingType;
}

export interface CameraMoveCommand extends BaseCommand {
  type: 'cameraMove';
  from: { x: number; y: number; z: number };
  to: { x: number; y: number; z: number };
  easing?: EasingType;
}

export interface CameraRotateCommand extends BaseCommand {
  type: 'cameraRotate';
  from: { x: number; y: number; z: number };
  to: { x: number; y: number; z: number };
  easing?: EasingType;
}

export type Command =
  | ShowCommand
  | HideCommand
  | ReplaceCommand
  | CutCommand
  | MoveCommand
  | ScaleCommand
  | RotateCommand
  | FlipHCommand
  | FlipVCommand
  | CropCommand
  | OpacityCommand
  | FadeInCommand
  | FadeOutCommand
  | BlurCommand
  | CrossfadeCommand
  | SlideCommand
  | WipeCommand
  | MusicCommand
  | SfxCommand
  | AmbientCommand
  | VolumeCommand
  | FadeAudioInCommand
  | FadeAudioOutCommand
  | TextCommand
  | SubtitleCommand
  | Move3DCommand
  | Rotate3DCommand
  | DepthCommand
  | CameraMoveCommand
  | CameraRotateCommand;

export const COMMAND_TYPES = [
  'show', 'hide', 'replace', 'cut',
  'move', 'scale', 'rotate', 'flipHorizontal', 'flipVertical', 'crop',
  'opacity', 'fadeIn', 'fadeOut', 'blur',
  'crossfade', 'slide', 'wipe',
  'music', 'sfx', 'ambient', 'volume', 'fadeAudioIn', 'fadeAudioOut',
  'text', 'subtitle',
  'move3D', 'rotate3D', 'depth',
  'cameraMove', 'cameraRotate',
] as const;
