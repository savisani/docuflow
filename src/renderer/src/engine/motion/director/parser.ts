import { v4 as uuidv4 } from 'uuid';
import type { MotionPlanV1, MotionComponent } from '../types';
import { MOTION_PLAN_VERSION } from '../types';
import {
  KNOWN_COMPONENT_TYPES,
  COMPONENT_FIELDS,
  REQUIRED_FIELDS,
  KNOWN_OPERATIONS,
  KNOWN_POSITIONS,
  KNOWN_VISUAL_STYLES,
  KNOWN_MOTION_STYLES,
  KNOWN_ANIMATION_MOTIONS,
  STYLE_ALIASES,
  OPERATION_METADATA_FIELDS,
  type ParsedComponentBlock,
  type ParsedOperationBlock,
  type ParsedAIResponse,
  type ParseError,
} from './protocol';

/**
 * Motion Response Parser
 *
 * Converts the AI's systematic text response into a normalized MotionPlanV1.
 *
 * Security rules:
 * - Never executes AI text directly
 * - Rejects unknown component types
 * - Rejects unknown fields
 * - Rejects missing required fields
 * - Validates numeric ranges
 * - Validates allowed enum values
 * - Provides useful parser errors
 * - Never silently invents missing information
 * - Never silently deletes content
 */

// ── Line Parsing ────────────────────────────────────────────────

interface ParsedLine {
  key: string;
  value: string;
  lineNum: number;
}

function parseLine(raw: string, lineNum: number): ParsedLine | null {
  const trimmed = raw.trim();
  if (!trimmed || trimmed.startsWith('#') || trimmed.startsWith('//')) return null;

  const colonIdx = trimmed.indexOf(':');
  if (colonIdx === -1) return null;

  const key = trimmed.slice(0, colonIdx).trim().toLowerCase();
  const value = trimmed.slice(colonIdx + 1).trim();

  return { key, value, lineNum };
}

// ── Style Normalization ────────────────────────────────────────
// Only explicitly approved aliases are normalized.
// Unknown styles continue to fail validation.

function normalizeStyle(raw: string | undefined): string | undefined {
  if (!raw) return raw;
  const lower = raw.toLowerCase().trim();
  return STYLE_ALIASES[lower] ?? lower;
}

// ── Block Parsing ───────────────────────────────────────────────

