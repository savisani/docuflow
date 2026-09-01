// ---------------------------------------------------------------------------
// SceneIntent → SceneDSL Compiler
//
// Converts compact AI-generated SceneIntent JSON into the existing SceneDSL
// format. All defaults, validation, and normalization happen here in code.
// The AI only answers "what should happen visually?" — this module handles
// the deterministic work of filling defaults, fixing invalid values, and
// producing valid SceneDSL.
// ---------------------------------------------------------------------------

import { SceneDSL, SupportedMotion, SupportedTransition, SupportedStyle } from './types';

// ---------------------------------------------------------------------------
// SceneIntent — compact AI output schema
// ---------------------------------------------------------------------------

export interface SceneIntent {
  /** What to show visually (prompt for image generation) */
  v: string;
  /** Camera animation — one of the short aliases */
  a?: string;
  /** Transition to next scene */
  t?: string;
  /** Optional text overlay */
  tx?: string;
  /** Visual style hint */
  s?: string;
}

// ---------------------------------------------------------------------------
// Animation aliases — small models output these short strings
// ---------------------------------------------------------------------------

const ANIMATION_MAP: Record<string, SupportedMotion> = {
  'zoom_in': 'slow_zoom',
  'zoom': 'slow_zoom',
  'zoom_out': 'slow_zoom_out',
  'pan_left': 'slow_pan_left',
  'pan_right': 'slow_pan_right',
  'pan': 'slow_pan_right',
  'static': 'none',
  'none': 'none',
  'dolly': 'dolly_in',
  'orbit': 'orbit_left',
  'tilt': 'tilt_up',
  'crane': 'crane_up',
  'handheld': 'handheld',
  'parallax': 'parallax',
  'fast_zoom': 'fast_zoom',
  'medium_zoom': 'medium_zoom',
  'fast_pan': 'fast_pan_right',
  'medium_pan': 'medium_pan_right',
};

const TRANSITION_MAP: Record<string, SupportedTransition> = {
  'cut': 'cut',
  'fade': 'fade',
  'crossfade': 'crossfade',
  'dissolve': 'dissolve',
  'slide': 'slide_left',
  'slide_left': 'slide_left',
  'slide_right': 'slide_right',
  'wipe': 'wipe_left',
  'wipe_left': 'wipe_left',
  'wipe_right': 'wipe_right',
  'zoom_in': 'zoom_in',
  'zoom_out': 'zoom_out',
};

const STYLE_MAP: Record<string, SupportedStyle> = {
  'natural': 'natural',
  'cinematic': 'cinematic',
  'documentary': 'documentary',
  'vintage': 'vintage',
  'dramatic': 'dramatic',
  'minimal': 'minimal',
  'none': 'none',
};

// ---------------------------------------------------------------------------
// Defaults — deterministic, no AI needed
// ---------------------------------------------------------------------------

const DEFAULT_ANIMATION: SupportedMotion = 'slow_zoom';
const DEFAULT_TRANSITION: SupportedTransition = 'cut';
const DEFAULT_STYLE: SupportedStyle = 'natural';

// ---------------------------------------------------------------------------
// Normalize a single SceneIntent into a SceneDSL
// ---------------------------------------------------------------------------

function normalizeAnimation(raw?: string): SupportedMotion {
  if (!raw) return DEFAULT_ANIMATION;
  const lower = raw.toLowerCase().trim().replace(/[\s-]+/g, '_');
  if (ANIMATION_MAP[lower]) return ANIMATION_MAP[lower];
  // Fuzzy match
  for (const [key, val] of Object.entries(ANIMATION_MAP)) {
    if (lower.includes(key) || key.includes(lower)) return val;
  }
  return DEFAULT_ANIMATION;
}

function normalizeTransition(raw?: string): SupportedTransition {
  if (!raw) return DEFAULT_TRANSITION;
  const lower = raw.toLowerCase().trim().replace(/[\s-]+/g, '_');
  if (TRANSITION_MAP[lower]) return TRANSITION_MAP[lower];
  for (const [key, val] of Object.entries(TRANSITION_MAP)) {
    if (lower.includes(key) || key.includes(lower)) return val;
  }
  return DEFAULT_TRANSITION;
}

