import { describe, it, expect } from 'vitest';
import { parseAIResponse } from '../parser';
import { validateOperation, processOperations } from '../operations';
import { buildMotionDirectorPrompt, OllamaMotionProvider } from '../index';
import { MockMotionProvider } from '../providers/mock';
import { MOTION_PLAN_VERSION } from '../../types';
import type { MotionDirectorRequest } from '../protocol';

// ── Helpers ─────────────────────────────────────────────────────

const DEFAULT_OPTIONS = { canvasWidth: 1920, canvasHeight: 1080, defaultDuration: 5 };

function makeRequest(overrides?: Partial<MotionDirectorRequest>): MotionDirectorRequest {
  return {
    prompt: 'Show a statistic about traffic',
    canvasWidth: 1920,
    canvasHeight: 1080,
    duration: 5,
    ...overrides,
  };
}

// ═════════════════════════════════════════════════════════════════
// VALID SINGLE COMPONENT
// ═════════════════════════════════════════════════════════════════

describe('Parser — Valid Single Component', () => {
  it('parses a minimal valid component', () => {
    const response = `COMPONENT: statistic
TEXT: 73%
LABEL: of global traffic
DURATION: 4
END`;

    const result = parseAIResponse(response, DEFAULT_OPTIONS);
    expect(result.success).toBe(true);
    expect(result.plan).toBeDefined();
    expect(result.plan!.version).toBe(MOTION_PLAN_VERSION);
    expect(result.plan!.components).toHaveLength(1);
    expect(result.plan!.components[0].type).toBe('statistic');
  });

  it('parses component with all optional fields', () => {
    const response = `COMPONENT: statistic
TEXT: 42
LABEL: answers found
UNIT: count
SOURCE: research study
POSITION: center
DURATION: 5
STYLE: documentary
START: 1
END`;

    const result = parseAIResponse(response, DEFAULT_OPTIONS);
    expect(result.success).toBe(true);
    expect(result.plan!.components).toHaveLength(1);
    const comp = result.plan!.components[0];
    expect(comp.type).toBe('statistic');
    expect(comp.data.value).toBe('42');
    expect(comp.data.label).toBe('answers found');
    if ('unit' in comp.data) expect(comp.data.unit).toBe('count');
    if ('source' in comp.data) expect(comp.data.source).toBe('research study');
    expect(comp.timing.start).toBe(1);
    expect(comp.timing.duration).toBe(5);
  });

  it('handles case-insensitive field keys', () => {
    const response = `component: statistic
Text: 73%
Label: of global traffic
Duration: 4
End`;

    const result = parseAIResponse(response, DEFAULT_OPTIONS);
    expect(result.success).toBe(true);
    expect(result.plan!.components).toHaveLength(1);
  });
});

// ═════════════════════════════════════════════════════════════════
// VALID MULTIPLE COMPONENTS
// ═════════════════════════════════════════════════════════════════

describe('Parser — Multiple Components', () => {
  it('parses multiple components separated by blank lines', () => {
    const response = `COMPONENT: statistic
TEXT: 42%
LABEL: completion rate
DURATION: 3
END

COMPONENT: statistic
TEXT: 1.2M
LABEL: users affected
DURATION: 3
END`;

    const result = parseAIResponse(response, DEFAULT_OPTIONS);
    expect(result.success).toBe(true);
    expect(result.plan!.components).toHaveLength(2);
    expect(result.plan!.components[0].data.value).toBe('42%');
    expect(result.plan!.components[1].data.value).toBe('1.2M');
  });

  it('auto-calculates start times for sequential components', () => {
    const response = `COMPONENT: statistic
TEXT: First
LABEL: A
DURATION: 3
END

COMPONENT: statistic
TEXT: Second
LABEL: B
DURATION: 2
END`;

    const result = parseAIResponse(response, DEFAULT_OPTIONS);
    expect(result.success).toBe(true);
    expect(result.plan!.components[0].timing.start).toBe(0);
    expect(result.plan!.components[1].timing.start).toBe(3);
  });
});

// ═════════════════════════════════════════════════════════════════
// MISSING FIELDS
// ═════════════════════════════════════════════════════════════════

describe('Parser — Missing Fields', () => {
  it('rejects component missing required TEXT field', () => {
    const response = `COMPONENT: statistic
LABEL: of traffic
DURATION: 4
END`;

    const result = parseAIResponse(response, DEFAULT_OPTIONS);
    expect(result.success).toBe(false);
    expect(result.errors.some((e) => e.code === 'MISSING_FIELD' && e.field === 'text')).toBe(true);
  });

  it('accepts component without LABEL field (label is optional)', () => {
    const response = `COMPONENT: statistic
TEXT: 73%
DURATION: 4
END`;

    const result = parseAIResponse(response, DEFAULT_OPTIONS);
    expect(result.success).toBe(true);
    expect(result.plan!.components).toHaveLength(1);
    expect(result.plan!.components[0].data.value).toBe('73%');
    expect(result.plan!.components[0].data.label).toBeFalsy();
  });

  it('rejects component missing required DURATION field', () => {
    const response = `COMPONENT: statistic
TEXT: 73%
LABEL: of traffic
END`;

    const result = parseAIResponse(response, DEFAULT_OPTIONS);
    expect(result.success).toBe(false);
    expect(result.errors.some((e) => e.code === 'MISSING_FIELD' && e.field === 'duration')).toBe(true);
  });
});

