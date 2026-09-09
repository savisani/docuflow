import { v4 as uuidv4 } from 'uuid';
import type { Command } from '../../../commands/types';
import type { ComponentCompiler } from '../compiler';
import type { MotionComponent, MotionStatisticData } from '../../types';

/**
 * Supported animation motions for Statistic components.
 * Each maps to a deterministic sequence of existing DocuFlow commands.
 */
type StatisticMotion = 'zoom' | 'slideUp' | 'slideLeft' | 'slideRight' | 'fade' | 'pop';

const VALID_MOTIONS: readonly StatisticMotion[] = [
  'zoom', 'slideUp', 'slideLeft', 'slideRight', 'fade', 'pop',
];

const MOTION_LOOKUP: Record<string, StatisticMotion> = Object.fromEntries(
  VALID_MOTIONS.map(m => [m.toLowerCase(), m])
);

/**
 * StatisticCompiler — compiles a Statistic component into DocuFlow commands.
 *
 * Supports deterministic motion vocabulary via component.style.motion:
 * - zoom:      scale entrance (default)
 * - slideUp:   enters from below
 * - slideLeft: enters from left
 * - slideRight: enters from right
 * - fade:      opacity-only entrance
 * - pop:       overshoot scale via keyframes
 */
export class StatisticCompiler implements ComponentCompiler {
  readonly componentType = 'statistic';

