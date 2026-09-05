/**
 * Scene DSL Parser & Compiler Tests
 */

import { describe, test, expect } from 'vitest';
import { parseSceneDSL, parseSceneDSLBlock, sceneToDSL, scenesToDSL } from '../parser';
import { compileSceneDSL, getDurationSeconds, type CompileContext } from '../compiler';

// ---------------------------------------------------------------------------
// Parser Tests
// ---------------------------------------------------------------------------

describe('parseSceneDSLBlock', () => {
  test('basic key-value parsing', () => {
    const block = `text: The ancient temple stood tall
visual: Ancient stone temple with mist
motion: slow_zoom
transition: crossfade
style: cinematic
duration: 5s`;

    const scene = parseSceneDSLBlock(block);
    expect(scene.text).toBe('The ancient temple stood tall');
    expect(scene.visual).toBe('Ancient stone temple with mist');
    expect(scene.motion).toBe('slow_zoom');
    expect(scene.transition).toBe('crossfade');
    expect(scene.style).toBe('cinematic');
    expect(scene.duration).toBe('5s');
  });

  test('motion aliases', () => {
    expect(parseSceneDSLBlock('text: x\nmotion: slow zoom in').motion).toBe('slow_zoom');
    expect(parseSceneDSLBlock('text: x\nmotion: fast pan right').motion).toBe('fast_pan_right');
    expect(parseSceneDSLBlock('text: x\nmotion: static').motion).toBe('none');
    expect(parseSceneDSLBlock('text: x\nmotion: handheld').motion).toBe('handheld');
    expect(parseSceneDSLBlock('text: x\nmotion: dolly in').motion).toBe('dolly_in');
    expect(parseSceneDSLBlock('text: x\nmotion: orbit left').motion).toBe('orbit_left');
  });

  test('transition aliases', () => {
    expect(parseSceneDSLBlock('text: x\ntransition: hard').transition).toBe('cut');
    expect(parseSceneDSLBlock('text: x\ntransition: dissolve').transition).toBe('dissolve');
    expect(parseSceneDSLBlock('text: x\ntransition: cross-fade').transition).toBe('crossfade');
  });

  test('style aliases', () => {
    expect(parseSceneDSLBlock('text: x\nstyle: movie').style).toBe('cinematic');
    expect(parseSceneDSLBlock('text: x\nstyle: retro').style).toBe('vintage');
    expect(parseSceneDSLBlock('text: x\nstyle: epic').style).toBe('dramatic');
  });

  test('optional fields', () => {
    const block = `text: Test
layers: mountains, trees
extras: morning light, fog
reasoning: slow build for atmosphere`;

    const scene = parseSceneDSLBlock(block);
    expect(scene.layers).toBeDefined();
    expect(scene.layers?.length).toBe(2);
    expect(scene.layers?.[0]).toBe('mountains');
    expect(scene.extras?.[0]).toBe('morning light');
    expect(scene.reasoning).toBe('slow build for atmosphere');
  });

  test('missing text returns empty', () => {
    const scene = parseSceneDSLBlock('visual: no text here');
    expect(scene.text).toBe('');
  });
});

describe('parseSceneDSL', () => {
  test('multiple scenes', () => {
    const dsl = `text: Scene one
visual: First scene
motion: slow_zoom

---

text: Scene two
visual: Second scene
motion: slow_pan_left`;

    const result = parseSceneDSL(dsl);
    expect(result.scenes.length).toBe(2);
    expect(result.errors.length).toBe(0);
    expect(result.scenes[0].text).toBe('Scene one');
    expect(result.scenes[1].text).toBe('Scene two');
    expect(result.scenes[0].motion).toBe('slow_zoom');
    expect(result.scenes[1].motion).toBe('slow_pan_left');
  });

  test('error on missing text', () => {
    const dsl = `visual: no text

---

text: valid scene
visual: has text`;

    const result = parseSceneDSL(dsl);
    expect(result.scenes.length).toBe(1);
    expect(result.errors.length).toBeGreaterThan(0);
  });
});

describe('sceneToDSL', () => {
  test('roundtrip', () => {
    const original = {
      text: 'Test scene',
      visual: 'Visual description',
      motion: 'slow_zoom' as const,
      transition: 'crossfade' as const,
      style: 'cinematic' as const,
      duration: '4s',
    };

    const dsl = sceneToDSL(original);
    const reparsed = parseSceneDSLBlock(dsl);
    expect(reparsed.text).toBe(original.text);
    expect(reparsed.visual).toBe(original.visual);
    expect(reparsed.motion).toBe(original.motion);
    expect(reparsed.transition).toBe(original.transition);
    expect(reparsed.style).toBe(original.style);
    expect(reparsed.duration).toBe(original.duration);
  });
});

// ---------------------------------------------------------------------------
// Compiler Tests
// ---------------------------------------------------------------------------

const testContext: CompileContext = {
  fps: 30,
  width: 1920,
  height: 1080,
};