function normalizeStyle(raw?: string): SupportedStyle {
  if (!raw) return DEFAULT_STYLE;
  const lower = raw.toLowerCase().trim().replace(/[\s-]+/g, '_');
  if (STYLE_MAP[lower]) return STYLE_MAP[lower];
  for (const [key, val] of Object.entries(STYLE_MAP)) {
    if (lower.includes(key) || key.includes(lower)) return val;
  }
  return DEFAULT_STYLE;
}

// ---------------------------------------------------------------------------
// Compile a batch of SceneIntents → SceneDSL[]
// ---------------------------------------------------------------------------

export function compileSceneIntents(
  intents: SceneIntent[],
  transcriptTexts: string[],
): SceneDSL[] {
  return intents.map((intent, i) => ({
    text: transcriptTexts[i] || '',
    visual: intent.v || transcriptTexts[i] || 'Scene visual',
    motion: normalizeAnimation(intent.a),
    transition: normalizeTransition(intent.t),
    style: normalizeStyle(intent.s),
    layers: intent.tx ? [intent.tx] : undefined,
  }));
}

// ---------------------------------------------------------------------------
// Parse raw JSON response from the model into SceneIntent[]
//
// Handles:
// - Clean JSON array
// - JSON wrapped in markdown fences
// - JSON embedded in text
// - Single object (wraps in array)
// ---------------------------------------------------------------------------

export function parseSceneIntents(raw: string): SceneIntent[] {
  let cleaned = raw.trim();

  // Strip markdown code fences
  cleaned = cleaned.replace(/^```(?:json)?\s*\n?/i, '').replace(/\n?```\s*$/i, '');

  // Try direct parse
  try {
    const parsed = JSON.parse(cleaned);
    if (Array.isArray(parsed)) return parsed.filter(isSceneIntent);
    if (parsed && typeof parsed === 'object' && parsed.v) return [parsed as SceneIntent];
  } catch { /* continue */ }

  // Try to find JSON array in text
  const arrStart = cleaned.indexOf('[');
  const arrEnd = cleaned.lastIndexOf(']');
  if (arrStart !== -1 && arrEnd > arrStart) {
    try {
      const parsed = JSON.parse(cleaned.slice(arrStart, arrEnd + 1));
      if (Array.isArray(parsed)) return parsed.filter(isSceneIntent);
    } catch { /* continue */ }
  }

  // Try to find JSON object in text
  const objStart = cleaned.indexOf('{');
  const objEnd = cleaned.lastIndexOf('}');
  if (objStart !== -1 && objEnd > objStart) {
    try {
      const parsed = JSON.parse(cleaned.slice(objStart, objEnd + 1));
      if (parsed && typeof parsed === 'object' && parsed.v) return [parsed as SceneIntent];
    } catch { /* continue */ }
  }

  return [];
}

function isSceneIntent(obj: unknown): obj is SceneIntent {
  return obj != null && typeof obj === 'object' && 'v' in obj && typeof (obj as Record<string, unknown>).v === 'string';
}

// ---------------------------------------------------------------------------
// Build compact prompt for a batch of segments
// ---------------------------------------------------------------------------

export interface PromptSegment {
  start: number;
  end: number;
  text: string;
}

export function buildFASTPrompt(
  segments: PromptSegment[],
  context?: string,
): string {
  const segLines = segments.map((s, i) =>
    `[${i}] ${s.start.toFixed(1)}s-${s.end.toFixed(1)}s: "${s.text}"`,
  ).join('\n');

  const contextLine = context ? `\nContext: ${context}\n` : '';

  return `For each narration segment, return a JSON array. Each object has:
v: visual prompt for image generation (cinematic, detailed)
a: animation (zoom_in|zoom_out|pan_left|pan_right|static|dolly|handheld|parallax)
t: transition to next (cut|fade|crossfade|slide|wipe)
s: style (cinematic|documentary|natural|dramatic)
tx: optional text overlay (omit if none needed)

Only return the JSON array, nothing else.
${contextLine}
Segments:
${segLines}

JSON:`;
}

// ---------------------------------------------------------------------------
// Build per-segment prompt (single segment, maximum reliability)
// ---------------------------------------------------------------------------

export function buildSingleSegmentPrompt(
  segment: PromptSegment,
  context?: string,
): string {
  const contextLine = context ? `\nContext: ${context}\n` : '';
  return `Narration (${segment.start.toFixed(1)}s-${segment.end.toFixed(1)}s): "${segment.text}"
${contextLine}Return JSON: {"v":"visual prompt","a":"animation","t":"transition","s":"style"}`;
}
