/**
 * MotionPlanV1 — Versioned documentary motion plan.
 *
 * Describes WHAT should happen. Contains NO executable code.
 * AI generates this as structured data only.
 */

export const MOTION_PLAN_VERSION = 1 as const;

export type MotionComponentType = 'statistic';

export interface MotionCanvas {
  width: number;
  height: number;
}

export interface MotionStyle {
  visual: 'documentary' | 'minimal' | 'bold';
  motion: 'subtle' | 'moderate' | 'energetic';
}

export interface MotionTiming {
  start: number;
  duration: number;
}

export interface MotionStatisticData {
  value: string;
  label: string;
  unit?: string;
  source?: string;
  fontSize?: number;
  fontWeight?: string;
  color?: string;
}

export type MotionComponentData = MotionStatisticData;

export interface MotionComponent {
  type: MotionComponentType;
  id?: string;
  data: MotionComponentData;
  timing: MotionTiming;
  style?: Record<string, string | number | boolean>;
}

export interface MotionPlanMetadata {
  name: string;
  description?: string;
  createdAt?: string;
}

export interface MotionPlanV1 {
  version: typeof MOTION_PLAN_VERSION;
  metadata: MotionPlanMetadata;
  canvas: MotionCanvas;
  duration: number;
  style: MotionStyle;
  components: MotionComponent[];
}

/**
 * MotionRequestV1 — Versioned request envelope for the Motion Gateway.
 */
export const MOTION_REQUEST_VERSION = 1 as const;

export type MotionOperation =
  | 'getCapabilities'
  | 'getComponents'
  | 'validatePlan'
  | 'createPlan'
  | 'previewPlan'
  | 'compilePlan'
  | 'addToTimeline';

export interface MotionRequestV1 {
  version: typeof MOTION_REQUEST_VERSION;
  operation: MotionOperation;
  requestId: string;
  plan?: MotionPlanV1;
  options?: Record<string, unknown>;
}

export type MotionResponseStatus = 'success' | 'error';

export interface MotionResponseV1 {
  version: typeof MOTION_REQUEST_VERSION;
  requestId: string;
  status: MotionResponseStatus;
  operation: MotionOperation;
  data?: unknown;
  error?: string;
  errors?: string[];
}
