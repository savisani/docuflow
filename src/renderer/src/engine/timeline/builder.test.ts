import { describe, test, expect } from 'vitest';
import { buildTimeline } from './builder';
import { resolveLayerState, resolveCameraState } from './resolver';
import { Command } from '../commands/types';
import { Asset } from '../../types/assets';
import { ProjectSettings } from '../../types/project';

function makeAsset(id: string, logicalId: string, type: Asset['type'] = 'image'): Asset {
  return {
    id,
    logicalId,
    filename: `${logicalId}.jpg`,
    type,
    mimeType: 'image/jpeg',
  };
}

function makeImageCmd(id: string, assetId: string, start: number, duration: number): Command {
  return { id, type: 'show', asset: assetId, start, duration } as Command;
}

const settings: ProjectSettings = { width: 1920, height: 1080, fps: 30 };

function resolveAt(tl: ReturnType<typeof buildTimeline>, layerId: string, timeSec: number) {
  const layer = tl.layers[layerId];
  if (!layer) return null;
  const frame = Math.round(timeSec * settings.fps);
  return resolveLayerState(layer, frame);
}

describe('Timeline Builder', () => {
  describe('MOVE3D', () => {
    test('animation resolves correctly over time', () => {
      const assets = [makeAsset('img1', 'image1')];
      const commands: Command[] = [
        makeImageCmd('cmd-show', 'img1', 0, 10),
        {
          id: 'cmd-move3d', type: 'move3D', target: 'cmd-show', start: 0, duration: 10,
          from: { x: 0, y: 0, z: 0 }, to: { x: 200, y: 0, z: 400 },
        } as Command,
      ];

      const tl = buildTimeline(commands, assets, settings);
      expect(tl.layers['cmd-show']).toBeDefined();

      const anims = tl.layers['cmd-show'].animations;
      expect(anims.length).toBe(3);

      const at0 = resolveAt(tl, 'cmd-show', 0);
      expect(at0?.z).toBe(0);

      const at5 = resolveAt(tl, 'cmd-show', 5);
      expect(at5?.z).toBe(200);
      expect(at5?.x).toBe(100);

      const at10 = resolveAt(tl, 'cmd-show', 10);
      expect(at10?.z).toBe(400);
      expect(at10?.x).toBe(200);
    });
  });

  describe('ROTATE3D', () => {
    test('animation resolves correctly', () => {
      const assets = [makeAsset('img1', 'image1')];
      const commands: Command[] = [
        makeImageCmd('cmd-show', 'img1', 0, 10),
        {
          id: 'cmd-rot3d', type: 'rotate3D', target: 'cmd-show', start: 2, duration: 6,
          from: { x: 0, y: 0, z: 0 }, to: { x: 10, y: 25, z: 0 },
        } as Command,
      ];

      const tl = buildTimeline(commands, assets, settings);

      const at0 = resolveAt(tl, 'cmd-show', 0);
      expect(at0?.rotationX).toBe(0);

      const at2 = resolveAt(tl, 'cmd-show', 2);
      expect(at2?.rotationX).toBe(0);

      const at5 = resolveAt(tl, 'cmd-show', 5);
      expect(at5?.rotationX).toBe(5);
      expect(at5?.rotationY).toBe(12.5);

      const at8 = resolveAt(tl, 'cmd-show', 8);
      expect(at8?.rotationX).toBe(10);
      expect(at8?.rotationY).toBe(25);
    });
  });

  describe('DEPTH', () => {
    test('animation resolves correctly', () => {
      const assets = [makeAsset('img1', 'image1')];
      const commands: Command[] = [
        makeImageCmd('cmd-show', 'img1', 0, 12),
        {
          id: 'cmd-depth', type: 'depth', target: 'cmd-show', start: 4, duration: 8,
          from: 400, to: 100,
        } as Command,
      ];

      const tl = buildTimeline(commands, assets, settings);

      const at0 = resolveAt(tl, 'cmd-show', 0);
      expect(at0?.z).toBe(0);

      const at4 = resolveAt(tl, 'cmd-show', 4);
      expect(at4?.z).toBe(400);

      const at8 = resolveAt(tl, 'cmd-show', 8);
      expect(at8?.z).toBe(250);

      const at12 = resolveAt(tl, 'cmd-show', 12);
      expect(at12?.z).toBe(100);
    });
  });

  describe('Multiple simultaneous animations', () => {
    test('coexist on same layer', () => {
      const assets = [makeAsset('img1', 'image1')];
      const commands: Command[] = [
        makeImageCmd('cmd-show', 'img1', 0, 10),
        {
          id: 'cmd-move', type: 'move', target: 'cmd-show', start: 0, duration: 10,
          from: { x: 0, y: 0 }, to: { x: 100, y: 50 },
        } as Command,
        {
          id: 'cmd-scale', type: 'scale', target: 'cmd-show', start: 0, duration: 10,
          from: 1, to: 2,
        } as Command,
        {
          id: 'cmd-rotate', type: 'rotate', target: 'cmd-show', start: 0, duration: 10,
          from: 0, to: 180,
        } as Command,
      ];

      const tl = buildTimeline(commands, assets, settings);
      const anims = tl.layers['cmd-show'].animations;
      expect(anims.length).toBe(4);

      const at5 = resolveAt(tl, 'cmd-show', 5);
      expect(at5?.x).toBe(50);
      expect(at5?.y).toBe(25);
      expect(at5?.scale).toBe(1.5);
      expect(at5?.rotationZ).toBe(90);
    });
  });

  describe('Animation timing', () => {
    test('retains base before start, interpolates during, retains final after end', () => {
      const assets = [makeAsset('img1', 'image1')];
      const commands: Command[] = [
        makeImageCmd('cmd-show', 'img1', 0, 15),
        {
          id: 'cmd-move', type: 'move', target: 'cmd-show', start: 5, duration: 5,
          from: { x: 0, y: 0 }, to: { x: 100, y: 0 },
        } as Command,
      ];

      const tl = buildTimeline(commands, assets, settings);

      const before = resolveAt(tl, 'cmd-show', 0);
      expect(before?.x).toBe(0);

      const start = resolveAt(tl, 'cmd-show', 5);
      expect(start?.x).toBe(0);

      const mid = resolveAt(tl, 'cmd-show', 7.5);
      expect(mid?.x).toBe(50);

      const end = resolveAt(tl, 'cmd-show', 10);
      expect(end?.x).toBe(100);

      const after = resolveAt(tl, 'cmd-show', 12);
      expect(after?.x).toBe(100);
    });
  });

  describe('Camera', () => {
    test('MOVE animates correctly', () => {
      const assets = [makeAsset('img1', 'image1')];
      const commands: Command[] = [
        makeImageCmd('cmd-show', 'img1', 0, 10),
        {
          id: 'cmd-cam', type: 'cameraMove', start: 0, duration: 10,
          from: { x: 0, y: 0, z: 1200 }, to: { x: 0, y: 0, z: 700 },
        } as Command,
      ];

      const tl = buildTimeline(commands, assets, settings);

      const cam0 = resolveCameraState(tl.camera, 0);
      expect(cam0.z).toBe(1200);

      const cam5 = resolveCameraState(tl.camera, 150);
      expect(cam5.z).toBe(950);

      const cam10 = resolveCameraState(tl.camera, 300);
      expect(cam10.z).toBe(700);
    });
  });

  describe('2D MOVE', () => {
    test('produces x/y animations only', () => {
      const assets = [makeAsset('img1', 'image1')];
      const commands: Command[] = [
        makeImageCmd('cmd-show', 'img1', 0, 5),
        {
          id: 'cmd-move', type: 'move', target: 'cmd-show', start: 0, duration: 5,
          from: { x: 0, y: 0 }, to: { x: 300, y: 100 },
        } as Command,
      ];

      const tl = buildTimeline(commands, assets, settings);
      const anims = tl.layers['cmd-show'].animations;
      const props = anims.map((a) => a.property);
      expect(props).toContain('x');
      expect(props).toContain('y');
      expect(props).not.toContain('z');

      const at2 = resolveAt(tl, 'cmd-show', 2);
      expect(at2?.x).toBe(120);
      expect(at2?.y).toBe(40);
    });
  });
});