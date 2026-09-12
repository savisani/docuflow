import { v4 as uuidv4 } from 'uuid';
import type { Command } from '../../../commands/types';
import type { ComponentCompiler } from '../compiler';
import type { MotionComponent, MotionTitleCardData } from '../../types';

/**
 * Supported animation motions for TitleCard components.
 * Each maps to a deterministic sequence of existing DocuFlow commands.
 */
type TitleCardMotion = 'zoom' | 'slideUp' | 'slideDown' | 'slideLeft' | 'slideRight' | 'fade' | 'pop';

const VALID_MOTIONS: readonly TitleCardMotion[] = [
  'zoom', 'slideUp', 'slideDown', 'slideLeft', 'slideRight', 'fade', 'pop',
];

const MOTION_LOOKUP: Record<string, TitleCardMotion> = Object.fromEntries(
  VALID_MOTIONS.map(m => [m.toLowerCase(), m])
);

/**
 * Estimate the number of lines text will wrap to when rendered.
 * Uses average character width heuristic for proportional fonts.
 * Text is constrained to 80% of canvas width with pre-wrap whitespace.
 */
function estimateLineCount(text: string, fontSize: number, canvasWidth: number): number {
  const maxWidth = canvasWidth * 0.8;
  // Average character width for proportional fonts (roughly 0.5-0.6x font size)
  const avgCharWidth = fontSize * 0.55;
  const charsPerLine = Math.floor(maxWidth / avgCharWidth);
  // Handle explicit newlines and wrapping
  const lines = text.split('\n');
  let totalLines = 0;
  for (const line of lines) {
    if (line.length === 0) {
      totalLines += 1; // Empty line still takes space
    } else {
      totalLines += Math.ceil(line.length / charsPerLine);
    }
  }
  return Math.max(1, totalLines);
}

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

    // Deterministic subtitle sizing: proportional to title, clamped for readability
    const subtitleFontSize = data.subtitle
      ? Math.round(Math.min(48, Math.max(28, titleFontSize * 0.4)))
      : 0;

    // Deterministic vertical positioning based on font sizes
    const TITLE_LINE_HEIGHT = 1.2;
    const SUBTITLE_LINE_HEIGHT = 1.3;
    const SUBTITLE_GAP = 20;

    // Estimate line counts to handle text wrapping
    const titleLineCount = estimateLineCount(data.title, titleFontSize, canvasWidth);
    const subtitleLineCount = data.subtitle
      ? estimateLineCount(data.subtitle, subtitleFontSize, canvasWidth)
      : 0;

    const titleLineHeight = titleFontSize * TITLE_LINE_HEIGHT;
    const subtitleLineHeight = subtitleFontSize * SUBTITLE_LINE_HEIGHT;

    // Calculate actual rendered heights including wrapping
    const titleBlockHeight = titleLineHeight * titleLineCount;
    const subtitleBlockHeight = subtitleLineHeight * subtitleLineCount;

    let titleY: number;
    let subtitleY: number;

    if (data.subtitle) {
      // Center the title+subtitle block as a group around canvas midpoint
      const totalHeight = titleBlockHeight + SUBTITLE_GAP + subtitleBlockHeight;
      titleY = centerY - totalHeight / 2;
      subtitleY = titleY + titleBlockHeight + SUBTITLE_GAP;
    } else {
      // For title-only, center at canvas midpoint (single line assumed)
      titleY = centerY;
    }

    const commands: Command[] = [];

    // Title text — large, centered
    const titleId = uuidv4();
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
      centered: true,
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
        y: subtitleY,
        fontSize: subtitleFontSize,
        fontFamily: 'Arial',
        fontWeight: 'normal',
        color: '#CCCCCC',
        centered: true,
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
            from: { x: centerX, y: subtitleY + slideOffset },
            to: { x: centerX, y: subtitleY },
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
        const slideOffset = 200;
        commands.push({
          id: uuidv4(),
          type: 'move',
          target: titleId,
          from: { x: centerX, y: titleY - slideOffset },
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
            from: { x: centerX, y: subtitleY - slideOffset },
            to: { x: centerX, y: subtitleY },
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
            from: { x: centerX - slideOffset, y: subtitleY },
            to: { x: centerX, y: subtitleY },
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
            from: { x: centerX + slideOffset, y: subtitleY },
            to: { x: centerX, y: subtitleY },
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
