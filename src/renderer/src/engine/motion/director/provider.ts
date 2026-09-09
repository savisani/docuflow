/**
 * Motion Director — Provider Abstraction
 *
 * The AI provider interface so the same response protocol works with:
 * - Ollama/local models now
 * - cloud providers later
 * - OpenClaw later if desired
 *
 * The provider receives a Motion Director request and returns the
 * systematic text response. The provider does NOT produce JSON.
 */

import type { MotionDirectorRequest } from './protocol';

// ── Provider Types ──────────────────────────────────────────────

export type MotionProviderType = 'ollama' | 'openrouter' | 'gemini' | 'mock';

export interface MotionProviderConfig {
  type: MotionProviderType;
  model?: string;
  apiKey?: string;
  baseUrl?: string;
  temperature?: number;
  maxTokens?: number;
}

export interface MotionProviderResponse {
  text: string;
  model: string;
  provider: MotionProviderType;
  finishReason: 'stop' | 'length' | 'error';
  error?: string;
}

// ── Provider Interface ──────────────────────────────────────────

export interface MotionDirectorProvider {
  readonly providerType: MotionProviderType;

  /** Check if the provider is available */
  isAvailable(): Promise<boolean>;

  /** Send a request to the AI and get a text response */
  generate(request: MotionDirectorRequest): Promise<MotionProviderResponse>;

  /** Get the system prompt for this provider */
  getSystemPrompt(): string;
}

// ── System Prompt Template ──────────────────────────────────────

export function buildMotionDirectorPrompt(request: MotionDirectorRequest): string {
  const componentList = `statistic`;
  const fieldList = `text, label, unit, source, position, duration, style, motion, start`;
  const positionList = `center, top, bottom, left, right, top_left, top_right, bottom_left, bottom_right`;
  const styleList = `documentary, minimal, bold`;
  const motionList = `zoom, slideUp, slideLeft, slideRight, fade, pop`;

  return `You are a motion graphics director. Given a user prompt, create motion graphics components.

AVAILABLE COMPONENT TYPES: ${componentList}
FIELDS PER COMPONENT: ${fieldList}
POSITIONS: ${positionList}
STYLES: ${styleList} (use ONLY these exact style names)
MOTIONS: ${motionList} (use ONLY these exact motion names for animation style)

CANVAS: ${request.canvasWidth}x${request.canvasHeight}
DURATION: ${request.duration} seconds

RULES:
- Each component block starts with COMPONENT: <type> and ends with END.
- COMPONENT FIELDS are: text, label, unit, source, position, duration, style, motion, start.
- LABEL is optional. Only include it if the user explicitly requests a label or subtitle.
- MOTION controls the entrance animation style. If the user specifies a motion (e.g., "slide up", "fade in", "pop"), use the corresponding MOTION value. If no motion is specified, omit the MOTION field (defaults to zoom).
- OPERATION, TARGET, and REASON are NOT component fields. Do NOT include them inside a component block unless you are modifying an existing component.
- For NEW components (most requests): output only the component fields. The system defaults to ADD automatically.
- For UPDATE: include OPERATION: update, TARGET: <existing component ID>, REASON: <why>.
- For REMOVE: include OPERATION: remove, TARGET: <existing component ID>, REASON: <why>.
- Do NOT invent component IDs. Only use IDs the system provides.
- Do NOT use array indexes (0, 1, 2) as component IDs.
- Use only canonical style names: documentary, minimal, bold.
- Use only canonical motion names: zoom, slideUp, slideLeft, slideRight, fade, pop.

EXAMPLE — simple new statistic (no label):
COMPONENT: statistic
TEXT: 42%
POSITION: center
DURATION: 4
STYLE: documentary
END

EXAMPLE — statistic with label:
COMPONENT: statistic
TEXT: 73%
LABEL: of global traffic
POSITION: center
DURATION: 4
STYLE: documentary
END

EXAMPLE — statistic with slideUp motion:
COMPONENT: statistic
TEXT: 42%
POSITION: center
DURATION: 4
MOTION: slideUp
END

${request.existingComponentIds?.length ? `EXISTING COMPONENT IDs: ${request.existingComponentIds.join(', ')}` : 'No existing components.'}

USER PROMPT: ${request.prompt}

Respond with component blocks only. Do NOT include explanations or JSON.`;
}