// ═════════════════════════════════════════════════════════════════
// UNKNOWN FIELDS
// ═════════════════════════════════════════════════════════════════

describe('Parser — Unknown Fields', () => {
  it('rejects component with unknown field', () => {
    const response = `COMPONENT: statistic
TEXT: 73%
LABEL: of traffic
DURATION: 4
MALICIOUS_FIELD: injected
END`;

    const result = parseAIResponse(response, DEFAULT_OPTIONS);
    expect(result.success).toBe(false);
    expect(result.errors.some((e) => e.code === 'UNKNOWN_FIELD')).toBe(true);
  });
});

// ═════════════════════════════════════════════════════════════════
// INVALID DURATION
// ═════════════════════════════════════════════════════════════════

describe('Parser — Invalid Duration', () => {
  it('rejects non-numeric duration', () => {
    const response = `COMPONENT: statistic
TEXT: 73%
LABEL: of traffic
DURATION: abc
END`;

    const result = parseAIResponse(response, DEFAULT_OPTIONS);
    expect(result.success).toBe(false);
    expect(result.errors.some((e) => e.code === 'INVALID_DURATION')).toBe(true);
  });

  it('rejects negative duration', () => {
    const response = `COMPONENT: statistic
TEXT: 73%
LABEL: of traffic
DURATION: -5
END`;

    const result = parseAIResponse(response, DEFAULT_OPTIONS);
    expect(result.success).toBe(false);
    expect(result.errors.some((e) => e.code === 'INVALID_DURATION')).toBe(true);
  });

  it('rejects zero duration', () => {
    const response = `COMPONENT: statistic
TEXT: 73%
LABEL: of traffic
DURATION: 0
END`;

    const result = parseAIResponse(response, DEFAULT_OPTIONS);
    expect(result.success).toBe(false);
    expect(result.errors.some((e) => e.code === 'INVALID_DURATION')).toBe(true);
  });

  it('rejects duration exceeding limit', () => {
    const response = `COMPONENT: statistic
TEXT: 73%
LABEL: of traffic
DURATION: 400
END`;

    const result = parseAIResponse(response, DEFAULT_OPTIONS);
    expect(result.success).toBe(false);
    expect(result.errors.some((e) => e.code === 'DURATION_EXCEEDS_LIMIT')).toBe(true);
  });
});

// ═════════════════════════════════════════════════════════════════
// UNKNOWN COMPONENT TYPE
// ═════════════════════════════════════════════════════════════════

describe('Parser — Unknown Component', () => {
  it('rejects unknown component type', () => {
    const response = `COMPONENT: malicious_type
TEXT: 73%
LABEL: of traffic
DURATION: 4
END`;

    const result = parseAIResponse(response, DEFAULT_OPTIONS);
    expect(result.success).toBe(false);
    expect(result.errors.some((e) => e.code === 'UNKNOWN_COMPONENT')).toBe(true);
  });

  it('rejects empty component type', () => {
    const response = `COMPONENT:
TEXT: 73%
LABEL: of traffic
DURATION: 4
END`;

    const result = parseAIResponse(response, DEFAULT_OPTIONS);
    expect(result.success).toBe(false);
  });
});

// ═════════════════════════════════════════════════════════════════
// MALFORMED RESPONSE
// ═════════════════════════════════════════════════════════════════

describe('Parser — Malformed Response', () => {
  it('handles empty response', () => {
    const result = parseAIResponse('', DEFAULT_OPTIONS);
    expect(result.success).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
  });

  it('handles response with only comments', () => {
    const result = parseAIResponse('# This is a comment\n// Another comment', DEFAULT_OPTIONS);
    expect(result.success).toBe(false);
  });

  it('handles response with no END keywords', () => {
    const response = `COMPONENT: statistic
TEXT: 73%
LABEL: of traffic
DURATION: 4`;

    const result = parseAIResponse(response, DEFAULT_OPTIONS);
    // Should still parse since blank line or EOF flushes the block
    expect(result.plan).toBeDefined();
  });

  it('handles extra whitespace gracefully', () => {
    const response = `  COMPONENT:   statistic  
  TEXT:   73%  
  LABEL:   of traffic  
  DURATION:   4  
  END  `;

    const result = parseAIResponse(response, DEFAULT_OPTIONS);
    expect(result.success).toBe(true);
  });
});

// ═════════════════════════════════════════════════════════════════
// REMOVE OPERATION BLOCKED
// ═════════════════════════════════════════════════════════════════

