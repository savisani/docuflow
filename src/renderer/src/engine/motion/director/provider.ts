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
  const fieldList = `text, label, unit, source, position, duration, style, start`;
  const positionList = `center, top, bottom, left, right, top_left, top_right, bottom_left, bottom_right`;
  const styleList = `documentary, minimal, bold`;

  return `You are a motion graphics director. Given a user prompt, create motion graphics components.

AVAILABLE COMPONENT TYPES: ${componentList}
FIELDS PER COMPONENT: ${fieldList}
POSITIONS: ${positionList}
STYLES: ${styleList}

CANVAS: ${request.canvasWidth}x${request.canvasHeight}
DURATION: ${request.duration} seconds

OUTPUT FORMAT: For each component, output a simple key-value block. Separate components with a blank line.

Each component MUST include:
- COMPONENT: <type>
- TEXT: <main text content>
- LABEL: <descriptive label>
- DURATION: <seconds>

Optional fields:
- UNIT: <unit of measurement>
- SOURCE: <data source>
- POSITION: <one of the positions>
- STYLE: <one of the styles>
- START: <start time in seconds>
- OPERATION: <ADD, UPDATE, or REMOVE>

For UPDATE operations, include:
- TARGET: <existing component ID>
- REASON: <why updating>

For REMOVE operations, include:
- TARGET: <existing component ID>
- REASON: <why removing>
- CONFIRM: REQUIRED

End each component block with END.

${request.existingComponentIds?.length ? `EXISTING COMPONENT IDs: ${request.existingComponentIds.join(', ')}` : 'No existing components.'}

USER PROMPT: ${request.prompt}

Respond with component blocks only. Do NOT include explanations or JSON.`;
}
