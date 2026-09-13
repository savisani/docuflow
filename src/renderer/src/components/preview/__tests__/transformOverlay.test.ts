import { describe, test, expect } from 'vitest';
import { LayerState } from '../../../types/timeline';

const MIN_SCALE = 0.05;
const MAX_SCALE = 10;

function clamp(val: number, min: number, max: number) {
  return Math.max(min, Math.min(max, val));
}

interface ResizeResult {
  x: number;
  y: number;
  scale: number;
  w: number;
  h: number;
}

function computeCornerResize(opts: {
  handle: 'nw' | 'ne' | 'sw' | 'se';
  elW: number;
  elH: number;
  startScale: number;
  startX: number;
  startY: number;
  dxComp: number;
  dyComp: number;
}): ResizeResult {
  const { handle, elW, elH, startScale, startX, startY, dxComp, dyComp } = opts;

  let handleDirX = 0;
  let handleDirY = 0;
  if (handle === 'se' || handle === 'ne') handleDirX = 1;
  if (handle === 'nw' || handle === 'sw') handleDirX = -1;
  if (handle === 'se' || handle === 'sw') handleDirY = 1;
  if (handle === 'nw' || handle === 'ne') handleDirY = -1;

  const diagLenSq = elW * elW + elH * elH;
  const delta = diagLenSq > 0
    ? (dxComp * handleDirX * elW + dyComp * handleDirY * elH) / diagLenSq
    : 0;
  const newScale = clamp(startScale + delta, MIN_SCALE, MAX_SCALE);

  const anchorOnLeft = handle === 'se' || handle === 'ne';
  const anchorOnTop = handle === 'se' || handle === 'sw';
  const anchorX = anchorOnLeft
    ? startX - elW / 2
    : startX + elW * (startScale - 0.5);
  const anchorY = anchorOnTop
    ? startY - elH / 2
    : startY + elH * (startScale - 0.5);

  const newX = anchorOnLeft
    ? anchorX + elW / 2
    : anchorX - elW * (newScale - 0.5);
  const newY = anchorOnTop
    ? anchorY + elH / 2
    : anchorY - elH * (newScale - 0.5);

  const w = elW * newScale;
  const h = elH * newScale;

  return { x: newX, y: newY, scale: newScale, w, h };
}

function computeEdgeResize(opts: {
  handle: 'e' | 'w' | 'n' | 's';
  elW: number;
  elH: number;
  startScale: number;
  startX: number;
  startY: number;
  dxComp: number;
  dyComp: number;
  naturalW: number;
  naturalH: number;
  aspectRatio: number;
}): ResizeResult {
  const { handle, elW, elH, startScale, startX, startY, dxComp, dyComp, naturalW, naturalH, aspectRatio } = opts;

  const origW = elW * startScale;
  const origH = elH * startScale;

  let newW: number;
  let newH: number;

  if (handle === 'e') {
    newW = Math.max(20, origW + dxComp);
    newH = newW / aspectRatio;
  } else if (handle === 'w') {
    newW = Math.max(20, origW - dxComp);
    newH = newW / aspectRatio;
  } else if (handle === 's') {
    newH = Math.max(20, origH + dyComp);
    newW = newH * aspectRatio;
  } else {
    newH = Math.max(20, origH - dyComp);
    newW = newH * aspectRatio;
  }

  const newScale = clamp(newW / naturalW, MIN_SCALE, MAX_SCALE);

  const anchorOnLeft = handle === 'e';
  const anchorOnTop = handle === 's';
  const anchorX = anchorOnLeft
    ? startX - elW / 2
    : startX + elW * (startScale - 0.5);
  const anchorY = anchorOnTop
    ? startY - elH / 2
    : startY + elH * (startScale - 0.5);

  const newX = anchorOnLeft
    ? anchorX + elW / 2
    : anchorX - elW * (newScale - 0.5);
  const newY = anchorOnTop
    ? anchorY + elH / 2
    : anchorY - elH * (newScale - 0.5);

  const w = naturalW * newScale;
  const h = naturalH * newScale;

  return { x: newX, y: newY, scale: newScale, w, h };
}

function screenToComp(dxScreen: number, dyScreen: number, displayScale: number) {
  return { dxComp: dxScreen / displayScale, dyComp: dyScreen / displayScale };
}

