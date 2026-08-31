import { EasingType } from '../commands/types';

type EasingFn = (t: number) => number;

const easings: Record<EasingType, EasingFn> = {
  linear: (t) => t,
  easeIn: (t) => t * t * t,
  easeOut: (t) => 1 - Math.pow(1 - t, 3),
  easeInOut: (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2),
};

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

export function interpolate(
  frame: number,
  startFrame: number,
  endFrame: number,
  fromValue: number,
  toValue: number,
  easing: EasingType = 'linear'
): number {
  if (startFrame === endFrame) return toValue;
  const progress = clamp((frame - startFrame) / (endFrame - startFrame), 0, 1);
  const easedProgress = easings[easing](progress);
  return fromValue + (toValue - fromValue) * easedProgress;
}

export function interpolateColor(
  frame: number,
  startFrame: number,
  endFrame: number,
  fromHex: string,
  toHex: string,
  easing: EasingType = 'linear'
): string {
  const from = hexToRgb(fromHex);
  const to = hexToRgb(toHex);
  const r = Math.round(interpolate(frame, startFrame, endFrame, from.r, to.r, easing));
  const g = Math.round(interpolate(frame, startFrame, endFrame, from.g, to.g, easing));
  const b = Math.round(interpolate(frame, startFrame, endFrame, from.b, to.b, easing));
  return `rgb(${r},${g},${b})`;
}

function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const h = hex.replace('#', '');
  return {
    r: parseInt(h.substring(0, 2), 16),
    g: parseInt(h.substring(2, 4), 16),
    b: parseInt(h.substring(4, 6), 16),
  };
}
