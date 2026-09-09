/**
 * AI Motion Director — Response Protocol
 *
 * A deterministic, human-readable text protocol that small local models
 * (Ollama/Gemma) can reliably generate. AI must NOT be required to produce JSON.
 *
 * Format:
 *   COMPONENT: statistic
 *   TEXT: 73%
 *   LABEL: of global traffic
 *   DURATION: 4
 *   STYLE: documentary
 *   END
 *
 * Multiple components are separated by blank lines.
 * Operations (ADD/UPDATE/REMOVE) are declared at the top.
 */

// ── Known Component Types ───────────────────────────────────────

export const KNOWN_COMPONENT_TYPES = ['statistic'] as const;
export type KnownComponentType = (typeof KNOWN_COMPONENT_TYPES)[number];

// ── Known Fields Per Component ──────────────────────────────────

export const COMPONENT_FIELDS: Record<KnownComponentType, readonly string[]> = {
  statistic: ['text', 'label', 'unit', 'source', 'position', 'duration', 'style', 'motion', 'start'],
} as const;

export const REQUIRED_FIELDS: Record<KnownComponentType, readonly string[]> = {
  statistic: ['text', 'duration'],
} as const;

// ── Known Operation Types ───────────────────────────────────────

export const KNOWN_OPERATIONS = ['add', 'update', 'remove'] as const;
export type KnownOperation = (typeof KNOWN_OPERATIONS)[number];

// ── Known Position Values ───────────────────────────────────────

export const KNOWN_POSITIONS = [
  'center', 'top', 'bottom', 'left', 'right',
  'top_left', 'top_right', 'bottom_left', 'bottom_right',
] as const;
export type KnownPosition = (typeof KNOWN_POSITIONS)[number];

// ── Known Style Values ──────────────────────────────────────────

export const KNOWN_VISUAL_STYLES = ['documentary', 'minimal', 'bold'] as const;
export const KNOWN_MOTION_STYLES = ['subtle', 'moderate', 'energetic'] as const;

// ── Known Animation Motion Entries ─────────────────────────────
// Semantic motion styles for component animation.
// The compiler maps these to deterministic command sequences.

export const KNOWN_ANIMATION_MOTIONS = ['zoom', 'slideUp', 'slideLeft', 'slideRight', 'fade', 'pop'] as const;
export type KnownAnimationMotion = (typeof KNOWN_ANIMATION_MOTIONS)[number];

// ── Style Aliases (weak model normalization) ────────────────────
// Only explicitly approved aliases. The parser normalizes these
// to canonical values before validation. Unknown styles still fail.

export const STYLE_ALIASES: Record<string, string> = {
  'minimalist': 'minimal',
};

// ── Operation Metadata Fields ───────────────────────────────────
// These fields are NOT component fields. They are operation metadata
// that may appear inside a component block from weak models (Gemma).
// The parser extracts them into a separate ParsedOperationBlock.

export const OPERATION_METADATA_FIELDS = ['operation', 'target', 'reason', 'confirm'] as const;

// ── Parsed Component Block ──────────────────────────────────────

export interface ParsedComponentBlock {
  type: string;
  fields: Record<string, string>;
  lineStart: number;
  lineEnd: number;
}

// ── Parsed Operation Block ──────────────────────────────────────

export interface ParsedOperationBlock {
  operation: string;
  targetId?: string;
  reason?: string;
  confirm?: string;
  component?: ParsedComponentBlock;
  lineStart: number;
  lineEnd: number;
}

// ── Parsed AI Response ──────────────────────────────────────────

export interface ParsedAIResponse {
  operations: ParsedOperationBlock[];
  components: ParsedComponentBlock[];
  parseErrors: ParseError[];
}

// ── Parse Error ─────────────────────────────────────────────────

export interface ParseError {
  line: number;
  field: string;
  message: string;
  code: string;
}

// ── Directive Request (what the user sends to the AI) ───────────

export interface MotionDirectorRequest {
  prompt: string;
  canvasWidth: number;
  canvasHeight: number;
  duration: number;
  existingComponentIds?: string[];
}

// ── Directive Result (parsed + validated) ────────────────────────

export interface MotionDirectorResult {
  success: boolean;
  plan?: import('../types').MotionPlanV1;
  operations?: ParsedOperationBlock[];
  errors: ParseError[];
  rawResponse: string;
}
