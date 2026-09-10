import { v4 as uuidv4 } from 'uuid';
import type { Command } from '../../../commands/types';
import type { ComponentCompiler } from '../compiler';
import type { MotionComponent, MotionTitleCardData } from '../../types';

/**
 * Supported animation motions for TitleCard components.
 * Each maps to a deterministic sequence of existing DocuFlow commands.
 */
type TitleCardMotion = 'zoom' | 'slideUp' | 'slideLeft' | 'slideRight' | 'fade' | 'pop';

const VALID_MOTIONS: readonly TitleCardMotion[] = [
  'zoom', 'slideUp', 'slideLeft', 'slideRight', 'fade', 'pop',
];

const MOTION_LOOKUP: Record<string, TitleCardMotion> = Object.fromEntries(
  VALID_MOTIONS.map(m => [m.toLowerCase(), m])
);

/**
 * TitleCardCompiler — compiles a TitleCard component into DocuFlow commands.
 *
 * Produces title text (large) and optional subtitle text (smaller).
 * Reuses the same motion vocabulary as StatisticCompiler.
 */
export class TitleCardCompiler implements ComponentCompiler {
  readonly componentType = 'titlecard';

  validate(data: MotionTitleCardData, _canvasWidth: number, _canvasHeight: number): string[] {
    const errors: string[] = [];
    if (!data.title || data.title.trim().length === 0) {
      errors.push('TitleCard title is required');
    }
    if (data.title && data.title.length > 500) {
      errors.push('TitleCard title exceeds maximum length of 500 characters');
    }
    if (data.subtitle && data.subtitle.length > 500) {
      errors.push('TitleCard subtitle exceeds maximum length of 500 characters');
    }
    return errors;
  }

  compile(
    component: MotionComponent,
    canvasWidth: number,
    canvasHeight: number,
    _assetPrefix?: string
  ): Command[] {
    const data = component.data as MotionTitleCardData;
    const { start, duration } = component.timing;
    const motion = this.resolveMotion(component);
    const centerX = canvasWidth / 2;
    const centerY = canvasHeight / 2;

    const fadeInDuration = Math.min(0.5, duration * 0.15);
    const fadeOutStart = start + duration - fadeInDuration;

    // Resolve visual properties with safe defaults
    const titleFontSize = data.fontSize ?? 72;
    const titleFontWeight = data.fontWeight ?? 'bold';
    const titleColor = data.color ?? '#FFFFFF';

    const commands: Command[] = [];

    // Title text — large, centered above midpoint
    const titleId = uuidv4();
    const titleY = data.subtitle ? centerY - 30 : centerY;
    commands.push({
      id: titleId,
      type: 'text',
      content: data.title,
      x: centerX,
      y: titleY,
      fontSize: titleFontSize,
      fontFamily: 'Arial',
      fontWeight: titleFontWeight,
      color: titleColor,
      start,
      duration,
    });

    // Subtitle text — smaller, below title (only if subtitle is provided)
    const subtitleId = data.subtitle ? uuidv4() : null;
    if (subtitleId && data.subtitle) {
      commands.push({
        id: subtitleId,
        type: 'text',
        content: data.subtitle,
        x: centerX,
        y: centerY + 40,
        fontSize: Math.min(28, titleFontSize * 0.4),
        fontFamily: 'Arial',
        fontWeight: 'normal',
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
          target: titleId,
          from: { x: centerX, y: titleY + slideOffset },
          to: { x: centerX, y: titleY },
          start,
          duration: fadeInDuration,
          easing: 'easeOut',
        });
        commands.push({
          id: uuidv4(),
          type: 'fadeIn',
          target: titleId,
          start,
          duration: fadeInDuration,
        });
        if (subtitleId) {
          commands.push({
            id: uuidv4(),
            type: 'move',
            target: subtitleId,
            from: { x: centerX, y: centerY + 40 + slideOffset },
            to: { x: centerX, y: centerY + 40 },
            start,
            duration: fadeInDuration,
            easing: 'easeOut',
          });
          commands.push({
            id: uuidv4(),
            type: 'fadeIn',
            target: subtitleId,
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
          target: titleId,
          from: { x: centerX - slideOffset, y: titleY },
          to: { x: centerX, y: titleY },
          start,
          duration: fadeInDuration,
          easing: 'easeOut',
        });
        commands.push({
          id: uuidv4(),
          type: 'fadeIn',
          target: titleId,
          start,
          duration: fadeInDuration,
        });
        if (subtitleId) {
          commands.push({
            id: uuidv4(),
            type: 'move',
            target: subtitleId,
            from: { x: centerX - slideOffset, y: centerY + 40 },
            to: { x: centerX, y: centerY + 40 },
            start,
            duration: fadeInDuration,
            easing: 'easeOut',
          });
          commands.push({
            id: uuidv4(),
            type: 'fadeIn',
            target: subtitleId,
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
          target: titleId,
          from: { x: centerX + slideOffset, y: titleY },
          to: { x: centerX, y: titleY },
          start,
          duration: fadeInDuration,
          easing: 'easeOut',
        });
        commands.push({
          id: uuidv4(),
          type: 'fadeIn',
          target: titleId,
          start,
          duration: fadeInDuration,
        });
        if (subtitleId) {
          commands.push({
            id: uuidv4(),
            type: 'move',
            target: subtitleId,
            from: { x: centerX + slideOffset, y: centerY + 40 },
            to: { x: centerX, y: centerY + 40 },
            start,
            duration: fadeInDuration,
            easing: 'easeOut',
          });
          commands.push({
            id: uuidv4(),
            type: 'fadeIn',
            target: subtitleId,
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
          target: titleId,
          start,
          duration: fadeInDuration,
        });
        if (subtitleId) {
          commands.push({
            id: uuidv4(),
            type: 'fadeIn',
            target: subtitleId,
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
          target: titleId,
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
          target: titleId,
          start,
          duration: fadeInDuration,
        });
        if (subtitleId) {
          const labelDelay = fadeInDuration * 0.15;
          commands.push({
            id: uuidv4(),
            type: 'setKeyframes',
            target: subtitleId,
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
            target: subtitleId,
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
          target: titleId,
          start,
          duration: fadeInDuration,
        });
        if (subtitleId) {
          commands.push({
            id: uuidv4(),
            type: 'fadeIn',
            target: subtitleId,
            start,
            duration: fadeInDuration,
          });
        }
        commands.push({
          id: uuidv4(),
          type: 'scale',
          target: titleId,
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
      target: titleId,
      start: fadeOutStart,
      duration: fadeInDuration,
    });
    if (subtitleId) {
      commands.push({
        id: uuidv4(),
        type: 'fadeOut',
        target: subtitleId,
        start: fadeOutStart,
        duration: fadeInDuration,
      });
    }

    return commands;
  }

  private resolveMotion(component: MotionComponent): TitleCardMotion {
    const raw = component.style?.motion;
    if (typeof raw === 'string') {
      const match = MOTION_LOOKUP[raw.toLowerCase()];
      if (match) return match;
    }
    return 'fade';
  }
}