function visualNW(x: number, y: number, elW: number) {
  return { vx: x - elW / 2, vy: y - elW / 2 };
}

function findLayerForCommand(
  layers: Record<string, LayerState>,
  commandId: string
): LayerState | null {
  const direct = layers[commandId];
  if (direct) return direct;
  for (const layer of Object.values(layers)) {
    if (layer.assetSegments.some((seg) => seg.commandId === commandId)) {
      return layer;
    }
  }
  return null;
}

describe('TransformOverlay resize math', () => {
  const natW = 800;
  const natH = 600;
  const elW = natW;
  const elH = natH;

  describe('corner resize preserves aspect ratio', () => {
    test('SE handle: drag 100px right and 75px down maintains 4:3 ratio', () => {
      const result = computeCornerResize({
        handle: 'se', elW, elH, startScale: 1,
        startX: 0, startY: 0, dxComp: 100, dyComp: 75,
      });
      expect(result.w / result.h).toBeCloseTo(natW / natH, 6);
      expect(result.scale).toBeGreaterThan(1);
    });

    test('NW handle: drag -100px left and -75px up maintains 4:3 ratio', () => {
      const result = computeCornerResize({
        handle: 'nw', elW, elH, startScale: 1,
        startX: 0, startY: 0, dxComp: -100, dyComp: -75,
      });
      expect(result.w / result.h).toBeCloseTo(natW / natH, 6);
      expect(result.scale).toBeGreaterThan(1);
    });

    test('NE handle: drag 100px right and -75px up maintains 4:3 ratio', () => {
      const result = computeCornerResize({
        handle: 'ne', elW, elH, startScale: 1,
        startX: 0, startY: 0, dxComp: 100, dyComp: -75,
      });
      expect(result.w / result.h).toBeCloseTo(natW / natH, 6);
      expect(result.scale).toBeGreaterThan(1);
    });

    test('SW handle: drag -100px left and 75px down maintains 4:3 ratio', () => {
      const result = computeCornerResize({
        handle: 'sw', elW, elH, startScale: 1,
        startX: 0, startY: 0, dxComp: -100, dyComp: 75,
      });
      expect(result.w / result.h).toBeCloseTo(natW / natH, 6);
      expect(result.scale).toBeGreaterThan(1);
    });
  });

  describe('corner resize visual anchor stays fixed', () => {
    test('SE handle: visual NW corner stays fixed', () => {
      const sx = 100;
      const sy = 50;
      const result = computeCornerResize({
        handle: 'se', elW, elH, startScale: 1,
        startX: sx, startY: sy, dxComp: 200, dyComp: 150,
      });
      const nwOrigVX = sx - elW / 2;
      const nwOrigVY = sy - elH / 2;
      const nwNewVX = result.x - elW / 2;
      const nwNewVY = result.y - elH / 2;
      expect(nwNewVX).toBeCloseTo(nwOrigVX, 4);
      expect(nwNewVY).toBeCloseTo(nwOrigVY, 4);
    });

    test('NW handle: visual SE corner stays fixed', () => {
      const sx = 100;
      const sy = 50;
      const result = computeCornerResize({
        handle: 'nw', elW, elH, startScale: 1,
        startX: sx, startY: sy, dxComp: -200, dyComp: -150,
      });
      const seOrigVX = sx + elW * (1 - 0.5);
      const seOrigVY = sy + elH * (1 - 0.5);
      const seNewVX = result.x + elW * (result.scale - 0.5);
      const seNewVY = result.y + elH * (result.scale - 0.5);
      expect(seNewVX).toBeCloseTo(seOrigVX, 4);
      expect(seNewVY).toBeCloseTo(seOrigVY, 4);
    });

    test('NE handle: visual SW corner stays fixed', () => {
      const sx = 100;
      const sy = 50;
      const result = computeCornerResize({
        handle: 'ne', elW, elH, startScale: 1,
        startX: sx, startY: sy, dxComp: 200, dyComp: -150,
      });
      const swOrigVX = sx - elW / 2;
      const swOrigVY = sy + elH * (1 - 0.5);
      const swNewVX = result.x - elW / 2;
      const swNewVY = result.y + elH * (result.scale - 0.5);
      expect(swNewVX).toBeCloseTo(swOrigVX, 4);
      expect(swNewVY).toBeCloseTo(swOrigVY, 4);
    });

    test('SW handle: visual NE corner stays fixed', () => {
      const sx = 100;
      const sy = 50;
      const result = computeCornerResize({
        handle: 'sw', elW, elH, startScale: 1,
        startX: sx, startY: sy, dxComp: -200, dyComp: 150,
      });
      const neOrigVX = sx + elW * (1 - 0.5);
      const neOrigVY = sy - elH / 2;
      const neNewVX = result.x + elW * (result.scale - 0.5);
      const neNewVY = result.y - elH / 2;
      expect(neNewVX).toBeCloseTo(neOrigVX, 4);
      expect(neNewVY).toBeCloseTo(neOrigVY, 4);
    });

    test('SE handle: anchor stays fixed at non-zero position', () => {
      const sx = 300;
      const sy = 200;
      const result = computeCornerResize({
        handle: 'se', elW, elH, startScale: 1.5,
        startX: sx, startY: sy, dxComp: 100, dyComp: 75,
      });
      const nwOrigVX = sx - elW / 2;
      const nwOrigVY = sy - elH / 2;
      const nwNewVX = result.x - elW / 2;
      const nwNewVY = result.y - elH / 2;
      expect(nwNewVX).toBeCloseTo(nwOrigVX, 4);
      expect(nwNewVY).toBeCloseTo(nwOrigVY, 4);
    });
  });

  describe('edge resize position anchoring', () => {
    test('e handle: visual left edge stays fixed', () => {
      const sx = 100;
      const sy = 50;
      const result = computeEdgeResize({
        handle: 'e', elW, elH, startScale: 1,
        startX: sx, startY: sy, dxComp: 200, dyComp: 0,
        naturalW: natW, naturalH: natH, aspectRatio: natW / natH,
      });
      const leftOrig = sx - elW / 2;
      const leftNew = result.x - elW / 2;
      expect(leftNew).toBeCloseTo(leftOrig, 4);
    });

    test('w handle: visual right edge stays fixed', () => {
      const sx = 100;
      const sy = 50;
      const result = computeEdgeResize({
        handle: 'w', elW, elH, startScale: 1,
        startX: sx, startY: sy, dxComp: -200, dyComp: 0,
        naturalW: natW, naturalH: natH, aspectRatio: natW / natH,
      });
      const rightOrig = sx + elW * (1 - 0.5);
      const rightNew = result.x + elW * (result.scale - 0.5);
      expect(rightNew).toBeCloseTo(rightOrig, 4);
    });

    test('s handle: visual top edge stays fixed', () => {
      const sx = 100;
      const sy = 50;
      const result = computeEdgeResize({
        handle: 's', elW, elH, startScale: 1,
        startX: sx, startY: sy, dxComp: 0, dyComp: 150,
        naturalW: natW, naturalH: natH, aspectRatio: natW / natH,
      });
      const topOrig = sy - elH / 2;
      const topNew = result.y - elH / 2;
      expect(topNew).toBeCloseTo(topOrig, 4);
    });

    test('n handle: visual bottom edge stays fixed', () => {
      const sx = 100;
      const sy = 50;
      const result = computeEdgeResize({
        handle: 'n', elW, elH, startScale: 1,
        startX: sx, startY: sy, dxComp: 0, dyComp: -150,
        naturalW: natW, naturalH: natH, aspectRatio: natW / natH,
      });
      const bottomOrig = sy + elH * (1 - 0.5);
      const bottomNew = result.y + elH * (result.scale - 0.5);
      expect(bottomNew).toBeCloseTo(bottomOrig, 4);
    });
  });

  describe('screen-to-composition coordinate conversion', () => {
    test('scale=0.5: 100 screen px = 200 comp px', () => {
      const { dxComp } = screenToComp(100, 0, 0.5);
      expect(dxComp).toBe(200);
    });

    test('scale=2: 100 screen px = 50 comp px', () => {
      const { dxComp } = screenToComp(100, 0, 2);
      expect(dxComp).toBe(50);
    });

    test('scale=1: screen and comp are 1:1', () => {
      const { dxComp, dyComp } = screenToComp(100, -50, 1);
      expect(dxComp).toBe(100);
      expect(dyComp).toBe(-50);
    });
  });

  describe('mostly horizontal/vertical drags', () => {
    test('SE: mostly horizontal drag gives small scale change for tall image', () => {
      const tallElW = 200;
      const tallElH = 800;
      const result = computeCornerResize({
        handle: 'se', elW: tallElW, elH: tallElH, startScale: 1,
        startX: 0, startY: 0, dxComp: 100, dyComp: 0,
      });
      expect(result.w / result.h).toBeCloseTo(tallElW / tallElH, 6);
      expect(result.scale).toBeGreaterThan(1);
    });

    test('SE: mostly vertical drag gives small scale change for wide image', () => {
      const wideElW = 800;
      const wideElH = 200;
      const result = computeCornerResize({
        handle: 'se', elW: wideElW, elH: wideElH, startScale: 1,
        startX: 0, startY: 0, dxComp: 0, dyComp: 100,
      });
      expect(result.w / result.h).toBeCloseTo(wideElW / wideElH, 6);
      expect(result.scale).toBeGreaterThan(1);
    });

    test('SE: diagonal drag along aspect ratio gives proportional scale', () => {
      const result = computeCornerResize({
        handle: 'se', elW: 800, elH: 600, startScale: 1,
        startX: 0, startY: 0, dxComp: 80, dyComp: 60,
      });
      expect(result.scale).toBeCloseTo(1.1, 4);
    });
  });

  describe('repeated resize does not accumulate error', () => {
    test('SE: resize 10 times by same delta, anchor stays fixed', () => {
      let scale = 1;
      let cx = 100;
      let cy = 50;
      const dxComp = 50;
      const dyComp = 37.5;

      for (let i = 0; i < 10; i++) {
        const result = computeCornerResize({
          handle: 'se', elW: natW, elH: natH, startScale: scale,
          startX: cx, startY: cy, dxComp, dyComp,
        });
        scale = result.scale;
        cx = result.x;
        cy = result.y;
      }

      expect(natW / natH).toBeCloseTo(natW / natH, 6);
      expect(scale).toBeGreaterThan(1);

      const nwVX = cx - natW / 2;
      const nwVY = cy - natH / 2;
      expect(nwVX).toBeCloseTo(100 - natW / 2, 2);
      expect(nwVY).toBeCloseTo(50 - natH / 2, 2);
    });
  });

  describe('edge cases', () => {
    test('very small image can be resized', () => {
      const result = computeCornerResize({
        handle: 'se', elW: 10, elH: 10, startScale: 0.1,
        startX: 0, startY: 0, dxComp: 100, dyComp: 100,
      });
      expect(result.scale).toBeGreaterThan(0.1);
      expect(result.w).toBeGreaterThan(1);
    });

    test('very large image can be resized', () => {
      const result = computeCornerResize({
        handle: 'se', elW: 4000, elH: 3000, startScale: 1,
        startX: 0, startY: 0, dxComp: 200, dyComp: 150,
      });
      expect(result.scale).toBeGreaterThan(1);
      expect(result.w).toBeCloseTo(4000 * result.scale, 2);
    });

    test('dragging inward makes image smaller', () => {
      const result = computeCornerResize({
        handle: 'se', elW, elH, startScale: 1,
        startX: 0, startY: 0, dxComp: -200, dyComp: -150,
      });
      expect(result.scale).toBeLessThan(1);
    });

    test('image positioned outside composition can still be resized', () => {
      const sx = -500;
      const sy = -300;
      const result = computeCornerResize({
        handle: 'nw', elW, elH, startScale: 1,
        startX: sx, startY: sy, dxComp: -100, dyComp: -75,
      });
      const seNewVX = result.x + elW * (result.scale - 0.5);
      const seNewVY = result.y + elH * (result.scale - 0.5);
      const seOrigVX = sx + elW * (1 - 0.5);
      const seOrigVY = sy + elH * (1 - 0.5);
      expect(seNewVX).toBeCloseTo(seOrigVX, 4);
      expect(seNewVY).toBeCloseTo(seOrigVY, 4);
    });
  });

  describe('portrait image', () => {
    const pElW = 600;
    const pElH = 800;

    test('SE corner resize maintains portrait aspect ratio', () => {
      const result = computeCornerResize({
        handle: 'se', elW: pElW, elH: pElH, startScale: 1,
        startX: 0, startY: 0, dxComp: 100, dyComp: 133.33,
      });
      expect(result.w / result.h).toBeCloseTo(pElW / pElH, 6);
      const nwNewVX = result.x - pElW / 2;
      const nwNewVY = result.y - pElH / 2;
      expect(nwNewVX).toBeCloseTo(-pElW / 2, 4);
      expect(nwNewVY).toBeCloseTo(-pElH / 2, 4);
    });
  });

  describe('square image', () => {
    const sElW = 500;
    const sElH = 500;

    test('NE corner resize maintains square aspect ratio', () => {
      const result = computeCornerResize({
        handle: 'ne', elW: sElW, elH: sElH, startScale: 1,
        startX: 0, startY: 0, dxComp: 150, dyComp: -150,
      });
      expect(result.w / result.h).toBeCloseTo(1, 6);
      const swNewVX = result.x - sElW / 2;
      const swNewVY = result.y + sElH * (result.scale - 0.5);
      expect(swNewVX).toBeCloseTo(-sElW / 2, 4);
      expect(swNewVY).toBeCloseTo(sElH * (1 - 0.5), 4);
    });
  });

  describe('findLayerForCommand', () => {
    const mockLayers: Record<string, LayerState> = {
      'cmd-a': {
        id: 'cmd-a',
        assetId: 'asset-1',
        assetUrl: 'url1',
        assetType: 'image',
        visible: true,
        startFrame: 0,
        endFrame: 90,
        x: 0, y: 0, z: 0, scale: 1,
        rotationX: 0, rotationY: 0, rotationZ: 0,
        opacity: 1, blur: 0, flipH: false, flipV: false,
        cropX: 0, cropY: 0, cropWidth: 0, cropHeight: 0,
        zIndex: 0,
        animations: [],
        keyframeTracks: [],
        assetSegments: [
          { assetId: 'asset-1', assetUrl: 'url1', assetType: 'image', startFrame: 0, commandId: 'cmd-a' },
        ],
      },
      'cmd-b': {
        id: 'cmd-b',
        assetId: 'asset-2',
        assetUrl: 'url2',
        assetType: 'image',
        visible: true,
        startFrame: 90,
        endFrame: 180,
        x: 0, y: 0, z: 0, scale: 1,
        rotationX: 0, rotationY: 0, rotationZ: 0,
        opacity: 1, blur: 0, flipH: false, flipV: false,
        cropX: 0, cropY: 0, cropWidth: 0, cropHeight: 0,
        zIndex: 1,
        animations: [],
        keyframeTracks: [],
        assetSegments: [
          { assetId: 'asset-2', assetUrl: 'url2', assetType: 'image', startFrame: 90, commandId: 'cmd-b' },
        ],
      },
    };

    test('finds layer by direct key match', () => {
      const result = findLayerForCommand(mockLayers, 'cmd-a');
      expect(result).toBe(mockLayers['cmd-a']);
    });

    test('finds layer by segment commandId', () => {
      const layersWithSegment: Record<string, LayerState> = {
        'layer-1': {
          ...mockLayers['cmd-a'],
          id: 'layer-1',
          assetSegments: [
            { assetId: 'asset-1', assetUrl: 'url1', assetType: 'image', startFrame: 0, commandId: 'cmd-segment-1' },
            { assetId: 'asset-2', assetUrl: 'url2', assetType: 'image', startFrame: 90, commandId: 'cmd-segment-2' },
          ],
        },
      };
      const result = findLayerForCommand(layersWithSegment, 'cmd-segment-2');
      expect(result).toBe(layersWithSegment['layer-1']);
    });

    test('returns null for unknown command', () => {
      const result = findLayerForCommand(mockLayers, 'cmd-unknown');
      expect(result).toBeNull();
    });

    test('returns null for empty layers', () => {
      const result = findLayerForCommand({}, 'cmd-a');
      expect(result).toBeNull();
    });
  });
});
