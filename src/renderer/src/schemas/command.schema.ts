import { z } from 'zod';

const EasingType = z.enum(['linear', 'easeIn', 'easeOut', 'easeInOut']);
const Direction = z.enum(['left', 'right', 'top', 'bottom']);
const SubtitleStyle = z.enum(['default', 'large', 'small']);

const Vec2 = z.object({ x: z.number(), y: z.number() });
const Vec3 = z.object({ x: z.number(), y: z.number(), z: z.number() });
const KeyframeEntry = z.object({
  time: z.number(),
  value: z.number(),
  easing: EasingType.optional(),
});

const BaseCommandFields = {
  id: z.string().min(1),
  start: z.number(),
  duration: z.number().optional(),
};

// ── Visual commands ──────────────────────────────────────────────

const ShowCommand = z.object({
  ...BaseCommandFields,
  type: z.literal('show'),
  asset: z.string().min(1),
  layer: z.number().optional(),
  x: z.number().optional(),
  y: z.number().optional(),
  z: z.number().optional(),
  scale: z.number().optional(),
  rotationX: z.number().optional(),
  rotationY: z.number().optional(),
  rotationZ: z.number().optional(),
  opacity: z.number().optional(),
  blur: z.number().optional(),
  flipH: z.boolean().optional(),
  flipV: z.boolean().optional(),
});

const HideCommand = z.object({
  ...BaseCommandFields,
  type: z.literal('hide'),
  target: z.string().min(1),
});

const ReplaceCommand = z.object({
  ...BaseCommandFields,
  type: z.literal('replace'),
  target: z.string().min(1),
  asset: z.string().min(1),
});

const CutCommand = z.object({
  ...BaseCommandFields,
  type: z.literal('cut'),
  target: z.string().min(1),
});

const MoveCommand = z.object({
  ...BaseCommandFields,
  type: z.literal('move'),
  target: z.string().min(1),
  from: Vec2,
  to: Vec2,
  easing: EasingType.optional(),
});

const ScaleCommand = z.object({
  ...BaseCommandFields,
  type: z.literal('scale'),
  target: z.string().min(1),
  from: z.number(),
  to: z.number(),
  easing: EasingType.optional(),
});

const RotateCommand = z.object({
  ...BaseCommandFields,
  type: z.literal('rotate'),
  target: z.string().min(1),
  from: z.number(),
  to: z.number(),
  easing: EasingType.optional(),
});

const FlipHCommand = z.object({
  ...BaseCommandFields,
  type: z.literal('flipHorizontal'),
  target: z.string().min(1),
});

const FlipVCommand = z.object({
  ...BaseCommandFields,
  type: z.literal('flipVertical'),
  target: z.string().min(1),
});

const CropCommand = z.object({
  ...BaseCommandFields,
  type: z.literal('crop'),
  target: z.string().min(1),
  x: z.number(),
  y: z.number(),
  width: z.number(),
  height: z.number(),
});

const OpacityCommand = z.object({
  ...BaseCommandFields,
  type: z.literal('opacity'),
  target: z.string().min(1),
  from: z.number(),
  to: z.number(),
  easing: EasingType.optional(),
});

const FadeInCommand = z.object({
  ...BaseCommandFields,
  type: z.literal('fadeIn'),
  target: z.string().min(1),
  duration: z.number(),
});

const FadeOutCommand = z.object({
  ...BaseCommandFields,
  type: z.literal('fadeOut'),
  target: z.string().min(1),
  duration: z.number(),
});

const BlurCommand = z.object({
  ...BaseCommandFields,
  type: z.literal('blur'),
  target: z.string().min(1),
  from: z.number(),
  to: z.number(),
  easing: EasingType.optional(),
});

const CrossfadeCommand = z.object({
  ...BaseCommandFields,
  type: z.literal('crossfade'),
  target: z.string().min(1),
  toAsset: z.string().min(1),
  duration: z.number(),
});

const SlideCommand = z.object({
  ...BaseCommandFields,
  type: z.literal('slide'),
  target: z.string().min(1),
  fromAsset: z.string().optional(),
  direction: Direction,
});

const WipeCommand = z.object({
  ...BaseCommandFields,
  type: z.literal('wipe'),
  target: z.string().min(1),
  toAsset: z.string().optional(),
  direction: Direction,
});

