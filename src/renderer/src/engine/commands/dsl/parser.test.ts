import { describe, test, expect } from 'vitest';
import { parseDsl } from './parser';
import { Asset } from '../../../types/assets';
import { DSL_COMMAND_NAMES, COMMAND_REGISTRY } from './registry';

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
  makeAsset('uuid-img1', 'image1', 'image'),
  makeAsset('uuid-img2', 'image2', 'image'),
  makeAsset('uuid-audio1', 'audio1', 'audio', 'sfx'),
  makeAsset('uuid-audio2', 'audio2', 'audio', 'sfx'),
  makeAsset('uuid-music1', 'music1', 'audio', 'music'),
];

describe('DSL Parser', () => {
  describe('Registry', () => {
    test('contains all 30 commands', () => {
      expect(COMMAND_REGISTRY.length).toBe(30);
      const names = COMMAND_REGISTRY.map((c) => c.dslName);
      expect(names).toContain('SHOW');
      expect(names).toContain('HIDE');
      expect(names).toContain('MOVE');
      expect(names).toContain('MOVE3D');
      expect(names).toContain('SCALE');
      expect(names).toContain('ROTATE');
      expect(names).toContain('ROTATE3D');
      expect(names).toContain('DEPTH');
      expect(names).toContain('OPACITY');
      expect(names).toContain('FADE');
      expect(names).toContain('FADE OUT');
      expect(names).toContain('BLUR');
      expect(names).toContain('REPLACE');
      expect(names).toContain('SLIDE');
      expect(names).toContain('CAMERA MOVE');
      expect(names).toContain('CAMERA ROTATE');
      expect(names).toContain('TEXT');
      expect(names).toContain('SUBTITLE');
      expect(names).toContain('SFX');
      expect(names).toContain('MUSIC');
      expect(names).toContain('FLIP HORIZONTAL');
      expect(names).toContain('FLIP VERTICAL');
      expect(names).toContain('CROP');
      expect(names).toContain('WIPE');
      expect(names).toContain('CUT');
      expect(names).toContain('VOLUME');
      expect(names).toContain('FADE AUDIO IN');
      expect(names).toContain('FADE AUDIO OUT');
      expect(names).toContain('AMBIENT');
      expect(names).toContain('CROSSFADE');
    });
  });

  describe('Basic commands', () => {
    test('parses SHOW + MOVE + SCALE + ROTATE', () => {
      const input = `SHOW IMAGE 1 FROM 0 TO 5
MOVE IMAGE 1 FROM 0,0 TO 300,100 DURING 0-5
SCALE IMAGE 1 FROM 1 TO 1.25 DURING 0-5
ROTATE IMAGE 1 FROM 0 TO 180 DURING 0-5`;
      const result = parseDsl(input, assets);
      expect(result.errors).toHaveLength(0);
      expect(result.commands).toHaveLength(4);

      const types = result.commands.map((c) => c.type);
      expect(types[0]).toBe('show');
      expect(types[1]).toBe('move');
      expect(types[2]).toBe('scale');
      expect(types[3]).toBe('rotate');
    });

    test('parses SHOW + MOVE3D + ROTATE3D + DEPTH', () => {
      const input = `SHOW IMAGE 1 FROM 0 TO 6
MOVE3D IMAGE 1 FROM 0,0,0 TO 100,0,400 DURING 0-6
ROTATE3D IMAGE 1 FROM 0,0,0 TO 10,25,0 DURING 1-6
DEPTH IMAGE 1 FROM 0 TO 300 DURING 0-6`;
      const result = parseDsl(input, assets);
      expect(result.errors).toHaveLength(0);
      expect(result.commands).toHaveLength(4);

      const types = result.commands.map((c) => c.type);
      expect(types[0]).toBe('show');
      expect(types[1]).toBe('move3D');
      expect(types[2]).toBe('rotate3D');
      expect(types[3]).toBe('depth');

      const move3d = result.commands[1];
      expect(move3d.from).toEqual({ x: 0, y: 0, z: 0 });
      expect(move3d.to).toEqual({ x: 100, y: 0, z: 400 });
    });

    test('parses SHOW + SLIDE + SFX', () => {
      const input = `SHOW IMAGE 1 FROM 0 TO 6
SHOW IMAGE 2 FROM 3 TO 8
SLIDE IMAGE 2 FROM RIGHT DURING 3-4
SFX 1 AT 3`;
      const result = parseDsl(input, assets);
      expect(result.errors).toHaveLength(0);
      expect(result.commands).toHaveLength(4);

      const types = result.commands.map((c) => c.type);
      expect(types[0]).toBe('show');
      expect(types[1]).toBe('show');
      expect(types[2]).toBe('slide');
      expect(types[3]).toBe('sfx');

      const slide = result.commands[2];
      expect(slide.direction).toBe('right');

      const sfx = result.commands[3];
      expect(sfx.start).toBe(3);
      expect(sfx.asset).toBe('uuid-audio1');
    });
  });

  describe('Audio commands', () => {
    test('parses MUSIC command', () => {
      const input = `MUSIC 1 FROM 0 TO 10`;
      const result = parseDsl(input, assets);
      expect(result.errors).toHaveLength(0);
      expect(result.commands).toHaveLength(1);

      const cmd = result.commands[0];
      expect(cmd.type).toBe('music');
      expect(cmd.asset).toBe('uuid-music1');
      expect(cmd.start).toBe(0);
      expect(cmd.duration).toBe(10);
    });

    test('parses FADE IN and FADE OUT', () => {
      const input = `FADE IN IMAGE 1 DURING 0-2
FADE OUT IMAGE 1 DURING 4-6`;
      const result = parseDsl(input, assets);
      expect(result.errors).toHaveLength(0);
      expect(result.commands).toHaveLength(2);
      expect(result.commands[0].type).toBe('fadeIn');
      expect(result.commands[1].type).toBe('fadeOut');
    });

    test('parses SFX with VOLUME', () => {
      const input = `SFX 1 AT 5 VOLUME 0.8`;
      const result = parseDsl(input, assets);
      expect(result.errors).toHaveLength(0);
      expect(result.commands).toHaveLength(1);

      const cmd = result.commands[0];
      expect(cmd.type).toBe('sfx');
      expect(cmd.volume).toBe(0.8);
    });
  });

  describe('Camera commands', () => {
    test('parses CAMERA MOVE', () => {
      const input = `CAMERA MOVE FROM 0,0,1200 TO 0,0,800 DURING 0-6`;
      const result = parseDsl(input, assets);
      expect(result.errors).toHaveLength(0);
      expect(result.commands).toHaveLength(1);

      const cmd = result.commands[0];
      expect(cmd.type).toBe('cameraMove');
      expect(cmd.from.z).toBe(1200);
      expect(cmd.to.z).toBe(800);
    });

    test('parses CAMERA ROTATE', () => {
      const input = `CAMERA ROTATE FROM 0,0,0 TO 5,10,0 DURING 0-6`;
      const result = parseDsl(input, assets);
      expect(result.errors).toHaveLength(0);
      expect(result.commands).toHaveLength(1);

      const cmd = result.commands[0];
      expect(cmd.type).toBe('cameraRotate');
    });
  });

  describe('Visual effect commands', () => {
    test('parses OPACITY', () => {
      const input = `OPACITY IMAGE 1 FROM 0 TO 1 DURING 0-2`;
      const result = parseDsl(input, assets);
      expect(result.errors).toHaveLength(0);
      expect(result.commands).toHaveLength(1);

      const cmd = result.commands[0];
      expect(cmd.type).toBe('opacity');
      expect(cmd.from).toBe(0);
      expect(cmd.to).toBe(1);
    });

    test('parses BLUR', () => {
      const input = `BLUR IMAGE 1 FROM 10 TO 0 DURING 0-2`;
      const result = parseDsl(input, assets);
      expect(result.errors).toHaveLength(0);
      expect(result.commands).toHaveLength(1);

      const cmd = result.commands[0];
      expect(cmd.type).toBe('blur');
    });

    test('parses HIDE', () => {
      const input = `HIDE IMAGE 1 AT 5`;
      const result = parseDsl(input, assets);
      expect(result.errors).toHaveLength(0);
      expect(result.commands).toHaveLength(1);

      const cmd = result.commands[0];
      expect(cmd.type).toBe('hide');
      expect(cmd.start).toBe(5);
    });

    test('parses REPLACE', () => {
      const input = `REPLACE IMAGE 1 WITH IMAGE 2 AT 5`;
      const result = parseDsl(input, assets);
      expect(result.errors).toHaveLength(0);
      expect(result.commands).toHaveLength(1);

      const cmd = result.commands[0];
      expect(cmd.type).toBe('replace');
      expect(cmd.target).toBe('uuid-img1');
      expect(cmd.asset).toBe('uuid-img2');
      expect(cmd.start).toBe(5);
    });

    test('parses DEPTH', () => {
      const input = `DEPTH IMAGE 1 FROM 0 TO 400 DURING 0-5`;
      const result = parseDsl(input, assets);
      expect(result.errors).toHaveLength(0);
      expect(result.commands).toHaveLength(1);

      const cmd = result.commands[0];
      expect(cmd.type).toBe('depth');
      expect(cmd.from).toBe(0);
      expect(cmd.to).toBe(400);
    });

    test('parses MOVE3D with negative coordinates', () => {
      const input = `MOVE3D IMAGE 1 FROM -100,50,-200 TO 300,-50,500 DURING 1.5-7.25`;
      const result = parseDsl(input, assets);
      expect(result.errors).toHaveLength(0);
      expect(result.commands).toHaveLength(1);

      const cmd = result.commands[0];
      expect(cmd.from.x).toBe(-100);
      expect(cmd.to.z).toBe(500);
      expect(cmd.start).toBe(1.5);
      expect(cmd.duration).toBe(5.75);
    });
  });

  describe('Text commands', () => {
    test('parses TEXT with FROM/TO syntax', () => {
      const input = `TEXT "HELLO" FROM 0 TO 5`;
      const result = parseDsl(input, assets);
      expect(result.errors).toHaveLength(0);
      expect(result.commands).toHaveLength(1);

      const cmd = result.commands[0];
      expect(cmd.type).toBe('text');
      expect(cmd.content).toBe('HELLO');
      expect(cmd.start).toBe(0);
      expect(cmd.duration).toBe(5);
    });

    test('parses SUBTITLE with FROM/TO syntax', () => {
      const input = `SUBTITLE "WORLD" FROM 0 TO 5`;
      const result = parseDsl(input, assets);
      expect(result.errors).toHaveLength(0);
      expect(result.commands).toHaveLength(1);

      const cmd = result.commands[0];
      expect(cmd.type).toBe('subtitle');
    });
  });

  describe('Error handling', () => {
    test('produces error for unknown command', () => {
      const input = `FOOBAR IMAGE 1 FROM 0 TO 5`;
      const result = parseDsl(input, assets);
      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.errors[0].message).toContain('Unknown command');
    });
  });
});