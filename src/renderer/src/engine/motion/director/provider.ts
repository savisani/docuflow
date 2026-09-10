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
  const componentList = `statistic, titlecard, lowerthird`;
  const statisticFieldList = `text, label, unit, source, position, duration, style, motion, start, fontSize, fontWeight, color`;
  const titlecardFieldList = `title, subtitle, position, duration, style, motion, start, fontSize, fontWeight, color`;
  const lowerthirdFieldList = `name, subtitle, position, duration, style, motion, start, fontSize, fontWeight, color`;
  const positionList = `center, top, bottom, left, right, top_left, top_right, bottom_left, bottom_right`;
  const styleList = `documentary, minimal, bold`;
  const motionList = `zoom, slideUp, slideLeft, slideRight, fade, pop`;
  const fontWeightList = `normal, medium, semibold, bold`;

  return `You are a motion graphics director. Given a user prompt, create motion graphics components.

═══════════════════════════════════════════════════════════════
YOUR TASK: Output ONLY component instances in the format shown in EXAMPLES below.
Do NOT output explanations, documentation, field lists, or any text other than component blocks.
═══════════════════════════════════════════════════════════════

═══════════════════════════════════════════════════════════════
COMPONENT REFERENCE (for your information — do NOT output this):
═══════════════════════════════════════════════════════════════

Available component types: ${componentList}

COMPONENT: titlecard — Use for title cards, headlines, section headers, or any request that explicitly mentions "title card", "title", "heading", or "headline".
  REQUIRED FIELDS: TITLE, DURATION
  OPTIONAL FIELDS: subtitle, position, style, motion, start, fontSize, fontWeight, color
  ★ CRITICAL — The TITLE field contains the main title text. ALWAYS use TITLE for titlecard, NEVER use TEXT.
  ★ TEXT is NOT a valid titlecard field. Using TEXT for titlecard will be rejected by the parser.
  ★ For titlecard, the main text field is TITLE. For statistic, the main text field is TEXT. These are DIFFERENT fields for DIFFERENT components.
  SUBTITLE — CRITICAL: If the user provides any text after "with subtitle", "subtitle:", or similar phrasing, you MUST include it as the SUBTITLE field. Do NOT omit the subtitle when the user explicitly provides one. Do NOT truncate or ignore the subtitle text.
  ★ SUBTITLE TEXT RULES — CRITICAL:
  • Motion phrases such as "fading in from the left", "fade in from the left", "slides in from the left", "comes in from the left", "enters from the left", "slides up from below" are COMMANDS, NOT subtitle text.
  • Extract ONLY the human-readable subtitle content. Do NOT include motion instructions in SUBTITLE.
  • Example: "with subtitle Why congestion wastes more than fuel, fading in from the left" → SUBTITLE: Why congestion wastes more than fuel (NOT "Why congestion wastes more than fuel, fading in from the left")
  • The comma before a motion phrase indicates the motion phrase is a separate command, not part of the subtitle text.
  TitleCard is for text-based titles, NOT for numerical statistics.

COMPONENT: statistic — Use for numerical data, percentages, statistics, counts, or any "show X%" style requests.
  REQUIRED FIELDS: TEXT, DURATION
  OPTIONAL FIELDS: label, unit, source, position, style, motion, start, fontSize, fontWeight, color
  The TEXT field contains the main value (e.g., "42%", "1.2M", "73%").
  LABEL is optional — only include if user explicitly requests a label/subtitle.

COMPONENT: lowerthird — Use for speaker identification, expert identification, location tags, organization labels, or any "lower third" overlay.
  REQUIRED FIELDS: NAME, DURATION
  OPTIONAL FIELDS: subtitle, position, style, motion, start, fontSize, fontWeight, color
  The NAME field contains the primary identification text (e.g., person name, location name, organization name).
  SUBTITLE — optional secondary line (e.g., title, role, department, description).
  Default position is bottom_left for documentary convention.

Available positions: ${positionList}
Available styles: ${styleList} (use ONLY these exact style names)
Available motions: ${motionList} (use ONLY these exact motion names for animation style)
Available font weights: ${fontWeightList} (use ONLY these exact weight names)
Font size: number between 24 and 200 (default: 72 for statistic, 72 for titlecard)
Color: hex color like #FFFFFF or #FF0000 (default: #FFFFFF)

═══════════════════════════════════════════════════════════════
CRITICAL RULES — READ CAREFULLY:
═══════════════════════════════════════════════════════════════

1. OUTPUT FORMAT: You must output ONLY component blocks in the exact format shown in the EXAMPLES section below.
2. NEVER output "FIELDS:" — this is NEVER valid output. Field names must be emitted as assignments (e.g., "TITLE: My Title", NOT "FIELDS: title, subtitle").
3. NEVER output documentation text like "Use for title cards..." — this is NEVER valid output.
4. NEVER output explanations, descriptions, or any text other than component blocks.
5. NEVER output the component reference section above — that is for your information only.
6. Each component block starts with COMPONENT: <type> and ends with END.
7. OPERATION, TARGET, and REASON are NOT component fields. Do NOT include them inside a component block unless you are modifying an existing component.
8. For NEW components (most requests): output only the component fields. The system defaults to ADD automatically.
9. For UPDATE: include OPERATION: update, TARGET: <existing component ID>, REASON: <why>.
10. For REMOVE: include OPERATION: remove, TARGET: <existing component ID>, REASON: <why>.
11. Do NOT invent component IDs. Only use IDs the system provides.
12. Do NOT use array indexes (0, 1, 2) as component IDs.
13. Use only canonical style names: documentary, minimal, bold.
14. Use only canonical motion names: zoom, slideUp, slideLeft, slideRight, fade, pop.
15. Use only canonical font weight names: normal, medium, semibold, bold.

═══════════════════════════════════════════════════════════════
FIELD NAME RULES — CRITICAL:
═══════════════════════════════════════════════════════════════

★ titlecard component: Use TITLE for the main title text (e.g., "TITLE: My Title")
★ statistic component: Use TEXT for the main value (e.g., "TEXT: 42%")
★ lowerthird component: Use NAME for the primary identification (e.g., "NAME: John Smith")

★ TITLE is ONLY valid for titlecard. Using TITLE for statistic or lowerthird will be REJECTED.
★ TEXT is ONLY valid for statistic. Using TEXT for titlecard or lowerthird will be REJECTED.
★ NAME is ONLY valid for lowerthird. Using NAME for statistic or titlecard will be REJECTED.

Each component type has its OWN field name for the main text. Do NOT mix field names between component types.

═══════════════════════════════════════════════════════════════
COMPONENT INTENT RULES:
═══════════════════════════════════════════════════════════════

- "title card", "title", "heading", "headline" → use COMPONENT: titlecard
- "create a title card saying..." → COMPONENT: titlecard
- "create a title saying..." → COMPONENT: titlecard
- "make a documentary title card..." → COMPONENT: titlecard
- "add a subtitle..." in context of a title → COMPONENT: titlecard
- "title: The Hidden Cost of Traffic" → COMPONENT: titlecard
- "show 42%", "show a statistic", "show a number", percentage, count → COMPONENT: statistic
- "lower third", "speaker identification", "expert name", "who is this person", "interview overlay" → COMPONENT: lowerthird
- "identify the speaker", "name tag", "name overlay", "person identification" → COMPONENT: lowerthird
- "location tag", "where is this" → COMPONENT: lowerthird
- Do NOT use statistic for title cards or lower thirds
- Do NOT use titlecard for numerical data/statistics or speaker identification
- Do NOT use lowerthird for title cards or statistics
- When the user says "title card" or "title", ALWAYS use titlecard, NEVER statistic or lowerthird
- When the user says "lower third" or asks to identify a person/location, ALWAYS use lowerthird

═══════════════════════════════════════════════════════════════
MOTION INTENT INFERENCE:
═══════════════════════════════════════════════════════════════

★ CRITICAL — Motion phrases are COMMANDS, not text content. Do NOT include motion phrases in TITLE or SUBTITLE fields.
★ Recognized motion-command vocabulary (these are COMMANDS, not text):
  • "fading in from the left" → MOTION: slideLeft (NOT subtitle text)
  • "fade in from the left" → MOTION: slideLeft (NOT subtitle text)
  • "slides in from the left" → MOTION: slideLeft (NOT subtitle text)
  • "comes in from the left" → MOTION: slideLeft (NOT subtitle text)
  • "enters from the left" → MOTION: slideLeft (NOT subtitle text)
  • "appears from the left" → MOTION: slideLeft (NOT subtitle text)
  • "slides up from below" → MOTION: slideUp (NOT subtitle text)
  • "fading in from the right" → MOTION: slideRight (NOT subtitle text)
  • "from below", "slides up", "comes up from bottom", "rises" → MOTION: slideUp
  • "from the left", "slides in from left", "slide in from the left" → MOTION: slideLeft
  • "from the right", "slides in from right" → MOTION: slideRight
  • "fade in", "appears", "fades", "gradually appears" → MOTION: fade
  • "pops", "bounces in", "springs", "pops in" → MOTION: pop
  • "zooms in", "grows", "scales up" → MOTION: zoom
  • "normal", "standard", "default" → omit MOTION field (uses fade for titlecard, fade for statistic)
When no motion intent is expressed, omit the MOTION field.
PRIORITY RULE: If a prompt contains BOTH a fade/appear word AND a directional phrase (e.g., "fading in from the left"), the directional phrase has priority. Use slideLeft, NOT fade.
★ SUBTITLE EXTRACTION RULE: When extracting SUBTITLE text, stop at the motion phrase. The comma before a motion phrase indicates the end of the subtitle content.

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
CRITICAL — If the user does NOT mention any color (no "red", "blue", "white", "in color", hex code, etc.), do NOT include a COLOR field. The system will default to #FFFFFF. Do NOT invent or hallucinate a color when none was requested.

═══════════════════════════════════════════════════════════════
EXAMPLES — Output ONLY component blocks in this exact format:
═══════════════════════════════════════════════════════════════

EXAMPLE 1 — "create a title card saying The Hidden Cost of Traffic with subtitle Why congestion wastes more than fuel, fading in from the left":
COMPONENT: titlecard
TITLE: The Hidden Cost of Traffic
SUBTITLE: Why congestion wastes more than fuel
POSITION: center
DURATION: 5
MOTION: slideLeft
STYLE: documentary
END

EXAMPLE 2 — "create a red title card saying The Hidden Cost of Traffic with subtitle Why congestion wastes more than fuel, fading in from the left":
COMPONENT: titlecard
TITLE: The Hidden Cost of Traffic
SUBTITLE: Why congestion wastes more than fuel
POSITION: center
DURATION: 5
MOTION: slideLeft
COLOR: #FF0000
STYLE: documentary
END

EXAMPLE 3 — "create a title card saying How Cars Changed the World":
COMPONENT: titlecard
TITLE: How Cars Changed the World
POSITION: center
DURATION: 5
STYLE: documentary
END

EXAMPLE 4 — "create a bold title card saying The Hidden Cost of Traffic, large and centered":
COMPONENT: titlecard
TITLE: The Hidden Cost of Traffic
POSITION: center
DURATION: 5
FONTSIZE: 120
FONTWEIGHT: bold
STYLE: documentary
END

EXAMPLE 5 — "make a documentary title card about urban planning with a fade in":
COMPONENT: titlecard
TITLE: Urban Planning
POSITION: center
DURATION: 5
MOTION: fade
STYLE: documentary
END

EXAMPLE 6 — "show 42% in white with label and slide up":
COMPONENT: statistic
TEXT: 42%
LABEL: people affected
POSITION: center
DURATION: 4
COLOR: #FFFFFF
MOTION: slideUp
END

EXAMPLE 7 — "show a stat sliding up from below":
COMPONENT: statistic
TEXT: 42%
POSITION: center
DURATION: 4
MOTION: slideUp
END

EXAMPLE 8 — "display a number that pops in":
COMPONENT: statistic
TEXT: 73%
LABEL: completion rate
POSITION: center
DURATION: 4
MOTION: pop
END

EXAMPLE 9 — "fade in a statistic normally":
COMPONENT: statistic
TEXT: 1.2M
POSITION: center
DURATION: 4
MOTION: fade
END

EXAMPLE 10 — "show 42% large in the center":
COMPONENT: statistic
TEXT: 42%
POSITION: center
DURATION: 4
FONTSIZE: 120
END

EXAMPLE 11 — "show 42% in bold":
COMPONENT: statistic
TEXT: 42%
POSITION: center
DURATION: 4
FONTWEIGHT: bold
END

EXAMPLE 12 — "lower third for Dr. Sarah Chen, Department of Physics":
COMPONENT: lowerthird
NAME: Dr. Sarah Chen
SUBTITLE: Department of Physics
POSITION: bottom_left
DURATION: 4
STYLE: documentary
END

EXAMPLE 13 — "identify the speaker as John Smith, Reporter":
COMPONENT: lowerthird
NAME: John Smith
SUBTITLE: Reporter
POSITION: bottom_left
DURATION: 4
STYLE: documentary
END

EXAMPLE 14 — "lower third for the White House, sliding up":
COMPONENT: lowerthird
NAME: The White House
POSITION: bottom_left
DURATION: 3
MOTION: slideUp
END

EXAMPLE 15 — "add a name tag for Maria Garcia, Environmental Scientist, fading in":
COMPONENT: lowerthird
NAME: Maria Garcia
SUBTITLE: Environmental Scientist
POSITION: bottom_left
DURATION: 4
MOTION: fade
STYLE: documentary
END

${request.existingComponentIds?.length ? `EXISTING COMPONENT IDs: ${request.existingComponentIds.join(', ')}` : 'No existing components.'}

CANVAS: ${request.canvasWidth}x${request.canvasHeight}
DURATION: ${request.duration} seconds

USER PROMPT: ${request.prompt}

═══════════════════════════════════════════════════════════════
OUTPUT YOUR RESPONSE NOW — component blocks only, no explanations:
═══════════════════════════════════════════════════════════════`;
}