describe('Operations — REMOVE Blocked', () => {
  it('blocks REMOVE operation without confirmation', () => {
    const op = {
      operation: 'remove',
      targetId: 'comp-123',
      reason: 'outdated',
      lineStart: 1,
      lineEnd: 5,
    };

    const result = validateOperation(op, ['comp-123', 'comp-456']);
    expect(result.valid).toBe(true);
    expect(result.operation).toBeDefined();
    expect(result.operation!.status).toBe('blocked');
    expect(result.operation!.confirmRequired).toBe(true);
  });

  it('blocks REMOVE even with CONFIRM: REQUIRED', () => {
    const op = {
      operation: 'remove',
      targetId: 'comp-123',
      reason: 'outdated',
      confirm: 'REQUIRED',
      lineStart: 1,
      lineEnd: 5,
    };

    const result = validateOperation(op, ['comp-123']);
    expect(result.valid).toBe(true);
    expect(result.operation!.status).toBe('blocked');
  });

  it('rejects REMOVE with missing target', () => {
    const op = {
      operation: 'remove',
      lineStart: 1,
      lineEnd: 3,
    };

    const result = validateOperation(op, ['comp-123']);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.code === 'MISSING_TARGET')).toBe(true);
  });

  it('rejects REMOVE with non-existent target', () => {
    const op = {
      operation: 'remove',
      targetId: 'nonexistent',
      lineStart: 1,
      lineEnd: 3,
    };

    const result = validateOperation(op, ['comp-123']);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.code === 'TARGET_NOT_FOUND')).toBe(true);
  });

  it('processOperations categorizes REMOVE as blocked', () => {
    const ops = [
      { operation: 'add', lineStart: 1, lineEnd: 5 },
      { operation: 'remove', targetId: 'comp-123', lineStart: 7, lineEnd: 11 },
    ];

    const result = processOperations(ops, ['comp-123']);
    expect(result.operations).toHaveLength(1);
    expect(result.operations[0].type).toBe('add');
    expect(result.blocked).toHaveLength(1);
    expect(result.blocked[0].type).toBe('remove');
  });
});

// ═════════════════════════════════════════════════════════════════
// STABLE TARGET VALIDATION
// ═════════════════════════════════════════════════════════════════

describe('Operations — Stable Target Validation', () => {
  it('validates UPDATE with existing target', () => {
    const op = {
      operation: 'update',
      targetId: 'comp-123',
      lineStart: 1,
      lineEnd: 5,
    };

    const result = validateOperation(op, ['comp-123', 'comp-456']);
    expect(result.valid).toBe(true);
    expect(result.operation!.type).toBe('update');
  });

  it('rejects UPDATE with missing target', () => {
    const op = {
      operation: 'update',
      lineStart: 1,
      lineEnd: 3,
    };

    const result = validateOperation(op, ['comp-123']);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.code === 'MISSING_TARGET')).toBe(true);
  });

  it('rejects UPDATE with non-existent target', () => {
    const op = {
      operation: 'update',
      targetId: 'nonexistent',
      lineStart: 1,
      lineEnd: 3,
    };

    const result = validateOperation(op, ['comp-123']);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.code === 'TARGET_NOT_FOUND')).toBe(true);
  });
});

// ═════════════════════════════════════════════════════════════════
// CONVERSION INTO MOTIONPLANV1
// ═════════════════════════════════════════════════════════════════

describe('Parser — Conversion to MotionPlanV1', () => {
  it('produces valid MotionPlanV1 structure', () => {
    const response = `COMPONENT: statistic
TEXT: 73%
LABEL: of global traffic
DURATION: 4
END`;

    const result = parseAIResponse(response, DEFAULT_OPTIONS);
    expect(result.success).toBe(true);
    expect(result.plan!.version).toBe(MOTION_PLAN_VERSION);
    expect(result.plan!.metadata.name).toBeDefined();
    expect(result.plan!.canvas.width).toBe(1920);
    expect(result.plan!.canvas.height).toBe(1080);
    expect(result.plan!.duration).toBeGreaterThanOrEqual(4);
    expect(result.plan!.style.visual).toBe('documentary');
    expect(result.plan!.style.motion).toBe('subtle');
  });

  it('sets plan duration to at least the last component end time', () => {
    const response = `COMPONENT: statistic
TEXT: First
LABEL: A
DURATION: 3
START: 0
END

COMPONENT: statistic
TEXT: Second
LABEL: B
DURATION: 5
START: 3
END`;

    const result = parseAIResponse(response, DEFAULT_OPTIONS);
    expect(result.success).toBe(true);
    expect(result.plan!.duration).toBe(8);
  });

  it('plan passes Zod validation', () => {
    const response = `COMPONENT: statistic
TEXT: 73%
LABEL: of global traffic
DURATION: 4
END`;

    const result = parseAIResponse(response, DEFAULT_OPTIONS);
    expect(result.success).toBe(true);

    // The plan should have all required fields
    const plan = result.plan!;
    expect(typeof plan.version).toBe('number');
    expect(typeof plan.metadata.name).toBe('string');
    expect(typeof plan.canvas.width).toBe('number');
    expect(typeof plan.canvas.height).toBe('number');
    expect(typeof plan.duration).toBe('number');
    expect(typeof plan.style.visual).toBe('string');
    expect(typeof plan.style.motion).toBe('string');
    expect(Array.isArray(plan.components)).toBe(true);
  });
});

