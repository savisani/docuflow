import { describe, test, expect } from 'vitest';
import { validateCommands } from '../commands/validator';
import { Command } from '../commands/types';
import { Asset } from '../../../types/assets';

function makeAsset(id: string, logicalId: string, type: Asset['type'] = 'image', audioRole?: string): Asset {
  return {
    id,
    logicalId,
    filename: `${logicalId}.jpg`,
    type,
    mimeType: type === 'audio' ? 'audio/mpeg' : 'image/jpeg',
    audioRole: audioRole as any,
  };
}

const assets: Asset[] = [
  makeAsset('img1', 'image1', 'image'),
  makeAsset('img2', 'image2', 'image'),
  makeAsset('audio1', 'audio1', 'audio', 'sfx'),
  makeAsset('music1', 'music1', 'audio', 'music'),
];

function makeShowCmd(id: string, asset: string, start: number, duration: number): Command {
  return { id, type: 'show', asset, start, duration };
}

function makeMoveCmd(id: string, target: string, start: number, duration: number): Command {
  return { id, type: 'move', target, from: { x: 0, y: 0 }, to: { x: 100, y: 100 }, start, duration };
}

describe('Command Validator', () => {
  describe('Valid commands', () => {
    test('validates correct show command', () => {
      const commands = [makeShowCmd('cmd1', 'img1', 0, 5)];
      const result = validateCommands(commands, assets);
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    test('validates move after show', () => {
      const commands = [
        makeShowCmd('cmd1', 'img1', 0, 5),
        makeMoveCmd('cmd2', 'cmd1', 1, 3),
      ];
      const result = validateCommands(commands, assets);
      expect(result.valid).toBe(true);
    });

    test('validates multiple shows and moves', () => {
      const commands = [
        makeShowCmd('cmd1', 'img1', 0, 10),
        makeMoveCmd('cmd2', 'cmd1', 0, 5),
        makeShowCmd('cmd3', 'img2', 5, 5),
        makeMoveCmd('cmd4', 'cmd3', 5, 5),
      ];
      const result = validateCommands(commands, assets);
      expect(result.valid).toBe(true);
    });
  });

  describe('Invalid asset references', () => {
    test('rejects show with non-existent asset', () => {
      const commands = [{ id: 'cmd1', type: 'show', asset: 'nonexistent', start: 0, duration: 5 }];
      const result = validateCommands(commands, assets);
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.field === 'asset' && e.message.includes('not found'))).toBe(true);
    });

    test('rejects replace with non-existent replacement asset', () => {
      const commands = [
        makeShowCmd('cmd1', 'img1', 0, 5),
        { id: 'cmd2', type: 'replace', target: 'cmd1', asset: 'nonexistent', start: 3 } as Command,
      ];
      const result = validateCommands(commands, assets);
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.field === 'asset' && e.message.includes('not found'))).toBe(true);
    });

    test('rejects music with non-existent audio', () => {
      const commands = [{ id: 'cmd1', type: 'music', asset: 'nonexistent', start: 0, duration: 5 } as Command];
      const result = validateCommands(commands, assets);
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.field === 'asset' && e.message.includes('not found'))).toBe(true);
    });
  });

  describe('Invalid time ranges', () => {
    test('rejects negative start time', () => {
      const commands = [makeShowCmd('cmd1', 'img1', -1, 5)];
      const result = validateCommands(commands, assets);
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.field === 'start' && e.message.includes('non-negative'))).toBe(true);
    });

    test('rejects zero duration', () => {
      const commands = [makeShowCmd('cmd1', 'img1', 0, 0)];
      const result = validateCommands(commands, assets);
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.field === 'duration' && e.message.includes('positive'))).toBe(true);
    });

    test('rejects negative duration', () => {
      const commands = [makeShowCmd('cmd1', 'img1', 0, -5)];
      const result = validateCommands(commands, assets);
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.field === 'duration' && e.message.includes('positive'))).toBe(true);
    });
  });

  describe('Target validation', () => {
    test('rejects hide without prior show', () => {
      const commands = [{ id: 'cmd1', type: 'hide', target: 'cmd1', start: 5 } as Command];
      const result = validateCommands(commands, assets);
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.field === 'target' && e.message.includes('not been shown'))).toBe(true);
    });

    test('rejects move without prior show', () => {
      const commands = [makeMoveCmd('cmd1', 'nonexistent', 0, 5)];
      const result = validateCommands(commands, assets);
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.field === 'target' && e.message.includes('not been shown'))).toBe(true);
    });

    test('rejects scale without prior show', () => {
      const commands = [{ id: 'cmd1', type: 'scale', target: 'nonexistent', start: 0, duration: 5, from: 1, to: 2 } as Command];
      const result = validateCommands(commands, assets);
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.field === 'target' && e.message.includes('not been shown'))).toBe(true);
    });

    test('rejects rotate without prior show', () => {
      const commands = [{ id: 'cmd1', type: 'rotate', target: 'nonexistent', start: 0, duration: 5, from: 0, to: 90 } as Command];
      const result = validateCommands(commands, assets);
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.field === 'target' && e.message.includes('not been shown'))).toBe(true);
    });

    test('rejects opacity without prior show', () => {
      const commands = [{ id: 'cmd1', type: 'opacity', target: 'nonexistent', start: 0, duration: 5, from: 0, to: 1 } as Command];
      const result = validateCommands(commands, assets);
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.field === 'target' && e.message.includes('not been shown'))).toBe(true);
    });

    test('rejects crossfade without prior show', () => {
      const commands = [{ id: 'cmd1', type: 'crossfade', target: 'nonexistent', toAsset: 'img2', start: 0, duration: 2 } as Command];
      const result = validateCommands(commands, assets);
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.field === 'target' && e.message.includes('not been shown'))).toBe(true);
    });
  });

  describe('Opacity validation', () => {
    test('rejects opacity > 1', () => {
      const commands = [
        makeShowCmd('cmd1', 'img1', 0, 5),
        { id: 'cmd2', type: 'opacity', target: 'cmd1', start: 0, duration: 5, from: 0, to: 1.5 } as Command,
      ];
      const result = validateCommands(commands, assets);
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.field === 'from/to' && e.message.includes('between 0 and 1'))).toBe(true);
    });

    test('rejects opacity < 0', () => {
      const commands = [
        makeShowCmd('cmd1', 'img1', 0, 5),
        { id: 'cmd2', type: 'opacity', target: 'cmd1', start: 0, duration: 5, from: -0.5, to: 1 } as Command,
      ];
      const result = validateCommands(commands, assets);
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.field === 'from/to' && e.message.includes('between 0 and 1'))).toBe(true);
    });

    test('accepts valid opacity range', () => {
      const commands = [
        makeShowCmd('cmd1', 'img1', 0, 5),
        { id: 'cmd2', type: 'opacity', target: 'cmd1', start: 0, duration: 5, from: 0, to: 1 } as Command,
      ];
      const result = validateCommands(commands, assets);
      expect(result.valid).toBe(true);
    });
  });

  describe('Text validation', () => {
    test('rejects empty text content', () => {
      const commands = [{ id: 'cmd1', type: 'text', content: '', start: 0, duration: 5 } as Command];
      const result = validateCommands(commands, assets);
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.field === 'content' && e.message.includes('empty'))).toBe(true);
    });

    test('rejects whitespace-only text content', () => {
      const commands = [{ id: 'cmd1', type: 'text', content: '   ', start: 0, duration: 5 } as Command];
      const result = validateCommands(commands, assets);
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.field === 'content' && e.message.includes('empty'))).toBe(true);
    });

    test('accepts valid text content', () => {
      const commands = [{ id: 'cmd1', type: 'text', content: 'Hello World', start: 0, duration: 5 } as Command];
      const result = validateCommands(commands, assets);
      expect(result.valid).toBe(true);
    });

    test('rejects empty subtitle content', () => {
      const commands = [{ id: 'cmd1', type: 'subtitle', content: '', start: 0, duration: 5 } as Command];
      const result = validateCommands(commands, assets);
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.field === 'content' && e.message.includes('empty'))).toBe(true);
    });
  });

  describe('Unknown command types', () => {
    test('rejects unknown command type', () => {
      const commands = [{ id: 'cmd1', type: 'unknownCommand' as any, start: 0 }];
      const result = validateCommands(commands, assets);
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.field === 'type' && e.message.includes('Unknown command type'))).toBe(true);
    });
  });

  describe('Audio commands', () => {
    test('validates music command', () => {
      const commands = [{ id: 'cmd1', type: 'music', asset: 'music1', start: 0, duration: 10 } as Command];
      const result = validateCommands(commands, assets);
      expect(result.valid).toBe(true);
    });

    test('validates sfx command', () => {
      const commands = [{ id: 'cmd1', type: 'sfx', asset: 'audio1', start: 5 } as Command];
      const result = validateCommands(commands, assets);
      expect(result.valid).toBe(true);
    });

    test('validates ambient command', () => {
      const commands = [{ id: 'cmd1', type: 'ambient', asset: 'music1', start: 0, duration: 10 } as Command];
      const result = validateCommands(commands, assets);
      expect(result.valid).toBe(true);
    });
  });
});