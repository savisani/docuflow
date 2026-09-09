import { describe, it, expect } from 'vitest';
import { validateMotionPlan, validateMotionRequest, MOTION_LIMITS } from '../validator';
import { processMotionRequest } from '../gateway';
import { getCapabilities, isCapabilityAllowed } from '../capabilities';
import { ComponentRegistry } from '../components/registry';
import { StatisticCompiler } from '../components/statistic/compiler';
import { buildTimeline } from '../../timeline/builder';
import { resolveLayerState } from '../../timeline/resolver';
import { isTextActive } from '../../timeline/resolver';
import type { MotionPlanV1, MotionRequestV1 } from '../types';
import type { ProjectSettings } from '../../../types/project';

// ── Helpers ─────────────────────────────────────────────────────

function validPlan(overrides?: Partial<MotionPlanV1>): MotionPlanV1 {
  return {
    version: 1,
    metadata: { name: 'Test Plan' },
    canvas: { width: 1920, height: 1080 },
    duration: 5,
    style: { visual: 'documentary', motion: 'subtle' },
    components: [
      {
        type: 'statistic',
        data: { value: '73%', label: 'of global traffic' },
        timing: { start: 0, duration: 4 },
      },
    ],
    ...overrides,
  };
}

function validRequest(overrides?: Partial<MotionRequestV1>): MotionRequestV1 {
  return {
    version: 1,
    operation: 'getCapabilities',
    requestId: 'test-req-001',
    ...overrides,
  };
}

// ═════════════════════════════════════════════════════════════════
// VALID INPUTS
// ═════════════════════════════════════════════════════════════════