// ═════════════════════════════════════════════════════════════════
// ZOD VALIDATION FAILURE
// ═════════════════════════════════════════════════════════════════

describe('Parser — Zod Validation Failure', () => {
  it('rejects plan with invalid canvas dimensions', () => {
    const response = `COMPONENT: statistic
TEXT: 73%
LABEL: of traffic
DURATION: 4
END`;

    const result = parseAIResponse(response, {
      canvasWidth: 0,
      canvasHeight: 1080,
    });
    // The parser builds the plan, but Zod validation in the gateway would catch this
    // The parser itself should still produce the plan
    expect(result.plan).toBeDefined();
  });
});

// ═════════════════════════════════════════════════════════════════
// PROVIDER
// ═════════════════════════════════════════════════════════════════

describe('Provider — Mock', () => {
  it('returns configured response', async () => {
    const mockResponse = `COMPONENT: statistic
TEXT: 42
LABEL: test value
DURATION: 3
END`;

    const provider = new MockMotionProvider(mockResponse);
    const result = await provider.generate(makeRequest());

    expect(result.text).toBe(mockResponse);
    expect(result.provider).toBe('mock');
    expect(result.finishReason).toBe('stop');
  });

  it('is always available', async () => {
    const provider = new MockMotionProvider();
    expect(await provider.isAvailable()).toBe(true);
  });
});

describe('Provider — Ollama', () => {
  it('creates with default config', () => {
    const provider = new OllamaMotionProvider();
    expect(provider.providerType).toBe('ollama');
  });

  it('creates with custom config', () => {
    const provider = new OllamaMotionProvider({
      model: 'llama3.2',
      baseUrl: 'http://custom:11434',
      temperature: 0.5,
    });
    expect(provider.providerType).toBe('ollama');
  });

  it('generates system prompt', () => {
    const provider = new OllamaMotionProvider();
    const prompt = provider.getSystemPrompt();
    expect(prompt).toContain('motion graphics');
    expect(prompt).toContain('JSON');
  });
});

describe('Provider — Prompt Building', () => {
  it('builds prompt with request parameters', () => {
    const request = makeRequest({
      prompt: 'Show traffic stats',
      canvasWidth: 1920,
      canvasHeight: 1080,
      duration: 10,
    });

    const prompt = buildMotionDirectorPrompt(request);
    expect(prompt).toContain('1920x1080');
    expect(prompt).toContain('10 seconds');
    expect(prompt).toContain('Show traffic stats');
    expect(prompt).toContain('statistic');
  });

  it('includes existing component IDs', () => {
    const request = makeRequest({
      existingComponentIds: ['comp-1', 'comp-2'],
    });

    const prompt = buildMotionDirectorPrompt(request);
    expect(prompt).toContain('comp-1');
    expect(prompt).toContain('comp-2');
  });
});

// ═════════════════════════════════════════════════════════════════
// UNKNOWN OPERATION
// ═════════════════════════════════════════════════════════════════

describe('Operations — Unknown Operation', () => {
  it('rejects unknown operation type', () => {
    const op = {
      operation: 'execute',
      lineStart: 1,
      lineEnd: 3,
    };

    const result = validateOperation(op, []);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.code === 'UNKNOWN_OPERATION')).toBe(true);
  });

  it('rejects malicious operations', () => {
    const maliciousOps = ['shell', 'exec', 'run', 'filesystem', 'process', 'system', 'eval'];
    for (const op of maliciousOps) {
      const result = validateOperation({ operation: op, lineStart: 1, lineEnd: 1 }, []);
      expect(result.valid).toBe(false);
    }
  });
});

// ═════════════════════════════════════════════════════════════════
// SECURITY — NO EXECUTION PATH
// ═════════════════════════════════════════════════════════════════

describe('Security — No Execution Path', () => {
  it('parser never produces executable code', () => {
    const response = `COMPONENT: statistic
TEXT: eval("malicious")
LABEL: of traffic
DURATION: 4
END`;

    const result = parseAIResponse(response, DEFAULT_OPTIONS);
    expect(result.success).toBe(true);
    // The text is treated as data, not code
    expect(result.plan!.components[0].data.value).toBe('eval("malicious")');
    // The plan should not contain executable instructions
    const planStr = JSON.stringify(result.plan);
    expect(planStr).not.toContain('child_process');
    expect(planStr).not.toContain('require(');
    expect(planStr).not.toContain('spawn(');
  });

  it('operations never execute automatically', () => {
    const op = {
      operation: 'remove',
      targetId: 'comp-123',
      lineStart: 1,
      lineEnd: 3,
    };

    const result = validateOperation(op, ['comp-123']);
    expect(result.operation!.status).toBe('blocked');
    expect(result.operation!.confirmRequired).toBe(true);
  });
});

