import { v4 as uuidv4 } from 'uuid';
import type { Command } from '../../../commands/types';
import type { ComponentCompiler } from '../compiler';
import type { MotionComponent, MotionStatisticData } from '../../types';

/**
 * StatisticCompiler — compiles a Statistic component into DocuFlow commands.
 *
 * Produces:
 * - text command for the value
 * - text command for the label
 * - opacity command for fade-in
 * - scale command for entrance animation
 * - opacity command for fade-out
 */
export class StatisticCompiler implements ComponentCompiler {
  readonly componentType = 'statistic';

  validate(data: MotionStatisticData, _canvasWidth: number, _canvasHeight: number): string[] {
    const errors: string[] = [];
    if (!data.value || data.value.trim().length === 0) {
      errors.push('Statistic value is required');
    }
    if (!data.label || data.label.trim().length === 0) {
      errors.push('Statistic label is required');
    }
    if (data.value && data.value.length > 500) {
      errors.push('Statistic value exceeds maximum length of 500 characters');
    }
    if (data.label && data.label.length > 500) {
      errors.push('Statistic label exceeds maximum length of 500 characters');
    }
    return errors;
  }

  compile(
    component: MotionComponent,
    canvasWidth: number,
    canvasHeight: number,
    _assetPrefix?: string
  ): Command[] {
    const data = component.data as MotionStatisticData;
    const { start, duration } = component.timing;
    const commands: Command[] = [];

    const fadeInDuration = Math.min(0.5, duration * 0.15);
    const fadeOutStart = start + duration - fadeInDuration;

    // Value text — large, centered
    const valueId = uuidv4();
    commands.push({
      id: valueId,
      type: 'text',
      content: data.value,
      x: canvasWidth / 2,
      y: canvasHeight / 2 - 30,
      fontSize: 72,
      fontFamily: 'Arial',
      color: '#FFFFFF',
      start,
      duration,
    });

    // Label text — smaller, below value
    const labelId = uuidv4();
    commands.push({
      id: labelId,
      type: 'text',
      content: data.label,
      x: canvasWidth / 2,
      y: canvasHeight / 2 + 40,
      fontSize: 28,
      fontFamily: 'Arial',
      color: '#CCCCCC',
      start,
      duration,
    });

    // Fade in for value
    commands.push({
      id: uuidv4(),
      type: 'fadeIn',
      target: valueId,
      start,
      duration: fadeInDuration,
    });

    // Fade in for label
    commands.push({
      id: uuidv4(),
      type: 'fadeIn',
      target: labelId,
      start,
      duration: fadeInDuration,
    });

    // Scale entrance for value
    commands.push({
      id: uuidv4(),
      type: 'scale',
      target: valueId,
      from: 0.8,
      to: 1,
      start,
      duration: fadeInDuration,
      easing: 'easeOut',
    });

    // Fade out for value
    commands.push({
      id: uuidv4(),
      type: 'fadeOut',
      target: valueId,
      start: fadeOutStart,
      duration: fadeInDuration,
    });

    // Fade out for label
    commands.push({
      id: uuidv4(),
      type: 'fadeOut',
      target: labelId,
      start: fadeOutStart,
      duration: fadeInDuration,
    });

    return commands;
  }
}
