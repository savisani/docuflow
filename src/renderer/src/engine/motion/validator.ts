import { z } from 'zod';
import type { MotionPlanV1, MotionComponent, MotionComponentData } from './types';
import { MOTION_PLAN_VERSION } from './types';

/**
 * Resource limits — fail-closed defaults.
 * AI-generated plans must stay within these bounds.
 */
export const MOTION_LIMITS = {
  MAX_COMPONENTS: 100,
  MAX_COMMANDS: 1000,
  MAX_TEXT_LENGTH: 500,
  MAX_DURATION: 300, // 5 minutes
  MAX_NESTING_DEPTH: 3,
  MAX_ASSET_REFERENCES: 50,
  MAX_CANVAS_WIDTH: 7680,
  MAX_CANVAS_HEIGHT: 4320,
  MIN_CANVAS_WIDTH: 320,
  MIN_CANVAS_HEIGHT: 180,
  MAX_KEYFRAMES: 500,
  MAX_COMPONENT_DATA_FIELDS: 20,
} as const;

// ── Zod Schemas ─────────────────────────────────────────────────

const MotionTimingSchema = z.object({
  start: z.number().min(0).max(MOTION_LIMITS.MAX_DURATION),
  duration: z.number().min(0.1).max(MOTION_LIMITS.MAX_DURATION),
});

const MotionCanvasSchema = z.object({
  width: z.number().int().min(MOTION_LIMITS.MIN_CANVAS_WIDTH).max(MOTION_LIMITS.MAX_CANVAS_WIDTH),
  height: z.number().int().min(MOTION_LIMITS.MIN_CANVAS_HEIGHT).max(MOTION_LIMITS.MAX_CANVAS_HEIGHT),
});

const MotionStyleSchema = z.object({
  visual: z.enum(['documentary', 'minimal', 'bold']),
  motion: z.enum(['subtle', 'moderate', 'energetic']),
});