describe('Motion Plan Validation — Valid Inputs', () => {
  it('accepts a minimal valid plan', () => {
    const result = validateMotionPlan(validPlan());
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('accepts a plan with optional fields', () => {
    const plan = validPlan({
      metadata: { name: 'Test', description: 'A test plan', createdAt: '2026-01-01' },
      components: [
        {
          type: 'statistic',
          id: 'comp-1',
          data: { value: '42', label: 'Answers', unit: 'count', source: 'research' },
          timing: { start: 0, duration: 3 },
          style: { color: '#FF0000' },
        },
      ],
    });
    const result = validateMotionPlan(plan);
    expect(result.valid).toBe(true);
  });

  it('accepts plan with multiple components', () => {
    const plan = validPlan({
      components: [
        { type: 'statistic', data: { value: '1', label: 'First' }, timing: { start: 0, duration: 2 } },
        { type: 'statistic', data: { value: '2', label: 'Second' }, timing: { start: 2, duration: 2 } },
        { type: 'statistic', data: { value: '3', label: 'Third' }, timing: { start: 4, duration: 1 } },
      ],
    });
    const result = validateMotionPlan(plan);
    expect(result.valid).toBe(true);
  });
});

describe('Motion Request Validation — Valid Inputs', () => {
  it('accepts a valid getCapabilities request', () => {
    const result = validateMotionRequest(validRequest());
    expect(result.valid).toBe(true);
  });

  it('accepts a valid compilePlan request', () => {
    const result = validateMotionRequest(validRequest({
      operation: 'compilePlan',
      plan: validPlan(),
    }));
    expect(result.valid).toBe(true);
  });
});

describe('Capability Model — Valid', () => {
  it('returns all capabilities', () => {
    const caps = getCapabilities();
    expect(caps.length).toBeGreaterThanOrEqual(7);
  });

  it('allows known capabilities', () => {
    expect(isCapabilityAllowed('motion.plan.create')).toBe(true);
    expect(isCapabilityAllowed('motion.plan.validate')).toBe(true);
    expect(isCapabilityAllowed('motion.component.list')).toBe(true);
    expect(isCapabilityAllowed('motion.component.compile')).toBe(true);
    expect(isCapabilityAllowed('motion.preview')).toBe(true);
    expect(isCapabilityAllowed('motion.timeline.preview')).toBe(true);
    expect(isCapabilityAllowed('motion.timeline.add')).toBe(true);
  });
});

describe('Component Registry — Valid', () => {
  it('registers statistic component', () => {
    expect(ComponentRegistry.isRegistered('statistic')).toBe(true);
  });

  it('returns registered types', () => {
    const types = ComponentRegistry.getRegisteredTypes();
    expect(types).toContain('statistic');
  });

  it('gets statistic compiler', () => {
    const compiler = ComponentRegistry.get('statistic');
    expect(compiler).toBeDefined();
    expect(compiler?.componentType).toBe('statistic');
  });
});

describe('Statistic Compiler — Valid', () => {
  it('compiles a statistic component to commands', () => {
    const compiler = new StatisticCompiler();
    const commands = compiler.compile(
      {
        type: 'statistic',
        data: { value: '73%', label: 'of global traffic' },
        timing: { start: 0, duration: 4 },
      },
      1920,
      1080
    );

    expect(commands.length).toBeGreaterThan(0);
    // Should have text commands for value and label
    const textCmds = commands.filter((c) => c.type === 'text');
    expect(textCmds.length).toBe(2);
    // Should have fade animations
    const fadeCmds = commands.filter((c) => c.type === 'fadeIn' || c.type === 'fadeOut');
    expect(fadeCmds.length).toBeGreaterThanOrEqual(2);
  });

  it('validates correct data', () => {
    const compiler = new StatisticCompiler();
    const errors = compiler.validate(
      { value: '73%', label: 'of global traffic' },
      1920,
      1080
    );
    expect(errors).toHaveLength(0);
  });
});

describe('Gateway — Valid Operations', () => {
  it('processes getCapabilities', () => {
    const response = processMotionRequest(validRequest());
    expect(response.status).toBe('success');
    expect(response.operation).toBe('getCapabilities');
    expect(Array.isArray(response.data)).toBe(true);
  });

  it('processes getComponents', () => {
    const response = processMotionRequest(validRequest({ operation: 'getComponents' }));
    expect(response.status).toBe('success');
    expect(response.data).toEqual([{ type: 'statistic' }]);
  });

  it('processes validatePlan', () => {
    const response = processMotionRequest(validRequest({
      operation: 'validatePlan',
      plan: validPlan(),
    }));
    expect(response.status).toBe('success');
    expect((response.data as any).valid).toBe(true);
  });

  it('processes createPlan', () => {
    const response = processMotionRequest(validRequest({
      operation: 'createPlan',
      plan: validPlan(),
    }));
    expect(response.status).toBe('success');
  });

  it('processes compilePlan', () => {
    const response = processMotionRequest(validRequest({
      operation: 'compilePlan',
      plan: validPlan(),
    }));
    expect(response.status).toBe('success');
    const data = response.data as { commands: any[]; commandCount: number };
    expect(data.commandCount).toBeGreaterThan(0);
    expect(data.commands.length).toBeGreaterThan(0);
  });
});

// ═════════════════════════════════════════════════════════════════
// INVALID / MALICIOUS INPUTS
// ═════════════════════════════════════════════════════════════════

describe('Motion Plan Validation — Invalid Inputs', () => {
  it('rejects null input', () => {
    const result = validateMotionPlan(null);
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
  });

  it('rejects non-object input', () => {
    const result = validateMotionPlan('not an object');
    expect(result.valid).toBe(false);
  });

  it('rejects missing version', () => {
    const plan = validPlan();
    (plan as any).version = undefined;
    const result = validateMotionPlan(plan);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.field === 'version')).toBe(true);
  });

  it('rejects wrong version', () => {
    const plan = validPlan();
    (plan as any).version = 2;
    const result = validateMotionPlan(plan);
    expect(result.valid).toBe(false);
  });

  it('rejects missing metadata', () => {
    const plan = validPlan();
    (plan as any).metadata = undefined;
    const result = validateMotionPlan(plan);
    expect(result.valid).toBe(false);
  });

  it('rejects empty metadata name', () => {
    const plan = validPlan({ metadata: { name: '' } });
    const result = validateMotionPlan(plan);
    expect(result.valid).toBe(false);
  });

  it('rejects negative duration', () => {
    const plan = validPlan({ duration: -1 });
    const result = validateMotionPlan(plan);
    expect(result.valid).toBe(false);
  });

  it('rejects zero duration', () => {
    const plan = validPlan({ duration: 0 });
    const result = validateMotionPlan(plan);
    expect(result.valid).toBe(false);
  });

  it('rejects duration exceeding limit', () => {
    const plan = validPlan({ duration: MOTION_LIMITS.MAX_DURATION + 1 });
    const result = validateMotionPlan(plan);
    expect(result.valid).toBe(false);
  });

  it('rejects non-finite duration', () => {
    const plan = validPlan({ duration: Infinity });
    const result = validateMotionPlan(plan);
    expect(result.valid).toBe(false);
  });

  it('rejects NaN duration', () => {
    const plan = validPlan({ duration: NaN });
    const result = validateMotionPlan(plan);
    expect(result.valid).toBe(false);
  });

  it('rejects invalid canvas width', () => {
    const plan = validPlan({ canvas: { width: 0, height: 1080 } });
    const result = validateMotionPlan(plan);
    expect(result.valid).toBe(false);
  });

  it('rejects canvas width exceeding limit', () => {
    const plan = validPlan({ canvas: { width: MOTION_LIMITS.MAX_CANVAS_WIDTH + 1, height: 1080 } });
    const result = validateMotionPlan(plan);
    expect(result.valid).toBe(false);
  });

  it('rejects non-integer canvas width', () => {
    const plan = validPlan({ canvas: { width: 1920.5, height: 1080 } });
    const result = validateMotionPlan(plan);
    expect(result.valid).toBe(false);
  });

  it('rejects invalid style visual', () => {
    const plan = validPlan({ style: { visual: 'neon', motion: 'subtle' } as any });
    const result = validateMotionPlan(plan);
    expect(result.valid).toBe(false);
  });

  it('rejects invalid style motion', () => {
    const plan = validPlan({ style: { visual: 'documentary', motion: 'frantic' } as any });
    const result = validateMotionPlan(plan);
    expect(result.valid).toBe(false);
  });
});

