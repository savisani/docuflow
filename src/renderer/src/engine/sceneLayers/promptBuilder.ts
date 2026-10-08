import type { SceneLayerType, SceneVisualContext, ShotType, LayerAlphaMode } from './types';

/**
 * Builds the full generation prompt for a single layer.
 *
 * Every layer of a scene receives the SAME shared visual context so the
 * independently generated background, subjects, foreground and atmosphere
 * belong to one coherent documentary frame (Phase 4 — visual consistency).
 */

const QUALITY_TAGS =
  'cinematic documentary still, photorealistic, hyper-detailed, sharp focus, natural film grain, coherent lighting';

const SHOT_FRAMING: Record<ShotType, string> = {
  establishing: 'wide establishing shot, environment dominates the frame, subjects small and distant',
  subject: 'medium shot focused on the main subject, environment supports the subject',
  environment: 'environmental composition showing place and activity, balanced depth',
  historical_reconstruction: 'staged historical reconstruction, period-accurate detail, cinematic blocking',
  detail: 'intimate detail shot, shallow depth of field, texture emphasized',
  atmospheric: 'mood-driven composition, atmosphere carries the image, restrained subject matter',
};

const CONTEXT_LABELS: { key: keyof SceneVisualContext; label: string }[] = [
  { key: 'period', label: 'time period' },
  { key: 'location', label: 'location' },
  { key: 'environment', label: 'environment' },
  { key: 'architecture', label: 'architecture' },
  { key: 'lighting', label: 'lighting' },
  { key: 'weather', label: 'weather' },
  { key: 'tone', label: 'mood' },
  { key: 'characters', label: 'people' },
  { key: 'clothing', label: 'clothing' },
  { key: 'cameraStyle', label: 'camera style' },
  { key: 'style', label: 'style' },
];

const ALPHA_INSTRUCTIONS: Record<LayerAlphaMode, string> = {
  none: '',
  chroma:
    'The layer content must be isolated on a completely flat, uniform, solid chroma-key green background (pure #00FF00). ' +
    'No environment, no scenery, no shadows cast on the background, no gradient, no vignette — only the subject over uniform green.',
  luminance:
    'Render the effect as soft glowing luminance on a completely pure black background filling the whole frame — ' +
    'nothing else visible, no scene elements, no horizon, no objects.',
};

const COMPOSITION_RULES: Record<SceneLayerType, string> = {
  background:
    'This is the full-frame background plate: sky, distant landscape and distant architecture only. ' +
    'No prominent people, animals or vehicles in the near or mid field.',
  midground:
    'This layer contains only the scene subjects, correctly scaled for their distance from the camera, ' +
    'with their placement matching the intended composition of the full scene.',
  foreground:
    'This layer contains only foreground framing elements that enter from the frame edges and stay near the camera, ' +
    'leaving the center of the frame clear so the main subject is never covered.',
  atmosphere:
    'This layer contains only the atmospheric effect across the whole frame, subtle enough to sit over the scene without hiding detail.',
};

export interface LayerPromptDraft {
  type: SceneLayerType;
  alphaMode: LayerAlphaMode;
  /** Layer-specific content: what is in this layer and where it sits. */
  content: string;
  shot?: ShotType;
  context: SceneVisualContext;
}

/** Context sentence shared by every layer of the scene. */
export function buildContextSentence(context: SceneVisualContext): string {
  const parts: string[] = [];
  for (const { key, label } of CONTEXT_LABELS) {
    const value = context[key];
    if (value) parts.push(`${label}: ${value}`);
  }
  return parts.length > 0 ? `Shared scene context — ${parts.join('; ')}.` : '';
}

/**
 * Compose the final prompt for one layer.
 *
 * Layout: layer content → composition rule → shared context → shot framing →
 * alpha constraint → quality tags. The shared context block is identical
 * across layers of the same scene.
 */
export function buildLayerPrompt(draft: LayerPromptDraft): string {
  const sections: string[] = [];

  const content = draft.content.trim().replace(/,+$/, '');
  if (content) sections.push(content);

  sections.push(COMPOSITION_RULES[draft.type]);

  const contextSentence = buildContextSentence(draft.context);
  if (contextSentence) sections.push(contextSentence);

  if (draft.shot) sections.push(`Shot type: ${SHOT_FRAMING[draft.shot]}.`);

  const alpha = ALPHA_INSTRUCTIONS[draft.alphaMode];
  if (alpha) sections.push(alpha);

  sections.push(QUALITY_TAGS);

  return sections.join(' ');
}