  validate(data: MotionStatisticData, _canvasWidth: number, _canvasHeight: number): string[] {
    const errors: string[] = [];
    if (!data.value || data.value.trim().length === 0) {
      errors.push('Statistic value is required');
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
    const motion = this.resolveMotion(component);
    const centerX = canvasWidth / 2;
    const centerY = canvasHeight / 2;

    const fadeInDuration = Math.min(0.5, duration * 0.15);
    const fadeOutStart = start + duration - fadeInDuration;

    const commands: Command[] = [];

    // Value text — large, centered
    const valueId = uuidv4();
    commands.push({
      id: valueId,
      type: 'text',
      content: data.value,
      x: centerX,
      y: centerY - 30,
      fontSize: 72,
      fontFamily: 'Arial',
      color: '#FFFFFF',
      start,
      duration,
    });

    // Label text — smaller, below value (only if label is provided)
    const labelId = data.label ? uuidv4() : null;
    if (labelId) {
      commands.push({
        id: labelId,
        type: 'text',
        content: data.label,
        x: centerX,
        y: centerY + 40,
        fontSize: 28,
        fontFamily: 'Arial',
        color: '#CCCCCC',
        start,
        duration,
      });
    }

    // ── Entrance animation (varies by motion) ───────────────────
    switch (motion) {
      case 'slideUp': {
        const slideOffset = 200;
        commands.push({
          id: uuidv4(),
          type: 'move',
          target: valueId,
          from: { x: centerX, y: centerY - 30 + slideOffset },
          to: { x: centerX, y: centerY - 30 },
          start,
          duration: fadeInDuration,
          easing: 'easeOut',
        });
        commands.push({
          id: uuidv4(),
          type: 'fadeIn',
          target: valueId,
          start,
          duration: fadeInDuration,
        });
        if (labelId) {
          commands.push({
            id: uuidv4(),
            type: 'move',
            target: labelId,
            from: { x: centerX, y: centerY + 40 + slideOffset },
            to: { x: centerX, y: centerY + 40 },
            start,
            duration: fadeInDuration,
            easing: 'easeOut',
          });
          commands.push({
            id: uuidv4(),
            type: 'fadeIn',
            target: labelId,
            start,
            duration: fadeInDuration,
          });
        }
        break;
      }

      case 'slideLeft': {
        const slideOffset = 300;
        commands.push({
          id: uuidv4(),
          type: 'move',
          target: valueId,
          from: { x: centerX - slideOffset, y: centerY - 30 },
          to: { x: centerX, y: centerY - 30 },
          start,
          duration: fadeInDuration,
          easing: 'easeOut',
        });
        commands.push({
          id: uuidv4(),
          type: 'fadeIn',
          target: valueId,
          start,
          duration: fadeInDuration,
        });
        if (labelId) {
          commands.push({
            id: uuidv4(),
            type: 'move',
            target: labelId,
            from: { x: centerX - slideOffset, y: centerY + 40 },
            to: { x: centerX, y: centerY + 40 },
            start,
            duration: fadeInDuration,
            easing: 'easeOut',
          });
          commands.push({
            id: uuidv4(),
            type: 'fadeIn',
            target: labelId,
            start,
            duration: fadeInDuration,
          });
        }
        break;
      }

      case 'slideRight': {
        const slideOffset = 300;
        commands.push({
          id: uuidv4(),
          type: 'move',
          target: valueId,
          from: { x: centerX + slideOffset, y: centerY - 30 },
          to: { x: centerX, y: centerY - 30 },
          start,
          duration: fadeInDuration,
          easing: 'easeOut',
        });
        commands.push({
          id: uuidv4(),
          type: 'fadeIn',
          target: valueId,
          start,
          duration: fadeInDuration,
        });
        if (labelId) {
          commands.push({
            id: uuidv4(),
            type: 'move',
            target: labelId,
            from: { x: centerX + slideOffset, y: centerY + 40 },
            to: { x: centerX, y: centerY + 40 },
            start,
            duration: fadeInDuration,
            easing: 'easeOut',
          });
          commands.push({
            id: uuidv4(),
            type: 'fadeIn',
            target: labelId,
            start,
            duration: fadeInDuration,
          });
        }
        break;
      }

      case 'fade': {
        commands.push({
          id: uuidv4(),
          type: 'fadeIn',
          target: valueId,
          start,
          duration: fadeInDuration,
        });
        if (labelId) {
          commands.push({
            id: uuidv4(),
            type: 'fadeIn',
            target: labelId,
            start,
            duration: fadeInDuration,
          });
        }
        break;
      }

      case 'pop': {
        const overshootTime = fadeInDuration * 0.6;
        const settleTime = fadeInDuration;
        commands.push({
          id: uuidv4(),
          type: 'setKeyframes',
          target: valueId,
          property: 'scale',
          keyframes: [
            { time: start, value: 0, easing: 'easeOut' },
            { time: start + overshootTime, value: 1.15, easing: 'easeIn' },
            { time: start + settleTime, value: 1.0, easing: 'easeOut' },
          ],
        });
        commands.push({
          id: uuidv4(),
          type: 'fadeIn',
          target: valueId,
          start,
          duration: fadeInDuration,
        });
        if (labelId) {
          const labelDelay = fadeInDuration * 0.15;
          commands.push({
            id: uuidv4(),
            type: 'setKeyframes',
            target: labelId,
            property: 'scale',
            keyframes: [
              { time: start + labelDelay, value: 0, easing: 'easeOut' },
              { time: start + overshootTime + labelDelay, value: 1.15, easing: 'easeIn' },
              { time: start + settleTime + labelDelay, value: 1.0, easing: 'easeOut' },
            ],
          });
          commands.push({
            id: uuidv4(),
            type: 'fadeIn',
            target: labelId,
            start: start + labelDelay,
            duration: fadeInDuration,
          });
        }
        break;
      }

      case 'zoom':
      default: {
        commands.push({
          id: uuidv4(),
          type: 'fadeIn',
          target: valueId,
          start,
          duration: fadeInDuration,
        });
        if (labelId) {
          commands.push({
            id: uuidv4(),
            type: 'fadeIn',
            target: labelId,
            start,
            duration: fadeInDuration,
          });
        }
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
        break;
      }
    }

    // ── Exit animation (same for all motions) ────────────────────
    commands.push({
      id: uuidv4(),
      type: 'fadeOut',
      target: valueId,
      start: fadeOutStart,
      duration: fadeInDuration,
    });
    if (labelId) {
      commands.push({
        id: uuidv4(),
        type: 'fadeOut',
        target: labelId,
        start: fadeOutStart,
        duration: fadeInDuration,
      });
    }

    return commands;
  }

  private resolveMotion(component: MotionComponent): StatisticMotion {
    const raw = component.style?.motion;
    if (typeof raw === 'string') {
      const match = MOTION_LOOKUP[raw.toLowerCase()];
      if (match) return match;
    }
    return 'fade';
  }
}