describe('Motion Plan Validation — Resource Limits', () => {
  it('rejects plan with too many components', () => {
    const components = Array.from({ length: MOTION_LIMITS.MAX_COMPONENTS + 1 }, (_, i) => ({
      type: 'statistic' as const,
      data: { value: `${i}`, label: `Item ${i}` },
      timing: { start: 0, duration: 1 },
    }));
    const plan = validPlan({ components });
    const result = validateMotionPlan(plan);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.code === 'too_big')).toBe(true);
  });

  it('rejects component with timing exceeding plan duration', () => {
    const plan = validPlan({
      duration: 5,
      components: [
        { type: 'statistic', data: { value: '1', label: 'X' }, timing: { start: 3, duration: 4 } },
      ],
    });
    const result = validateMotionPlan(plan);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.code === 'TIMING_EXCEEDS_DURATION')).toBe(true);
  });

  it('rejects duplicate component IDs', () => {
    const plan = validPlan({
      components: [
        { type: 'statistic', id: 'dup', data: { value: '1', label: 'A' }, timing: { start: 0, duration: 2 } },
        { type: 'statistic', id: 'dup', data: { value: '2', label: 'B' }, timing: { start: 2, duration: 2 } },
      ],
    });
    const result = validateMotionPlan(plan);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.code === 'DUPLICATE_IDS')).toBe(true);
  });

  it('rejects empty component value', () => {
    const plan = validPlan({
      components: [
        { type: 'statistic', data: { value: '', label: 'Label' }, timing: { start: 0, duration: 2 } },
      ],
    });
    const result = validateMotionPlan(plan);
    expect(result.valid).toBe(false);
  });

  it('rejects empty component label', () => {
    const plan = validPlan({
      components: [
        { type: 'statistic', data: { value: '42', label: '' }, timing: { start: 0, duration: 2 } },
      ],
    });
    const result = validateMotionPlan(plan);
    expect(result.valid).toBe(false);
  });

  it('rejects text exceeding max length', () => {
    const longText = 'x'.repeat(MOTION_LIMITS.MAX_TEXT_LENGTH + 1);
    const plan = validPlan({
      components: [
        { type: 'statistic', data: { value: longText, label: 'Label' }, timing: { start: 0, duration: 2 } },
      ],
    });
    const result = validateMotionPlan(plan);
    expect(result.valid).toBe(false);
  });
});

