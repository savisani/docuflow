/**
 * Capability model for the Motion Gateway.
 *
 * Each operation has explicit name, input/output schemas, validation, and limits.
 * Unknown capabilities are REJECTED.
 */

export type MotionCapability =
  | 'motion.plan.create'
  | 'motion.plan.validate'
  | 'motion.component.list'
  | 'motion.component.compile'
  | 'motion.preview'
  | 'motion.timeline.preview'
  | 'motion.timeline.add';

export interface MotionCapabilityInfo {
  name: MotionCapability;
  description: string;
  inputType: string;
  outputType: string;
}

const CAPABILITIES: MotionCapabilityInfo[] = [
  {
    name: 'motion.plan.create',
    description: 'Create a new MotionPlan from structured data',
    inputType: 'MotionPlanV1',
    outputType: 'MotionPlanV1',
  },
  {
    name: 'motion.plan.validate',
    description: 'Validate a MotionPlan against schemas and resource limits',
    inputType: 'MotionPlanV1',
    outputType: 'ValidationResult',
  },
  {
    name: 'motion.component.list',
    description: 'List available motion components',
    inputType: 'void',
    outputType: 'ComponentInfo[]',
  },
  {
    name: 'motion.component.compile',
    description: 'Compile a motion component into DocuFlow commands',
    inputType: 'MotionComponent',
    outputType: 'Command[]',
  },
  {
    name: 'motion.preview',
    description: 'Preview a motion plan in the video preview',
    inputType: 'MotionPlanV1',
    outputType: 'void',
  },
  {
    name: 'motion.timeline.preview',
    description: 'Preview the timeline state after compilation',
    inputType: 'MotionPlanV1',
    outputType: 'TimelinePreview',
  },
  {
    name: 'motion.timeline.add',
    description: 'Add compiled commands to the timeline',
    inputType: 'MotionPlanV1',
    outputType: 'Command[]',
  },
];

export function getCapabilities(): MotionCapabilityInfo[] {
  return [...CAPABILITIES];
}

export function isCapabilityAllowed(capability: string): boolean {
  return CAPABILITIES.some((c) => c.name === capability);
}

export function getCapability(name: string): MotionCapabilityInfo | undefined {
  return CAPABILITIES.find((c) => c.name === name);
}
