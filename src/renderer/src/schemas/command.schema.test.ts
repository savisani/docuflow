import { describe, test, expect } from 'vitest';
import { CommandSchema } from './command.schema';

describe('CommandSchema', () => {
  const validShow = {
    id: 'cmd-1',
    type: 'show',
    start: 0,
    duration: 5,
    asset: 'asset-1',
    layer: 0,
    x: 100,
    y: 200,
    scale: 1.5,
    opacity: 0.8,
  };

  const validMove = {
    id: 'cmd-2',
    type: 'move',
    start: 0,
    target: 'layer-1',
    from: { x: 0, y: 0 },
    to: { x: 100, y: 200 },
    easing: 'easeInOut',
  };

  const validText = {
    id: 'cmd-3',
    type: 'text',
    start: 0,
    duration: 3,
    content: 'Hello World',
    fontSize: 24,
    fontFamily: 'Arial',
    color: '#ffffff',
  };

  const validSetKeyframes = {
    id: 'cmd-4',
    type: 'setKeyframes',
    start: 0,
    target: 'layer-1',
    property: 'opacity',
    keyframes: [
      { time: 0, value: 0 },
      { time: 1, value: 1, easing: 'easeIn' },
    ],
  };

  test('accepts valid show command', () => {
    const result = CommandSchema.safeParse(validShow);
    expect(result.success).toBe(true);
  });

  test('accepts valid move command', () => {
    const result = CommandSchema.safeParse(validMove);
    expect(result.success).toBe(true);
  });

  test('accepts valid text command', () => {
    const result = CommandSchema.safeParse(validText);
    expect(result.success).toBe(true);
  });

  test('accepts valid setKeyframes command', () => {
    const result = CommandSchema.safeParse(validSetKeyframes);
    expect(result.success).toBe(true);
  });

  test('rejects unknown command type', () => {
    const result = CommandSchema.safeParse({
      id: 'cmd-1',
      type: 'unknownType',
      start: 0,
    });
    expect(result.success).toBe(false);
  });

  test('rejects missing id', () => {
    const result = CommandSchema.safeParse({
      type: 'show',
      start: 0,
      asset: 'asset-1',
    });
    expect(result.success).toBe(false);
  });

  test('rejects missing type', () => {
    const result = CommandSchema.safeParse({
      id: 'cmd-1',
      start: 0,
      asset: 'asset-1',
    });
    expect(result.success).toBe(false);
  });

  test('rejects empty id', () => {
    const result = CommandSchema.safeParse({
      id: '',
      type: 'show',
      start: 0,
      asset: 'asset-1',
    });
    expect(result.success).toBe(false);
  });

  test('rejects show command with missing asset', () => {
    const result = CommandSchema.safeParse({
      id: 'cmd-1',
      type: 'show',
      start: 0,
    });
    expect(result.success).toBe(false);
  });

  test('rejects move command with missing target', () => {
    const result = CommandSchema.safeParse({
      id: 'cmd-1',
      type: 'move',
      start: 0,
      from: { x: 0, y: 0 },
      to: { x: 100, y: 200 },
    });
    expect(result.success).toBe(false);
  });

  test('rejects move command with invalid from', () => {
    const result = CommandSchema.safeParse({
      id: 'cmd-1',
      type: 'move',
      start: 0,
      target: 'layer-1',
      from: { x: 'not a number', y: 0 },
      to: { x: 100, y: 200 },
    });
    expect(result.success).toBe(false);
  });

  test('rejects setKeyframes with empty keyframes', () => {
    const result = CommandSchema.safeParse({
      id: 'cmd-1',
      type: 'setKeyframes',
      start: 0,
      target: 'layer-1',
      property: 'opacity',
      keyframes: [],
    });
    expect(result.success).toBe(false);
  });

  test('rejects invalid easing type', () => {
    const result = CommandSchema.safeParse({
      id: 'cmd-1',
      type: 'move',
      start: 0,
      target: 'layer-1',
      from: { x: 0, y: 0 },
      to: { x: 100, y: 200 },
      easing: 'invalidEasing',
    });
    expect(result.success).toBe(false);
  });

  test('rejects non-string start', () => {
    const result = CommandSchema.safeParse({
      id: 'cmd-1',
      type: 'show',
      start: 'not a number',
      asset: 'asset-1',
    });
    expect(result.success).toBe(false);
  });
});