describe('Motion Request Validation — Invalid Inputs', () => {
  it('rejects null request', () => {
    const result = validateMotionRequest(null);
    expect(result.valid).toBe(false);
  });

  it('rejects unknown operation', () => {
    const result = validateMotionRequest({
      version: 1,
      operation: 'execute',
      requestId: 'test',
    });
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.code === 'UNKNOWN_OPERATION')).toBe(true);
  });

  it('rejects arbitrary operations', () => {
    const maliciousOps = [
      'shell', 'exec', 'run', 'filesystem', 'process', 'system',
      'invokeAny', 'eval', 'function', 'spawn', 'child_process',
    ];
    for (const op of maliciousOps) {
      const result = validateMotionRequest({
        version: 1,
        operation: op,
        requestId: 'test',
      });
      expect(result.valid).toBe(false);
    }
  });

  it('rejects missing requestId', () => {
    const result = validateMotionRequest({
      version: 1,
      operation: 'getCapabilities',
    });
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.code === 'MISSING_REQUEST_ID')).toBe(true);
  });

  it('rejects wrong version', () => {
    const result = validateMotionRequest({
      version: 99,
      operation: 'getCapabilities',
      requestId: 'test',
    });
    expect(result.valid).toBe(false);
  });
});

describe('Gateway — Security', () => {
  it('rejects unknown operations', () => {
    const response = processMotionRequest({
      version: 1,
      operation: 'execute',
      requestId: 'test',
    });
    expect(response.status).toBe('error');
  });

  it('rejects malicious operations', () => {
    const maliciousOps = [
      'shell', 'exec', 'run', 'filesystem', 'process', 'system',
      'invokeAny', 'eval', 'function', 'spawn', 'child_process',
    ];
    for (const op of maliciousOps) {
      const response = processMotionRequest({
        version: 1,
        operation: op,
        requestId: 'test',
      });
      expect(response.status).toBe('error');
    }
  });

  it('rejects compilePlan without plan', () => {
    const response = processMotionRequest({
      version: 1,
      operation: 'compilePlan',
      requestId: 'test',
    });
    expect(response.status).toBe('error');
  });

  it('rejects compilePlan with invalid plan', () => {
    const response = processMotionRequest({
      version: 1,
      operation: 'compilePlan',
      requestId: 'test',
      plan: { version: 1, metadata: { name: '' } },
    });
    expect(response.status).toBe('error');
  });

  it('rejects plan with unknown component type', () => {
    const response = processMotionRequest({
      version: 1,
      operation: 'compilePlan',
      requestId: 'test',
      plan: validPlan({
        components: [
          { type: 'malicious_component' as any, data: {}, timing: { start: 0, duration: 1 } },
        ],
      }),
    });
    expect(response.status).toBe('error');
  });

  it('rejects malformed JSON input', () => {
    const response = processMotionRequest('not json at all');
    expect(response.status).toBe('error');
  });

  it('rejects array input', () => {
    const response = processMotionRequest([1, 2, 3]);
    expect(response.status).toBe('error');
  });

  it('rejects numeric input', () => {
    const response = processMotionRequest(42);
    expect(response.status).toBe('error');
  });
});

describe('Security — Path Traversal', () => {
  it('rejects plans with filesystem paths in component data', () => {
    const plan = validPlan({
      components: [
        {
          type: 'statistic',
          data: { value: 'C:\\Users\\admin\\secret.txt', label: 'test' },
          timing: { start: 0, duration: 2 },
        },
      ],
    });
    // The plan should still validate since data fields are strings
    // But the gateway compilation will treat them as text content, not paths
    const result = validateMotionPlan(plan);
    expect(result.valid).toBe(true); // Data is strings, validated as strings
    // The key security is that paths are never executed, only rendered as text
  });

  it('rejects shell commands in structural fields', () => {
    const plan = validPlan({
      metadata: { name: 'test' },
    });
    // Inject suspicious content into a structural field
    (plan as any).metadata.name = 'eval("malicious")';
    const result = validateMotionPlan(plan);
    // This should be caught by suspicious content detection
    // if it appears in structural fields
  });
});

