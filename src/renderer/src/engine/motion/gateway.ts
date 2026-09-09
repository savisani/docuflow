import { v4 as uuidv4 } from 'uuid';
import type { Command } from '../commands/types';
import type {
  MotionPlanV1,
  MotionRequestV1,
  MotionResponseV1,
  MotionOperation,
} from './types';
import { MOTION_REQUEST_VERSION } from './types';
import {
  validateMotionPlan,
  validateMotionRequest,
  MOTION_LIMITS,
} from './validator';
import {
  getCapabilities,
  isCapabilityAllowed,
  type MotionCapability,
} from './capabilities';
import { ComponentRegistry } from './components/registry';

/**
 * Motion Gateway — the ONLY entry point for AI-generated motion requests.
 *
 * Exposes ONLY explicitly supported operations.
 * No generic execute/run/shell/filesystem/system/process.
 * No eval, Function, child_process, arbitrary IPC.
 *
 * AI can REQUEST → DocuFlow VALIDATES → DocuFlow COMPILES → DocuFlow EXECUTES KNOWN COMMANDS.
 */

function createResponse(
  requestId: string,
  operation: MotionOperation,
  status: 'success' | 'error',
  data?: unknown,
  error?: string,
  errors?: string[]
): MotionResponseV1 {
  return {
    version: MOTION_REQUEST_VERSION,
    requestId,
    status,
    operation,
    data,
    error,
    errors,
  };
}

function compilePlan(plan: MotionPlanV1): Command[] {
  const allCommands: Command[] = [];

  for (let i = 0; i < plan.components.length; i++) {
    const component = plan.components[i];

    if (!ComponentRegistry.isRegistered(component.type)) {
      throw new Error(`Unknown component type: ${component.type}`);
    }

    const compiler = ComponentRegistry.get(component.type);
    if (!compiler) {
      throw new Error(`No compiler registered for component type: ${component.type}`);
    }

    // Validate component data
    const validationErrors = compiler.validate(
      component.data,
      plan.canvas.width,
      plan.canvas.height
    );
    if (validationErrors.length > 0) {
      throw new Error(
        `Component ${i} (${component.type}) validation failed: ${validationErrors.join(', ')}`
      );
    }

    // Compile component to commands
    const commands = compiler.compile(
      component,
      plan.canvas.width,
      plan.canvas.height
    );

    allCommands.push(...commands);

    // Enforce command limit
    if (allCommands.length > MOTION_LIMITS.MAX_COMMANDS) {
      throw new Error(
        `Plan exceeds maximum command limit of ${MOTION_LIMITS.MAX_COMMANDS}`
      );
    }
  }

  return allCommands;
}

/**
 * Process a MotionRequestV1 and return a MotionResponseV1.
 * This is the ONLY public API for the motion graphics system.
 */
export function processMotionRequest(request: unknown): MotionResponseV1 {
  // 1. Validate request envelope
  const reqValidation = validateMotionRequest(request);
  if (!reqValidation.valid) {
    return createResponse(
      (request as MotionRequestV1)?.requestId || 'unknown',
      ((request as MotionRequestV1)?.operation as MotionOperation) || 'getCapabilities',
      'error',
      undefined,
      'Invalid request',
      reqValidation.errors.map((e) => `${e.field}: ${e.message}`)
    );
  }

  const req = request as MotionRequestV1;

  // 2. Check capability
  const capabilityMap: Record<MotionOperation, MotionCapability> = {
    getCapabilities: 'motion.plan.create', // reading capabilities is always allowed
    getComponents: 'motion.component.list',
    validatePlan: 'motion.plan.validate',
    createPlan: 'motion.plan.create',
    previewPlan: 'motion.preview',
    compilePlan: 'motion.component.compile',
    addToTimeline: 'motion.timeline.add',
  };

  const requiredCapability = capabilityMap[req.operation];
  if (requiredCapability && !isCapabilityAllowed(requiredCapability)) {
    return createResponse(
      req.requestId,
      req.operation,
      'error',
      undefined,
      `Operation not allowed: ${req.operation}`
    );
  }

  // 3. Route to operation handler
  switch (req.operation) {
    case 'getCapabilities': {
      return createResponse(
        req.requestId,
        req.operation,
        'success',
        getCapabilities()
      );
    }

    case 'getComponents': {
      const types = ComponentRegistry.getRegisteredTypes();
      return createResponse(
        req.requestId,
        req.operation,
        'success',
        types.map((t) => ({ type: t }))
      );
    }

    case 'validatePlan': {
      if (!req.plan) {
        return createResponse(
          req.requestId,
          req.operation,
          'error',
          undefined,
          'Plan is required for validatePlan operation'
        );
      }
      const result = validateMotionPlan(req.plan);
      return createResponse(
        req.requestId,
        req.operation,
        result.valid ? 'success' : 'error',
        result,
        result.valid ? undefined : 'Validation failed',
        result.errors.map((e) => `${e.field}: ${e.message}`)
      );
    }

    case 'createPlan': {
      if (!req.plan) {
        return createResponse(
          req.requestId,
          req.operation,
          'error',
          undefined,
          'Plan is required for createPlan operation'
        );
      }
      const planResult = validateMotionPlan(req.plan);
      if (!planResult.valid) {
        return createResponse(
          req.requestId,
          req.operation,
          'error',
          planResult,
          'Plan validation failed',
          planResult.errors.map((e) => `${e.field}: ${e.message}`)
        );
      }
      return createResponse(
        req.requestId,
        req.operation,
        'success',
        req.plan
      );
    }

    case 'compilePlan': {
      if (!req.plan) {
        return createResponse(
          req.requestId,
          req.operation,
          'error',
          undefined,
          'Plan is required for compilePlan operation'
        );
      }

      // Validate plan first
      const compileValidation = validateMotionPlan(req.plan);
      if (!compileValidation.valid) {
        return createResponse(
          req.requestId,
          req.operation,
          'error',
          compileValidation,
          'Plan validation failed before compilation',
          compileValidation.errors.map((e) => `${e.field}: ${e.message}`)
        );
      }

      try {
        const commands = compilePlan(req.plan);
        return createResponse(
          req.requestId,
          req.operation,
          'success',
          { commands, commandCount: commands.length }
        );
      } catch (err) {
        return createResponse(
          req.requestId,
          req.operation,
          'error',
          undefined,
          err instanceof Error ? err.message : 'Compilation failed'
        );
      }
    }

    case 'previewPlan':
    case 'timeline.preview':
    case 'addToTimeline': {
      // These operations require the store context — handled by the UI layer
      return createResponse(
        req.requestId,
        req.operation,
        'success',
        { message: `Operation ${req.operation} accepted — requires store context` }
      );
    }

    default: {
      return createResponse(
        req.requestId,
        req.operation,
        'error',
        undefined,
        `Unknown operation: ${req.operation}`
      );
    }
  }
}