// ── Audio commands ───────────────────────────────────────────────

const MusicCommand = z.object({
  ...BaseCommandFields,
  type: z.literal('music'),
  asset: z.string().min(1),
  volume: z.number().optional(),
  fadeIn: z.number().optional(),
  fadeOut: z.number().optional(),
});

const SfxCommand = z.object({
  ...BaseCommandFields,
  type: z.literal('sfx'),
  asset: z.string().min(1),
  volume: z.number().optional(),
});

const AmbientCommand = z.object({
  ...BaseCommandFields,
  type: z.literal('ambient'),
  asset: z.string().min(1),
  volume: z.number().optional(),
  fadeIn: z.number().optional(),
  fadeOut: z.number().optional(),
});

const VolumeCommand = z.object({
  ...BaseCommandFields,
  type: z.literal('volume'),
  target: z.string().min(1),
  from: z.number(),
  to: z.number(),
  easing: EasingType.optional(),
});

const FadeAudioInCommand = z.object({
  ...BaseCommandFields,
  type: z.literal('fadeAudioIn'),
  target: z.string().min(1),
  duration: z.number(),
});

const FadeAudioOutCommand = z.object({
  ...BaseCommandFields,
  type: z.literal('fadeAudioOut'),
  target: z.string().min(1),
  duration: z.number(),
});

// ── Text commands ────────────────────────────────────────────────

const TextCommand = z.object({
  ...BaseCommandFields,
  type: z.literal('text'),
  content: z.string(),
  x: z.number().optional(),
  y: z.number().optional(),
  fontSize: z.number().optional(),
  fontFamily: z.string().optional(),
  color: z.string().optional(),
  duration: z.number(),
});

const SubtitleCommand = z.object({
  ...BaseCommandFields,
  type: z.literal('subtitle'),
  content: z.string(),
  duration: z.number(),
  x: z.number().optional(),
  y: z.number().optional(),
  style: SubtitleStyle.optional(),
});

// ── 3D / Camera commands ────────────────────────────────────────

const Move3DCommand = z.object({
  ...BaseCommandFields,
  type: z.literal('move3D'),
  target: z.string().min(1),
  from: Vec3,
  to: Vec3,
  easing: EasingType.optional(),
});

const Rotate3DCommand = z.object({
  ...BaseCommandFields,
  type: z.literal('rotate3D'),
  target: z.string().min(1),
  from: Vec3,
  to: Vec3,
  easing: EasingType.optional(),
});

const DepthCommand = z.object({
  ...BaseCommandFields,
  type: z.literal('depth'),
  target: z.string().min(1),
  from: z.number(),
  to: z.number(),
  easing: EasingType.optional(),
});

const CameraMoveCommand = z.object({
  ...BaseCommandFields,
  type: z.literal('cameraMove'),
  from: Vec3,
  to: Vec3,
  easing: EasingType.optional(),
});

const CameraRotateCommand = z.object({
  ...BaseCommandFields,
  type: z.literal('cameraRotate'),
  from: Vec3,
  to: Vec3,
  easing: EasingType.optional(),
});

// ── Keyframe command ─────────────────────────────────────────────

const SetKeyframesCommand = z.object({
  ...BaseCommandFields,
  type: z.literal('setKeyframes'),
  target: z.string().min(1),
  property: z.string().min(1),
  keyframes: z.array(KeyframeEntry).min(1),
});

// ── Discriminated union ──────────────────────────────────────────

export const CommandSchema = z.discriminatedUnion('type', [
  ShowCommand,
  HideCommand,
  ReplaceCommand,
  CutCommand,
  MoveCommand,
  ScaleCommand,
  RotateCommand,
  FlipHCommand,
  FlipVCommand,
  CropCommand,
  OpacityCommand,
  FadeInCommand,
  FadeOutCommand,
  BlurCommand,
  CrossfadeCommand,
  SlideCommand,
  WipeCommand,
  MusicCommand,
  SfxCommand,
  AmbientCommand,
  VolumeCommand,
  FadeAudioInCommand,
  FadeAudioOutCommand,
  TextCommand,
  SubtitleCommand,
  Move3DCommand,
  Rotate3DCommand,
  DepthCommand,
  CameraMoveCommand,
  CameraRotateCommand,
  SetKeyframesCommand,
]);

export type CommandInput = z.infer<typeof CommandSchema>;