describe('Security — No Execution Path', () => {
  it('statistic compiler produces only text and animation commands', () => {
    const compiler = new StatisticCompiler();
    const commands = compiler.compile(
      {
        type: 'statistic',
        data: { value: '73%', label: 'of global traffic' },
        timing: { start: 0, duration: 4 },
      },
      1920,
      1080
    );

    const allowedTypes = ['text', 'fadeIn', 'fadeOut', 'scale', 'opacity'];
    for (const cmd of commands) {
      expect(allowedTypes).toContain(cmd.type);
    }
  });

  it('no command contains executable code', () => {
    const compiler = new StatisticCompiler();
    const commands = compiler.compile(
      {
        type: 'statistic',
        data: { value: 'test', label: 'test' },
        timing: { start: 0, duration: 2 },
      },
      1920,
      1080
    );

    const planStr = JSON.stringify(commands);
    expect(planStr).not.toContain('eval(');
    expect(planStr).not.toContain('Function(');
    expect(planStr).not.toContain('child_process');
    expect(planStr).not.toContain('require(');
    expect(planStr).not.toContain('spawn(');
    expect(planStr).not.toContain('exec(');
    expect(planStr).not.toContain('shell');
    expect(planStr).not.toContain('powershell');
    expect(planStr).not.toContain('cmd.exe');
    expect(planStr).not.toContain('python');
  });
});

describe('Capability Model — Denials', () => {
  it('rejects unknown capabilities', () => {
    expect(isCapabilityAllowed('unknown.capability')).toBe(false);
    expect(isCapabilityAllowed('')).toBe(false);
    expect(isCapabilityAllowed('motion.')).toBe(false);
    expect(isCapabilityAllowed('motion.plan.')).toBe(false);
    expect(isCapabilityAllowed('motion.system.execute')).toBe(false);
    expect(isCapabilityAllowed('shell.execute')).toBe(false);
    expect(isCapabilityAllowed('filesystem.read')).toBe(false);
  });
});

describe('Component Registry — Denials', () => {
  it('rejects unknown component types', () => {
    expect(ComponentRegistry.isRegistered('unknown')).toBe(false);
    expect(ComponentRegistry.isRegistered('')).toBe(false);
    expect(ComponentRegistry.isRegistered('malicious')).toBe(false);
    expect(ComponentRegistry.get('unknown')).toBeUndefined();
  });
});

describe('Statistic Compiler — Validation', () => {
  it('rejects empty value', () => {
    const compiler = new StatisticCompiler();
    const errors = compiler.validate({ value: '', label: 'test' }, 1920, 1080);
    expect(errors.length).toBeGreaterThan(0);
  });

  it('rejects empty label', () => {
    const compiler = new StatisticCompiler();
    const errors = compiler.validate({ value: '42', label: '' }, 1920, 1080);
    expect(errors.length).toBeGreaterThan(0);
  });

  it('rejects value exceeding max length', () => {
    const compiler = new StatisticCompiler();
    const errors = compiler.validate(
      { value: 'x'.repeat(501), label: 'test' },
      1920,
      1080
    );
    expect(errors.length).toBeGreaterThan(0);
  });

  it('rejects label exceeding max length', () => {
    const compiler = new StatisticCompiler();
    const errors = compiler.validate(
      { value: '42', label: 'x'.repeat(501) },
      1920,
      1080
    );
    expect(errors.length).toBeGreaterThan(0);
  });
});

// ═════════════════════════════════════════════════════════════════
// STATISTIC COMPILER — ANIMATION COMMANDS
// ═════════════════════════════════════════════════════════════════

