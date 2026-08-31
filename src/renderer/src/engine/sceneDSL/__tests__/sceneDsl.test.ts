/**
 * Scene DSL Parser & Compiler Tests
 *
 * Run with: npx tsx src/renderer/src/engine/sceneDSL/__tests__/sceneDsl.test.ts
 */

import { parseSceneDSL, parseSceneDSLBlock, sceneToDSL, scenesToDSL } from '../parser';
import { compileSceneDSL, getDurationSeconds, type CompileContext } from '../compiler';

let passed = 0;
let failed = 0;

function assert(condition: boolean, message: string) {
  if (condition) {
    passed++;
    console.log(`  ✓ ${message}`);
  } else {
    failed++;
    console.error(`  ✗ ${message}`);
  }
}

function assertEqual<T>(actual: T, expected: T, message: string) {
  if (actual === expected) {
    passed++;
    console.log(`  ✓ ${message}`);
  } else {
    failed++;
    console.error(`  ✗ ${message} — expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

function group(name: string) {
  console.log(`\n=== ${name} ===`);
}

// ---------------------------------------------------------------------------
// Parser Tests
// ---------------------------------------------------------------------------

group('parseSceneDSLBlock - basic key-value parsing');
{
  const block = `text: The ancient temple stood tall
visual: Ancient stone temple with mist
motion: slow_zoom
transition: crossfade
style: cinematic
duration: 5s`;

  const scene = parseSceneDSLBlock(block);
  assertEqual(scene.text, 'The ancient temple stood tall', 'text parsed');
  assertEqual(scene.visual, 'Ancient stone temple with mist', 'visual parsed');
  assertEqual(scene.motion, 'slow_zoom', 'motion normalized');
  assertEqual(scene.transition, 'crossfade', 'transition parsed');
  assertEqual(scene.style, 'cinematic', 'style parsed');
  assertEqual(scene.duration, '5s', 'duration parsed');
}

group('parseSceneDSLBlock - motion aliases');
{
  assertEqual(parseSceneDSLBlock('text: x\nmotion: slow zoom in').motion, 'slow_zoom', 'slow zoom in -> slow_zoom');
  assertEqual(parseSceneDSLBlock('text: x\nmotion: fast pan right').motion, 'fast_pan_right', 'fast pan right -> fast_pan_right');
  assertEqual(parseSceneDSLBlock('text: x\nmotion: static').motion, 'none', 'static -> none');
  assertEqual(parseSceneDSLBlock('text: x\nmotion: handheld').motion, 'handheld', 'handheld passthrough');
  assertEqual(parseSceneDSLBlock('text: x\nmotion: dolly in').motion, 'dolly_in', 'dolly in -> dolly_in');
  assertEqual(parseSceneDSLBlock('text: x\nmotion: orbit left').motion, 'orbit_left', 'orbit left -> orbit_left');
}

group('parseSceneDSLBlock - transition aliases');
{
  assertEqual(parseSceneDSLBlock('text: x\ntransition: hard').transition, 'cut', 'hard -> cut');
  assertEqual(parseSceneDSLBlock('text: x\ntransition: dissolve').transition, 'dissolve', 'dissolve passthrough');
  assertEqual(parseSceneDSLBlock('text: x\ntransition: cross-fade').transition, 'crossfade', 'cross-fade -> crossfade');
}

group('parseSceneDSLBlock - style aliases');
{
  assertEqual(parseSceneDSLBlock('text: x\nstyle: movie').style, 'cinematic', 'movie -> cinematic');
  assertEqual(parseSceneDSLBlock('text: x\nstyle: retro').style, 'vintage', 'retro -> vintage');
  assertEqual(parseSceneDSLBlock('text: x\nstyle: epic').style, 'dramatic', 'epic -> dramatic');
}

group('parseSceneDSLBlock - optional fields');
{
  const block = `text: Test
layers: mountains, trees
extras: morning light, fog
reasoning: slow build for atmosphere`;

  const scene = parseSceneDSLBlock(block);
  assert(scene.layers !== undefined, 'layers parsed');
  assertEqual(scene.layers?.length, 2, 'layers has 2 items');
  assertEqual(scene.layers?.[0], 'mountains', 'layers[0] correct');
  assertEqual(scene.extras?.[0], 'morning light', 'extras[0] correct');
  assertEqual(scene.reasoning, 'slow build for atmosphere', 'reasoning parsed');
}

group('parseSceneDSLBlock - missing text returns empty');
{
  const scene = parseSceneDSLBlock('visual: no text here');
  assertEqual(scene.text, '', 'empty text when not provided');
}

group('parseSceneDSL - multiple scenes');
{
  const dsl = `text: Scene one
visual: First scene
motion: slow_zoom

---

text: Scene two
visual: Second scene
motion: slow_pan_left`;

  const result = parseSceneDSL(dsl);
  assertEqual(result.scenes.length, 2, 'parsed 2 scenes');
  assertEqual(result.errors.length, 0, 'no errors');
  assertEqual(result.scenes[0].text, 'Scene one', 'first scene text');
  assertEqual(result.scenes[1].text, 'Scene two', 'second scene text');
  assertEqual(result.scenes[0].motion, 'slow_zoom', 'first scene motion');
  assertEqual(result.scenes[1].motion, 'slow_pan_left', 'second scene motion normalized');
}

group('parseSceneDSL - error on missing text');
{
  const dsl = `visual: no text

---

text: valid scene
visual: has text`;

  const result = parseSceneDSL(dsl);
  assertEqual(result.scenes.length, 1, 'only valid scene parsed');
  assert(result.errors.length > 0, 'error reported for missing text');
}

group('sceneToDSL - roundtrip');
{
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
  assertEqual(reparsed.text, original.text, 'roundtrip text');
  assertEqual(reparsed.visual, original.visual, 'roundtrip visual');
  assertEqual(reparsed.motion, original.motion, 'roundtrip motion');
  assertEqual(reparsed.transition, original.transition, 'roundtrip transition');
  assertEqual(reparsed.style, original.style, 'roundtrip style');
  assertEqual(reparsed.duration, original.duration, 'roundtrip duration');
}

// ---------------------------------------------------------------------------
// Compiler Tests
// ---------------------------------------------------------------------------

const testContext: CompileContext = {
  fps: 30,
  width: 1920,
  height: 1080,
};

group('compileSceneDSL - basic single scene');
{
  const scenes = [
    { text: 'Hello world', visual: 'A greeting', duration: '3s' },
  ];

  const result = compileSceneDSL(scenes, testContext);
  assertEqual(result.errors.length, 0, 'no errors');
  assertEqual(result.scenes.length, 1, '1 compiled scene');
  assertEqual(result.scenes[0].durationFrames, 90, '3s * 30fps = 90 frames');
  assertEqual(result.scenes[0].startFrame, 0, 'starts at frame 0');
  assertEqual(result.scenes[0].endFrame, 90, 'ends at frame 90');
  assertEqual(result.allCommands.length, 1, '1 command (show)');
  assertEqual(result.allCommands[0].type, 'show', 'command is show type');
}

group('compileSceneDSL - multiple scenes sequential');
{
  const scenes = [
    { text: 'Scene 1', duration: '2s' },
    { text: 'Scene 2', duration: '3s' },
    { text: 'Scene 3', duration: '1s' },
  ];

  const result = compileSceneDSL(scenes, testContext);
  assertEqual(result.errors.length, 0, 'no errors');
  assertEqual(result.scenes.length, 3, '3 compiled scenes');
  assertEqual(result.scenes[0].startFrame, 0, 'scene1 starts at 0');
  assertEqual(result.scenes[0].endFrame, 60, 'scene1 ends at 60 (2s)');
  assertEqual(result.scenes[1].startFrame, 60, 'scene2 starts at 60');
  assertEqual(result.scenes[1].endFrame, 150, 'scene2 ends at 150 (3s)');
  assertEqual(result.scenes[2].startFrame, 150, 'scene3 starts at 150');
  assertEqual(result.scenes[2].endFrame, 180, 'scene3 ends at 180 (1s)');
}

group('compileSceneDSL - motion generates extra commands');
{
  const scenes = [
    { text: 'Zoom scene', motion: 'slow_zoom', duration: '4s' },
  ];

  const result = compileSceneDSL(scenes, testContext);
  assert(result.allCommands.length >= 2, 'show + scale commands');
  const scaleCmd = result.allCommands.find(c => c.type === 'scale');
  assert(scaleCmd !== undefined, 'scale command exists');
}

group('compileSceneDSL - no motion means fewer commands');
{
  const scenes = [
    { text: 'Static scene', motion: 'none', duration: '3s' },
  ];

  const result = compileSceneDSL(scenes, testContext);
  assertEqual(result.allCommands.length, 1, 'only show command');
}

group('compileSceneDSL - asset map populated');
{
  const scenes = [
    { text: 'Scene A', duration: '2s' },
    { text: 'Scene B', duration: '2s' },
  ];

  const result = compileSceneDSL(scenes, testContext);
  assert(result.assetMap.size >= 2, 'at least 2 assets in map');
}

group('compileSceneDSL - default duration');
{
  const scenes = [
    { text: 'No duration specified' },
  ];

  const result = compileSceneDSL(scenes, testContext);
  assertEqual(result.scenes[0].durationFrames, 150, 'default 5s * 30fps = 150 frames');
}

group('getDurationSeconds - parsing');
{
  assertEqual(getDurationSeconds({ text: '', duration: '5s' }), 5, '5s');
  assertEqual(getDurationSeconds({ text: '', duration: '3.5s' }), 3.5, '3.5s');
  assertEqual(getDurationSeconds({ text: '', duration: '500ms' }), 0.5, '500ms');
  assertEqual(getDurationSeconds({ text: '' }), 5, 'default 5s');
  assertEqual(getDurationSeconds({ text: '', duration: 'invalid' }), 5, 'invalid falls back to 5s');
}

group('compileSceneDSL - pan motion generates move commands');
{
  const scenes = [
    { text: 'Pan scene', motion: 'slow_pan_left', duration: '3s' },
  ];

  const result = compileSceneDSL(scenes, testContext);
  const moveCmd = result.allCommands.find(c => c.type === 'move');
  assert(moveCmd !== undefined, 'move command exists for pan');
}

group('compileSceneDSL - dolly motion generates multiple commands');
{
  const scenes = [
    { text: 'Dolly scene', motion: 'dolly_in', duration: '3s' },
  ];

  const result = compileSceneDSL(scenes, testContext);
  assert(result.allCommands.length >= 3, 'show + scale + opacity for dolly');
}

group('compileSceneDSL - crossfade transition');
{
  const scenes = [
    { text: 'Scene 1', transition: 'crossfade', duration: '3s' },
    { text: 'Scene 2', duration: '3s' },
  ];

  const result = compileSceneDSL(scenes, testContext);
  const crossfadeCmd = result.allCommands.find(c => c.type === 'crossfade');
  assert(crossfadeCmd !== undefined, 'crossfade command exists');
}

group('compileSceneDSL - slide transition');
{
  const scenes = [
    { text: 'Scene 1', transition: 'slide_left', duration: '3s' },
    { text: 'Scene 2', duration: '3s' },
  ];

  const result = compileSceneDSL(scenes, testContext);
  const slideCmd = result.allCommands.find(c => c.type === 'slide');
  assert(slideCmd !== undefined, 'slide command exists');
}

group('compileSceneDSL - all motion types produce valid commands');
{
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
    assert(result.errors.length === 0, `${motion}: no errors`);
    assert(result.scenes.length === 1, `${motion}: scene compiled`);
  }
}

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------

console.log(`\n${'='.repeat(40)}`);
console.log(`Results: ${passed} passed, ${failed} failed`);
console.log(`${'='.repeat(40)}`);

if (failed > 0) {
  process.exit(1);
}
