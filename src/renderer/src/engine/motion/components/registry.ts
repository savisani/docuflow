import type { ComponentCompiler } from './compiler';
import { StatisticCompiler } from './statistic/compiler';

/**
 * ComponentRegistry — central registry for all motion component compilers.
 *
 * New components are added by registering their compiler.
 * Unknown components are REJECTED at the gateway level.
 */

const compilers = new Map<string, ComponentCompiler>();

function registerCompiler(compiler: ComponentCompiler): void {
  compilers.set(compiler.componentType, compiler);
}

function getCompiler(componentType: string): ComponentCompiler | undefined {
  return compilers.get(componentType);
}

function getRegisteredTypes(): string[] {
  return [...compilers.keys()];
}

function isRegistered(componentType: string): boolean {
  return compilers.has(componentType);
}

// ── Register built-in compilers ─────────────────────────────────

registerCompiler(new StatisticCompiler());

// ── Public API ──────────────────────────────────────────────────

export const ComponentRegistry = {
  register: registerCompiler,
  get: getCompiler,
  getRegisteredTypes,
  isRegistered,
} as const;