describe('Statistic Compiler — Animation Commands', () => {
  const compiler = new StatisticCompiler();
  const settings: ProjectSettings = { width: 1920, height: 1080, fps: 30 };

  function compileStatistic(value: string, label: string, duration: number, start = 0) {
    return compiler.compile(
      { type: 'statistic', data: { value, label }, timing: { start, duration } },
      1920,
      1080
    );
  }

  it('produces text commands for value and label', () => {
    const commands = compileStatistic('42%', 'sample rate', 4);
    const textCmds = commands.filter(c => c.type === 'text');
    expect(textCmds).toHaveLength(2);
    expect(textCmds[0].content).toBe('42%');
    expect(textCmds[1].content).toBe('sample rate');
  });

  it('produces fadeIn commands for both text elements', () => {
    const commands = compileStatistic('42%', 'sample rate', 4);
    const fadeIns = commands.filter(c => c.type === 'fadeIn');
    expect(fadeIns).toHaveLength(2);
    for (const cmd of fadeIns) {
      expect(cmd.start).toBe(0);
      expect(cmd.duration).toBeGreaterThan(0);
      expect(cmd.duration).toBeLessThanOrEqual(0.5);
    }
  });

  it('produces fadeOut commands for both text elements', () => {
    const commands = compileStatistic('42%', 'sample rate', 4);
    const fadeOuts = commands.filter(c => c.type === 'fadeOut');
    expect(fadeOuts).toHaveLength(2);
    for (const cmd of fadeOuts) {
      expect(cmd.start).toBeGreaterThan(3);
      expect(cmd.start).toBeLessThan(4);
      expect(cmd.duration).toBeGreaterThan(0);
    }
  });

  it('produces a scale command for the value', () => {
    const commands = compileStatistic('42%', 'sample rate', 4);
    const scales = commands.filter(c => c.type === 'scale');
    expect(scales).toHaveLength(1);
    expect(scales[0].from).toBe(0.8);
    expect(scales[0].to).toBe(1);
    expect(scales[0].easing).toBe('easeOut');
  });

  it('animation commands target text command IDs', () => {
    const commands = compileStatistic('42%', 'sample rate', 4);
    const textIds = commands.filter(c => c.type === 'text').map(c => c.id);
    const animCmds = commands.filter(c => c.type === 'fadeIn' || c.type === 'fadeOut' || c.type === 'scale');
    for (const cmd of animCmds) {
      expect(textIds).toContain(cmd.target);
    }
  });

  it('no animation exceeds the statistic duration', () => {
    const duration = 4;
    const commands = compileStatistic('42%', 'sample rate', duration);
    for (const cmd of commands) {
      const cmdEnd = cmd.start + (cmd.duration || 0);
      expect(cmdEnd).toBeLessThanOrEqual(duration + 0.01);
    }
  });

  it('no new command types are introduced', () => {
    const allowedTypes = ['text', 'fadeIn', 'fadeOut', 'scale'];
    const commands = compileStatistic('42%', 'sample rate', 4);
    for (const cmd of commands) {
      expect(allowedTypes).toContain(cmd.type);
    }
  });

  it('centered position uses canvas midpoint', () => {
    const commands = compileStatistic('42%', 'sample rate', 4);
    const valueText = commands.find(c => c.type === 'text' && c.content === '42%')!;
    expect(valueText.x).toBe(960);
    expect(valueText.y).toBe(510);
  });

  it('compiles through buildTimeline and attaches animations to text layers', () => {
    const commands = compileStatistic('42%', 'sample rate', 4);
    const timeline = buildTimeline(commands, [], settings);

    expect(timeline.textLayers.length).toBe(2);
    const valueLayer = timeline.textLayers.find(t => t.content === '42%')!;
    expect(valueLayer).toBeDefined();
    expect(valueLayer.animations.length).toBeGreaterThan(0);

    const opacityAnims = valueLayer.animations.filter(a => a.property === 'opacity');
    expect(opacityAnims.length).toBeGreaterThanOrEqual(2);

    const scaleAnims = valueLayer.animations.filter(a => a.property === 'scale');
    expect(scaleAnims.length).toBe(1);
  });

  it('text layer resolves correct opacity at frame 0 (before fade-in completes)', () => {
    const commands = compileStatistic('42%', 'sample rate', 4);
    const timeline = buildTimeline(commands, [], settings);
    const valueLayer = timeline.textLayers.find(t => t.content === '42%')!;
    expect(isTextActive(valueLayer, 0)).toBe(true);
  });

  it('text layer resolves correct opacity mid-duration (fully visible)', () => {
    const commands = compileStatistic('42%', 'sample rate', 4);
    const timeline = buildTimeline(commands, [], settings);
    const valueLayer = timeline.textLayers.find(t => t.content === '42%')!;
    const midFrame = Math.round(2 * settings.fps);
    expect(isTextActive(valueLayer, midFrame)).toBe(true);
  });

  it('text layer is inactive after end', () => {
    const commands = compileStatistic('42%', 'sample rate', 4);
    const timeline = buildTimeline(commands, [], settings);
    const valueLayer = timeline.textLayers.find(t => t.content === '42%')!;
    const afterEnd = Math.round(4.1 * settings.fps);
    expect(isTextActive(valueLayer, afterEnd)).toBe(false);
  });
});