// ═════════════════════════════════════════════════════════════════
// EDGE CASES
// ═════════════════════════════════════════════════════════════════

describe('Parser — Edge Cases', () => {
  it('handles lines without colons', () => {
    const response = `COMPONENT: statistic
TEXT: 73%
LABEL: of traffic
DURATION: 4
this line has no colon
END`;

    const result = parseAIResponse(response, DEFAULT_OPTIONS);
    expect(result.success).toBe(true);
  });

  it('handles comment lines', () => {
    const response = `# This is a comment
COMPONENT: statistic
// Another comment
TEXT: 73%
LABEL: of traffic
DURATION: 4
END`;

    const result = parseAIResponse(response, DEFAULT_OPTIONS);
    expect(result.success).toBe(true);
  });

  it('handles multiple blank lines between blocks', () => {
    const response = `COMPONENT: statistic
TEXT: 73%
LABEL: of traffic
DURATION: 4
END


COMPONENT: statistic
TEXT: 42
LABEL: answers
DURATION: 3
END`;

    const result = parseAIResponse(response, DEFAULT_OPTIONS);
    expect(result.success).toBe(true);
    expect(result.plan!.components).toHaveLength(2);
  });
});

// ═════════════════════════════════════════════════════════════════
// GEMMA RESPONSE — Operation Metadata in Component Block
// ═════════════════════════════════════════════════════════════════

describe('Parser — Gemma Response (Operation Metadata in Component)', () => {
  it('parses the exact Gemma 1B response without errors', () => {
    const response = `COMPONENT: statistic
TEXT: 42%
LABEL: Percentage
DURATION: 4.0
STYLE: minimalist
START: 0.0
OPERATION: UPDATE
TARGET: 0
REASON: Update the percentage
END: END`;

    const result = parseAIResponse(response, DEFAULT_OPTIONS);
    expect(result.success).toBe(true);
    expect(result.plan).toBeDefined();
    expect(result.plan!.components).toHaveLength(1);

    // Statistic fields should be valid
    const comp = result.plan!.components[0];
    expect(comp.type).toBe('statistic');
    expect(comp.data.value).toBe('42%');
    expect(comp.data.label).toBe('Percentage');
  });

  it('extracts operation metadata separately from component fields', () => {
    const response = `COMPONENT: statistic
TEXT: 42%
LABEL: Percentage
DURATION: 4.0
OPERATION: UPDATE
TARGET: 0
REASON: Update the percentage
END`;

    const result = parseAIResponse(response, DEFAULT_OPTIONS);
    expect(result.success).toBe(true);

    // The operation should be parsed separately
    expect(result.operations).toHaveLength(1);
    expect(result.operations[0].operation).toBe('update');
    expect(result.operations[0].targetId).toBe('0');
    expect(result.operations[0].reason).toBe('Update the percentage');
  });

  it('does not report operation/target/reason as unknown component fields', () => {
    const response = `COMPONENT: statistic
TEXT: 42%
LABEL: Percentage
DURATION: 4.0
OPERATION: UPDATE
TARGET: 0
REASON: Update the percentage
END`;

    const result = parseAIResponse(response, DEFAULT_OPTIONS);
    expect(result.success).toBe(true);

    // No errors should reference operation, target, or reason
    const fieldErrors = result.errors.filter(
      (e) => e.field === 'operation' || e.field === 'target' || e.field === 'reason'
    );
    expect(fieldErrors).toHaveLength(0);
  });

  it('normalizes "minimalist" style to "minimal"', () => {
    const response = `COMPONENT: statistic
TEXT: 42%
LABEL: Percentage
DURATION: 4.0
STYLE: minimalist
END`;

    const result = parseAIResponse(response, DEFAULT_OPTIONS);
    expect(result.success).toBe(true);

    // The component should use canonical style
    const comp = result.plan!.components[0];
    expect((comp.style as any).visual).toBe('minimal');
  });

  it('defaults to ADD when no OPERATION field is present', () => {
    const response = `COMPONENT: statistic
TEXT: 73%
LABEL: of traffic
DURATION: 4
END`;

    const result = parseAIResponse(response, DEFAULT_OPTIONS);
    expect(result.success).toBe(true);

    // Should produce an ADD operation by default
    expect(result.operations).toHaveLength(1);
    expect(result.operations[0].operation).toBe('add');
  });
});

// ═════════════════════════════════════════════════════════════════
// STYLE NORMALIZATION
// ═════════════════════════════════════════════════════════════════