describe('compileSceneDSL', () => {
  test('basic single scene', () => {
    const scenes = [
      { text: 'Hello world', visual: 'A greeting', duration: '3s' },
    ];

    const result = compileSceneDSL(scenes, testContext);
    expect(result.errors.length).toBe(0);
    expect(result.scenes.length).toBe(1);
    expect(result.scenes[0].durationFrames).toBe(90);
    expect(result.scenes[0].startFrame).toBe(0);
    expect(result.scenes[0].endFrame).toBe(90);
    expect(result.allCommands.length).toBe(1);
    expect(result.allCommands[0].type).toBe('show');
  });

  test('multiple scenes sequential', () => {
    const scenes = [
      { text: 'Scene 1', duration: '2s' },
      { text: 'Scene 2', duration: '3s' },
      { text: 'Scene 3', duration: '1s' },
    ];

    const result = compileSceneDSL(scenes, testContext);
    expect(result.errors.length).toBe(0);
    expect(result.scenes.length).toBe(3);
    expect(result.scenes[0].startFrame).toBe(0);
    expect(result.scenes[0].endFrame).toBe(60);
    expect(result.scenes[1].startFrame).toBe(60);
    expect(result.scenes[1].endFrame).toBe(150);
    expect(result.scenes[2].startFrame).toBe(150);
    expect(result.scenes[2].endFrame).toBe(180);
  });

  test('motion generates extra commands', () => {
    const scenes = [
      { text: 'Zoom scene', motion: 'slow_zoom', duration: '4s' },
    ];

    const result = compileSceneDSL(scenes, testContext);
    expect(result.allCommands.length).toBeGreaterThanOrEqual(2);
    const scaleCmd = result.allCommands.find(c => c.type === 'scale');
    expect(scaleCmd).toBeDefined();
  });

  test('no motion means fewer commands', () => {
    const scenes = [
      { text: 'Static scene', motion: 'none', duration: '3s' },
    ];

    const result = compileSceneDSL(scenes, testContext);
    expect(result.allCommands.length).toBe(1);
  });

  test('asset map populated', () => {
    const scenes = [
      { text: 'Scene A', duration: '2s' },
      { text: 'Scene B', duration: '2s' },
    ];

    const result = compileSceneDSL(scenes, testContext);
    expect(result.assetMap.size).toBeGreaterThanOrEqual(2);
  });

  test('default duration', () => {
    const scenes = [
      { text: 'No duration specified' },
    ];

    const result = compileSceneDSL(scenes, testContext);
    expect(result.scenes[0].durationFrames).toBe(90);
  });

  test('pan motion generates move commands', () => {
    const scenes = [
      { text: 'Pan scene', motion: 'slow_pan_left', duration: '3s' },
    ];

    const result = compileSceneDSL(scenes, testContext);
    const moveCmd = result.allCommands.find(c => c.type === 'move');
    expect(moveCmd).toBeDefined();
  });

  test('dolly motion generates multiple commands', () => {
    const scenes = [
      { text: 'Dolly scene', motion: 'dolly_in', duration: '3s' },
    ];

    const result = compileSceneDSL(scenes, testContext);
    expect(result.allCommands.length).toBeGreaterThanOrEqual(3);
  });

  test('crossfade transition', () => {
    const scenes = [
      { text: 'Scene 1', transition: 'crossfade', duration: '3s' },
      { text: 'Scene 2', duration: '3s' },
    ];

    const result = compileSceneDSL(scenes, testContext);
    const crossfadeCmd = result.allCommands.find(c => c.type === 'crossfade');
    expect(crossfadeCmd).toBeDefined();
  });

  test('slide transition', () => {
    const scenes = [
      { text: 'Scene 1', transition: 'slide_left', duration: '3s' },
      { text: 'Scene 2', duration: '3s' },
    ];

    const result = compileSceneDSL(scenes, testContext);
    const slideCmd = result.allCommands.find(c => c.type === 'slide');
    expect(slideCmd).toBeDefined();
  });

  test('all motion types produce valid commands', () => {
    const motions = [
      'none', 'slow_zoom', 'medium_zoom', 'fast_zoom',
      'slow_zoom_out', 'medium_zoom_out', 'fast_zoom_out',
      'slow_pan_left', 'slow_pan_right', 'slow_pan_up', 'slow_pan_down',
      'medium_pan_left', 'medium_pan_right', 'fast_pan_left', 'fast_pan_right',
      'dolly_in', 'dolly_out', 'orbit_left', 'orbit_right',
      'tilt_up', 'tilt_down', 'crane_up', 'crane_down',
      'handheld', 'parallax',
    ];

    for (const motion of motions) {
      const scenes = [{ text: `Motion: ${motion}`, motion, duration: '2s' }];
      const result = compileSceneDSL(scenes, testContext);
      expect(result.errors.length).toBe(0);
      expect(result.scenes.length).toBe(1);
    }
  });
});

describe('getDurationSeconds', () => {
  test('parses seconds', () => {
    expect(getDurationSeconds({ text: '', duration: '5s' })).toBe(5);
  });

  test('parses decimal seconds', () => {
    expect(getDurationSeconds({ text: '', duration: '3.5s' })).toBe(3.5);
  });

  test('parses milliseconds', () => {
    expect(getDurationSeconds({ text: '', duration: '500ms' })).toBe(0.5);
  });

  test('returns 0 when no duration', () => {
    expect(getDurationSeconds({ text: '' })).toBe(0);
  });

  test('returns 0 for invalid duration', () => {
    expect(getDurationSeconds({ text: '', duration: 'invalid' })).toBe(0);
  });
});
