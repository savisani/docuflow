import { v4 as uuidv4 } from 'uuid';
import type { Command } from '../../../commands/types';
import type { ComponentCompiler } from '../compiler';
import type { MotionComponent, MotionLowerThirdData } from '../../types';

/**
 * Supported animation motions for LowerThird components.
 * Each maps to a deterministic sequence of existing DocuFlow commands.
 */
type LowerThirdMotion = 'zoom' | 'slideUp' | 'slideDown' | 'slideLeft' | 'slideRight' | 'fade' | 'pop';

const VALID_MOTIONS: readonly LowerThirdMotion[] = [
  'zoom', 'slideUp', 'slideDown', 'slideLeft', 'slideRight', 'fade', 'pop',
];

const MOTION_LOOKUP: Record<string, LowerThirdMotion> = Object.fromEntries(
  VALID_MOTIONS.map(m => [m.toLowerCase(), m])
);

/**
 * LowerThirdCompiler — compiles a LowerThird component into DocuFlow commands.
 *
 * Produces name text (bold, larger) and optional subtitle text (smaller).
 * Default position: bottom-left for documentary convention.
 * Reuses the same motion vocabulary as StatisticCompiler and TitleCardCompiler.
 */
export class LowerThirdCompiler implements ComponentCompiler {
  readonly componentType = 'lowerthird';

  validate(data: MotionLowerThirdData, _canvasWidth: number, _canvasHeight: number): string[] {
    const errors: string[] = [];
    if (!data.name || data.name.trim().length === 0) {
      errors.push('LowerThird name is required');
    }
    if (data.name && data.name.length > 500) {
      errors.push('LowerThird name exceeds maximum length of 500 characters');
    }
    if (data.subtitle && data.subtitle.length > 500) {
      errors.push('LowerThird subtitle exceeds maximum length of 500 characters');
    }
    return errors;
  }

  compile(
    component: MotionComponent,
    canvasWidth: number,
    canvasHeight: number,
    _assetPrefix?: string
  ): Command[] {
    const data = component.data as MotionLowerThirdData;
    const { start, duration } = component.timing;
    const motion = this.resolveMotion(component);

    // Position: use style.x/y if provided, otherwise bottom-left documentary default
    const nameX = (component.style?.x as number) ?? canvasWidth * 0.15;
    const nameY = (component.style?.y as number) ?? canvasHeight * 0.82;

    const fadeInDuration = Math.min(0.5, duration * 0.15);
    const fadeOutStart = start + duration - fadeInDuration;

    // Resolve visual properties with safe defaults
    const nameFontSize = data.fontSize ?? 42;
    const nameFontWeight = data.fontWeight ?? 'bold';
    const nameColor = data.color ?? '#FFFFFF';

    // Deterministic subtitle sizing: proportional to name, clamped for readability
    const subtitleFontSize = data.subtitle
      ? Math.round(Math.min(32, Math.max(24, nameFontSize * 0.7)))
      : 0;

    // Deterministic vertical positioning based on font sizes
    const NAME_LINE_HEIGHT = 1.2;
    const SUBTITLE_LINE_HEIGHT = 1.3;
    const SUBTITLE_GAP = 8;

    const nameLineHeight = nameFontSize * NAME_LINE_HEIGHT;

    let nameYPos: number;
    let subtitleYPos: number;

    if (data.subtitle) {
      // Position name above the anchor, subtitle below
      nameYPos = nameY - (nameLineHeight / 2);
      subtitleYPos = nameYPos + nameLineHeight + SUBTITLE_GAP;
    } else {
      nameYPos = nameY;
    }

    const commands: Command[] = [];

    // Name text — bold, at position
    const nameId = uuidv4();
    commands.push({
      id: nameId,
      type: 'text',
      content: data.name,
      x: nameX,
      y: nameYPos,
      fontSize: nameFontSize,
      fontFamily: 'Arial',
      fontWeight: nameFontWeight,
      color: nameColor,
      start,
      duration,
    });

    // Subtitle text — smaller, below name (only if subtitle is provided)
    const subtitleId = data.subtitle ? uuidv4() : null;
    if (subtitleId && data.subtitle) {
      commands.push({
        id: subtitleId,
        type: 'text',
        content: data.subtitle,
        x: nameX,
        y: subtitleYPos,
        fontSize: subtitleFontSize,
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
        const slideOffset = 150;
        commands.push({
          id: uuidv4(),
          type: 'move',
          target: nameId,
          from: { x: nameX, y: nameYPos + slideOffset },
          to: { x: nameX, y: nameYPos },
          start,
          duration: fadeInDuration,
          easing: 'easeOut',
        });
        commands.push({
          id: uuidv4(),
          type: 'fadeIn',
          target: nameId,
          start,
          duration: fadeInDuration,
        });
        if (subtitleId) {
          commands.push({
            id: uuidv4(),
            type: 'move',
            target: subtitleId,
            from: { x: nameX, y: subtitleYPos + slideOffset },
            to: { x: nameX, y: subtitleYPos },
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

      case 'slideDown': {
        const slideOffset = 150;
        commands.push({
          id: uuidv4(),
          type: 'move',
          target: nameId,
          from: { x: nameX, y: nameYPos - slideOffset },
          to: { x: nameX, y: nameYPos },
          start,
          duration: fadeInDuration,
          easing: 'easeOut',
        });
        commands.push({
          id: uuidv4(),
          type: 'fadeIn',
          target: nameId,
          start,
          duration: fadeInDuration,
        });
        if (subtitleId) {
          commands.push({
            id: uuidv4(),
            type: 'move',
            target: subtitleId,
            from: { x: nameX, y: subtitleYPos - slideOffset },
            to: { x: nameX, y: subtitleYPos },
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
        const slideOffset = 200;
        commands.push({
          id: uuidv4(),
          type: 'move',
          target: nameId,
          from: { x: nameX - slideOffset, y: nameYPos },
          to: { x: nameX, y: nameYPos },
          start,
          duration: fadeInDuration,
          easing: 'easeOut',
        });
        commands.push({
          id: uuidv4(),
          type: 'fadeIn',
          target: nameId,
          start,
          duration: fadeInDuration,
        });
        if (subtitleId) {
          commands.push({
            id: uuidv4(),
            type: 'move',
            target: subtitleId,
            from: { x: nameX - slideOffset, y: subtitleYPos },
            to: { x: nameX, y: subtitleYPos },
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
        const slideOffset = 200;
        commands.push({
          id: uuidv4(),
          type: 'move',
          target: nameId,
          from: { x: nameX + slideOffset, y: nameYPos },
          to: { x: nameX, y: nameYPos },
          start,
          duration: fadeInDuration,
          easing: 'easeOut',
        });
        commands.push({
          id: uuidv4(),
          type: 'fadeIn',
          target: nameId,
          start,
          duration: fadeInDuration,
        });
        if (subtitleId) {
          commands.push({
            id: uuidv4(),
            type: 'move',
            target: subtitleId,
            from: { x: nameX + slideOffset, y: subtitleYPos },
            to: { x: nameX, y: subtitleYPos },
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
          target: nameId,
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
          target: nameId,
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
          target: nameId,
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
          target: nameId,
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
          target: nameId,
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
      target: nameId,
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

  private resolveMotion(component: MotionComponent): LowerThirdMotion {
    const raw = component.style?.motion;
    if (typeof raw === 'string') {
      const match = MOTION_LOOKUP[raw.toLowerCase()];
      if (match) return match;
    }
    return 'slideUp';
  }
}