function parseBlocks(text: string): ParsedAIResponse {
  const lines = text.split('\n');
  const components: ParsedComponentBlock[] = [];
  const operations: ParsedOperationBlock[] = [];
  const parseErrors: ParseError[] = [];

  let currentBlock: ParsedLine[] = [];
  let blockStartLine = 0;
  let inComponent = false;
  let inOperation = false;

  function flushBlock(): void {
    if (currentBlock.length === 0) return;

    const firstKey = currentBlock[0].key;

    if (firstKey === 'component') {
      // Parse as component block
      const type = currentBlock[0].value.toLowerCase();
      const fields: Record<string, string> = {};
      const operationFields: Record<string, string> = {};

      for (let i = 1; i < currentBlock.length; i++) {
        const line = currentBlock[i];
        if (line.key === 'end') continue;

        // Separate operation metadata from component fields.
        // Weak models (Gemma) may include OPERATION/TARGET/REASON inside
        // the component block. These are NOT component fields.
        if ((OPERATION_METADATA_FIELDS as readonly string[]).includes(line.key)) {
          operationFields[line.key] = line.value;
        } else {
          fields[line.key] = line.value;
        }
      }

      components.push({
        type,
        fields,
        lineStart: blockStartLine,
        lineEnd: blockStartLine + currentBlock.length - 1,
      });

      // If operation metadata was found, create a separate operation block.
      // This allows the operation processing layer to handle it correctly.
      // If no OPERATION field was provided, default to 'add' for new components.
      const opType = (operationFields.operation ?? 'add').toLowerCase();
      operations.push({
        operation: opType,
        targetId: operationFields.target,
        reason: operationFields.reason,
        confirm: operationFields.confirm,
        lineStart: blockStartLine,
        lineEnd: blockStartLine + currentBlock.length - 1,
      });
    } else if (firstKey === 'operation') {
      // Parse as operation block
      const operation = currentBlock[0].value.toLowerCase();
      const fields: Record<string, string> = {};

      for (let i = 1; i < currentBlock.length; i++) {
        const line = currentBlock[i];
        if (line.key === 'end') continue;
        fields[line.key] = line.value;
      }

      const opBlock: ParsedOperationBlock = {
        operation,
        targetId: fields.target,
        reason: fields.reason,
        confirm: fields.confirm,
        lineStart: blockStartLine,
        lineEnd: blockStartLine + currentBlock.length - 1,
      };

      // If there's a component nested in the operation, parse it
      if (fields.type) {
        opBlock.component = {
          type: fields.type,
          fields: { ...fields },
          lineStart: blockStartLine,
          lineEnd: blockStartLine + currentBlock.length - 1,
        };
      }

      operations.push(opBlock);
    } else {
      parseErrors.push({
        line: blockStartLine,
        field: firstKey,
        message: `Unknown block type starting with "${firstKey}"`,
        code: 'UNKNOWN_BLOCK',
      });
    }

    currentBlock = [];
  }

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    const trimmed = raw.trim();

    // Blank line = block separator
    if (!trimmed) {
      flushBlock();
      continue;
    }

    // END keyword = end of block
    if (trimmed.toUpperCase() === 'END') {
      flushBlock();
      continue;
    }

    const parsed = parseLine(raw, i + 1);
    if (!parsed) continue;

    if (currentBlock.length === 0) {
      blockStartLine = i + 1;
    }
    currentBlock.push(parsed);
  }

  // Flush any remaining block
  flushBlock();

  return { operations, components, parseErrors };
}

// ── Component Validation ────────────────────────────────────────

