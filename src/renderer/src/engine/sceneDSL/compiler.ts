import { Command, ShowCommand, ScaleCommand, MoveCommand, OpacityCommand } from '../commands/types';
import { generateLogicalId } from '../media/findAsset';
import { SceneDSL, SupportedMotion, SupportedTransition } from './types';

function generateId(): string {
  return `cmd_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
}

function motionToCommands(
  assetId: string,
  motion: SupportedMotion,
  startFrame: number,
  durationFrames: number,
): Command[] {
  const cmds: Command[] = [];

  switch (motion) {
    case 'slow_zoom':
      cmds.push({ id: generateId(), type: 'scale', target: assetId, start: startFrame, duration: durationFrames, from: 1.0, to: 1.1, easing: 'easeInOut' });
      break;
    case 'medium_zoom':
      cmds.push({ id: generateId(), type: 'scale', target: assetId, start: startFrame, duration: durationFrames, from: 1.0, to: 1.2, easing: 'easeInOut' });
      break;
    case 'fast_zoom':
      cmds.push({ id: generateId(), type: 'scale', target: assetId, start: startFrame, duration: durationFrames, from: 1.0, to: 1.35, easing: 'easeIn' });
      break;
    case 'slow_zoom_out':
      cmds.push({ id: generateId(), type: 'scale', target: assetId, start: startFrame, duration: durationFrames, from: 1.1, to: 1.0, easing: 'easeInOut' });
      break;
    case 'medium_zoom_out':
      cmds.push({ id: generateId(), type: 'scale', target: assetId, start: startFrame, duration: durationFrames, from: 1.2, to: 1.0, easing: 'easeInOut' });
      break;
    case 'fast_zoom_out':
      cmds.push({ id: generateId(), type: 'scale', target: assetId, start: startFrame, duration: durationFrames, from: 1.35, to: 1.0, easing: 'easeIn' });
      break;
    case 'slow_pan_left':
      cmds.push({ id: generateId(), type: 'move', target: assetId, start: startFrame, duration: durationFrames, from: { x: 0, y: 0 }, to: { x: -30, y: 0 }, easing: 'easeInOut' });
      break;
    case 'slow_pan_right':
      cmds.push({ id: generateId(), type: 'move', target: assetId, start: startFrame, duration: durationFrames, from: { x: 0, y: 0 }, to: { x: 30, y: 0 }, easing: 'easeInOut' });
      break;
    case 'slow_pan_up':
      cmds.push({ id: generateId(), type: 'move', target: assetId, start: startFrame, duration: durationFrames, from: { x: 0, y: 0 }, to: { x: 0, y: -20 }, easing: 'easeInOut' });
      break;
    case 'slow_pan_down':
      cmds.push({ id: generateId(), type: 'move', target: assetId, start: startFrame, duration: durationFrames, from: { x: 0, y: 0 }, to: { x: 0, y: 20 }, easing: 'easeInOut' });
      break;
    case 'medium_pan_left':
      cmds.push({ id: generateId(), type: 'move', target: assetId, start: startFrame, duration: durationFrames, from: { x: 0, y: 0 }, to: { x: -60, y: 0 }, easing: 'easeInOut' });
      break;
    case 'medium_pan_right':
      cmds.push({ id: generateId(), type: 'move', target: assetId, start: startFrame, duration: durationFrames, from: { x: 0, y: 0 }, to: { x: 60, y: 0 }, easing: 'easeInOut' });
      break;
    case 'fast_pan_left':
      cmds.push({ id: generateId(), type: 'move', target: assetId, start: startFrame, duration: durationFrames, from: { x: 0, y: 0 }, to: { x: -100, y: 0 }, easing: 'easeIn' });
      break;
    case 'fast_pan_right':
      cmds.push({ id: generateId(), type: 'move', target: assetId, start: startFrame, duration: durationFrames, from: { x: 0, y: 0 }, to: { x: 100, y: 0 }, easing: 'easeIn' });
      break;
    case 'dolly_in':
      cmds.push(
        { id: generateId(), type: 'scale', target: assetId, start: startFrame, duration: durationFrames, from: 1.0, to: 1.3, easing: 'easeInOut' },
        { id: generateId(), type: 'opacity', target: assetId, start: startFrame, duration: durationFrames, from: 1.0, to: 0.95, easing: 'easeInOut' },
      );
      break;
    case 'dolly_out':
      cmds.push(
        { id: generateId(), type: 'scale', target: assetId, start: startFrame, duration: durationFrames, from: 1.3, to: 1.0, easing: 'easeInOut' },
        { id: generateId(), type: 'opacity', target: assetId, start: startFrame, duration: durationFrames, from: 0.95, to: 1.0, easing: 'easeInOut' },
      );
      break;
    case 'orbit_left':
      cmds.push({ id: generateId(), type: 'rotate', target: assetId, start: startFrame, duration: durationFrames, from: 0, to: -15, easing: 'easeInOut' });
      break;
    case 'orbit_right':
      cmds.push({ id: generateId(), type: 'rotate', target: assetId, start: startFrame, duration: durationFrames, from: 0, to: 15, easing: 'easeInOut' });
      break;
    case 'tilt_up':
      cmds.push({ id: generateId(), type: 'rotate3D', target: assetId, start: startFrame, duration: durationFrames, from: { x: 0, y: 0, z: 0 }, to: { x: -10, y: 0, z: 0 }, easing: 'easeInOut' });
      break;
    case 'tilt_down':
      cmds.push({ id: generateId(), type: 'rotate3D', target: assetId, start: startFrame, duration: durationFrames, from: { x: 0, y: 0, z: 0 }, to: { x: 10, y: 0, z: 0 }, easing: 'easeInOut' });
      break;
    case 'crane_up':
      cmds.push({ id: generateId(), type: 'move3D', target: assetId, start: startFrame, duration: durationFrames, from: { x: 0, y: 0, z: 0 }, to: { x: 0, y: -20, z: 10 }, easing: 'easeInOut' });
      break;
    case 'crane_down':
      cmds.push({ id: generateId(), type: 'move3D', target: assetId, start: startFrame, duration: durationFrames, from: { x: 0, y: 0, z: 0 }, to: { x: 0, y: 20, z: 10 }, easing: 'easeInOut' });
      break;
    case 'handheld':
      cmds.push({ id: generateId(), type: 'rotate', target: assetId, start: startFrame, duration: durationFrames, from: 0, to: 2, easing: 'easeInOut' });
      break;
    case 'parallax':
      cmds.push(
        { id: generateId(), type: 'scale', target: assetId, start: startFrame, duration: durationFrames, from: 1.0, to: 1.08, easing: 'easeInOut' },
        { id: generateId(), type: 'move', target: assetId, start: startFrame, duration: durationFrames, from: { x: 0, y: 0 }, to: { x: 10, y: -5 }, easing: 'easeInOut' },
      );
      break;
    case 'none':
    default:
      break;
  }

  return cmds;
}

function transitionToCommands(
  currentAssetId: string,
  nextAssetId: string,
  transition: SupportedTransition,
  startFrame: number,
  durationFrames: number,
): Command[] {
  const cmds: Command[] = [];

  switch (transition) {
    case 'crossfade':
    case 'dissolve':
    case 'fade':
      cmds.push({
        id: generateId(),
        type: 'crossfade',
        target: currentAssetId,
        toAsset: nextAssetId,
        start: startFrame,
        duration: durationFrames,
      });
      break;
    case 'slide_left':
      cmds.push({
        id: generateId(),
        type: 'slide',
        target: currentAssetId,
        fromAsset: nextAssetId,
        direction: 'left',
        start: startFrame,
        duration: durationFrames,
      });
      break;
    case 'slide_right':
      cmds.push({
        id: generateId(),
        type: 'slide',
        target: currentAssetId,
        fromAsset: nextAssetId,
        direction: 'right',
        start: startFrame,
        duration: durationFrames,
      });
      break;
    case 'slide_up':
      cmds.push({
        id: generateId(),
        type: 'slide',
        target: currentAssetId,
        fromAsset: nextAssetId,
        direction: 'top',
        start: startFrame,
        duration: durationFrames,
      });
      break;
    case 'slide_down':
      cmds.push({
        id: generateId(),
        type: 'slide',
        target: currentAssetId,
        fromAsset: nextAssetId,
        direction: 'bottom',
        start: startFrame,
        duration: durationFrames,
      });
      break;
    case 'wipe_left':
      cmds.push({
        id: generateId(),
        type: 'wipe',
        target: currentAssetId,
        toAsset: nextAssetId,
        direction: 'left',
        start: startFrame,
        duration: durationFrames,
      });
      break;
    case 'wipe_right':
      cmds.push({
        id: generateId(),
        type: 'wipe',
        target: currentAssetId,
        toAsset: nextAssetId,
        direction: 'right',
        start: startFrame,
        duration: durationFrames,
      });
      break;
    case 'wipe_up':
      cmds.push({
        id: generateId(),
        type: 'wipe',
        target: currentAssetId,
        toAsset: nextAssetId,
        direction: 'top',
        start: startFrame,
        duration: durationFrames,
      });
      break;
    case 'wipe_down':
      cmds.push({
        id: generateId(),
        type: 'wipe',
        target: currentAssetId,
        toAsset: nextAssetId,
        direction: 'bottom',
        start: startFrame,
        duration: durationFrames,
      });
      break;
    case 'zoom_in':
      cmds.push({
        id: generateId(),
        type: 'scale',
        target: currentAssetId,
        start: startFrame,
        duration: durationFrames,
        from: 1.0,
        to: 1.5,
        easing: 'easeIn',
      });
      break;
    case 'zoom_out':
      cmds.push({
        id: generateId(),
        type: 'scale',
        target: currentAssetId,
        start: startFrame,
        duration: durationFrames,
        from: 1.5,
        to: 1.0,
        easing: 'easeOut',
      });
      break;
    case 'cut':
    default:
      break;
  }

  return cmds;
}

function durationToSeconds(duration?: string): number {
  if (!duration) return 0;
  const match = duration.match(/^(\d+(?:\.\d+)?)(s|ms)?$/);
  if (!match) return 0;
  const value = parseFloat(match[1]);
  const unit = match[2] || 's';
  return unit === 'ms' ? value / 1000 : value;
}

// ---------------------------------------------------------------------------
// Normalize scene durations to fit audio duration
// Uses transcript segments when available, falls back to even distribution
// ---------------------------------------------------------------------------

function normalizeSceneDurations(
  scenes: SceneDSL[],
  context: CompileContext,
): number[] {
  const totalAudioDuration = context.audioDuration ||
    (context.transcriptSegments && context.transcriptSegments.length > 0
      ? context.transcriptSegments[context.transcriptSegments.length - 1].end
      : 0);

  if (scenes.length === 0) return [];

  // Check if any scene has explicit durations
  const hasDurations = scenes.some(s => durationToSeconds(s.duration) > 0);

  if (hasDurations) {
    // Respect AI-provided durations but scale to fit audio if total exceeds it
    let durations = scenes.map(s => {
      const d = durationToSeconds(s.duration);
      return d > 0 ? d : 3; // fallback for scenes without duration
    });

    if (totalAudioDuration > 0) {
      const totalSceneDuration = durations.reduce((a, b) => a + b, 0);
      if (totalSceneDuration > 0 && Math.abs(totalSceneDuration - totalAudioDuration) > 0.5) {
        // Scale durations to match audio
        const scale = totalAudioDuration / totalSceneDuration;
        durations = durations.map(d => Math.max(0.5, d * scale));
      }
    }

    return durations;
  }

  // No durations provided — derive from transcript segments
  if (context.transcriptSegments && context.transcriptSegments.length > 0) {
    // Match scenes to transcript segments by text overlap
    const durations: number[] = [];
    const segText = context.transcriptSegments.map(s => s.text.toLowerCase());

    for (const scene of scenes) {
      const sceneWords = new Set(scene.text.toLowerCase().split(/\s+/));
      let bestStart = -1;
      let bestEnd = -1;
      let bestScore = 0;

      for (let i = 0; i < context.transcriptSegments!.length; i++) {
        for (let j = i; j < context.transcriptSegments!.length; j++) {
          const combined = segText.slice(i, j + 1).join(' ');
          const words = combined.split(/\s+/);
          let matches = 0;
          for (const w of words) {
            if (sceneWords.has(w)) matches++;
          }
          const score = matches / Math.max(sceneWords.size, 1);
          if (score > bestScore && score > 0.3) {
            bestScore = score;
            bestStart = i;
            bestEnd = j;
          }
        }
      }

      if (bestStart >= 0) {
        const start = context.transcriptSegments![bestStart].start;
        const end = context.transcriptSegments![bestEnd].end;
        durations.push(Math.max(0.5, end - start));
      } else {
        durations.push(3); // default fallback
      }
    }

    // Normalize to fit total audio duration
    if (totalAudioDuration > 0) {
      const total = durations.reduce((a, b) => a + b, 0);
      if (total > 0 && Math.abs(total - totalAudioDuration) > 0.5) {
        const scale = totalAudioDuration / total;
        return durations.map(d => Math.max(0.5, d * scale));
      }
    }

    return durations;
  }

  // No transcript — even distribution across audio duration or 3s per scene
  const fallbackDuration = totalAudioDuration > 0
    ? totalAudioDuration / scenes.length
    : 3;
  return scenes.map(() => Math.max(0.5, fallbackDuration));
}

export interface CompileContext {
  fps: number;
  width: number;
  height: number;
  existingAssets?: Array<{ logicalId: string; filename: string; type: 'image' | 'video' | 'audio' }>;
  transcriptSegments?: Array<{ start: number; end: number; text: string }>;
  audioDuration?: number;
}

export interface CompiledScene {
  sceneIndex: number;
  assetLogicalId: string;
  commands: Command[];
  startFrame: number;
  endFrame: number;
  durationFrames: number;
}

export interface CompileOutput {
  scenes: CompiledScene[];
  allCommands: Command[];
  assetMap: Map<string, { logicalId: string; filename: string; type: 'image' | 'video' | 'audio' }>;
  errors: string[];
  warnings: string[];
}

export function compileSceneDSL(
  scenes: SceneDSL[],
  context: CompileContext,
  sceneImages?: Map<number, string>,
): CompileOutput {
  const { fps } = context;
  const allCommands: Command[] = [];
  const compiledScenes: CompiledScene[] = [];
  const assetMap = new Map<string, { logicalId: string; filename: string; type: 'image' | 'video' | 'audio' }>();
  const errors: string[] = [];
  const warnings: string[] = [];

  const transitionDurationFrames = Math.round(0.5 * fps);

  // Normalize all scene durations to fit audio
  const normalizedDurations = normalizeSceneDurations(scenes, context);

  let currentFrame = 0;

  for (let i = 0; i < scenes.length; i++) {
    const scene = scenes[i];
    const durationSec = normalizedDurations[i];
    const durationFrames = Math.round(durationSec * fps);
    const startFrame = currentFrame;
    const endFrame = startFrame + durationFrames;

    const imageFilename = sceneImages?.get(i) || `scene_${i + 1}.png`;
    const existingLogicalIds = new Set(
      Array.from(assetMap.values()).map(a => a.logicalId),
    );
    const assetLogicalId = `image${existingLogicalIds.size + 1}`;

    assetMap.set(imageFilename, {
      logicalId: assetLogicalId,
      filename: imageFilename,
      type: 'image',
    });

    const sceneCommands: Command[] = [];

    const showCmd: ShowCommand = {
      id: generateId(),
      type: 'show',
      asset: assetLogicalId,
      start: startFrame,
      duration: durationFrames,
      layer: i,
      x: 0,
      y: 0,
      z: i,
      scale: 1.0,
      opacity: 1.0,
    };
    sceneCommands.push(showCmd);

    if (scene.motion && scene.motion !== 'none') {
      const motionCmds = motionToCommands(assetLogicalId, scene.motion as SupportedMotion, startFrame, durationFrames);
      sceneCommands.push(...motionCmds);
    }

    if (i < scenes.length - 1) {
      const nextScene = scenes[i + 1];
      const nextImageFilename = sceneImages?.get(i + 1) || `scene_${i + 2}.png`;
      const nextLogicalId = `image${existingLogicalIds.size + 2}`;

      if (!assetMap.has(nextImageFilename)) {
        assetMap.set(nextImageFilename, {
          logicalId: nextLogicalId,
          filename: nextImageFilename,
          type: 'image',
        });
      }

      const effectiveTransition = i === 0 ? (scene.transition || 'cut') : (nextScene.transition || 'cut');

      if (effectiveTransition !== 'cut') {
        const transitionStart = endFrame - transitionDurationFrames;
        const transitionCmds = transitionToCommands(
          assetLogicalId,
          nextLogicalId,
          effectiveTransition as SupportedTransition,
          Math.max(startFrame, transitionStart),
          transitionDurationFrames,
        );
        sceneCommands.push(...transitionCmds);
      }
    }

    allCommands.push(...sceneCommands);
    compiledScenes.push({
      sceneIndex: i,
      assetLogicalId,
      commands: sceneCommands,
      startFrame,
      endFrame,
      durationFrames,
    });

    currentFrame = endFrame;
  }

  return {
    scenes: compiledScenes,
    allCommands,
    assetMap,
    errors,
    warnings,
  };
}

export function getDurationSeconds(scene: SceneDSL): number {
  return durationToSeconds(scene.duration);
}
