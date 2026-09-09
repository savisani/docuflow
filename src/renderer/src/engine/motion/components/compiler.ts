import type { Command } from '../../commands/types';
import type { MotionComponent, MotionComponentData } from '../types';

/**
 * ComponentCompiler — interface for compiling a motion component into DocuFlow commands.
 *
 * Each component type has its own compiler. Compilers produce ONLY
 * existing Command types that the timeline builder already understands.
 */
export interface ComponentCompiler {
  /** The component type this compiler handles */
  readonly componentType: string;

  /** Validate component data before compilation */
  validate(data: MotionComponentData, canvasWidth: number, canvasHeight: number): string[];

  /** Compile a component into existing DocuFlow Command[] */
  compile(
    component: MotionComponent,
    canvasWidth: number,
    canvasHeight: number,
    assetPrefix?: string
  ): Command[];
}
