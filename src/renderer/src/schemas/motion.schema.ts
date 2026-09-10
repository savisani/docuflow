import { z } from 'zod';
import { MOTION_PLAN_VERSION, MOTION_REQUEST_VERSION } from '../engine/motion/types';
import { MOTION_LIMITS } from '../engine/motion/validator';

/**
 * Zod schema for MotionPlanV1 — used for serialization and IPC validation.
 */

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
  label: z.string().min(1).max(MOTION_LIMITS.MAX_TEXT_LENGTH),
  unit: z.string().max(MOTION_LIMITS.MAX_TEXT_LENGTH).optional(),
  source: z.string().max(MOTION_LIMITS.MAX_TEXT_LENGTH).optional(),
});

const MotionTitleCardDataSchema = z.object({
  title: z.string().min(1).max(MOTION_LIMITS.MAX_TEXT_LENGTH),
  subtitle: z.string().min(1).max(MOTION_LIMITS.MAX_TEXT_LENGTH).optional(),
});

const MotionComponentDataSchema: z.ZodType<any> = z.lazy(() =>
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

/**
 * Zod schema for MotionRequestV1 — validates the request envelope.
 */
export const MotionRequestSchema = z.object({
  version: z.literal(MOTION_REQUEST_VERSION),
  operation: z.enum([
    'getCapabilities',
    'getComponents',
    'validatePlan',
    'createPlan',
    'previewPlan',
    'compilePlan',
    'addToTimeline',
  ]),
  requestId: z.string().min(1),
  plan: MotionPlanSchema.optional(),
  options: z.record(z.unknown()).optional(),
});

export type MotionRequestInput = z.infer<typeof MotionRequestSchema>;