function validateComponent(
  block: ParsedComponentBlock,
  canvasWidth: number,
  canvasHeight: number
): ParseError[] {
  const errors: ParseError[] = [];

  // Check known component type
  if (!KNOWN_COMPONENT_TYPES.includes(block.type as any)) {
    errors.push({
      line: block.lineStart,
      field: 'type',
      message: `Unknown component type: "${block.type}". Known types: ${KNOWN_COMPONENT_TYPES.join(', ')}`,
      code: 'UNKNOWN_COMPONENT',
    });
    return errors; // Can't validate further
  }

  const knownFields = COMPONENT_FIELDS[block.type as keyof typeof COMPONENT_FIELDS];
  const requiredFields = REQUIRED_FIELDS[block.type as keyof typeof REQUIRED_FIELDS];

  // Check required fields
  for (const field of requiredFields) {
    if (!block.fields[field] || block.fields[field].trim() === '') {
      errors.push({
        line: block.lineStart,
        field,
        message: `Missing required field: "${field}"`,
        code: 'MISSING_FIELD',
      });
    }
  }

  // Check for unknown fields
  for (const field of Object.keys(block.fields)) {
    if (!knownFields.includes(field)) {
      errors.push({
        line: block.lineStart,
        field,
        message: `Unknown field: "${field}". Known fields: ${knownFields.join(', ')}`,
        code: 'UNKNOWN_FIELD',
      });
    }
  }

  // Validate duration is numeric and positive
  const durationStr = block.fields.duration;
  if (durationStr) {
    const duration = parseFloat(durationStr);
    if (!Number.isFinite(duration) || duration <= 0) {
      errors.push({
        line: block.lineStart,
        field: 'duration',
        message: `Invalid duration: "${durationStr}". Must be a positive number.`,
        code: 'INVALID_DURATION',
      });
    } else if (duration > 300) {
      errors.push({
        line: block.lineStart,
        field: 'duration',
        message: `Duration ${duration}s exceeds maximum of 300s`,
        code: 'DURATION_EXCEEDS_LIMIT',
      });
    }
  }

  // Validate start is numeric and non-negative
  const startStr = block.fields.start;
  if (startStr) {
    const start = parseFloat(startStr);
    if (!Number.isFinite(start) || start < 0) {
      errors.push({
        line: block.lineStart,
        field: 'start',
        message: `Invalid start: "${startStr}". Must be a non-negative number.`,
        code: 'INVALID_START',
      });
    }
  }

  // Validate position if provided
  const position = block.fields.position;
  if (position && !KNOWN_POSITIONS.includes(position as any)) {
    errors.push({
      line: block.lineStart,
      field: 'position',
      message: `Unknown position: "${position}". Known positions: ${KNOWN_POSITIONS.join(', ')}`,
      code: 'UNKNOWN_POSITION',
    });
  }

  // Validate style if provided (normalize aliases first)
  const normalizedStyle = normalizeStyle(block.fields.style);
  if (block.fields.style && normalizedStyle && !KNOWN_VISUAL_STYLES.includes(normalizedStyle as any)) {
    errors.push({
      line: block.lineStart,
      field: 'style',
      message: `Unknown style: "${block.fields.style}". Known styles: ${KNOWN_VISUAL_STYLES.join(', ')}`,
      code: 'UNKNOWN_STYLE',
    });
  }

  // Validate motion if provided
  const motion = block.fields.motion;
  if (motion && !KNOWN_ANIMATION_MOTIONS.includes(motion.toLowerCase() as any)) {
    errors.push({
      line: block.lineStart,
      field: 'motion',
      message: `Unknown motion: "${motion}". Known motions: ${KNOWN_ANIMATION_MOTIONS.join(', ')}`,
      code: 'UNKNOWN_MOTION',
    });
  }

  return errors;
}

// ── Position → Coordinates ──────────────────────────────────────

function positionToCoordinates(
  position: string | undefined,
  canvasWidth: number,
  canvasHeight: number
): { x: number; y: number } {
  switch (position) {
    case 'top_left': return { x: canvasWidth * 0.15, y: canvasHeight * 0.15 };
    case 'top_right': return { x: canvasWidth * 0.85, y: canvasHeight * 0.15 };
    case 'bottom_left': return { x: canvasWidth * 0.15, y: canvasHeight * 0.85 };
    case 'bottom_right': return { x: canvasWidth * 0.85, y: canvasHeight * 0.85 };
    case 'top': return { x: canvasWidth / 2, y: canvasHeight * 0.15 };
    case 'bottom': return { x: canvasWidth / 2, y: canvasHeight * 0.85 };
    case 'left': return { x: canvasWidth * 0.15, y: canvasHeight / 2 };
    case 'right': return { x: canvasWidth * 0.85, y: canvasHeight / 2 };
    case 'center':
    default:
      return { x: canvasWidth / 2, y: canvasHeight / 2 };
  }
}

// ── Component Block → MotionComponent ───────────────────────────