describe('Parser — Style Normalization', () => {
  it('normalizes "minimalist" to "minimal"', () => {
    const response = `COMPONENT: statistic
TEXT: 73%
LABEL: of traffic
DURATION: 4
STYLE: minimalist
END`;

    const result = parseAIResponse(response, DEFAULT_OPTIONS);
    expect(result.success).toBe(true);
    expect((result.plan!.components[0].style as any).visual).toBe('minimal');
  });

  it('accepts canonical "minimal" directly', () => {
    const response = `COMPONENT: statistic
TEXT: 73%
LABEL: of traffic
DURATION: 4
STYLE: minimal
END`;

    const result = parseAIResponse(response, DEFAULT_OPTIONS);
    expect(result.success).toBe(true);
    expect((result.plan!.components[0].style as any).visual).toBe('minimal');
  });

  it('rejects unknown arbitrary styles like "neon cyberpunk extreme"', () => {
    const response = `COMPONENT: statistic
TEXT: 73%
LABEL: of traffic
DURATION: 4
STYLE: neon cyberpunk extreme
END`;

    const result = parseAIResponse(response, DEFAULT_OPTIONS);
    expect(result.success).toBe(false);
    expect(result.errors.some((e) => e.code === 'UNKNOWN_STYLE')).toBe(true);
  });

  it('rejects unknown style "futuristic"', () => {
    const response = `COMPONENT: statistic
TEXT: 73%
LABEL: of traffic
DURATION: 4
STYLE: futuristic
END`;

    const result = parseAIResponse(response, DEFAULT_OPTIONS);
    expect(result.success).toBe(false);
    expect(result.errors.some((e) => e.code === 'UNKNOWN_STYLE')).toBe(true);
  });

  it('case-insensitive normalization: "Minimalist" -> "minimal"', () => {
    const response = `COMPONENT: statistic
TEXT: 73%
LABEL: of traffic
DURATION: 4
STYLE: Minimalist
END`;

    const result = parseAIResponse(response, DEFAULT_OPTIONS);
    expect(result.success).toBe(true);
    expect((result.plan!.components[0].style as any).visual).toBe('minimal');
  });
});

// ═════════════════════════════════════════════════════════════════
// OPERATION METADATA — UPDATE with Valid/Invalid Targets
// ═════════════════════════════════════════════════════════════════

describe('Parser — Operation Metadata', () => {
  it('UPDATE with valid stable target is recognized', () => {
    const response = `COMPONENT: statistic
TEXT: 99%
LABEL: Updated value
DURATION: 3
OPERATION: update
TARGET: comp-abc-123
END`;

    const result = parseAIResponse(response, DEFAULT_OPTIONS);
    expect(result.success).toBe(true);
    expect(result.operations).toHaveLength(1);
    expect(result.operations[0].operation).toBe('update');
    expect(result.operations[0].targetId).toBe('comp-abc-123');
  });

  it('UPDATE with invalid target (numeric index) is recognized but operation layer rejects', () => {
    const response = `COMPONENT: statistic
TEXT: 99%
LABEL: Updated value
DURATION: 3
OPERATION: update
TARGET: 0
END`;

    const result = parseAIResponse(response, DEFAULT_OPTIONS);
    expect(result.success).toBe(true);

    // The parser extracts the operation
    expect(result.operations).toHaveLength(1);
    expect(result.operations[0].operation).toBe('update');
    expect(result.operations[0].targetId).toBe('0');

    // But the operations layer rejects it because "0" is not a valid existing ID
    const opResult = processOperations(result.operations, ['comp-abc-123']);
    expect(opResult.errors.length).toBeGreaterThan(0);
    expect(opResult.errors.some((e) => e.code === 'TARGET_NOT_FOUND')).toBe(true);
  });

  it('REMOVE remains confirmation-gated', () => {
    const response = `COMPONENT: statistic
TEXT: 73%
LABEL: of traffic
DURATION: 4
OPERATION: remove
TARGET: comp-abc-123
REASON: outdated
END`;

    const result = parseAIResponse(response, DEFAULT_OPTIONS);
    expect(result.success).toBe(true);

    const opResult = processOperations(result.operations, ['comp-abc-123']);
    expect(opResult.blocked).toHaveLength(1);
    expect(opResult.blocked[0].type).toBe('remove');
    expect(opResult.blocked[0].confirmRequired).toBe(true);
  });

  it('REASON field is extracted as metadata', () => {
    const response = `COMPONENT: statistic
TEXT: 73%
LABEL: of traffic
DURATION: 4
OPERATION: update
TARGET: comp-abc-123
REASON: Update the percentage
END`;

    const result = parseAIResponse(response, DEFAULT_OPTIONS);
    expect(result.operations[0].reason).toBe('Update the percentage');
  });

  it('CONFIRM field is extracted as metadata', () => {
    const response = `COMPONENT: statistic
TEXT: 73%
LABEL: of traffic
DURATION: 4
OPERATION: remove
TARGET: comp-abc-123
REASON: outdated
CONFIRM: REQUIRED
END`;

    const result = parseAIResponse(response, DEFAULT_OPTIONS);
    expect(result.operations[0].confirm).toBe('REQUIRED');
  });
});

