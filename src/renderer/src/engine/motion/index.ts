// Types
export type {
  MotionPlanV1,
  MotionComponent,
  MotionComponentType,
  MotionComponentData,
  MotionStatisticData,
  MotionCanvas,
  MotionStyle,
  MotionTiming,
  MotionPlanMetadata,
  MotionRequestV1,
  MotionResponseV1,
  MotionOperation,
  MotionResponseStatus,
} from './types';

export { MOTION_PLAN_VERSION, MOTION_REQUEST_VERSION } from './types';

// Validator
export {
  validateMotionPlan,
  validateMotionRequest,
  MotionPlanSchema,
  MOTION_LIMITS,
  type MotionValidationResult,
  type MotionValidationError,
  type MotionPlanInput,
} from './validator';

// Capabilities
export {
  getCapabilities,
  isCapabilityAllowed,
  getCapability,
  type MotionCapability,
  type MotionCapabilityInfo,
} from './capabilities';

// Gateway
export { processMotionRequest } from './gateway';

// Component Registry
export { ComponentRegistry } from './components/registry';

// Compiler interface
export type { ComponentCompiler } from './components/compiler';
