import {
  SceneDSL,
  MOTION_ALIASES,
  TRANSITION_ALIASES,
  STYLE_ALIASES,
  VALID_MOTIONS,
  VALID_TRANSITIONS,
  VALID_STYLES,
  SupportedMotion,
  SupportedTransition,
  SupportedStyle,
} from './types';

const SCENE_SEPARATOR = /^\s*---+\s*$/m;

function parseKeyValue(line: string): [string, string] | null {
  const colonIndex = line.indexOf(':');
  if (colonIndex === -1) return null;

  const key = line.substring(0, colonIndex).trim().toLowerCase();
  const value = line.substring(colonIndex + 1).trim();
  return [key, value];
}

function normalizeMotion(raw: string): SupportedMotion {
  const lower = raw.toLowerCase().trim();
  if (MOTION_ALIASES[lower]) return MOTION_ALIASES[lower];
  const camelCase = lower.replace(/\s+/g, '_');
  if (VALID_MOTIONS.includes(camelCase as SupportedMotion)) return camelCase as SupportedMotion;
  for (const alias of Object.keys(MOTION_ALIASES)) {
    if (alias.includes(lower) || lower.includes(alias)) return MOTION_ALIASES[alias];
  }
  return 'none';
}

function normalizeTransition(raw: string): SupportedTransition {
  const lower = raw.toLowerCase().trim();
  if (TRANSITION_ALIASES[lower]) return TRANSITION_ALIASES[lower];
  const camelCase = lower.replace(/\s+/g, '_');
  if (VALID_TRANSITIONS.includes(camelCase as SupportedTransition)) return camelCase as SupportedTransition;
  for (const alias of Object.keys(TRANSITION_ALIASES)) {
    if (alias.includes(lower) || lower.includes(alias)) return TRANSITION_ALIASES[alias];
  }
  return 'cut';
}

function normalizeStyle(raw: string): SupportedStyle {
  const lower = raw.toLowerCase().trim();
  if (STYLE_ALIASES[lower]) return STYLE_ALIASES[lower];
  const camelCase = lower.replace(/\s+/g, '_');
  if (VALID_STYLES.includes(camelCase as SupportedStyle)) return camelCase as SupportedStyle;
  for (const alias of Object.keys(STYLE_ALIASES)) {
    if (alias.includes(lower) || lower.includes(alias)) return STYLE_ALIASES[alias];
  }
  return 'natural';
}

function normalizeDuration(raw: string): string {
  const cleaned = raw.toLowerCase().trim();
  const match = cleaned.match(/^(\d+(?:\.\d+)?)\s*(s|sec|seconds?|ms|milliseconds?)?$/);
  if (match) {
    const value = parseFloat(match[1]);
    const unit = match[2] || 's';
    if (unit.startsWith('ms')) return `${Math.round(value)}ms`;
    return `${value}s`;
  }
  return raw;
}

export function parseSceneDSLBlock(block: string): SceneDSL {
  const lines = block.split('\n').filter(l => l.trim());
  const scene: SceneDSL = { text: '' };

  for (const line of lines) {
    const kv = parseKeyValue(line);
    if (!kv) continue;

    const [key, value] = kv;
    if (!value) continue;

    switch (key) {
      case 'text':
        scene.text = value;
        break;
      case 'visual':
      case 'image':
      case 'description':
        scene.visual = value;
        break;
      case 'motion':
      case 'camera':
      case 'movement':
        scene.motion = normalizeMotion(value);
        break;
      case 'transition':
      case 'trans':
        scene.transition = normalizeTransition(value);
        break;
      case 'style':
      case 'look':
        scene.style = normalizeStyle(value);
        break;
      case 'duration':
      case 'dur':
      case 'len':
      case 'length':
        scene.duration = normalizeDuration(value);
        break;
      case 'layers':
      case 'layer':
        scene.layers = value.split(',').map(l => l.trim()).filter(Boolean);
        break;
      case 'extras':
      case 'extra':
        scene.extras = value.split(',').map(e => e.trim()).filter(Boolean);
        break;
      case 'reasoning':
      case 'reason':
      case 'thought':
        scene.reasoning = value;
        break;
    }
  }

  return scene;
}

export function parseSceneDSL(dslText: string): { scenes: SceneDSL[]; errors: string[] } {
  const errors: string[] = [];
  const normalized = dslText.replace(/\n\s*---+\s*\n/g, '\n---\n');
  const blocks = normalized.split(SCENE_SEPARATOR).filter(b => b.trim());
  const scenes: SceneDSL[] = [];

  for (let i = 0; i < blocks.length; i++) {
    const block = blocks[i].trim();
    if (!block) continue;

    try {
      const scene = parseSceneDSLBlock(block);
      if (!scene.text) {
        errors.push(`Scene ${i + 1}: missing required 'text' field`);
        continue;
      }
      scenes.push(scene);
    } catch (err) {
      errors.push(`Scene ${i + 1}: parse error - ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  return { scenes, errors };
}

export function sceneToDSL(scene: SceneDSL): string {
  const lines: string[] = [];
  lines.push(`text: ${scene.text}`);
  if (scene.visual) lines.push(`visual: ${scene.visual}`);
  if (scene.motion && scene.motion !== 'none') lines.push(`motion: ${scene.motion}`);
  if (scene.transition && scene.transition !== 'cut') lines.push(`transition: ${scene.transition}`);
  if (scene.style && scene.style !== 'natural') lines.push(`style: ${scene.style}`);
  if (scene.duration) lines.push(`duration: ${scene.duration}`);
  if (scene.layers?.length) lines.push(`layers: ${scene.layers.join(', ')}`);
  if (scene.extras?.length) lines.push(`extras: ${scene.extras.join(', ')}`);
  if (scene.reasoning) lines.push(`reasoning: ${scene.reasoning}`);
  return lines.join('\n');
}

export function scenesToDSL(scenes: SceneDSL[]): string {
  return scenes.map(sceneToDSL).join('\n\n---\n\n');
}