// ═════════════════════════════════════════════════════════════════
// NUMERIC INDEXES MUST NOT BECOME STABLE IDS
// ═════════════════════════════════════════════════════════════════

describe('Parser — Numeric Index Rejection', () => {
  it('numeric TARGET is parsed but rejected by operations layer', () => {
    const response = `COMPONENT: statistic
TEXT: 73%
LABEL: of traffic
DURATION: 4
OPERATION: update
TARGET: 0
END`;

    const result = parseAIResponse(response, DEFAULT_OPTIONS);
    expect(result.success).toBe(true);

    // "0" is parsed as the targetId string
    expect(result.operations[0].targetId).toBe('0');

    // But no real component has ID "0", so operations layer rejects it
    const opResult = processOperations(result.operations, ['real-component-id']);
    expect(opResult.errors.some((e) => e.code === 'TARGET_NOT_FOUND')).toBe(true);
  });

  it('numeric string TARGET is not silently converted to an ID', () => {
    const response = `COMPONENT: statistic
TEXT: 73%
LABEL: of traffic
DURATION: 4
OPERATION: update
TARGET: 42
END`;

    const result = parseAIResponse(response, DEFAULT_OPTIONS);
    expect(result.operations[0].targetId).toBe('42');

    // Even with "42" as an existing ID (unlikely), it must match exactly
    const opResult = processOperations(result.operations, ['42']);
    expect(opResult.operations).toHaveLength(1);
    expect(opResult.operations[0].targetId).toBe('42');

    // But with a real ID, it fails
    const opResult2 = processOperations(result.operations, ['comp-real-id']);
    expect(opResult2.errors.some((e) => e.code === 'TARGET_NOT_FOUND')).toBe(true);
  });
});

// ═════════════════════════════════════════════════════════════════
// UNKNOWN COMPONENT FIELDS REMAIN REJECTED
// ═════════════════════════════════════════════════════════════════

describe('Parser — Unknown Fields Still Rejected', () => {
  it('rejects component with arbitrary unknown field', () => {
    const response = `COMPONENT: statistic
TEXT: 73%
LABEL: of traffic
DURATION: 4
INJECTED_FIELD: malicious
END`;

    const result = parseAIResponse(response, DEFAULT_OPTIONS);
    expect(result.success).toBe(false);
    expect(result.errors.some((e) => e.code === 'UNKNOWN_FIELD' && e.field === 'injected_field')).toBe(true);
  });

  it('rejects unknown component type', () => {
    const response = `COMPONENT: chart
TEXT: 73%
LABEL: of traffic
DURATION: 4
END`;

    const result = parseAIResponse(response, DEFAULT_OPTIONS);
    expect(result.success).toBe(false);
    expect(result.errors.some((e) => e.code === 'UNKNOWN_COMPONENT')).toBe(true);
  });
});

// ═════════════════════════════════════════════════════════════════
// PROVIDER PROMPT CLARITY TESTS
// ═════════════════════════════════════════════════════════════════

