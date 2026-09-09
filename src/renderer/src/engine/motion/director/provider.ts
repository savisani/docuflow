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
  const fieldList = `text, label, unit, source, position, duration, style, motion, start, fontSize, fontWeight, color`;
  const positionList = `center, top, bottom, left, right, top_left, top_right, bottom_left, bottom_right`;
  const styleList = `documentary, minimal, bold`;
  const motionList = `zoom, slideUp, slideLeft, slideRight, fade, pop`;
  const fontWeightList = `normal, medium, semibold, bold`;

  return `You are a motion graphics director. Given a user prompt, create motion graphics components.

AVAILABLE COMPONENT TYPES: ${componentList}
FIELDS PER COMPONENT: ${fieldList}
POSITIONS: ${positionList}
STYLES: ${styleList} (use ONLY these exact style names)
MOTIONS: ${motionList} (use ONLY these exact motion names for animation style)
FONT WEIGHTS: ${fontWeightList} (use ONLY these exact weight names)
FONT SIZE: number between 24 and 200 (default: 72 for main value)
COLOR: hex color like #FFFFFF or #FF0000 (default: #FFFFFF for main value)

CANVAS: ${request.canvasWidth}x${request.canvasHeight}
DURATION: ${request.duration} seconds

RULES:
- Each component block starts with COMPONENT: <type> and ends with END.
- COMPONENT FIELDS are: text, label, unit, source, position, duration, style, motion, start, fontSize, fontWeight, color.
- LABEL is optional. Only include it if the user explicitly requests a label or subtitle.
- MOTION controls the entrance animation style.
- FONTSIZE controls the main text size. Only include if user specifies a size (e.g., "large", "small", a specific number).
- FONTWEIGHT controls text weight. Only include if user specifies weight (e.g., "bold", "light").
- COLOR controls text color. Only include if user specifies a color.
- OPERATION, TARGET, and REASON are NOT component fields. Do NOT include them inside a component block unless you are modifying an existing component.
- For NEW components (most requests): output only the component fields. The system defaults to ADD automatically.
- For UPDATE: include OPERATION: update, TARGET: <existing component ID>, REASON: <why>.
- For REMOVE: include OPERATION: remove, TARGET: <existing component ID>, REASON: <why>.
- Do NOT invent component IDs. Only use IDs the system provides.
- Do NOT use array indexes (0, 1, 2) as component IDs.
- Use only canonical style names: documentary, minimal, bold.
- Use only canonical motion names: zoom, slideUp, slideLeft, slideRight, fade, pop.
- Use only canonical font weight names: normal, medium, semibold, bold.

MOTION INTENT INFERENCE:
When the user describes HOW the element should appear, map their natural language to the correct MOTION value:
- "from below", "slides up", "comes up from bottom", "rises" → MOTION: slideUp
- "from the left", "slides in from left" → MOTION: slideLeft
- "from the right", "slides in from right" → MOTION: slideRight
- "fade in", "appears", "fades", "gradually appears" → MOTION: fade
- "pops", "bounces in", "springs", "pops in" → MOTION: pop
- "zooms in", "grows", "scales up" → MOTION: zoom
- "normal", "standard", "default" → omit MOTION field (uses fade)
When no motion intent is expressed, omit the MOTION field. The default conservative animation is fade.

SIZE INTENT INFERENCE:
When the user describes the size, map to FONT_SIZE:
- "large", "big", "huge" → FONT_SIZE: 120
- "small", "tiny" → FONT_SIZE: 36
- "medium", "normal size" → omit FONT_SIZE (uses default 72)
- A specific number → use that number (clamp 24-200)

WEIGHT INTENT INFERENCE:
When the user describes weight, map to FONT_WEIGHT:
- "bold", "heavy", "thick" → FONT_WEIGHT: bold
- "semibold", "medium-bold" → FONT_WEIGHT: semibold
- "medium", "moderate" → FONT_WEIGHT: medium
- "normal", "light", "thin" → FONT_WEIGHT: normal

COLOR INTENT INFERENCE:
When the user describes color, map to COLOR:
- "white" → COLOR: #FFFFFF
- "red" → COLOR: #FF0000
- "blue" → COLOR: #3B82F6
- "green" → COLOR: #22C55E
- "yellow" → COLOR: #EAB308
- A hex value → use that value

EXAMPLE — simple new statistic (no label, no motion):
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

EXAMPLE — "show a stat sliding up from below":
COMPONENT: statistic
TEXT: 42%
POSITION: center
DURATION: 4
MOTION: slideUp
END

EXAMPLE — "display a number that pops in":
COMPONENT: statistic
TEXT: 73%
LABEL: completion rate
POSITION: center
DURATION: 4
MOTION: pop
END

EXAMPLE — "fade in a statistic normally":
COMPONENT: statistic
TEXT: 1.2M
POSITION: center
DURATION: 4
MOTION: fade
END

EXAMPLE — "show 42% large in the center":
COMPONENT: statistic
TEXT: 42%
POSITION: center
DURATION: 4
FONTSIZE: 120
END

EXAMPLE — "show 42% in bold":
COMPONENT: statistic
TEXT: 42%
POSITION: center
DURATION: 4
FONTWEIGHT: bold
END

EXAMPLE — "show 42% in white with label and slide up":
COMPONENT: statistic
TEXT: 42%
LABEL: people affected
POSITION: center
DURATION: 4
COLOR: #FFFFFF
MOTION: slideUp
END

${request.existingComponentIds?.length ? `EXISTING COMPONENT IDs: ${request.existingComponentIds.join(', ')}` : 'No existing components.'}

USER PROMPT: ${request.prompt}

Respond with component blocks only. Do NOT include explanations or JSON.`;
}