function blockToComponent(
  block: ParsedComponentBlock,
  canvasWidth: number,
  canvasHeight: number,
  index: number,
  runningStart: number
): MotionComponent {
  const duration = parseFloat(block.fields.duration) || 3;
  const start = parseFloat(block.fields.start) || runningStart;

  const position = block.fields.position;
  const coords = positionToCoordinates(position, canvasWidth, canvasHeight);

  // Map style to MotionStyle (normalize aliases)
  const rawStyle = normalizeStyle(block.fields.style) || 'documentary';
  // The style field may contain an animation motion value (e.g., "slideUp")
  // If so, use it as the motion; otherwise check the dedicated motion field
  const isAnimationMotion = KNOWN_ANIMATION_MOTIONS.includes(rawStyle as any);
  const visualStyle = isAnimationMotion ? 'documentary' : rawStyle;
  const motionStyle = block.fields.motion?.toLowerCase() || (isAnimationMotion ? rawStyle : undefined);

  switch (block.type) {
    case 'statistic': {
      return {
        type: 'statistic',
        id: uuidv4(),
        data: {
          value: block.fields.text || '0',
          label: block.fields.label || '',
          unit: block.fields.unit || undefined,
          source: block.fields.source || undefined,
        },
        timing: { start, duration },
        style: {
          position: position || 'center',
          x: coords.x,
          y: coords.y,
          visual: visualStyle,
          ...(motionStyle ? { motion: motionStyle } : {}),
        },
      };
    }
    default:
      throw new Error(`Unknown component type: ${block.type}`);
  }
}

// ── Main Parse Function ─────────────────────────────────────────

export interface ParseOptions {
  canvasWidth: number;
  canvasHeight: number;
  defaultDuration?: number;
  defaultStyle?: string;
}

export interface ParseResult {
  success: boolean;
  plan?: MotionPlanV1;
  operations: ParsedOperationBlock[];
  errors: ParseError[];
  rawResponse: string;
}

export function parseAIResponse(
  response: string,
  options: ParseOptions
): ParseResult {
  const { canvasWidth, canvasHeight, defaultDuration = 5 } = options;

  // 1. Parse raw text into blocks
  const parsed = parseBlocks(response);

  // 2. If there are parse errors, return them
  if (parsed.parseErrors.length > 0) {
    return {
      success: false,
      operations: parsed.operations,
      errors: parsed.parseErrors,
      rawResponse: response,
    };
  }

  // 2b. Check for empty response (no components)
  if (parsed.components.length === 0) {
    return {
      success: false,
      operations: parsed.operations,
      errors: [
        {
          line: 0,
          message: 'No valid components found in response.',
          code: 'EMPTY_RESPONSE',
        },
      ],
      rawResponse: response,
    };
  }

  // 3. Validate each component block
  const allErrors: ParseError[] = [];
  for (const block of parsed.components) {
    const errors = validateComponent(block, canvasWidth, canvasHeight);
    allErrors.push(...errors);
  }

  if (allErrors.length > 0) {
    return {
      success: false,
      operations: parsed.operations,
      errors: allErrors,
      rawResponse: response,
    };
  }

  // 4. Convert blocks to MotionComponents
  const components: MotionComponent[] = [];
  let runningStart = 0;

  for (let i = 0; i < parsed.components.length; i++) {
    const block = parsed.components[i];
    try {
      const comp = blockToComponent(block, canvasWidth, canvasHeight, i, runningStart);
      components.push(comp);
      runningStart = comp.timing.start + comp.timing.duration;
    } catch (err) {
      allErrors.push({
        line: block.lineStart,
        field: 'type',
        message: err instanceof Error ? err.message : 'Failed to convert component',
        code: 'CONVERSION_FAILED',
      });
    }
  }

  if (allErrors.length > 0) {
    return {
      success: false,
      operations: parsed.operations,
      errors: allErrors,
      rawResponse: response,
    };
  }

  // 5. Build MotionPlanV1
  const totalDuration = Math.max(
    defaultDuration,
    ...components.map((c) => c.timing.start + c.timing.duration)
  );

  const plan: MotionPlanV1 = {
    version: MOTION_PLAN_VERSION,
    metadata: {
      name: 'AI Generated Motion Plan',
      description: `Parsed from AI response (${components.length} components)`,
      createdAt: new Date().toISOString(),
    },
    canvas: { width: canvasWidth, height: canvasHeight },
    duration: totalDuration,
    style: {
      visual: 'documentary',
      motion: 'subtle',
    },
    components,
  };

  return {
    success: true,
    plan,
    operations: parsed.operations,
    errors: [],
    rawResponse: response,
  };
}
