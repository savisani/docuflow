import { KNOWN_OPERATIONS, type ParsedOperationBlock, type ParseError } from './protocol';

/**
 * Motion Director — Operation Policy
 *
 * Controls which operations the AI is allowed to request.
 *
 * Rules:
 * - ADD: Allowed (creates new components)
 * - UPDATE: Allowed only with valid stable target ID
 * - REMOVE: ALWAYS blocked — requires explicit user confirmation
 * - Unknown operations: Rejected
 *
 * REMOVE is never executed automatically. It is represented as a
 * pending operation that requires explicit user confirmation.
 */

// ── Operation Types ─────────────────────────────────────────────

export type OperationStatus = 'pending' | 'confirmed' | 'rejected' | 'blocked';

export interface MotionOperation {
  type: 'add' | 'update' | 'remove';
  targetId?: string;
  reason?: string;
  confirmRequired: boolean;
  status: OperationStatus;
  component?: import('./protocol').ParsedComponentBlock;
}

// ── Operation Validation ────────────────────────────────────────

export function validateOperation(
  op: ParsedOperationBlock,
  existingComponentIds: string[]
): { valid: boolean; operation?: MotionOperation; errors: ParseError[] } {
  const errors: ParseError[] = [];

  // Check known operation type
  if (!KNOWN_OPERATIONS.includes(op.operation as any)) {
    return {
      valid: false,
      errors: [{
        line: op.lineStart,
        field: 'operation',
        message: `Unknown operation: "${op.operation}". Known operations: ${KNOWN_OPERATIONS.join(', ')}`,
        code: 'UNKNOWN_OPERATION',
      }],
    };
  }

  const operation = op.operation as 'add' | 'update' | 'remove';

  switch (operation) {
    case 'add': {
      return {
        valid: true,
        operation: {
          type: 'add',
          reason: op.reason,
          confirmRequired: false,
          status: 'pending',
          component: op.component,
        },
        errors: [],
      };
    }

    case 'update': {
      // UPDATE requires a valid target ID
      if (!op.targetId) {
        return {
          valid: false,
          errors: [{
            line: op.lineStart,
            field: 'target',
            message: 'UPDATE operation requires a TARGET field with a stable component ID',
            code: 'MISSING_TARGET',
          }],
        };
      }

      // Check that the target exists
      if (!existingComponentIds.includes(op.targetId)) {
        return {
          valid: false,
          errors: [{
            line: op.lineStart,
            field: 'target',
            message: `Target component not found: "${op.targetId}". Existing IDs: ${existingComponentIds.join(', ')}`,
            code: 'TARGET_NOT_FOUND',
          }],
        };
      }

      return {
        valid: true,
        operation: {
          type: 'update',
          targetId: op.targetId,
          reason: op.reason,
          confirmRequired: false,
          status: 'pending',
          component: op.component,
        },
        errors: [],
      };
    }

    case 'remove': {
      // REMOVE ALWAYS requires confirmation — never automatic
      if (!op.targetId) {
        return {
          valid: false,
          errors: [{
            line: op.lineStart,
            field: 'target',
            message: 'REMOVE operation requires a TARGET field with a stable component ID',
            code: 'MISSING_TARGET',
          }],
        };
      }

      // Check that the target exists
      if (!existingComponentIds.includes(op.targetId)) {
        return {
          valid: false,
          errors: [{
            line: op.lineStart,
            field: 'target',
            message: `Target component not found: "${op.targetId}". Existing IDs: ${existingComponentIds.join(', ')}`,
            code: 'TARGET_NOT_FOUND',
          }],
        };
      }

      // REMOVE is ALWAYS blocked — requires user confirmation
      return {
        valid: true,
        operation: {
          type: 'remove',
          targetId: op.targetId,
          reason: op.reason,
          confirmRequired: true,
          status: 'blocked',
        },
        errors: [],
      };
    }

    default: {
      return {
        valid: false,
        errors: [{
          line: op.lineStart,
          field: 'operation',
          message: `Unhandled operation: "${operation}"`,
          code: 'UNHANDLED_OPERATION',
        }],
      };
    }
  }
}

// ── Process All Operations ──────────────────────────────────────

export interface OperationResult {
  operations: MotionOperation[];
  blocked: MotionOperation[];
  errors: ParseError[];
}

export function processOperations(
  operations: ParsedOperationBlock[],
  existingComponentIds: string[]
): OperationResult {
  const result: OperationResult = {
    operations: [],
    blocked: [],
    errors: [],
  };

  for (const op of operations) {
    const validation = validateOperation(op, existingComponentIds);

    if (!validation.valid) {
      result.errors.push(...validation.errors);
      continue;
    }

    if (validation.operation) {
      if (validation.operation.status === 'blocked') {
        result.blocked.push(validation.operation);
      } else {
        result.operations.push(validation.operation);
      }
    }
  }

  return result;
}