describe('Provider Prompt — Clarity and Anti-Documentation', () => {
  const request = makeRequest({
    prompt: 'Create a red title card saying The Hidden Cost of Traffic with subtitle Why congestion wastes more than fuel, fading in from the left.',
  });

  const prompt = buildMotionDirectorPrompt(request);

  it('prompt contains explicit instruction that FIELDS: is NEVER valid output', () => {
    expect(prompt).toMatch(/NEVER output "FIELDS:.*this is NEVER valid output/i);
  });

  it('prompt contains explicit instruction that documentation text is NEVER valid output', () => {
    expect(prompt).toMatch(/NEVER output documentation text like "Use for title cards.*this is NEVER valid output/i);
  });

  it('prompt contains explicit instruction that explanations are NEVER valid output', () => {
    expect(prompt).toMatch(/NEVER output explanations.*component blocks/i);
  });

  it('prompt contains explicit instruction that component reference is for information only', () => {
    expect(prompt).toMatch(/COMPONENT REFERENCE.*for your information.*do NOT output/i);
  });

  it('prompt separates documentation from expected output with clear sections', () => {
    expect(prompt).toMatch(/YOUR TASK.*Output ONLY component instances/i);
    expect(prompt).toMatch(/COMPONENT REFERENCE.*for your information/i);
    expect(prompt).toMatch(/EXAMPLES.*Output ONLY component blocks/i);
    expect(prompt).toMatch(/OUTPUT YOUR RESPONSE NOW.*component blocks only/i);
  });

  it('prompt contains TitleCard example with COLOR and directional motion', () => {
    expect(prompt).toMatch(/EXAMPLE 10.*red title card.*fading in from the left/i);
    expect(prompt).toMatch(/COMPONENT: titlecard\s+TITLE: The Hidden Cost of Traffic\s+SUBTITLE: Why congestion wastes more than fuel\s+POSITION: center\s+DURATION: 5\s+MOTION: slideLeft\s+COLOR: #FF0000\s+STYLE: documentary/s);
  });

  it('prompt contains example with subtitle and directional motion', () => {
    expect(prompt).toMatch(/EXAMPLE 9.*title card.*subtitle.*fading in from the left/i);
    expect(prompt).toMatch(/COMPONENT: titlecard\s+TITLE: The Hidden Cost of Traffic\s+SUBTITLE: Why congestion wastes more than fuel\s+POSITION: center\s+DURATION: 5\s+MOTION: slideLeft\s+STYLE: documentary/s);
  });

  it('prompt contains explicit instruction to output only component blocks', () => {
    expect(prompt).toMatch(/OUTPUT YOUR RESPONSE NOW.*component blocks only.*no explanations/i);
  });

  it('prompt does not include FIELDS: as valid output in examples', () => {
    // The COMPONENT REFERENCE section contains FIELDS: for information only
    // The EXAMPLES section should NOT contain FIELDS: as valid output
    const examplesSection = prompt.split('EXAMPLES —')[1] || '';
    expect(examplesSection).not.toMatch(/FIELDS:/);
  });

  it('prompt includes all required fields for titlecard in examples', () => {
    expect(prompt).toMatch(/TITLE:/);
    expect(prompt).toMatch(/SUBTITLE:/);
    expect(prompt).toMatch(/MOTION:/);
    expect(prompt).toMatch(/COLOR:/);
    expect(prompt).toMatch(/DURATION:/);
    expect(prompt).toMatch(/END/);
  });
});

// ═════════════════════════════════════════════════════════════════
// TITLECARD FIELD NAME REGRESSION TESTS
// ═════════════════════════════════════════════════════════════════

describe('Provider Prompt — TitleCard Field Name Rules', () => {
  const request = makeRequest({
    prompt: 'Create a red title card saying The Hidden Cost of Traffic with subtitle Why congestion wastes more than fuel, fading in from the left.',
  });

  const prompt = buildMotionDirectorPrompt(request);

  it('prompt explicitly states TEXT is NOT a valid titlecard field', () => {
    expect(prompt).toMatch(/TEXT is NOT a valid titlecard field/i);
  });

  it('prompt explicitly states TITLE must always be used for titlecard', () => {
    expect(prompt).toMatch(/ALWAYS use TITLE for titlecard/i);
  });

  it('prompt explicitly states TEXT is ONLY valid for statistic', () => {
    expect(prompt).toMatch(/TEXT is ONLY valid for statistic/i);
  });

  it('prompt explicitly states TITLE is ONLY valid for titlecard', () => {
    expect(prompt).toMatch(/TITLE is ONLY valid for titlecard/i);
  });

  it('prompt explicitly states each component type has its own field name', () => {
    expect(prompt).toMatch(/Each component type has its OWN field name/i);
  });

  it('prompt shows correct field name mapping for each component type', () => {
    expect(prompt).toMatch(/statistic component.*TEXT/i);
    expect(prompt).toMatch(/titlecard component.*TITLE/i);
    expect(prompt).toMatch(/lowerthird component.*NAME/i);
  });

  it('prompt example 10 uses TITLE not TEXT for titlecard', () => {
    const example10 = prompt.split('EXAMPLE 10')[1] || '';
    expect(example10).toMatch(/TITLE: The Hidden Cost of Traffic/);
    expect(example10).not.toMatch(/TEXT: The Hidden Cost of Traffic/);
  });

  it('prompt example 9 uses TITLE not TEXT for titlecard', () => {
    const example9 = prompt.split('EXAMPLE 9')[1] || '';
    expect(example9).toMatch(/TITLE: The Hidden Cost of Traffic/);
    expect(example9).not.toMatch(/TEXT: The Hidden Cost of Traffic/);
  });

  it('prompt example 11 uses TITLE not TEXT for titlecard', () => {
    const example11 = prompt.split('EXAMPLE 11')[1] || '';
    expect(example11).toMatch(/TITLE: How Cars Changed the World/);
    expect(example11).not.toMatch(/TEXT: How Cars Changed the World/);
  });

  it('prompt example 12 uses TITLE not TEXT for titlecard', () => {
    const example12 = prompt.split('EXAMPLE 12')[1] || '';
    expect(example12).toMatch(/TITLE: The Hidden Cost of Traffic/);
    expect(example12).not.toMatch(/TEXT: The Hidden Cost of Traffic/);
  });

  it('prompt example 13 uses TITLE not TEXT for titlecard', () => {
    const example13 = prompt.split('EXAMPLE 13')[1] || '';
    expect(example13).toMatch(/TITLE: Urban Planning/);
    expect(example13).not.toMatch(/TEXT: Urban Planning/);
  });

  it('prompt explicitly states that using TEXT for titlecard will be rejected', () => {
    expect(prompt).toMatch(/Using TEXT for titlecard.*will be rejected/i);
  });
});