const MotionStatisticDataSchema = z.object({
  value: z.string().min(1).max(MOTION_LIMITS.MAX_TEXT_LENGTH),
  label: z.string().max(MOTION_LIMITS.MAX_TEXT_LENGTH).optional(),
  unit: z.string().max(MOTION_LIMITS.MAX_TEXT_LENGTH).optional(),
  source: z.string().max(MOTION_LIMITS.MAX_TEXT_LENGTH).optional(),
  fontSize: z.number().min(24).max(200).optional(),
  fontWeight: z.enum(['normal', 'medium', 'semibold', 'bold']).optional(),
  color: z.string().regex(/^#[0-9A-Fa-f]{6}$/).optional(),
});

const MotionTitleCardDataSchema = z.object({
  title: z.string().min(1).max(MOTION_LIMITS.MAX_TEXT_LENGTH),
  subtitle: z.string().min(1).max(MOTION_LIMITS.MAX_TEXT_LENGTH).optional(),
  fontSize: z.number().min(24).max(200).optional(),
  fontWeight: z.enum(['normal', 'medium', 'semibold', 'bold']).optional(),
  color: z.string().regex(/^#[0-9A-Fa-f]{6}$/).optional(),
});

const MotionComponentDataSchema: z.ZodType<MotionComponentData> = z.lazy(() =>
  z.union([MotionStatisticDataSchema, MotionTitleCardDataSchema])
);

const MotionComponentSchema = z.object({
  type: z.enum(['statistic', 'titlecard']),
  id: z.string().max(100).optional(),
  data: MotionComponentDataSchema,
  timing: MotionTimingSchema,
  style: z.record(z.union([z.string(), z.number(), z.boolean()])).optional(),
});

const MotionPlanMetadataSchema = z.object({
  name: z.string().min(1).max(200),
  description: z.string().max(1000).optional(),
  createdAt: z.string().max(50).optional(),
});

export const MotionPlanSchema = z.object({
  version: z.literal(MOTION_PLAN_VERSION),
  metadata: MotionPlanMetadataSchema,
  canvas: MotionCanvasSchema,
  duration: z.number().min(0.1).max(MOTION_LIMITS.MAX_DURATION),
  style: MotionStyleSchema,
  components: z.array(MotionComponentSchema).max(MOTION_LIMITS.MAX_COMPONENTS),
});

export type MotionPlanInput = z.infer<typeof MotionPlanSchema>;

// ── Validation Result ───────────────────────────────────────────

export interface MotionValidationResult {
  valid: boolean;
  errors: MotionValidationError[];
}

export interface MotionValidationError {
  field: string;
  message: string;
  code: string;
}

// ── Validation Functions ────────────────────────────────────────

export function validateMotionPlan(plan: unknown): MotionValidationResult {
  const errors: MotionValidationError[] = [];

  // 1. Schema validation
  const result = MotionPlanSchema.safeParse(plan);
  if (!result.success) {
    for (const issue of result.error.issues) {
      errors.push({
        field: issue.path.join('.'),
        message: issue.message,
        code: issue.code,
      });
    }
    return { valid: false, errors };
  }

  const validatedPlan = result.data;

  // 2. Semantic validation
  // Check component timing doesn't exceed plan duration
  for (let i = 0; i < validatedPlan.components.length; i++) {
    const comp = validatedPlan.components[i];
    const compEnd = comp.timing.start + comp.timing.duration;
    if (compEnd > validatedPlan.duration + 0.1) {
      errors.push({
        field: `components[${i}].timing`,
        message: `Component ${i} ends at ${compEnd}s but plan duration is ${validatedPlan.duration}s`,
        code: 'TIMING_EXCEEDS_DURATION',
      });
    }
  }

  // Check for overlapping component IDs
  const ids = validatedPlan.components
    .map((c) => c.id)
    .filter((id): id is string => id !== undefined);
  const uniqueIds = new Set(ids);
  if (ids.length !== uniqueIds.size) {
    errors.push({
      field: 'components',
      message: 'Duplicate component IDs found',
      code: 'DUPLICATE_IDS',
    });
  }

  // 3. Suspicious content detection (data-only, no execution)
  const planStr = JSON.stringify(validatedPlan);
  const suspiciousPatterns = [
    /\beval\b/i,
    /\bFunction\s*\(/i,
    /\bchild_process\b/i,
    /\brequire\s*\(\s*['"]child_process['"]\s*\)/i,
    /\bspawn\b/i,
    /\bexec\s*\(/i,
    /\bexecSync\b/i,
    /\bshell\b/i,
    /\bpowershell\b/i,
    /\bcmd\.exe\b/i,
    /\bpython\b/i,
    /\bsystem\s*\(/i,
    /\bprocess\.\w+/i,
    /\bwindow\.\w+\s*=/i,
    /\bdocument\.\w+/i,
    /<script/i,
    /javascript:/i,
  ];

  for (const pattern of suspiciousPatterns) {
    if (pattern.test(planStr)) {
      // Check if it's in a data field (text content) vs structure
      // Only flag if it appears in structural fields, not user text
      const structuralFields = ['type', 'version', 'operation', 'name'];
      for (const field of structuralFields) {
        const fieldPattern = new RegExp(`"${field}"\\s*:\\s*"[^"]*${pattern.source}[^"]*"`, 'i');
        if (fieldPattern.test(planStr)) {
          errors.push({
            field,
            message: `Suspicious pattern detected in field "${field}": ${pattern.source}`,
            code: 'SUSPICIOUS_CONTENT',
          });
        }
      }
    }
  }

  return { valid: errors.length === 0, errors };
}

export function validateMotionRequest(request: unknown): MotionValidationResult {
  const errors: MotionValidationError[] = [];

  if (typeof request !== 'object' || request === null) {
    return { valid: false, errors: [{ field: 'request', message: 'Request must be an object', code: 'INVALID_TYPE' }] };
  }

  const req = request as Record<string, unknown>;

  if (req.version !== MOTION_PLAN_VERSION) {
    errors.push({ field: 'version', message: `Invalid version: ${req.version}`, code: 'INVALID_VERSION' });
  }

  const validOperations = [
    'getCapabilities', 'getComponents', 'validatePlan', 'createPlan',
    'previewPlan', 'compilePlan', 'addToTimeline',
  ];

  if (typeof req.operation !== 'string' || !validOperations.includes(req.operation)) {
    errors.push({ field: 'operation', message: `Unknown operation: ${req.operation}`, code: 'UNKNOWN_OPERATION' });
  }

  if (typeof req.requestId !== 'string' || req.requestId.length === 0) {
    errors.push({ field: 'requestId', message: 'requestId is required', code: 'MISSING_REQUEST_ID' });
  }

  return { valid: errors.length === 0, errors };
}
