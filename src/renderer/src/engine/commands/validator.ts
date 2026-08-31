import { Command, COMMAND_TYPES } from './types';
import { Asset } from '../../types/assets';
import { findAsset } from '../media/findAsset';

export interface ValidationResult {
  valid: boolean;
  errors: CommandError[];
}

export interface CommandError {
  commandId: string;
  field: string;
  message: string;
}

const TYPE_ALIASES: Record<string, string> = {
  slideIn: 'slide',
  slideOut: 'slide',
  fadeIn: 'fadeIn',
  fadeOut: 'fadeOut',
  zoomIn: 'scale',
  zoomOut: 'scale',
  audio: 'music',
  sfx: 'sfx',
  sound: 'sfx',
  effect: 'sfx',
  bgMusic: 'music',
  backgroundMusic: 'music',
  bgm: 'music',
  voiceover: 'sfx',
  voice: 'sfx',
  narration: 'sfx',
  ambient: 'ambient',
  bgAmbient: 'ambient',
  backgroundAmbient: 'ambient',
  rotateIn: 'rotate',
  rotateOut: 'rotate',
  moveIn: 'move',
  moveOut: 'move',
  textIn: 'text',
  textOut: 'text',
  titleIn: 'text',
  titleOut: 'text',
  subtitleIn: 'subtitle',
  subtitleOut: 'subtitle',
};

function normalizeCommandType(rawType: string): string {
  return TYPE_ALIASES[rawType] || rawType;
}

export function normalizeCommands(commands: Command[], assets?: Asset[]): Command[] {
  return commands.map((cmd) => {
    let normalized = normalizeCommandType(cmd.type);
    if (normalized !== cmd.type) {
      cmd = { ...cmd, type: normalized } as Command;
    }

    if (assets && (cmd.type === 'music' || cmd.type === 'sfx' || cmd.type === 'ambient')) {
      const audioAsset = findAsset(assets, (cmd as any).asset);
      if (audioAsset?.duration && (cmd as any).duration != null && (cmd as any).duration > audioAsset.duration) {
        cmd = { ...cmd, duration: audioAsset.duration } as Command;
      }
    }

    return cmd;
  });
}

export function validateCommands(commands: Command[], assets: Asset[]): ValidationResult {
  const errors: CommandError[] = [];
  const shownAssets = new Set<string>();

  for (const cmd of commands) {
    if (!COMMAND_TYPES.includes(cmd.type as typeof COMMAND_TYPES[number])) {
      errors.push({
        commandId: cmd.id,
        field: 'type',
        message: `Unknown command type: ${cmd.type}`,
      });
      continue;
    }

    if (typeof cmd.start !== 'number' || cmd.start < 0) {
      errors.push({
        commandId: cmd.id,
        field: 'start',
        message: 'Start time must be a non-negative number',
      });
    }

    if (cmd.duration !== undefined && (typeof cmd.duration !== 'number' || cmd.duration <= 0)) {
      errors.push({
        commandId: cmd.id,
        field: 'duration',
        message: 'Duration must be a positive number',
      });
    }

    switch (cmd.type) {
      case 'show': {
        const asset = findAsset(assets, cmd.asset);
        if (!asset) {
          errors.push({
            commandId: cmd.id,
            field: 'asset',
            message: `Asset not found: ${cmd.asset}`,
          });
        }
        shownAssets.add(cmd.asset);
        shownAssets.add(cmd.id);
        break;
      }
      case 'hide':
      case 'scale':
      case 'rotate':
      case 'flipHorizontal':
      case 'flipVertical':
      case 'crop':
      case 'opacity':
      case 'fadeIn':
      case 'fadeOut':
      case 'blur':
      case 'move':
      case 'cut': {
        if (!shownAssets.has(cmd.target)) {
          errors.push({
            commandId: cmd.id,
            field: 'target',
            message: `Target "${cmd.target}" has not been shown yet`,
          });
        }
        break;
      }
      case 'replace': {
        if (!shownAssets.has(cmd.target)) {
          errors.push({
            commandId: cmd.id,
            field: 'target',
            message: `Target "${cmd.target}" has not been shown yet`,
          });
        }
        const replacement = findAsset(assets, cmd.asset);
        if (!replacement) {
          errors.push({
            commandId: cmd.id,
            field: 'asset',
            message: `Replacement asset not found: ${cmd.asset}`,
          });
        } else {
          shownAssets.add(cmd.asset);
        }
        break;
      }
      case 'crossfade': {
        if (!shownAssets.has(cmd.target)) {
          errors.push({
            commandId: cmd.id,
            field: 'target',
            message: `Target "${cmd.target}" has not been shown yet`,
          });
        }
        break;
      }
      case 'slide':
      case 'wipe': {
        if (!shownAssets.has(cmd.target)) {
          errors.push({
            commandId: cmd.id,
            field: 'target',
            message: `Target "${cmd.target}" has not been shown yet`,
          });
        }
        break;
      }
      case 'music':
      case 'sfx':
      case 'ambient': {
        const audioAsset = findAsset(assets, cmd.asset);
        if (!audioAsset) {
          errors.push({
            commandId: cmd.id,
            field: 'asset',
            message: `Audio asset not found: ${cmd.asset}`,
          });
        } else if (audioAsset.duration && cmd.duration != null && cmd.duration > audioAsset.duration) {
          errors.push({
            commandId: cmd.id,
            field: 'duration',
            message: `Duration ${cmd.duration}s exceeds audio file length ${audioAsset.duration}s — capped to ${audioAsset.duration}s`,
          });
        }
        break;
      }
      case 'volume':
      case 'fadeAudioIn':
      case 'fadeAudioOut': {
        break;
      }
      case 'text':
      case 'subtitle': {
        if (!cmd.content || cmd.content.trim().length === 0) {
          errors.push({
            commandId: cmd.id,
            field: 'content',
            message: 'Text content cannot be empty',
          });
        }
        break;
      }
    }

    if (cmd.type === 'opacity') {
      const c = cmd as Extract<Command, { type: 'opacity' }>;
      if (c.from < 0 || c.from > 1 || c.to < 0 || c.to > 1) {
        errors.push({
          commandId: cmd.id,
          field: 'from/to',
          message: 'Opacity values must be between 0 and 1',
        });
      }
    }

    if (cmd.type === 'fadeIn' || cmd.type === 'fadeOut') {
      shownAssets.add(cmd.type === 'fadeIn' ? (cmd as Extract<Command, { type: 'fadeIn' }>).target : (cmd as Extract<Command, { type: 'fadeOut' }>).target);
    }
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}