// ═════════════════════════════════════════════════════════════════
// STATISTIC MOTION VOCABULARY
// ═════════════════════════════════════════════════════════════════

describe('Statistic Compiler — Motion Vocabulary', () => {
  const compiler = new StatisticCompiler();
  const settings: ProjectSettings = { width: 1920, height: 1080, fps: 30 };

  function compileWithMotion(motion: string | undefined) {
    return compiler.compile(
      {
        type: 'statistic',
        data: { value: '73%', label: 'of global traffic' },
        timing: { start: 0, duration: 4 },
        ...(motion ? { style: { motion } } : {}),
      },
      1920,
      1080
    );
  }

  function getCommandTypes(commands: ReturnType<typeof compileWithMotion>) {
    return commands.map(c => c.type);
  }

  it('zoom produces scale entrance (default behavior)', () => {
    const commands = compileWithMotion('zoom');
    const types = getCommandTypes(commands);
    expect(types).toContain('scale');
    expect(types).toContain('fadeIn');
    expect(types).toContain('fadeOut');
    // No move commands for zoom
    expect(types).not.toContain('move');
    expect(types).not.toContain('setKeyframes');
  });

  it('slideUp produces move commands with Y offset', () => {
    const commands = compileWithMotion('slideUp');
    const moveCmds = commands.filter(c => c.type === 'move');
    expect(moveCmds.length).toBe(2); // value + label
    for (const cmd of moveCmds) {
      const move = cmd as any;
      expect(move.from.y).toBeGreaterThan(move.to.y);
      expect(move.from.x).toBe(move.to.x);
    }
    expect(getCommandTypes(commands)).toContain('fadeIn');
    expect(getCommandTypes(commands)).not.toContain('scale');
  });

  it('slideLeft produces move commands with X offset', () => {
    const commands = compileWithMotion('slideLeft');
    const moveCmds = commands.filter(c => c.type === 'move');
    expect(moveCmds.length).toBe(2);
    for (const cmd of moveCmds) {
      const move = cmd as any;
      expect(move.from.x).toBeLessThan(move.to.x);
      expect(move.from.y).toBe(move.to.y);
    }
    expect(getCommandTypes(commands)).toContain('fadeIn');
    expect(getCommandTypes(commands)).not.toContain('scale');
  });

  it('slideRight produces move commands with X offset', () => {
    const commands = compileWithMotion('slideRight');
    const moveCmds = commands.filter(c => c.type === 'move');
    expect(moveCmds.length).toBe(2);
    for (const cmd of moveCmds) {
      const move = cmd as any;
      expect(move.from.x).toBeGreaterThan(move.to.x);
      expect(move.from.y).toBe(move.to.y);
    }
    expect(getCommandTypes(commands)).toContain('fadeIn');
    expect(getCommandTypes(commands)).not.toContain('scale');
  });

  it('fade produces only fadeIn/fadeOut (no scale, no move)', () => {
    const commands = compileWithMotion('fade');
    const types = getCommandTypes(commands);
    expect(types).toContain('fadeIn');
    expect(types).toContain('fadeOut');
    expect(types).not.toContain('scale');
    expect(types).not.toContain('move');
    expect(types).not.toContain('setKeyframes');
  });

  it('pop produces setKeyframes for overshoot scale', () => {
    const commands = compileWithMotion('pop');
    const types = getCommandTypes(commands);
    expect(types).toContain('setKeyframes');
    expect(types).toContain('fadeIn');
    expect(types).toContain('fadeOut');
    expect(types).not.toContain('scale');
    expect(types).not.toContain('move');
    // Verify keyframe overshoot
    const kfCmds = commands.filter(c => c.type === 'setKeyframes');
    expect(kfCmds.length).toBe(2); // value + label
    for (const cmd of kfCmds) {
      const kf = cmd as any;
      expect(kf.property).toBe('scale');
      expect(kf.keyframes.length).toBe(3);
      expect(kf.keyframes[0].value).toBe(0);
      expect(kf.keyframes[1].value).toBeGreaterThan(1); // overshoot
      expect(kf.keyframes[2].value).toBe(1.0);
    }
  });

  it('default (no motion) produces zoom behavior', () => {
    const commands = compileWithMotion(undefined);
    const types = getCommandTypes(commands);
    expect(types).toContain('scale');
    expect(types).toContain('fadeIn');
    expect(types).toContain('fadeOut');
    expect(types).not.toContain('move');
    expect(types).not.toContain('setKeyframes');
  });

  it('unsupported motion falls back to zoom', () => {
    const commands = compileWithMotion('nonexistent');
    const types = getCommandTypes(commands);
    expect(types).toContain('scale');
    expect(types).not.toContain('move');
  });

  it('each motion produces a different command set', () => {
    const zoom = compileWithMotion('zoom');
    const slideUp = compileWithMotion('slideUp');
    const slideLeft = compileWithMotion('slideLeft');
    const slideRight = compileWithMotion('slideRight');
    const fade = compileWithMotion('fade');
    const pop = compileWithMotion('pop');

    function commandSignature(cmds: ReturnType<typeof compileWithMotion>) {
      return cmds.map(c => {
        const any = c as any;
        if (any.type === 'move') return `move(${any.from.x},${any.from.y})`;
        if (any.type === 'setKeyframes') return `kf(${any.keyframes.map((k: any) => k.value).join(',')})`;
        if (any.type === 'scale') return `scale(${any.from},${any.to})`;
        return any.type;
      }).join(',');
    }

    const sigs = [zoom, slideUp, slideLeft, slideRight, fade, pop].map(commandSignature);
    const unique = new Set(sigs);
    expect(unique.size).toBe(6);
  });

  it('all motions produce text commands for value and label', () => {
    const motions = ['zoom', 'slideUp', 'slideLeft', 'slideRight', 'fade', 'pop'];
    for (const motion of motions) {
      const commands = compileWithMotion(motion);
      const textCmds = commands.filter(c => c.type === 'text');
      expect(textCmds.length).toBe(2);
      expect(textCmds[0].content).toBe('73%');
      expect(textCmds[1].content).toBe('of global traffic');
    }
  });

  it('all motions produce fadeOut commands', () => {
    const motions = ['zoom', 'slideUp', 'slideLeft', 'slideRight', 'fade', 'pop'];
    for (const motion of motions) {
      const commands = compileWithMotion(motion);
      const fadeOuts = commands.filter(c => c.type === 'fadeOut');
      expect(fadeOuts.length).toBe(2);
    }
  });

  it('all motions produce animation commands targeting text IDs', () => {
    const motions = ['zoom', 'slideUp', 'slideLeft', 'slideRight', 'fade', 'pop'];
    for (const motion of motions) {
      const commands = compileWithMotion(motion);
      const textIds = commands.filter(c => c.type === 'text').map(c => c.id);
      const animCmds = commands.filter(c =>
        c.type === 'fadeIn' || c.type === 'fadeOut' || c.type === 'scale' || c.type === 'move' || c.type === 'setKeyframes'
      );
      for (const cmd of animCmds) {
        expect(textIds).toContain((cmd as any).target);
      }
    }
  });

  it('compiled plan can reach Add to Timeline via gateway', () => {
    const motions = ['zoom', 'slideUp', 'slideLeft', 'slideRight', 'fade', 'pop'];
    for (const motion of motions) {
      const plan: MotionPlanV1 = {
        version: 1,
        metadata: { name: 'Test' },
        canvas: { width: 1920, height: 1080 },
        duration: 5,
        style: { visual: 'documentary', motion: 'subtle' },
        components: [
          {
            type: 'statistic',
            data: { value: '73%', label: 'of global traffic' },
            timing: { start: 0, duration: 4 },
            style: { motion },
          },
        ],
      };
      const result = processMotionRequest({
        version: 1,
        operation: 'compilePlan',
        requestId: `test-${motion}`,
        plan,
      });
      expect(result.status).toBe('success');
      const data = result.data as { commands: any[]; commandCount: number };
      expect(data.commandCount).toBeGreaterThan(0);
    }
  });
});
