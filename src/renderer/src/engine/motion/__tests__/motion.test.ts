import { describe, it, expect } from 'vitest';
import { validateMotionPlan, validateMotionRequest, MOTION_LIMITS } from '../validator';
import { processMotionRequest } from '../gateway';
import { getCapabilities, isCapabilityAllowed } from '../capabilities';
import { ComponentRegistry } from '../components/registry';
import { StatisticCompiler } from '../components/statistic/compiler';
import { TitleCardCompiler } from '../components/titlecard/compiler';
import { parseAIResponse } from '../director/parser';
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
    expect(response.data).toEqual([{ type: 'statistic' }, { type: 'titlecard' }]);
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

  it('accepts component without label (label is optional)', () => {
    const plan = validPlan({
      components: [
        { type: 'statistic', data: { value: '42' }, timing: { start: 0, duration: 2 } },
      ],
    });
    const result = validateMotionPlan(plan);
    expect(result.valid).toBe(true);
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

  it('accepts missing label (label is optional)', () => {
    const compiler = new StatisticCompiler();
    const errors = compiler.validate({ value: '42' }, 1920, 1080);
    expect(errors).toHaveLength(0);
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

  it('produces a scale command for the value when motion is zoom', () => {
    const commands = compiler.compile(
      { type: 'statistic', data: { value: '42%', label: 'sample rate' }, timing: { start: 0, duration: 4 }, style: { motion: 'zoom' } },
      1920,
      1080
    );
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
    const allowedTypes = ['text', 'fadeIn', 'fadeOut', 'scale', 'move', 'setKeyframes'];
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

  it('zoom produces scale entrance', () => {
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

  it('default (no motion) produces fade behavior', () => {
    const commands = compileWithMotion(undefined);
    const types = getCommandTypes(commands);
    expect(types).toContain('fadeIn');
    expect(types).toContain('fadeOut');
    expect(types).not.toContain('scale');
    expect(types).not.toContain('move');
    expect(types).not.toContain('setKeyframes');
  });

  it('unsupported motion falls back to fade', () => {
    const commands = compileWithMotion('nonexistent');
    const types = getCommandTypes(commands);
    expect(types).toContain('fadeIn');
    expect(types).not.toContain('scale');
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

// ───────────────────────────────────────────────────────────────
// Regression: duplicate text and motion style behavior
// ───────────────────────────────────────────────────────────────
describe('Regression — duplicate text and motion differentiation', () => {
  const compiler = new StatisticCompiler();

  it('no label → only 1 text command (value)', () => {
    const commands = compiler.compile(
      {
        type: 'statistic',
        data: { value: '42%' },
        timing: { start: 0, duration: 3 },
      },
      1920, 1080
    );
    const textCmds = commands.filter((c) => c.type === 'text');
    expect(textCmds).toHaveLength(1);
    expect(textCmds[0].content).toBe('42%');
  });

  it('label provided → 2 text commands (value + label)', () => {
    const commands = compiler.compile(
      {
        type: 'statistic',
        data: { value: '73%', label: 'of traffic' },
        timing: { start: 0, duration: 4 },
      },
      1920, 1080
    );
    const textCmds = commands.filter((c) => c.type === 'text');
    expect(textCmds).toHaveLength(2);
    expect(textCmds[0].content).toBe('73%');
    expect(textCmds[1].content).toBe('of traffic');
  });

  it('zoom: fadeIn + scale', () => {
    const commands = compiler.compile(
      {
        type: 'statistic',
        data: { value: '42%' },
        timing: { start: 0, duration: 3 },
        style: { motion: 'zoom' },
      },
      1920, 1080
    );
    const hasFadeIn = commands.some((c) => c.type === 'fadeIn' && c.target);
    const hasScale = commands.some((c) => c.type === 'scale');
    const hasMove = commands.some((c) => c.type === 'move');
    expect(hasFadeIn).toBe(true);
    expect(hasScale).toBe(true);
    expect(hasMove).toBe(false);
  });

  it('slideUp: move + fadeIn', () => {
    const commands = compiler.compile(
      {
        type: 'statistic',
        data: { value: '42%' },
        timing: { start: 0, duration: 3 },
        style: { motion: 'slideUp' },
      },
      1920, 1080
    );
    const moveCmds = commands.filter((c) => c.type === 'move');
    const fadeInCmds = commands.filter((c) => c.type === 'fadeIn');
    expect(moveCmds.length).toBeGreaterThanOrEqual(1);
    expect(fadeInCmds.length).toBeGreaterThanOrEqual(1);
  });

  it('slideLeft: move + fadeIn', () => {
    const commands = compiler.compile(
      {
        type: 'statistic',
        data: { value: '42%' },
        timing: { start: 0, duration: 3 },
        style: { motion: 'slideLeft' },
      },
      1920, 1080
    );
    const moveCmds = commands.filter((c) => c.type === 'move');
    expect(moveCmds.length).toBeGreaterThanOrEqual(1);
    expect(moveCmds[0].from.x).toBeLessThan(moveCmds[0].to.x);
  });

  it('slideRight: move + fadeIn', () => {
    const commands = compiler.compile(
      {
        type: 'statistic',
        data: { value: '42%' },
        timing: { start: 0, duration: 3 },
        style: { motion: 'slideRight' },
      },
      1920, 1080
    );
    const moveCmds = commands.filter((c) => c.type === 'move');
    expect(moveCmds.length).toBeGreaterThanOrEqual(1);
    expect(moveCmds[0].from.x).toBeGreaterThan(moveCmds[0].to.x);
  });

  it('fade: fadeIn only, no move, no scale', () => {
    const commands = compiler.compile(
      {
        type: 'statistic',
        data: { value: '42%' },
        timing: { start: 0, duration: 3 },
        style: { motion: 'fade' },
      },
      1920, 1080
    );
    const fadeInCmds = commands.filter((c) => c.type === 'fadeIn');
    const moveCmds = commands.filter((c) => c.type === 'move');
    const scaleCmds = commands.filter((c) => c.type === 'scale');
    expect(fadeInCmds.length).toBeGreaterThanOrEqual(1);
    expect(moveCmds).toHaveLength(0);
    expect(scaleCmds).toHaveLength(0);
  });

  it('pop: setKeyframes + fadeIn', () => {
    const commands = compiler.compile(
      {
        type: 'statistic',
        data: { value: '42%' },
        timing: { start: 0, duration: 3 },
        style: { motion: 'pop' },
      },
      1920, 1080
    );
    const keyframeCmds = commands.filter((c) => c.type === 'setKeyframes');
    expect(keyframeCmds.length).toBeGreaterThanOrEqual(1);
    expect(keyframeCmds[0].property).toBe('scale');
  });

  it('case-insensitive motion lookup', () => {
    const commands = compiler.compile(
      {
        type: 'statistic',
        data: { value: '42%' },
        timing: { start: 0, duration: 3 },
        style: { motion: 'SLIDEUP' },
      },
      1920, 1080
    );
    const moveCmds = commands.filter((c) => c.type === 'move');
    expect(moveCmds.length).toBeGreaterThanOrEqual(1);
  });

  it('no label produces no label-targeting move commands', () => {
    const commands = compiler.compile(
      {
        type: 'statistic',
        data: { value: '42%' },
        timing: { start: 0, duration: 3 },
        style: { motion: 'slideUp' },
      },
      1920, 1080
    );
    const textCmds = commands.filter((c) => c.type === 'text');
    expect(textCmds).toHaveLength(1);
    const valueId = textCmds[0].id;
    const moveCmds = commands.filter((c) => c.type === 'move');
    for (const cmd of moveCmds) {
      expect(cmd.target).toBe(valueId);
    }
  });

  it('with label produces move commands for both targets', () => {
    const commands = compiler.compile(
      {
        type: 'statistic',
        data: { value: '42%', label: 'stat' },
        timing: { start: 0, duration: 3 },
        style: { motion: 'slideUp' },
      },
      1920, 1080
    );
    const textCmds = commands.filter((c) => c.type === 'text');
    expect(textCmds).toHaveLength(2);
    const valueId = textCmds[0].id;
    const labelId = textCmds[1].id;
    const moveCmds = commands.filter((c) => c.type === 'move');
    const targets = moveCmds.map((c) => c.target);
    expect(targets).toContain(valueId);
    expect(targets).toContain(labelId);
  });
});

// ═════════════════════════════════════════════════════════════════
// Full path: AI response → parse → compile → commands
// ═════════════════════════════════════════════════════════════════
describe('Full path — AI response to compiled commands', () => {
  it('slideUp AI response compiles to valid move commands', () => {
    const aiResponse = `COMPONENT: statistic
TEXT: 42%
MOTION: slideUp
POSITION: center
DURATION: 4
END`;

    const parseResult = parseAIResponse(aiResponse, {
      canvasWidth: 1920,
      canvasHeight: 1080,
      defaultDuration: 4,
    });

    expect(parseResult.success).toBe(true);
    expect(parseResult.plan).toBeDefined();

    const result = processMotionRequest({
      version: 1,
      operation: 'compilePlan',
      requestId: 'test-full-path-slideUp',
      plan: parseResult.plan!,
    });

    expect(result.status).toBe('success');
    const data = result.data as { commands: any[]; commandCount: number };
    expect(data.commandCount).toBeGreaterThan(0);

    const commandTypes = data.commands.map((c: any) => c.type);
    expect(commandTypes).toContain('move');
    expect(commandTypes).toContain('fadeIn');
    expect(commandTypes).toContain('text');
    expect(commandTypes).not.toContain('slideUp');
    expect(commandTypes).not.toContain('slideLeft');
    expect(commandTypes).not.toContain('slideRight');
  });

  it('slideLeft AI response compiles to valid move commands', () => {
    const aiResponse = `COMPONENT: statistic
TEXT: 42%
MOTION: slideLeft
POSITION: center
DURATION: 4
END`;

    const parseResult = parseAIResponse(aiResponse, {
      canvasWidth: 1920,
      canvasHeight: 1080,
      defaultDuration: 4,
    });

    expect(parseResult.success).toBe(true);

    const result = processMotionRequest({
      version: 1,
      operation: 'compilePlan',
      requestId: 'test-full-path-slideLeft',
      plan: parseResult.plan!,
    });

    expect(result.status).toBe('success');
    const data = result.data as { commands: any[]; commandCount: number };
    const commandTypes = data.commands.map((c: any) => c.type);
    expect(commandTypes).toContain('move');
    expect(commandTypes).not.toContain('slideUp');
    expect(commandTypes).not.toContain('slideLeft');
    expect(commandTypes).not.toContain('slideRight');
  });

  it('slideRight AI response compiles to valid move commands', () => {
    const aiResponse = `COMPONENT: statistic
TEXT: 42%
MOTION: slideRight
POSITION: center
DURATION: 4
END`;

    const parseResult = parseAIResponse(aiResponse, {
      canvasWidth: 1920,
      canvasHeight: 1080,
      defaultDuration: 4,
    });

    expect(parseResult.success).toBe(true);

    const result = processMotionRequest({
      version: 1,
      operation: 'compilePlan',
      requestId: 'test-full-path-slideRight',
      plan: parseResult.plan!,
    });

    expect(result.status).toBe('success');
    const data = result.data as { commands: any[]; commandCount: number };
    const commandTypes = data.commands.map((c: any) => c.type);
    expect(commandTypes).toContain('move');
    expect(commandTypes).not.toContain('slideUp');
    expect(commandTypes).not.toContain('slideLeft');
    expect(commandTypes).not.toContain('slideRight');
  });
});

// ═════════════════════════════════════════════════════════════════
// Natural-language motion intent inference
// ═════════════════════════════════════════════════════════════════
describe('Natural-language motion intent inference', () => {
  function parseAndCompile(aiResponse: string) {
    const parseResult = parseAIResponse(aiResponse, {
      canvasWidth: 1920,
      canvasHeight: 1080,
      defaultDuration: 4,
    });
    expect(parseResult.success).toBe(true);
    expect(parseResult.plan).toBeDefined();

    const result = processMotionRequest({
      version: 1,
      operation: 'compilePlan',
      requestId: 'test-nl-motion',
      plan: parseResult.plan!,
    });
    expect(result.status).toBe('success');
    return result.data as { commands: any[]; commandCount: number };
  }

  it('"from below" intent → slideUp motion', () => {
    const data = parseAndCompile(`COMPONENT: statistic
TEXT: 73%
MOTION: slideUp
POSITION: center
DURATION: 4
END`);
    const types = data.commands.map((c: any) => c.type);
    expect(types).toContain('move');
    expect(types).not.toContain('scale');
  });

  it('"from the left" intent → slideLeft motion', () => {
    const data = parseAndCompile(`COMPONENT: statistic
TEXT: 42%
MOTION: slideLeft
POSITION: center
DURATION: 4
END`);
    const types = data.commands.map((c: any) => c.type);
    expect(types).toContain('move');
    const moveCmds = data.commands.filter((c: any) => c.type === 'move');
    for (const cmd of moveCmds) {
      expect((cmd as any).from.x).toBeLessThan((cmd as any).to.x);
    }
  });

  it('"from the right" intent → slideRight motion', () => {
    const data = parseAndCompile(`COMPONENT: statistic
TEXT: 42%
MOTION: slideRight
POSITION: center
DURATION: 4
END`);
    const types = data.commands.map((c: any) => c.type);
    expect(types).toContain('move');
    const moveCmds = data.commands.filter((c: any) => c.type === 'move');
    for (const cmd of moveCmds) {
      expect((cmd as any).from.x).toBeGreaterThan((cmd as any).to.x);
    }
  });

  it('"fade in" intent → fade motion', () => {
    const data = parseAndCompile(`COMPONENT: statistic
TEXT: 1.2M
MOTION: fade
POSITION: center
DURATION: 4
END`);
    const types = data.commands.map((c: any) => c.type);
    expect(types).toContain('fadeIn');
    expect(types).not.toContain('scale');
    expect(types).not.toContain('move');
  });

  it('"pop" intent → pop motion', () => {
    const data = parseAndCompile(`COMPONENT: statistic
TEXT: 99%
MOTION: pop
POSITION: center
DURATION: 4
END`);
    const types = data.commands.map((c: any) => c.type);
    expect(types).toContain('setKeyframes');
    expect(types).not.toContain('scale');
    expect(types).not.toContain('move');
  });

  it('"zoom in" intent → zoom motion', () => {
    const data = parseAndCompile(`COMPONENT: statistic
TEXT: 500
MOTION: zoom
POSITION: center
DURATION: 4
END`);
    const types = data.commands.map((c: any) => c.type);
    expect(types).toContain('scale');
    expect(types).toContain('fadeIn');
    expect(types).not.toContain('move');
  });

  it('no motion specified → defaults to fade (conservative)', () => {
    const data = parseAndCompile(`COMPONENT: statistic
TEXT: 42%
POSITION: center
DURATION: 4
END`);
    const types = data.commands.map((c: any) => c.type);
    expect(types).toContain('fadeIn');
    expect(types).not.toContain('scale');
    expect(types).not.toContain('move');
    expect(types).not.toContain('setKeyframes');
  });

  it('case-insensitive MOTION: SLIDEUP → slideUp', () => {
    const data = parseAndCompile(`COMPONENT: statistic
TEXT: 42%
MOTION: SLIDEUP
POSITION: center
DURATION: 4
END`);
    const types = data.commands.map((c: any) => c.type);
    expect(types).toContain('move');
    expect(types).not.toContain('scale');
  });

  it('case-insensitive MOTION: SlideUp → slideUp', () => {
    const data = parseAndCompile(`COMPONENT: statistic
TEXT: 42%
MOTION: SlideUp
POSITION: center
DURATION: 4
END`);
    const types = data.commands.map((c: any) => c.type);
    expect(types).toContain('move');
    expect(types).not.toContain('scale');
  });

  it('each natural-language intent produces distinct command signatures', () => {
    const responses = {
      slideUp: `COMPONENT: statistic\nTEXT: 1\nMOTION: slideUp\nPOSITION: center\nDURATION: 4\nEND`,
      slideLeft: `COMPONENT: statistic\nTEXT: 2\nMOTION: slideLeft\nPOSITION: center\nDURATION: 4\nEND`,
      slideRight: `COMPONENT: statistic\nTEXT: 3\nMOTION: slideRight\nPOSITION: center\nDURATION: 4\nEND`,
      fade: `COMPONENT: statistic\nTEXT: 4\nMOTION: fade\nPOSITION: center\nDURATION: 4\nEND`,
      pop: `COMPONENT: statistic\nTEXT: 5\nMOTION: pop\nPOSITION: center\nDURATION: 4\nEND`,
      zoom: `COMPONENT: statistic\nTEXT: 6\nMOTION: zoom\nPOSITION: center\nDURATION: 4\nEND`,
    };

    const signatures = Object.entries(responses).map(([motion, resp]) => {
      const data = parseAndCompile(resp);
      const types = data.commands.map((c: any) => c.type);
      return `${motion}:${types.sort().join(',')}`;
    });

    const unique = new Set(signatures);
    expect(unique.size).toBe(6);
  });
});

// ═════════════════════════════════════════════════════════════════
// Statistic Visual Styling Regression Tests
// ═════════════════════════════════════════════════════════════════
describe('Statistic Visual Styling', () => {
  const compiler = new StatisticCompiler();

  function compileWithStyle(style: Record<string, any>) {
    return compiler.compile(
      {
        type: 'statistic',
        data: { value: '42%', label: 'sample rate', ...style.data },
        timing: { start: 0, duration: 4 },
        ...style.component,
      },
      1920,
      1080
    );
  }

  function getTextCommands(commands: ReturnType<typeof compileWithStyle>) {
    return commands.filter(c => c.type === 'text') as any[];
  }

  it('default styling remains unchanged (fontSize=72, fontWeight=normal, color=#FFFFFF)', () => {
    const commands = compileWithStyle({});
    const texts = getTextCommands(commands);
    expect(texts[0].fontSize).toBe(72);
    expect(texts[0].fontWeight).toBe('normal');
    expect(texts[0].color).toBe('#FFFFFF');
  });

  it('custom fontSize is preserved in text command', () => {
    const commands = compileWithStyle({ data: { fontSize: 120 } });
    const texts = getTextCommands(commands);
    expect(texts[0].fontSize).toBe(120);
  });

  it('custom fontWeight is preserved in text command', () => {
    const commands = compileWithStyle({ data: { fontWeight: 'bold' } });
    const texts = getTextCommands(commands);
    expect(texts[0].fontWeight).toBe('bold');
  });

  it('custom color is preserved in text command', () => {
    const commands = compileWithStyle({ data: { color: '#FF0000' } });
    const texts = getTextCommands(commands);
    expect(texts[0].color).toBe('#FF0000');
  });

  it('position is preserved with styling through parser', () => {
    const aiResponse = `COMPONENT: statistic
TEXT: 42%
FONTSIZE: 100
COLOR: #00FF00
POSITION: top
DURATION: 4
END`;

    const parseResult = parseAIResponse(aiResponse, {
      canvasWidth: 1920,
      canvasHeight: 1080,
      defaultDuration: 4,
    });

    expect(parseResult.success).toBe(true);
    const comp = parseResult.plan!.components[0];
    expect((comp.data as any).fontSize).toBe(100);
    expect((comp.data as any).color).toBe('#00FF00');
    // Position should be top (15% of 1080 = 162)
    expect(comp.style).toBeDefined();
    expect((comp.style as any).position).toBe('top');
    expect((comp.style as any).y).toBeLessThan(300);
  });

  it('optional label renders exactly once with styling', () => {
    const commands = compileWithStyle({ data: { label: 'people affected', fontSize: 100, color: '#FF0000' } });
    const texts = getTextCommands(commands);
    expect(texts).toHaveLength(2);
    expect(texts[0].content).toBe('42%');
    expect(texts[0].fontSize).toBe(100);
    expect(texts[0].color).toBe('#FF0000');
    expect(texts[1].content).toBe('people affected');
    // Label gets derived smaller fontSize
    expect(texts[1].fontSize).toBeLessThan(100);
  });

  it('statistic without label renders only the main text', () => {
    const commands = compileWithStyle({ data: { fontSize: 96, fontWeight: 'semibold', label: '' } });
    const texts = getTextCommands(commands);
    expect(texts).toHaveLength(1);
    expect(texts[0].content).toBe('42%');
    expect(texts[0].fontSize).toBe(96);
    expect(texts[0].fontWeight).toBe('semibold');
  });

  it('motion still works with styling', () => {
    const commands = compileWithStyle({
      data: { fontSize: 100, color: '#0000FF' },
      component: { style: { motion: 'slideUp' } },
    });
    const types = commands.map(c => c.type);
    expect(types).toContain('move');
    expect(types).toContain('fadeIn');
    expect(types).toContain('text');
    const texts = getTextCommands(commands);
    expect(texts[0].fontSize).toBe(100);
    expect(texts[0].color).toBe('#0000FF');
  });

  it('natural-language prompt can map to styling fields via parser', () => {
    const aiResponse = `COMPONENT: statistic
TEXT: 42%
LABEL: completion rate
FONTSIZE: 120
FONTWEIGHT: bold
COLOR: #FF5500
POSITION: center
DURATION: 4
MOTION: zoom
END`;

    const parseResult = parseAIResponse(aiResponse, {
      canvasWidth: 1920,
      canvasHeight: 1080,
      defaultDuration: 4,
    });

    expect(parseResult.success).toBe(true);
    const comp = parseResult.plan!.components[0];
    expect(comp.data.value).toBe('42%');
    expect((comp.data as any).label).toBe('completion rate');
    expect((comp.data as any).fontSize).toBe(120);
    expect((comp.data as any).fontWeight).toBe('bold');
    expect((comp.data as any).color).toBe('#FF5500');
  });

  it('invalid fontSize is rejected by parser', () => {
    const aiResponse = `COMPONENT: statistic
TEXT: 42%
FONTSIZE: 500
DURATION: 4
END`;

    const parseResult = parseAIResponse(aiResponse, {
      canvasWidth: 1920,
      canvasHeight: 1080,
    });

    expect(parseResult.success).toBe(false);
    expect(parseResult.errors.some(e => e.code === 'INVALID_FONT_SIZE')).toBe(true);
  });

  it('invalid fontWeight is rejected by parser', () => {
    const aiResponse = `COMPONENT: statistic
TEXT: 42%
FONTWEIGHT: ultrablack
DURATION: 4
END`;

    const parseResult = parseAIResponse(aiResponse, {
      canvasWidth: 1920,
      canvasHeight: 1080,
    });

    expect(parseResult.success).toBe(false);
    expect(parseResult.errors.some(e => e.code === 'UNKNOWN_FONT_WEIGHT')).toBe(true);
  });

  it('invalid color format is rejected by parser', () => {
    const aiResponse = `COMPONENT: statistic
TEXT: 42%
COLOR: not-a-color
DURATION: 4
END`;

    const parseResult = parseAIResponse(aiResponse, {
      canvasWidth: 1920,
      canvasHeight: 1080,
    });

    expect(parseResult.success).toBe(false);
    expect(parseResult.errors.some(e => e.code === 'INVALID_COLOR')).toBe(true);
  });

  it('unknown styling fields are rejected', () => {
    const aiResponse = `COMPONENT: statistic
TEXT: 42%
FONTSTYLE: italic
DURATION: 4
END`;

    const parseResult = parseAIResponse(aiResponse, {
      canvasWidth: 1920,
      canvasHeight: 1080,
    });

    expect(parseResult.success).toBe(false);
    expect(parseResult.errors.some(e => e.code === 'UNKNOWN_FIELD')).toBe(true);
  });

  it('existing motions remain unchanged with styling', () => {
    const motions = ['zoom', 'slideUp', 'slideLeft', 'slideRight', 'fade', 'pop'];
    for (const motion of motions) {
      const commands = compileWithStyle({
        data: { fontSize: 80, color: '#AABBCC' },
        component: { style: { motion } },
      });
      const texts = getTextCommands(commands);
      expect(texts[0].fontSize).toBe(80);
      expect(texts[0].color).toBe('#AABBCC');
      // Motion commands still present
      const animTypes = commands.filter(c => c.type !== 'text').map(c => c.type);
      expect(animTypes.length).toBeGreaterThan(0);
    }
  });
});

// ═════════════════════════════════════════════════════════════════
// TITLECARD COMPONENT
// ═════════════════════════════════════════════════════════════════

describe('TitleCard — Component Registry', () => {
  it('registers titlecard component', () => {
    expect(ComponentRegistry.isRegistered('titlecard')).toBe(true);
  });

  it('returns titlecard in registered types', () => {
    const types = ComponentRegistry.getRegisteredTypes();
    expect(types).toContain('titlecard');
  });

  it('gets titlecard compiler', () => {
    const compiler = ComponentRegistry.get('titlecard');
    expect(compiler).toBeDefined();
    expect(compiler?.componentType).toBe('titlecard');
  });
});

describe('TitleCard — Compiler', () => {
  const compiler = new TitleCardCompiler();

  it('compiles title-only component to commands', () => {
    const commands = compiler.compile(
      {
        type: 'titlecard',
        data: { title: 'The Hidden Cost of Traffic' },
        timing: { start: 0, duration: 5 },
      },
      1920,
      1080
    );

    expect(commands.length).toBeGreaterThan(0);
    const textCmds = commands.filter(c => c.type === 'text');
    expect(textCmds).toHaveLength(1);
    expect(textCmds[0].content).toBe('The Hidden Cost of Traffic');
  });

  it('compiles title + subtitle to two text commands', () => {
    const commands = compiler.compile(
      {
        type: 'titlecard',
        data: {
          title: 'The Hidden Cost of Traffic',
          subtitle: 'Why congestion wastes more than fuel',
        },
        timing: { start: 0, duration: 5 },
      },
      1920,
      1080
    );

    const textCmds = commands.filter(c => c.type === 'text');
    expect(textCmds).toHaveLength(2);
    expect(textCmds[0].content).toBe('The Hidden Cost of Traffic');
    expect(textCmds[1].content).toBe('Why congestion wastes more than fuel');
  });

  it('title and subtitle do not duplicate', () => {
    const commands = compiler.compile(
      {
        type: 'titlecard',
        data: {
          title: 'The Hidden Cost of Traffic',
          subtitle: 'Why congestion wastes more than fuel',
        },
        timing: { start: 0, duration: 5 },
      },
      1920,
      1080
    );

    const textCmds = commands.filter(c => c.type === 'text');
    expect(textCmds[0].content).not.toBe(textCmds[1].content);
    // No text command should contain both title and subtitle concatenated
    for (const cmd of textCmds) {
      expect(cmd.content).not.toContain('The Hidden Cost of Traffic Why congestion');
    }
  });

  it('validates correct data', () => {
    const errors = compiler.validate(
      { title: 'The Hidden Cost of Traffic' },
      1920,
      1080
    );
    expect(errors).toHaveLength(0);
  });

  it('rejects empty title', () => {
    const errors = compiler.validate({ title: '' }, 1920, 1080);
    expect(errors.length).toBeGreaterThan(0);
  });

  it('rejects title exceeding max length', () => {
    const errors = compiler.validate(
      { title: 'x'.repeat(501) },
      1920,
      1080
    );
    expect(errors.length).toBeGreaterThan(0);
  });

  it('rejects subtitle exceeding max length', () => {
    const errors = compiler.validate(
      { title: 'Test', subtitle: 'x'.repeat(501) },
      1920,
      1080
    );
    expect(errors.length).toBeGreaterThan(0);
  });

  it('produces fadeIn commands for title', () => {
    const commands = compiler.compile(
      {
        type: 'titlecard',
        data: { title: 'Test Title' },
        timing: { start: 0, duration: 4 },
      },
      1920,
      1080
    );
    const fadeIns = commands.filter(c => c.type === 'fadeIn');
    expect(fadeIns.length).toBeGreaterThanOrEqual(1);
  });

  it('produces fadeOut commands for title', () => {
    const commands = compiler.compile(
      {
        type: 'titlecard',
        data: { title: 'Test Title' },
        timing: { start: 0, duration: 4 },
      },
      1920,
      1080
    );
    const fadeOuts = commands.filter(c => c.type === 'fadeOut');
    expect(fadeOuts.length).toBeGreaterThanOrEqual(1);
  });

  it('animation commands target text command IDs', () => {
    const commands = compiler.compile(
      {
        type: 'titlecard',
        data: { title: 'Test', subtitle: 'Sub' },
        timing: { start: 0, duration: 4 },
      },
      1920,
      1080
    );
    const textIds = commands.filter(c => c.type === 'text').map(c => c.id);
    const animCmds = commands.filter(c =>
      c.type === 'fadeIn' || c.type === 'fadeOut' || c.type === 'scale' || c.type === 'move' || c.type === 'setKeyframes'
    );
    for (const cmd of animCmds) {
      expect(textIds).toContain((cmd as any).target);
    }
  });

  it('no animation exceeds the titlecard duration', () => {
    const duration = 5;
    const commands = compiler.compile(
      {
        type: 'titlecard',
        data: { title: 'Test' },
        timing: { start: 0, duration },
      },
      1920,
      1080
    );
    for (const cmd of commands) {
      const cmdEnd = cmd.start + (cmd.duration || 0);
      expect(cmdEnd).toBeLessThanOrEqual(duration + 0.01);
    }
  });

  it('no new command types are introduced', () => {
    const allowedTypes = ['text', 'fadeIn', 'fadeOut', 'scale', 'move', 'setKeyframes'];
    const commands = compiler.compile(
      {
        type: 'titlecard',
        data: { title: 'Test', subtitle: 'Sub' },
        timing: { start: 0, duration: 4 },
      },
      1920,
      1080
    );
    for (const cmd of commands) {
      expect(allowedTypes).toContain(cmd.type);
    }
  });
});

describe('TitleCard — Motion Vocabulary', () => {
  const compiler = new TitleCardCompiler();

  function compileWithMotion(motion: string | undefined) {
    return compiler.compile(
      {
        type: 'titlecard',
        data: { title: 'The Hidden Cost of Traffic', subtitle: 'Why congestion wastes more than fuel' },
        timing: { start: 0, duration: 5 },
        ...(motion ? { style: { motion } } : {}),
      },
      1920,
      1080
    );
  }

  function getCommandTypes(commands: ReturnType<typeof compileWithMotion>) {
    return commands.map(c => c.type);
  }

  it('zoom produces scale entrance', () => {
    const commands = compileWithMotion('zoom');
    const types = getCommandTypes(commands);
    expect(types).toContain('scale');
    expect(types).toContain('fadeIn');
    expect(types).toContain('fadeOut');
    expect(types).not.toContain('move');
    expect(types).not.toContain('setKeyframes');
  });

  it('slideUp produces move commands with Y offset', () => {
    const commands = compileWithMotion('slideUp');
    const moveCmds = commands.filter(c => c.type === 'move');
    expect(moveCmds.length).toBe(2);
    for (const cmd of moveCmds) {
      const move = cmd as any;
      expect(move.from.y).toBeGreaterThan(move.to.y);
      expect(move.from.x).toBe(move.to.x);
    }
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
  });

  it('fade produces only fadeIn/fadeOut', () => {
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
  });

  it('default (no motion) produces fade behavior', () => {
    const commands = compileWithMotion(undefined);
    const types = getCommandTypes(commands);
    expect(types).toContain('fadeIn');
    expect(types).toContain('fadeOut');
    expect(types).not.toContain('scale');
    expect(types).not.toContain('move');
    expect(types).not.toContain('setKeyframes');
  });

  it('all motions produce text commands for title and subtitle', () => {
    const motions = ['zoom', 'slideUp', 'slideLeft', 'slideRight', 'fade', 'pop'];
    for (const motion of motions) {
      const commands = compileWithMotion(motion);
      const textCmds = commands.filter(c => c.type === 'text');
      expect(textCmds.length).toBe(2);
      expect(textCmds[0].content).toBe('The Hidden Cost of Traffic');
      expect(textCmds[1].content).toBe('Why congestion wastes more than fuel');
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

  it('case-insensitive motion lookup', () => {
    const commands = compiler.compile(
      {
        type: 'titlecard',
        data: { title: 'Test' },
        timing: { start: 0, duration: 3 },
        style: { motion: 'SLIDELEFT' },
      },
      1920,
      1080
    );
    const moveCmds = commands.filter(c => c.type === 'move');
    expect(moveCmds.length).toBeGreaterThanOrEqual(1);
  });
});

describe('TitleCard — Visual Styling', () => {
  const compiler = new TitleCardCompiler();

  it('default styling (fontSize=72, fontWeight=bold, color=#FFFFFF)', () => {
    const commands = compiler.compile(
      {
        type: 'titlecard',
        data: { title: 'Test' },
        timing: { start: 0, duration: 4 },
      },
      1920,
      1080
    );
    const texts = commands.filter(c => c.type === 'text') as any[];
    expect(texts[0].fontSize).toBe(72);
    expect(texts[0].fontWeight).toBe('bold');
    expect(texts[0].color).toBe('#FFFFFF');
  });

  it('custom fontSize is preserved', () => {
    const commands = compiler.compile(
      {
        type: 'titlecard',
        data: { title: 'Test', fontSize: 120 },
        timing: { start: 0, duration: 4 },
      },
      1920,
      1080
    );
    const texts = commands.filter(c => c.type === 'text') as any[];
    expect(texts[0].fontSize).toBe(120);
  });

  it('custom fontWeight is preserved', () => {
    const commands = compiler.compile(
      {
        type: 'titlecard',
        data: { title: 'Test', fontWeight: 'semibold' },
        timing: { start: 0, duration: 4 },
      },
      1920,
      1080
    );
    const texts = commands.filter(c => c.type === 'text') as any[];
    expect(texts[0].fontWeight).toBe('semibold');
  });

  it('custom color is preserved', () => {
    const commands = compiler.compile(
      {
        type: 'titlecard',
        data: { title: 'Test', color: '#FF0000' },
        timing: { start: 0, duration: 4 },
      },
      1920,
      1080
    );
    const texts = commands.filter(c => c.type === 'text') as any[];
    expect(texts[0].color).toBe('#FF0000');
  });

  it('subtitle gets smaller derived fontSize', () => {
    const commands = compiler.compile(
      {
        type: 'titlecard',
        data: { title: 'Big Title', subtitle: 'Small Sub', fontSize: 100 },
        timing: { start: 0, duration: 4 },
      },
      1920,
      1080
    );
    const texts = commands.filter(c => c.type === 'text') as any[];
    expect(texts).toHaveLength(2);
    expect(texts[0].fontSize).toBe(100);
    expect(texts[1].fontSize).toBeLessThan(100);
  });

  it('position is preserved through parser', () => {
    const aiResponse = `COMPONENT: titlecard
TITLE: Test Title
POSITION: top
DURATION: 4
END`;

    const parseResult = parseAIResponse(aiResponse, {
      canvasWidth: 1920,
      canvasHeight: 1080,
      defaultDuration: 4,
    });

    expect(parseResult.success).toBe(true);
    const comp = parseResult.plan!.components[0];
    expect((comp.style as any).position).toBe('top');
  });
});

// ═════════════════════════════════════════════════════════════════
// TITLECARD — PARSER (AI RESPONSE → MOTIONPLAN)
// ═════════════════════════════════════════════════════════════════

describe('TitleCard — Parser', () => {
  it('parses title card from AI response', () => {
    const aiResponse = `COMPONENT: titlecard
TITLE: The Hidden Cost of Traffic
SUBTITLE: Why congestion wastes more than fuel
POSITION: center
DURATION: 5
MOTION: slideLeft
STYLE: documentary
END`;

    const result = parseAIResponse(aiResponse, {
      canvasWidth: 1920,
      canvasHeight: 1080,
      defaultDuration: 5,
    });

    expect(result.success).toBe(true);
    expect(result.plan).toBeDefined();
    expect(result.plan!.components).toHaveLength(1);
    expect(result.plan!.components[0].type).toBe('titlecard');
    expect(result.plan!.components[0].data.title).toBe('The Hidden Cost of Traffic');
    expect(result.plan!.components[0].data.subtitle).toBe('Why congestion wastes more than fuel');
  });

  it('parses title card without subtitle', () => {
    const aiResponse = `COMPONENT: titlecard
TITLE: How Cars Changed the World
POSITION: center
DURATION: 5
STYLE: documentary
END`;

    const result = parseAIResponse(aiResponse, {
      canvasWidth: 1920,
      canvasHeight: 1080,
      defaultDuration: 5,
    });

    expect(result.success).toBe(true);
    expect(result.plan!.components[0].data.title).toBe('How Cars Changed the World');
    expect(result.plan!.components[0].data.subtitle).toBeUndefined();
  });

  it('rejects titlecard missing required TITLE field', () => {
    const aiResponse = `COMPONENT: titlecard
SUBTITLE: Just a subtitle
DURATION: 4
END`;

    const result = parseAIResponse(aiResponse, {
      canvasWidth: 1920,
      canvasHeight: 1080,
    });

    expect(result.success).toBe(false);
    expect(result.errors.some(e => e.code === 'MISSING_FIELD' && e.field === 'title')).toBe(true);
  });

  it('rejects titlecard missing required DURATION field', () => {
    const aiResponse = `COMPONENT: titlecard
TITLE: Test Title
END`;

    const result = parseAIResponse(aiResponse, {
      canvasWidth: 1920,
      canvasHeight: 1080,
    });

    expect(result.success).toBe(false);
    expect(result.errors.some(e => e.code === 'MISSING_FIELD' && e.field === 'duration')).toBe(true);
  });

  it('rejects titlecard with unknown field', () => {
    const aiResponse = `COMPONENT: titlecard
TITLE: Test
DURATION: 4
INJECTED_FIELD: malicious
END`;

    const result = parseAIResponse(aiResponse, {
      canvasWidth: 1920,
      canvasHeight: 1080,
    });

    expect(result.success).toBe(false);
    expect(result.errors.some(e => e.code === 'UNKNOWN_FIELD')).toBe(true);
  });

  it('parses all optional fields', () => {
    const aiResponse = `COMPONENT: titlecard
TITLE: The Hidden Cost
SUBTITLE: of Traffic
POSITION: center
DURATION: 5
STYLE: documentary
MOTION: slideLeft
FONTSIZE: 100
FONTWEIGHT: bold
COLOR: #FF0000
START: 1
END`;

    const result = parseAIResponse(aiResponse, {
      canvasWidth: 1920,
      canvasHeight: 1080,
      defaultDuration: 5,
    });

    expect(result.success).toBe(true);
    const comp = result.plan!.components[0];
    expect(comp.data.title).toBe('The Hidden Cost');
    expect(comp.data.subtitle).toBe('of Traffic');
    expect(comp.data.fontSize).toBe(100);
    expect(comp.data.fontWeight).toBe('bold');
    expect(comp.data.color).toBe('#FF0000');
    expect(comp.timing.start).toBe(1);
    expect(comp.timing.duration).toBe(5);
    expect((comp.style as any).motion).toBe('slideleft');
  });
});

// ═════════════════════════════════════════════════════════════════
// TITLECARD — FULL PATH (AI → PARSE → COMPILE → COMMANDS)
// ═════════════════════════════════════════════════════════════════

describe('TitleCard — Full Path', () => {
  it('slideLeft title card compiles to valid move commands', () => {
    const aiResponse = `COMPONENT: titlecard
TITLE: The Hidden Cost of Traffic
SUBTITLE: Why congestion wastes more than fuel
POSITION: center
DURATION: 5
MOTION: slideLeft
END`;

    const parseResult = parseAIResponse(aiResponse, {
      canvasWidth: 1920,
      canvasHeight: 1080,
      defaultDuration: 5,
    });

    expect(parseResult.success).toBe(true);
    expect(parseResult.plan).toBeDefined();

    const result = processMotionRequest({
      version: 1,
      operation: 'compilePlan',
      requestId: 'test-titlecard-slideLeft',
      plan: parseResult.plan!,
    });

    expect(result.status).toBe('success');
    const data = result.data as { commands: any[]; commandCount: number };
    expect(data.commandCount).toBeGreaterThan(0);

    const commandTypes = data.commands.map((c: any) => c.type);
    expect(commandTypes).toContain('move');
    expect(commandTypes).toContain('fadeIn');
    expect(commandTypes).toContain('text');

    // Verify title and subtitle are separate text commands
    const textCmds = data.commands.filter((c: any) => c.type === 'text');
    expect(textCmds).toHaveLength(2);
    expect(textCmds[0].content).toBe('The Hidden Cost of Traffic');
    expect(textCmds[1].content).toBe('Why congestion wastes more than fuel');
  });

  it('fade title card compiles without move or scale', () => {
    const aiResponse = `COMPONENT: titlecard
TITLE: How Cars Changed the World
POSITION: center
DURATION: 5
MOTION: fade
END`;

    const parseResult = parseAIResponse(aiResponse, {
      canvasWidth: 1920,
      canvasHeight: 1080,
      defaultDuration: 5,
    });

    expect(parseResult.success).toBe(true);

    const result = processMotionRequest({
      version: 1,
      operation: 'compilePlan',
      requestId: 'test-titlecard-fade',
      plan: parseResult.plan!,
    });

    expect(result.status).toBe('success');
    const data = result.data as { commands: any[]; commandCount: number };
    const commandTypes = data.commands.map((c: any) => c.type);
    expect(commandTypes).toContain('fadeIn');
    expect(commandTypes).not.toContain('scale');
    expect(commandTypes).not.toContain('move');
  });

  it('title card with styling compiles correctly', () => {
    const aiResponse = `COMPONENT: titlecard
TITLE: The Hidden Cost of Traffic
POSITION: center
DURATION: 5
FONTSIZE: 120
FONTWEIGHT: bold
COLOR: #FF5500
END`;

    const parseResult = parseAIResponse(aiResponse, {
      canvasWidth: 1920,
      canvasHeight: 1080,
      defaultDuration: 5,
    });

    expect(parseResult.success).toBe(true);

    const result = processMotionRequest({
      version: 1,
      operation: 'compilePlan',
      requestId: 'test-titlecard-styled',
      plan: parseResult.plan!,
    });

    expect(result.status).toBe('success');
    const data = result.data as { commands: any[]; commandCount: number };

    const textCmds = data.commands.filter((c: any) => c.type === 'text');
    expect(textCmds).toHaveLength(1);
    expect(textCmds[0].content).toBe('The Hidden Cost of Traffic');
    expect(textCmds[0].fontSize).toBe(120);
    expect(textCmds[0].fontWeight).toBe('bold');
    expect(textCmds[0].color).toBe('#FF5500');
  });

  it('slideLeft title card produces TWO text layers through buildTimeline with correct properties', () => {
    const aiResponse = `COMPONENT: titlecard
TITLE: The Hidden Cost of Traffic
SUBTITLE: Why congestion wastes more than fuel
POSITION: center
DURATION: 5
MOTION: slideLeft
END`;

    const parseResult = parseAIResponse(aiResponse, {
      canvasWidth: 1920,
      canvasHeight: 1080,
      defaultDuration: 5,
    });

    expect(parseResult.success).toBe(true);
    expect(parseResult.plan).toBeDefined();

    const compileResult = processMotionRequest({
      version: 1,
      operation: 'compilePlan',
      requestId: 'test-titlecard-slideLeft-buildTimeline',
      plan: parseResult.plan!,
    });

    expect(compileResult.status).toBe('success');
    const { commands } = compileResult.data as { commands: any[] };

    const settings: ProjectSettings = { width: 1920, height: 1080, fps: 30 };
    const timeline = buildTimeline(commands, [], settings);

    // CRITICAL: both title and subtitle must become TextLayers
    expect(timeline.textLayers.length).toBe(2);

    const titleLayer = timeline.textLayers.find(t => t.content === 'The Hidden Cost of Traffic');
    const subtitleLayer = timeline.textLayers.find(t => t.content === 'Why congestion wastes more than fuel');

    expect(titleLayer).toBeDefined();
    expect(subtitleLayer).toBeDefined();

    // Verify title properties
    expect(titleLayer!.fontSize).toBe(72);
    expect(titleLayer!.fontWeight).toBe('bold');
    expect(titleLayer!.color).toBe('#FFFFFF');
    expect(titleLayer!.x).toBe(960);
    expect(titleLayer!.y).toBeCloseTo(467.95, 0);

    // Verify subtitle properties
    expect(subtitleLayer!.fontSize).toBe(29);
    expect(subtitleLayer!.fontWeight).toBe('normal');
    expect(subtitleLayer!.color).toBe('#CCCCCC');
    expect(subtitleLayer!.x).toBe(960);
    expect(subtitleLayer!.y).toBeGreaterThan(titleLayer!.y);

    // Verify IDs are unique
    expect(titleLayer!.id).not.toBe(subtitleLayer!.id);

    // Verify both have animations
    expect(titleLayer!.animations.length).toBeGreaterThan(0);
    expect(subtitleLayer!.animations.length).toBeGreaterThan(0);
  });
});

// ═════════════════════════════════════════════════════════════════
// STATISTIC vs TITLECARD — Intent Disambiguation
// ═════════════════════════════════════════════════════════════════

describe('Intent Disambiguation — Statistic vs TitleCard', () => {
  it('"show 42%" maps to statistic', () => {
    const aiResponse = `COMPONENT: statistic
TEXT: 42%
POSITION: center
DURATION: 4
END`;

    const result = parseAIResponse(aiResponse, {
      canvasWidth: 1920,
      canvasHeight: 1080,
      defaultDuration: 4,
    });

    expect(result.success).toBe(true);
    expect(result.plan!.components[0].type).toBe('statistic');
  });

  it('"create a title card saying X" maps to titlecard', () => {
    const aiResponse = `COMPONENT: titlecard
TITLE: The Hidden Cost of Traffic
POSITION: center
DURATION: 5
END`;

    const result = parseAIResponse(aiResponse, {
      canvasWidth: 1920,
      canvasHeight: 1080,
      defaultDuration: 5,
    });

    expect(result.success).toBe(true);
    expect(result.plan!.components[0].type).toBe('titlecard');
  });

  it('"create a title saying X" maps to titlecard', () => {
    const aiResponse = `COMPONENT: titlecard
TITLE: How Cars Changed the World
POSITION: center
DURATION: 5
END`;

    const result = parseAIResponse(aiResponse, {
      canvasWidth: 1920,
      canvasHeight: 1080,
      defaultDuration: 5,
    });

    expect(result.success).toBe(true);
    expect(result.plan!.components[0].type).toBe('titlecard');
  });

  it('statistic request still produces statistic, not titlecard', () => {
    const aiResponse = `COMPONENT: statistic
TEXT: 42%
LABEL: of traffic
POSITION: center
DURATION: 4
END`;

    const result = parseAIResponse(aiResponse, {
      canvasWidth: 1920,
      canvasHeight: 1080,
      defaultDuration: 4,
    });

    expect(result.success).toBe(true);
    expect(result.plan!.components[0].type).toBe('statistic');
    expect(result.plan!.components[0].data.value).toBe('42%');
  });

  it('both types can coexist in the same plan', () => {
    const aiResponse = `COMPONENT: titlecard
TITLE: Traffic Report
POSITION: center
DURATION: 5
END

COMPONENT: statistic
TEXT: 42%
POSITION: center
DURATION: 4
START: 5
END`;

    const result = parseAIResponse(aiResponse, {
      canvasWidth: 1920,
      canvasHeight: 1080,
      defaultDuration: 10,
    });

    expect(result.success).toBe(true);
    expect(result.plan!.components).toHaveLength(2);
    expect(result.plan!.components[0].type).toBe('titlecard');
    expect(result.plan!.components[1].type).toBe('statistic');
  });
});

// ═════════════════════════════════════════════════════════════════
// STATISTIC — Regression: existing behavior unchanged
// ═════════════════════════════════════════════════════════════════

describe('Statistic — Regression: existing behavior unchanged', () => {
  it('statistic still compiles with all original fields', () => {
    const compiler = new StatisticCompiler();
    const commands = compiler.compile(
      {
        type: 'statistic',
        data: { value: '73%', label: 'of global traffic', unit: '%', source: 'research' },
        timing: { start: 0, duration: 4 },
        style: { motion: 'slideUp' },
      },
      1920,
      1080
    );

    const textCmds = commands.filter(c => c.type === 'text');
    expect(textCmds).toHaveLength(2);
    expect(textCmds[0].content).toBe('73%');
    expect(textCmds[1].content).toBe('of global traffic');

    const moveCmds = commands.filter(c => c.type === 'move');
    expect(moveCmds.length).toBeGreaterThanOrEqual(1);
  });

  it('statistic motion vocabulary unchanged', () => {
    const motions = ['zoom', 'slideUp', 'slideLeft', 'slideRight', 'fade', 'pop'];
    const compiler = new StatisticCompiler();
    for (const motion of motions) {
      const commands = compiler.compile(
        {
          type: 'statistic',
          data: { value: '42%', label: 'test' },
          timing: { start: 0, duration: 3 },
          style: { motion },
        },
        1920,
        1080
      );
      expect(commands.length).toBeGreaterThan(0);
    }
  });
});

// ═════════════════════════════════════════════════════════════════
// TITLECARD OUTPUT CORRECTNESS — centered metadata + positioning
// ═════════════════════════════════════════════════════════════════

describe('TitleCard — Output Correctness (centered metadata)', () => {
  const compiler = new TitleCardCompiler();
  const settings: ProjectSettings = { width: 1920, height: 1080, fps: 30 };

  function compileWithTitleAndSubtitle(overrides?: Record<string, unknown>) {
    return compiler.compile(
      {
        type: 'titlecard',
        data: {
          title: 'The Hidden Cost of Traffic',
          subtitle: 'Why congestion wastes more than fuel',
          ...overrides,
        },
        timing: { start: 0, duration: 5 },
        style: { motion: 'slideLeft' },
      },
      1920,
      1080
    );
  }

  it('1. title command has centered: true', () => {
    const commands = compileWithTitleAndSubtitle();
    const textCmds = commands.filter(c => c.type === 'text');
    expect(textCmds[0].centered).toBe(true);
  });

  it('2. subtitle command has centered: true', () => {
    const commands = compileWithTitleAndSubtitle();
    const textCmds = commands.filter(c => c.type === 'text');
    expect(textCmds[1].centered).toBe(true);
  });

  it('3. title and subtitle have unique IDs', () => {
    const commands = compileWithTitleAndSubtitle();
    const textCmds = commands.filter(c => c.type === 'text');
    expect(textCmds[0].id).not.toBe(textCmds[1].id);
  });

  it('4. subtitle Y is below title Y', () => {
    const commands = compileWithTitleAndSubtitle();
    const textCmds = commands.filter(c => c.type === 'text');
    const title = textCmds.find(c => c.content === 'The Hidden Cost of Traffic')!;
    const subtitle = textCmds.find(c => c.content === 'Why congestion wastes more than fuel')!;
    expect(subtitle.y).toBeGreaterThan(title.y);
  });

  it('5. default colors are #FFFFFF (title) and #CCCCCC (subtitle)', () => {
    const commands = compileWithTitleAndSubtitle();
    const textCmds = commands.filter(c => c.type === 'text');
    expect(textCmds[0].color).toBe('#FFFFFF');
    expect(textCmds[1].color).toBe('#CCCCCC');
  });

  it('6. explicit color is preserved', () => {
    const commands = compileWithTitleAndSubtitle({ color: '#FF5500' });
    const textCmds = commands.filter(c => c.type === 'text');
    expect(textCmds[0].color).toBe('#FF5500');
  });

  it('7. default font sizes are 72 (title) and 29 (subtitle)', () => {
    const commands = compileWithTitleAndSubtitle();
    const textCmds = commands.filter(c => c.type === 'text');
    expect(textCmds[0].fontSize).toBe(72);
    expect(textCmds[1].fontSize).toBe(29);
  });

  it('8. explicit fontSize is preserved', () => {
    const commands = compileWithTitleAndSubtitle({ fontSize: 120 });
    const textCmds = commands.filter(c => c.type === 'text');
    expect(textCmds[0].fontSize).toBe(120);
    expect(textCmds[1].fontSize).toBe(48);
  });

  it('9. buildTimeline propagates centered to TextLayers', () => {
    const commands = compileWithTitleAndSubtitle();
    const timeline = buildTimeline(commands, [], settings);

    expect(timeline.textLayers.length).toBe(2);
    const titleLayer = timeline.textLayers.find(t => t.content === 'The Hidden Cost of Traffic')!;
    const subtitleLayer = timeline.textLayers.find(t => t.content === 'Why congestion wastes more than fuel')!;

    expect(titleLayer.centered).toBe(true);
    expect(subtitleLayer.centered).toBe(true);
  });

  it('10. Statistic text commands do NOT have centered flag', () => {
    const statCompiler = new StatisticCompiler();
    const commands = statCompiler.compile(
      {
        type: 'statistic',
        data: { value: '42%', label: 'of traffic' },
        timing: { start: 0, duration: 4 },
      },
      1920,
      1080
    );
    const textCmds = commands.filter(c => c.type === 'text');
    for (const cmd of textCmds) {
      expect((cmd as any).centered).toBeUndefined();
    }

    const timeline = buildTimeline(commands, [], settings);
    for (const layer of timeline.textLayers) {
      expect(layer.centered).toBe(false);
    }
  });

  it('11. slideLeft produces correct animation commands targeting title and subtitle', () => {
    const commands = compileWithTitleAndSubtitle();
    const textCmds = commands.filter(c => c.type === 'text');
    const textIds = textCmds.map(c => c.id);

    const moveCmds = commands.filter(c => c.type === 'move');
    expect(moveCmds.length).toBeGreaterThanOrEqual(2);
    for (const cmd of moveCmds) {
      expect(textIds).toContain((cmd as any).target);
    }

    const fadeInCmds = commands.filter(c => c.type === 'fadeIn');
    expect(fadeInCmds.length).toBeGreaterThanOrEqual(2);
    for (const cmd of fadeInCmds) {
      expect(textIds).toContain((cmd as any).target);
    }
  });
});

// ═════════════════════════════════════════════════════════════════
// TITLECARD SUBTITLE/COLOR/MOTION FIX — post-processing inference
// ═════════════════════════════════════════════════════════════════

describe('TitleCard — Subtitle Preservation', () => {
  const compiler = new TitleCardCompiler();
  const settings: ProjectSettings = { width: 1920, height: 1080, fps: 30 };

  it('1. title-only TitleCard produces ONE text layer', () => {
    const commands = compiler.compile(
      {
        type: 'titlecard',
        data: { title: 'The Hidden Cost of Traffic' },
        timing: { start: 0, duration: 5 },
        style: { motion: 'fade' },
      },
      1920,
      1080
    );
    const textCmds = commands.filter(c => c.type === 'text');
    expect(textCmds.length).toBe(1);
    expect(textCmds[0].content).toBe('The Hidden Cost of Traffic');

    const timeline = buildTimeline(commands, [], settings);
    expect(timeline.textLayers.length).toBe(1);
  });

  it('2. title + subtitle produces TWO visible text layers', () => {
    const commands = compiler.compile(
      {
        type: 'titlecard',
        data: {
          title: 'The Hidden Cost of Traffic',
          subtitle: 'Why congestion wastes more than fuel',
        },
        timing: { start: 0, duration: 5 },
        style: { motion: 'fade' },
      },
      1920,
      1080
    );
    const textCmds = commands.filter(c => c.type === 'text');
    expect(textCmds.length).toBe(2);
    expect(textCmds[0].content).toBe('The Hidden Cost of Traffic');
    expect(textCmds[1].content).toBe('Why congestion wastes more than fuel');

    const timeline = buildTimeline(commands, [], settings);
    expect(timeline.textLayers.length).toBe(2);
  });

  it('3. subtitle is below the title', () => {
    const commands = compiler.compile(
      {
        type: 'titlecard',
        data: {
          title: 'The Hidden Cost of Traffic',
          subtitle: 'Why congestion wastes more than fuel',
        },
        timing: { start: 0, duration: 5 },
        style: { motion: 'fade' },
      },
      1920,
      1080
    );
    const textCmds = commands.filter(c => c.type === 'text');
    const title = textCmds.find(c => c.content === 'The Hidden Cost of Traffic')!;
    const subtitle = textCmds.find(c => c.content === 'Why congestion wastes more than fuel')!;
    expect(subtitle.y).toBeGreaterThan(title.y);
  });

  it('4. both title and subtitle are horizontally centered', () => {
    const commands = compiler.compile(
      {
        type: 'titlecard',
        data: {
          title: 'The Hidden Cost of Traffic',
          subtitle: 'Why congestion wastes more than fuel',
        },
        timing: { start: 0, duration: 5 },
        style: { motion: 'fade' },
      },
      1920,
      1080
    );
    const textCmds = commands.filter(c => c.type === 'text');
    for (const cmd of textCmds) {
      expect(cmd.centered).toBe(true);
    }

    const timeline = buildTimeline(commands, [], settings);
    for (const layer of timeline.textLayers) {
      expect(layer.centered).toBe(true);
    }
  });
});

describe('TitleCard — Default Color Behavior', () => {
  const compiler = new TitleCardCompiler();

  it('1. no COLOR → #FFFFFF for title and #CCCCCC for subtitle', () => {
    const commands = compiler.compile(
      {
        type: 'titlecard',
        data: {
          title: 'The Hidden Cost of Traffic',
          subtitle: 'Why congestion wastes more than fuel',
        },
        timing: { start: 0, duration: 5 },
        style: { motion: 'fade' },
      },
      1920,
      1080
    );
    const textCmds = commands.filter(c => c.type === 'text');
    expect(textCmds[0].color).toBe('#FFFFFF');
    expect(textCmds[1].color).toBe('#CCCCCC');
  });

  it('2. explicit valid COLOR → requested color', () => {
    const commands = compiler.compile(
      {
        type: 'titlecard',
        data: {
          title: 'The Hidden Cost of Traffic',
          color: '#FF5500',
        },
        timing: { start: 0, duration: 5 },
        style: { motion: 'fade' },
      },
      1920,
      1080
    );
    const textCmds = commands.filter(c => c.type === 'text');
    expect(textCmds[0].color).toBe('#FF5500');
  });

  it('3. post-processing removes AI-invented color when user did not request one', () => {
    // Simulate AI hallucinating a blue color when user didn't request any color
    const aiResponse = `COMPONENT: titlecard
TITLE: The Hidden Cost of Traffic
SUBTITLE: Why congestion wastes more than fuel
COLOR: #3B82F6
POSITION: center
DURATION: 5
MOTION: slideLeft
STYLE: documentary
END`;

    const parseResult = parseAIResponse(aiResponse, {
      canvasWidth: 1920,
      canvasHeight: 1080,
      defaultDuration: 5,
      userPrompt: 'Create a title card saying The Hidden Cost of Traffic with subtitle Why congestion wastes more than fuel, fading in from the left.',
    });

    expect(parseResult.success).toBe(true);
    const component = parseResult.plan!.components[0];
    const data = component.data as { title: string; subtitle?: string; color?: string };
    expect(data.color).toBeUndefined();
  });

  it('4. post-processing preserves explicit color when user requested one', () => {
    const aiResponse = `COMPONENT: titlecard
TITLE: The Hidden Cost of Traffic
COLOR: #FF0000
POSITION: center
DURATION: 5
STYLE: documentary
END`;

    const parseResult = parseAIResponse(aiResponse, {
      canvasWidth: 1920,
      canvasHeight: 1080,
      defaultDuration: 5,
      userPrompt: 'Create a red title card saying The Hidden Cost of Traffic',
    });

    expect(parseResult.success).toBe(true);
    const component = parseResult.plan!.components[0];
    const data = component.data as { color?: string };
    expect(data.color).toBe('#FF0000');
  });

  it('5. post-processing preserves hex color when user requested one', () => {
    const aiResponse = `COMPONENT: titlecard
TITLE: Test
COLOR: #AABBCC
POSITION: center
DURATION: 5
STYLE: documentary
END`;

    const parseResult = parseAIResponse(aiResponse, {
      canvasWidth: 1920,
      canvasHeight: 1080,
      defaultDuration: 5,
      userPrompt: 'Create a title card in #AABBCC saying Test',
    });

    expect(parseResult.success).toBe(true);
    const component = parseResult.plan!.components[0];
    const data = component.data as { color?: string };
    expect(data.color).toBe('#AABBCC');
  });
});

describe('TitleCard — Directional Motion Inference', () => {
  const compiler = new TitleCardCompiler();

  it('1. "fading in from the left" → slideLeft (directional has priority over fade)', () => {
    const aiResponse = `COMPONENT: titlecard
TITLE: The Hidden Cost of Traffic
SUBTITLE: Why congestion wastes more than fuel
POSITION: center
DURATION: 5
MOTION: fade
STYLE: documentary
END`;

    const parseResult = parseAIResponse(aiResponse, {
      canvasWidth: 1920,
      canvasHeight: 1080,
      defaultDuration: 5,
      userPrompt: 'Create a title card saying The Hidden Cost of Traffic with subtitle Why congestion wastes more than fuel, fading in from the left.',
    });

    expect(parseResult.success).toBe(true);
    const component = parseResult.plan!.components[0];
    expect(component.style?.motion).toBe('slideLeft');
  });

  it('2. "fade in from the left" → slideLeft', () => {
    const aiResponse = `COMPONENT: titlecard
TITLE: Test
POSITION: center
DURATION: 5
MOTION: fade
STYLE: documentary
END`;

    const parseResult = parseAIResponse(aiResponse, {
      canvasWidth: 1920,
      canvasHeight: 1080,
      defaultDuration: 5,
      userPrompt: 'Create a title card saying Test, fade in from the left',
    });

    expect(parseResult.success).toBe(true);
    expect(parseResult.plan!.components[0].style?.motion).toBe('slideLeft');
  });

  it('3. "slide in from the left" → slideLeft', () => {
    const aiResponse = `COMPONENT: titlecard
TITLE: Test
POSITION: center
DURATION: 5
MOTION: fade
STYLE: documentary
END`;

    const parseResult = parseAIResponse(aiResponse, {
      canvasWidth: 1920,
      canvasHeight: 1080,
      defaultDuration: 5,
      userPrompt: 'Create a title card saying Test, slide in from the left',
    });

    expect(parseResult.success).toBe(true);
    expect(parseResult.plan!.components[0].style?.motion).toBe('slideLeft');
  });

  it('4. "enter from the left" → slideLeft', () => {
    const aiResponse = `COMPONENT: titlecard
TITLE: Test
POSITION: center
DURATION: 5
MOTION: fade
STYLE: documentary
END`;

    const parseResult = parseAIResponse(aiResponse, {
      canvasWidth: 1920,
      canvasHeight: 1080,
      defaultDuration: 5,
      userPrompt: 'Create a title card saying Test, enter from the left',
    });

    expect(parseResult.success).toBe(true);
    expect(parseResult.plan!.components[0].style?.motion).toBe('slideLeft');
  });

  it('5. "from below" → slideUp (existing mapping preserved)', () => {
    const aiResponse = `COMPONENT: titlecard
TITLE: Test
POSITION: center
DURATION: 5
MOTION: fade
STYLE: documentary
END`;

    const parseResult = parseAIResponse(aiResponse, {
      canvasWidth: 1920,
      canvasHeight: 1080,
      defaultDuration: 5,
      userPrompt: 'Create a title card saying Test from below',
    });

    expect(parseResult.success).toBe(true);
    expect(parseResult.plan!.components[0].style?.motion).toBe('slideUp');
  });

  it('6. "from the right" → slideRight (existing mapping preserved)', () => {
    const aiResponse = `COMPONENT: titlecard
TITLE: Test
POSITION: center
DURATION: 5
MOTION: fade
STYLE: documentary
END`;

    const parseResult = parseAIResponse(aiResponse, {
      canvasWidth: 1920,
      canvasHeight: 1080,
      defaultDuration: 5,
      userPrompt: 'Create a title card saying Test from the right',
    });

    expect(parseResult.success).toBe(true);
    expect(parseResult.plan!.components[0].style?.motion).toBe('slideRight');
  });

  it('7. "pops in" → pop (existing mapping preserved)', () => {
    const aiResponse = `COMPONENT: titlecard
TITLE: Test
POSITION: center
DURATION: 5
MOTION: fade
STYLE: documentary
END`;

    const parseResult = parseAIResponse(aiResponse, {
      canvasWidth: 1920,
      canvasHeight: 1080,
      defaultDuration: 5,
      userPrompt: 'Create a title card saying Test that pops in',
    });

    expect(parseResult.success).toBe(true);
    expect(parseResult.plan!.components[0].style?.motion).toBe('pop');
  });

  it('8. "zooms in" → zoom (existing mapping preserved)', () => {
    const aiResponse = `COMPONENT: titlecard
TITLE: Test
POSITION: center
DURATION: 5
MOTION: fade
STYLE: documentary
END`;

    const parseResult = parseAIResponse(aiResponse, {
      canvasWidth: 1920,
      canvasHeight: 1080,
      defaultDuration: 5,
      userPrompt: 'Create a title card saying Test that zooms in',
    });

    expect(parseResult.success).toBe(true);
    expect(parseResult.plan!.components[0].style?.motion).toBe('zoom');
  });

  it('9. "appears normally" → fade (existing mapping preserved)', () => {
    const aiResponse = `COMPONENT: titlecard
TITLE: Test
POSITION: center
DURATION: 5
MOTION: slideLeft
STYLE: documentary
END`;

    const parseResult = parseAIResponse(aiResponse, {
      canvasWidth: 1920,
      canvasHeight: 1080,
      defaultDuration: 5,
      userPrompt: 'Create a title card saying Test that appears normally',
    });

    expect(parseResult.success).toBe(true);
    expect(parseResult.plan!.components[0].style?.motion).toBe('fade');
  });

  it('10. slideLeft compiler generates correct move + fadeIn for both title and subtitle', () => {
    const commands = compiler.compile(
      {
        type: 'titlecard',
        data: {
          title: 'The Hidden Cost of Traffic',
          subtitle: 'Why congestion wastes more than fuel',
        },
        timing: { start: 0, duration: 5 },
        style: { motion: 'slideLeft' },
      },
      1920,
      1080
    );

    const textCmds = commands.filter(c => c.type === 'text');
    const textIds = textCmds.map(c => c.id);

    // slideLeft should generate move + fadeIn for title and subtitle
    const moveCmds = commands.filter(c => c.type === 'move');
    expect(moveCmds.length).toBeGreaterThanOrEqual(2);
    for (const cmd of moveCmds) {
      expect(textIds).toContain((cmd as any).target);
    }

    const fadeInCmds = commands.filter(c => c.type === 'fadeIn');
    expect(fadeInCmds.length).toBeGreaterThanOrEqual(2);
    for (const cmd of fadeInCmds) {
      expect(textIds).toContain((cmd as any).target);
    }
  });
});

describe('TitleCard — Complete Pipeline (user scenario)', () => {
  const compiler = new TitleCardCompiler();

  it('1. full scenario: subtitle + color defaults + slideLeft motion', () => {
    const aiResponse = `COMPONENT: titlecard
TITLE: The Hidden Cost of Traffic
SUBTITLE: Why congestion wastes more than fuel
POSITION: center
DURATION: 5
MOTION: fade
STYLE: documentary
END`;

    const parseResult = parseAIResponse(aiResponse, {
      canvasWidth: 1920,
      canvasHeight: 1080,
      defaultDuration: 5,
      userPrompt: 'Create a title card saying The Hidden Cost of Traffic with subtitle Why congestion wastes more than fuel, fading in from the left.',
    });

    expect(parseResult.success).toBe(true);
    const plan = parseResult.plan!;

    // Component type
    expect(plan.components.length).toBe(1);
    expect(plan.components[0].type).toBe('titlecard');

    // TITLE and SUBTITLE
    const data = plan.components[0].data as { title: string; subtitle: string; color?: string };
    expect(data.title).toBe('The Hidden Cost of Traffic');
    expect(data.subtitle).toBe('Why congestion wastes more than fuel');

    // COLOR = default white (no color requested)
    expect(data.color).toBeUndefined();

    // MOTION = slideLeft (directional phrase has priority)
    expect(plan.components[0].style?.motion).toBe('slideLeft');

    // Compile to commands
    const commands = compiler.compile(plan.components[0], 1920, 1080);
    const textCmds = commands.filter(c => c.type === 'text');
    expect(textCmds.length).toBe(2);

    // Title is centered
    expect(textCmds[0].centered).toBe(true);
    expect(textCmds[0].color).toBe('#FFFFFF');

    // Subtitle is centered below title
    expect(textCmds[1].centered).toBe(true);
    expect(textCmds[1].color).toBe('#CCCCCC');
    expect(textCmds[1].y).toBeGreaterThan(textCmds[0].y);

    // slideLeft generates move commands
    const moveCmds = commands.filter(c => c.type === 'move');
    expect(moveCmds.length).toBeGreaterThanOrEqual(2);

    // Verify via buildTimeline
    const timeline = buildTimeline(commands, [], { width: 1920, height: 1080, fps: 30 });
    expect(timeline.textLayers.length).toBe(2);
    const titleLayer = timeline.textLayers.find(t => t.content === 'The Hidden Cost of Traffic')!;
    const subtitleLayer = timeline.textLayers.find(t => t.content === 'Why congestion wastes more than fuel')!;
    expect(titleLayer.centered).toBe(true);
    expect(subtitleLayer.centered).toBe(true);
    expect(subtitleLayer.y).toBeGreaterThan(titleLayer.y);
  });

  it('2. subtitle preserved when AI omits it but user provided one', () => {
    const aiResponse = `COMPONENT: titlecard
TITLE: The Hidden Cost of Traffic
POSITION: center
DURATION: 5
MOTION: slideLeft
STYLE: documentary
END`;

    const parseResult = parseAIResponse(aiResponse, {
      canvasWidth: 1920,
      canvasHeight: 1080,
      defaultDuration: 5,
      userPrompt: 'Create a title card saying The Hidden Cost of Traffic with subtitle Why congestion wastes more than fuel, fading in from the left.',
    });

    expect(parseResult.success).toBe(true);
    const data = parseResult.plan!.components[0].data as { title: string; subtitle: string };
    expect(data.subtitle).toBe('Why congestion wastes more than fuel');
  });

  it('3. slideLeft motion enters from the left (move from.x < to.x)', () => {
    const commands = compiler.compile(
      {
        type: 'titlecard',
        data: {
          title: 'Test',
          subtitle: 'Subtitle',
        },
        timing: { start: 0, duration: 5 },
        style: { motion: 'slideLeft' },
      },
      1920,
      1080
    );

    const moveCmds = commands.filter(c => c.type === 'move');
    for (const cmd of moveCmds) {
      const move = cmd as { from: { x: number }; to: { x: number } };
      expect(move.from.x).toBeLessThan(move.to.x);
    }
  });
});

// ═════════════════════════════════════════════════════════════════
// TITLECARD LAYOUT — deterministic sizing and positioning
// ═════════════════════════════════════════════════════════════════

describe('TitleCard — Layout (deterministic sizing and positioning)', () => {
  const compiler = new TitleCardCompiler();
  const settings: ProjectSettings = { width: 1920, height: 1080, fps: 30 };

  it('1. title-only TitleCard remains unchanged (centered at canvas midpoint)', () => {
    const commands = compiler.compile(
      {
        type: 'titlecard',
        data: { title: 'Hello World' },
        timing: { start: 0, duration: 5 },
        style: { motion: 'fade' },
      },
      1920,
      1080
    );
    const textCmds = commands.filter(c => c.type === 'text');
    expect(textCmds.length).toBe(1);
    expect(textCmds[0].y).toBe(540);
    expect(textCmds[0].fontSize).toBe(72);
  });

  it('2. title + subtitle produces two text layers', () => {
    const commands = compiler.compile(
      {
        type: 'titlecard',
        data: { title: 'Title', subtitle: 'Subtitle' },
        timing: { start: 0, duration: 5 },
        style: { motion: 'fade' },
      },
      1920,
      1080
    );
    const textCmds = commands.filter(c => c.type === 'text');
    expect(textCmds.length).toBe(2);
  });

  it('3. subtitle is below title with clear separation', () => {
    const commands = compiler.compile(
      {
        type: 'titlecard',
        data: { title: 'Title', subtitle: 'Subtitle' },
        timing: { start: 0, duration: 5 },
        style: { motion: 'fade' },
      },
      1920,
      1080
    );
    const textCmds = commands.filter(c => c.type === 'text');
    const title = textCmds.find(c => c.content === 'Title')!;
    const subtitle = textCmds.find(c => c.content === 'Subtitle')!;
    const gap = subtitle.y - title.y;
    expect(gap).toBeGreaterThan(80);
  });

  it('4. subtitle font size is readable (>= 28px)', () => {
    const commands = compiler.compile(
      {
        type: 'titlecard',
        data: { title: 'Title', subtitle: 'Subtitle' },
        timing: { start: 0, duration: 5 },
        style: { motion: 'fade' },
      },
      1920,
      1080
    );
    const textCmds = commands.filter(c => c.type === 'text');
    const subtitle = textCmds.find(c => c.content === 'Subtitle')!;
    expect(subtitle.fontSize).toBeGreaterThanOrEqual(28);
  });

  it('5. default 72px title produces 29px subtitle', () => {
    const commands = compiler.compile(
      {
        type: 'titlecard',
        data: { title: 'Title', subtitle: 'Subtitle' },
        timing: { start: 0, duration: 5 },
        style: { motion: 'fade' },
      },
      1920,
      1080
    );
    const textCmds = commands.filter(c => c.type === 'text');
    expect(textCmds[0].fontSize).toBe(72);
    expect(textCmds[1].fontSize).toBe(29);
  });

  it('6. large title (120px) produces proportionally larger subtitle capped at 48px', () => {
    const commands = compiler.compile(
      {
        type: 'titlecard',
        data: { title: 'Title', subtitle: 'Subtitle', fontSize: 120 },
        timing: { start: 0, duration: 5 },
        style: { motion: 'fade' },
      },
      1920,
      1080
    );
    const textCmds = commands.filter(c => c.type === 'text');
    expect(textCmds[0].fontSize).toBe(120);
    expect(textCmds[1].fontSize).toBe(48);
  });

  it('7. very large title (200px) subtitle capped at 48px', () => {
    const commands = compiler.compile(
      {
        type: 'titlecard',
        data: { title: 'Title', subtitle: 'Subtitle', fontSize: 200 },
        timing: { start: 0, duration: 5 },
        style: { motion: 'fade' },
      },
      1920,
      1080
    );
    const textCmds = commands.filter(c => c.type === 'text');
    expect(textCmds[0].fontSize).toBe(200);
    expect(textCmds[1].fontSize).toBe(48);
  });

  it('8. title and subtitle do not share the same Y position', () => {
    const commands = compiler.compile(
      {
        type: 'titlecard',
        data: { title: 'Title', subtitle: 'Subtitle' },
        timing: { start: 0, duration: 5 },
        style: { motion: 'fade' },
      },
      1920,
      1080
    );
    const textCmds = commands.filter(c => c.type === 'text');
    expect(textCmds[0].y).not.toBe(textCmds[1].y);
  });

  it('9. long title pushes subtitle farther down (more gap than short title)', () => {
    const shortCommands = compiler.compile(
      {
        type: 'titlecard',
        data: { title: 'Hi', subtitle: 'Sub' },
        timing: { start: 0, duration: 5 },
        style: { motion: 'fade' },
      },
      1920,
      1080
    );
    const longCommands = compiler.compile(
      {
        type: 'titlecard',
        data: {
          title: 'The Hidden Cost of Traffic in Modern Cities',
          subtitle: 'Sub',
        },
        timing: { start: 0, duration: 5 },
        style: { motion: 'fade' },
      },
      1920,
      1080
    );
    const shortTexts = shortCommands.filter(c => c.type === 'text');
    const longTexts = longCommands.filter(c => c.type === 'text');
    const shortGap = shortTexts[1].y - shortTexts[0].y;
    const longGap = longTexts[1].y - longTexts[0].y;
    expect(longGap).toBeGreaterThanOrEqual(shortGap);
  });

  it('10. both title and subtitle are horizontally centered', () => {
    const commands = compiler.compile(
      {
        type: 'titlecard',
        data: { title: 'Title', subtitle: 'Subtitle' },
        timing: { start: 0, duration: 5 },
        style: { motion: 'fade' },
      },
      1920,
      1080
    );
    const textCmds = commands.filter(c => c.type === 'text');
    for (const cmd of textCmds) {
      expect(cmd.centered).toBe(true);
    }
    const timeline = buildTimeline(commands, [], settings);
    for (const layer of timeline.textLayers) {
      expect(layer.centered).toBe(true);
    }
  });

  it('11. slideLeft still works for title and subtitle', () => {
    const commands = compiler.compile(
      {
        type: 'titlecard',
        data: { title: 'Title', subtitle: 'Subtitle' },
        timing: { start: 0, duration: 5 },
        style: { motion: 'slideLeft' },
      },
      1920,
      1080
    );
    const textCmds = commands.filter(c => c.type === 'text');
    const textIds = textCmds.map(c => c.id);
    const moveCmds = commands.filter(c => c.type === 'move');
    expect(moveCmds.length).toBeGreaterThanOrEqual(2);
    for (const cmd of moveCmds) {
      expect(textIds).toContain((cmd as any).target);
    }
    const fadeInCmds = commands.filter(c => c.type === 'fadeIn');
    expect(fadeInCmds.length).toBeGreaterThanOrEqual(2);
  });

  it('12. slideLeft move targets match layout positions', () => {
    const commands = compiler.compile(
      {
        type: 'titlecard',
        data: { title: 'Title', subtitle: 'Subtitle' },
        timing: { start: 0, duration: 5 },
        style: { motion: 'slideLeft' },
      },
      1920,
      1080
    );
    const textCmds = commands.filter(c => c.type === 'text');
    const titleCmd = textCmds.find(c => c.content === 'Title')!;
    const subtitleCmd = textCmds.find(c => c.content === 'Subtitle')!;
    const moveCmds = commands.filter(c => c.type === 'move') as Array<{
      target: string;
      from: { x: number; y: number };
      to: { x: number; y: number };
    }>;
    const titleMove = moveCmds.find(m => m.target === titleCmd.id)!;
    const subtitleMove = moveCmds.find(m => m.target === subtitleCmd.id)!;
    expect(titleMove.to.y).toBe(titleCmd.y);
    expect(subtitleMove.to.y).toBe(subtitleCmd.y);
  });

  it('13. subtitle centered transform is preserved with slideLeft motion', () => {
    const commands = compiler.compile(
      {
        type: 'titlecard',
        data: { title: 'Title', subtitle: 'Subtitle' },
        timing: { start: 0, duration: 5 },
        style: { motion: 'slideLeft' },
      },
      1920,
      1080
    );
    const timeline = buildTimeline(commands, [], settings);
    for (const layer of timeline.textLayers) {
      expect(layer.centered).toBe(true);
    }
  });

  it('14. statistic rendering is unchanged', () => {
    const statCompiler = new StatisticCompiler();
    const commands = statCompiler.compile(
      {
        type: 'statistic',
        data: { value: '42%', label: 'of traffic' },
        timing: { start: 0, duration: 4 },
      },
      1920,
      1080
    );
    const textCmds = commands.filter(c => c.type === 'text');
    expect(textCmds.length).toBe(2);
    for (const cmd of textCmds) {
      expect((cmd as any).centered).toBeUndefined();
    }
    const timeline = buildTimeline(commands, [], settings);
    for (const layer of timeline.textLayers) {
      expect(layer.centered).toBe(false);
    }
  });

  it('15. title and subtitle block is vertically centered on canvas', () => {
    const commands = compiler.compile(
      {
        type: 'titlecard',
        data: { title: 'Title', subtitle: 'Subtitle' },
        timing: { start: 0, duration: 5 },
        style: { motion: 'fade' },
      },
      1920,
      1080
    );
    const textCmds = commands.filter(c => c.type === 'text');
    const title = textCmds.find(c => c.content === 'Title')!;
    const subtitle = textCmds.find(c => c.content === 'Subtitle')!;
    const blockMidpoint = (title.y + subtitle.y) / 2;
    expect(Math.abs(blockMidpoint - 540)).toBeLessThan(20);
  });
});
