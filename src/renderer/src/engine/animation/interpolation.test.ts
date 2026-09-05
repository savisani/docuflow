import { describe, test, expect } from 'vitest';
import { interpolate, interpolateColor } from './interpolation';

describe('interpolate', () => {
  test('linear at start', () => {
    expect(interpolate(0, 0, 100, 0, 10, 'linear')).toBe(0);
  });

  test('linear at end', () => {
    expect(interpolate(100, 0, 100, 0, 10, 'linear')).toBe(10);
  });

  test('linear at midpoint', () => {
    expect(interpolate(50, 0, 100, 0, 10, 'linear')).toBe(5);
  });

  test('linear at quarter', () => {
    expect(interpolate(25, 0, 100, 0, 100, 'linear')).toBe(25);
  });

  test('clamp before start', () => {
    expect(interpolate(-10, 0, 100, 0, 10, 'linear')).toBe(0);
  });

  test('clamp after end', () => {
    expect(interpolate(110, 0, 100, 0, 10, 'linear')).toBe(10);
  });

  test('same start and end frame returns toValue', () => {
    expect(interpolate(50, 50, 50, 0, 10, 'linear')).toBe(10);
  });

  test('negative range', () => {
    expect(interpolate(75, 50, 100, 100, 0, 'linear')).toBe(50);
  });

  test('default easing is linear', () => {
    expect(interpolate(50, 0, 100, 0, 10)).toBe(5);
  });
});

describe('interpolate - easing functions', () => {
  const startFrame = 0;
  const endFrame = 100;
  const fromValue = 0;
  const toValue = 1;

  test('easeIn at midpoint', () => {
    // easeIn: t^3, at t=0.5: 0.125
    const result = interpolate(50, startFrame, endFrame, fromValue, toValue, 'easeIn');
    expect(result).toBeCloseTo(0.125, 3);
  });

  test('easeOut at midpoint', () => {
    // easeOut: 1-(1-t)^3, at t=0.5: 0.875
    const result = interpolate(50, startFrame, endFrame, fromValue, toValue, 'easeOut');
    expect(result).toBeCloseTo(0.875, 3);
  });

  test('easeInOut at midpoint', () => {
    // easeInOut at t=0.5: 4*0.5^3 = 0.5
    const result = interpolate(50, startFrame, endFrame, fromValue, toValue, 'easeInOut');
    expect(result).toBeCloseTo(0.5, 3);
  });

  test('easeIn at start is 0', () => {
    expect(interpolate(startFrame, startFrame, endFrame, fromValue, toValue, 'easeIn')).toBeCloseTo(0, 3);
  });

  test('easeIn at end is 1', () => {
    expect(interpolate(endFrame, startFrame, endFrame, fromValue, toValue, 'easeIn')).toBeCloseTo(1, 3);
  });

  test('easeOut at start is 0', () => {
    expect(interpolate(startFrame, startFrame, endFrame, fromValue, toValue, 'easeOut')).toBeCloseTo(0, 3);
  });

  test('easeOut at end is 1', () => {
    expect(interpolate(endFrame, startFrame, endFrame, fromValue, toValue, 'easeOut')).toBeCloseTo(1, 3);
  });
});

describe('interpolateColor', () => {
  test('linear color interpolation at midpoint', () => {
    const result = interpolateColor(50, 0, 100, '#000000', '#ffffff', 'linear');
    // midpoint of black to white: rgb(128, 128, 128) approximately
    expect(result).toContain('rgb');
  });

  test('returns fromColor at start', () => {
    const result = interpolateColor(0, 0, 100, '#ff0000', '#0000ff', 'linear');
    expect(result).toBe('rgb(255,0,0)');
  });

  test('returns toColor at end', () => {
    const result = interpolateColor(100, 0, 100, '#ff0000', '#0000ff', 'linear');
    expect(result).toBe('rgb(0,0,255)');
  });
});
