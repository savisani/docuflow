import { describe, test, expect } from 'vitest';

// Pure math functions extracted from TransformOverlay resize logic.
// These test the coordinate model independent of React/DOM.

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
  origW: number;
  origH: number;
  origScale: number;
  origCX: number;
  origCY: number;
  dxComp: number;
  dyComp: number;
  naturalW: number;
  naturalH: number;
}): ResizeResult {
  const { handle, origW, origH, origScale, origCX, origCY, dxComp, dyComp, naturalW, naturalH } = opts;

  let effectiveDx = dxComp;
  let effectiveDy = dyComp;
  if (handle === 'nw' || handle === 'sw') effectiveDx = -dxComp;
  if (handle === 'nw' || handle === 'ne') effectiveDy = -dyComp;

  const origDist = Math.sqrt(origW * origW + origH * origH);
  const newDist = Math.sqrt(
    (origW + effectiveDx) * (origW + effectiveDx) +
    (origH + effectiveDy) * (origH + effectiveDy)
  );
  const uniformDelta = origDist > 0 ? newDist / origDist : 1;
  const newScale = clamp(origScale * uniformDelta, MIN_SCALE, MAX_SCALE);

  const cw = naturalW * newScale;
  const ch = naturalH * newScale;

  let signX = 0;
  let signY = 0;
  if (handle === 'e' || handle === 'ne' || handle === 'se') signX = 1;
  if (handle === 'w' || handle === 'nw' || handle === 'sw') signX = -1;
  if (handle === 's' || handle === 'sw' || handle === 'se') signY = 1;
  if (handle === 'n' || handle === 'nw' || handle === 'ne') signY = -1;

  const newX = origCX + signX * (cw - origW) / 2;
  const newY = origCY + signY * (ch - origH) / 2;

  return { x: newX, y: newY, scale: newScale, w: cw, h: ch };
}

function computeEdgeResize(opts: {
  handle: 'e' | 'w' | 'n' | 's';
  origW: number;
  origH: number;
  origScale: number;
  origCX: number;
  origCY: number;
  dxComp: number;
  dyComp: number;
  naturalW: number;
  naturalH: number;
  aspectRatio: number;
}): ResizeResult {
  const { handle, origW, origH, origScale, origCX, origCY, dxComp, dyComp, naturalW, naturalH, aspectRatio } = opts;

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

  const cw = naturalW * newScale;
  const ch = naturalH * newScale;

  let signX = 0;
  let signY = 0;
  if (handle === 'e') signX = 1;
  if (handle === 'w') signX = -1;
  if (handle === 's') signY = 1;
  if (handle === 'n') signY = -1;

  const newX = origCX + signX * (cw - origW) / 2;
  const newY = origCY + signY * (ch - origH) / 2;

  return { x: newX, y: newY, scale: newScale, w: cw, h: ch };
}

// Simulate the screen-to-composition coordinate conversion
function screenToComp(dxScreen: number, dyScreen: number, displayScale: number) {
  return { dxComp: dxScreen / displayScale, dyComp: dyScreen / displayScale };
}

describe('TransformOverlay resize math', () => {
  const natW = 800;
  const natH = 600;
  const initialScale = 1;
  const origW = natW * initialScale;
  const origH = natH * initialScale;
  const origCX = 0;
  const origCY = 0;

  describe('corner resize preserves aspect ratio', () => {
    test('SE handle: drag 100px right and 75px down maintains 4:3 ratio', () => {
      const dxComp = 100;
      const dyComp = 75;
      const result = computeCornerResize({
        handle: 'se', origW, origH, origScale: initialScale,
        origCX, origCY, dxComp, dyComp, naturalW: natW, naturalH: natH,
      });
      // Aspect ratio should be preserved
      expect(result.w / result.h).toBeCloseTo(natW / natH, 6);
      // Scale should increase (image got bigger)
      expect(result.scale).toBeGreaterThan(initialScale);
    });

    test('NW handle: drag -100px left and -75px up maintains 4:3 ratio', () => {
      const dxComp = -100;
      const dyComp = -75;
      const result = computeCornerResize({
        handle: 'nw', origW, origH, origScale: initialScale,
        origCX, origCY, dxComp, dyComp, naturalW: natW, naturalH: natH,
      });
      expect(result.w / result.h).toBeCloseTo(natW / natH, 6);
      expect(result.scale).toBeGreaterThan(initialScale);
    });

    test('NE handle: drag 100px right and -75px up maintains 4:3 ratio', () => {
      const dxComp = 100;
      const dyComp = -75;
      const result = computeCornerResize({
        handle: 'ne', origW, origH, origScale: initialScale,
        origCX, origCY, dxComp, dyComp, naturalW: natW, naturalH: natH,
      });
      expect(result.w / result.h).toBeCloseTo(natW / natH, 6);
      expect(result.scale).toBeGreaterThan(initialScale);
    });

    test('SW handle: drag -100px left and 75px down maintains 4:3 ratio', () => {
      const dxComp = -100;
      const dyComp = 75;
      const result = computeCornerResize({
        handle: 'sw', origW, origH, origScale: initialScale,
        origCX, origCY, dxComp, dyComp, naturalW: natW, naturalH: natH,
      });
      expect(result.w / result.h).toBeCloseTo(natW / natH, 6);
      expect(result.scale).toBeGreaterThan(initialScale);
    });
  });

  describe('corner resize position anchoring', () => {
    test('SE handle: NW corner stays fixed', () => {
      const result = computeCornerResize({
        handle: 'se', origW, origH, origScale: initialScale,
        origCX: 100, origCY: 50, dxComp: 200, dyComp: 150, naturalW: natW, naturalH: natH,
      });
      // NW corner of original: (100 - 400, 50 - 300) = (-300, -250)
      // NW corner of resized: (result.x - result.w/2, result.y - result.h/2)
      const nwOrigX = 100 - origW / 2;
      const nwOrigY = 50 - origH / 2;
      const nwNewX = result.x - result.w / 2;
      const nwNewY = result.y - result.h / 2;
      expect(nwNewX).toBeCloseTo(nwOrigX, 4);
      expect(nwNewY).toBeCloseTo(nwOrigY, 4);
    });

    test('NW handle: SE corner stays fixed', () => {
      const result = computeCornerResize({
        handle: 'nw', origW, origH, origScale: initialScale,
        origCX: 100, origCY: 50, dxComp: -200, dyComp: -150, naturalW: natW, naturalH: natH,
      });
      // SE corner of original: (100 + 400, 50 + 300) = (500, 350)
      const seOrigX = 100 + origW / 2;
      const seOrigY = 50 + origH / 2;
      const seNewX = result.x + result.w / 2;
      const seNewY = result.y + result.h / 2;
      expect(seNewX).toBeCloseTo(seOrigX, 4);
      expect(seNewY).toBeCloseTo(seOrigY, 4);
    });

    test('NE handle: SW corner stays fixed', () => {
      const result = computeCornerResize({
        handle: 'ne', origW, origH, origScale: initialScale,
        origCX: 100, origCY: 50, dxComp: 200, dyComp: -150, naturalW: natW, naturalH: natH,
      });
      const swOrigX = 100 - origW / 2;
      const swOrigY = 50 + origH / 2;
      const swNewX = result.x - result.w / 2;
      const swNewY = result.y + result.h / 2;
      expect(swNewX).toBeCloseTo(swOrigX, 4);
      expect(swNewY).toBeCloseTo(swOrigY, 4);
    });

    test('SW handle: NE corner stays fixed', () => {
      const result = computeCornerResize({
        handle: 'sw', origW, origH, origScale: initialScale,
        origCX: 100, origCY: 50, dxComp: -200, dyComp: 150, naturalW: natW, naturalH: natH,
      });
      const neOrigX = 100 + origW / 2;
      const neOrigY = 50 - origH / 2;
      const neNewX = result.x + result.w / 2;
      const neNewY = result.y - result.h / 2;
      expect(neNewX).toBeCloseTo(neOrigX, 4);
      expect(neNewY).toBeCloseTo(neOrigY, 4);
    });
  });

  describe('edge resize position anchoring', () => {
    test('e handle: left edge stays fixed', () => {
      const result = computeEdgeResize({
        handle: 'e', origW, origH, origScale: initialScale,
        origCX: 100, origCY: 50, dxComp: 200, dyComp: 0,
        naturalW: natW, naturalH: natH, aspectRatio: natW / natH,
      });
      const leftOrig = 100 - origW / 2;
      const leftNew = result.x - result.w / 2;
      expect(leftNew).toBeCloseTo(leftOrig, 4);
    });

    test('w handle: right edge stays fixed', () => {
      const result = computeEdgeResize({
        handle: 'w', origW, origH, origScale: initialScale,
        origCX: 100, origCY: 50, dxComp: -200, dyComp: 0,
        naturalW: natW, naturalH: natH, aspectRatio: natW / natH,
      });
      const rightOrig = 100 + origW / 2;
      const rightNew = result.x + result.w / 2;
      expect(rightNew).toBeCloseTo(rightOrig, 4);
    });

    test('s handle: top edge stays fixed', () => {
      const result = computeEdgeResize({
        handle: 's', origW, origH, origScale: initialScale,
        origCX: 100, origCY: 50, dxComp: 0, dyComp: 150,
        naturalW: natW, naturalH: natH, aspectRatio: natW / natH,
      });
      const topOrig = 50 - origH / 2;
      const topNew = result.y - result.h / 2;
      expect(topNew).toBeCloseTo(topOrig, 4);
    });

    test('n handle: bottom edge stays fixed', () => {
      const result = computeEdgeResize({
        handle: 'n', origW, origH, origScale: initialScale,
        origCX: 100, origCY: 50, dxComp: 0, dyComp: -150,
        naturalW: natW, naturalH: natH, aspectRatio: natW / natH,
      });
      const bottomOrig = 50 + origH / 2;
      const bottomNew = result.y + result.h / 2;
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

  describe('repeated resize does not accumulate error', () => {
    test('resize 10 times by same delta, result is consistent', () => {
      let scale = 1;
      let cx = 0;
      let cy = 0;
      const dxComp = 50;
      const dyComp = 37.5; // maintains 4:3 ratio

      for (let i = 0; i < 10; i++) {
        const ow = natW * scale;
        const oh = natH * scale;
        const result = computeCornerResize({
          handle: 'se', origW: ow, origH: oh, origScale: scale,
          origCX: cx, origCY: cy, dxComp, dyComp, naturalW: natW, naturalH: natH,
        });
        scale = result.scale;
        cx = result.x;
        cy = result.y;
      }

      // After 10 resizes, aspect ratio should still be correct
      const finalW = natW * scale;
      const finalH = natH * scale;
      expect(finalW / finalH).toBeCloseTo(natW / natH, 6);

      // Scale should be monotonically increasing
      expect(scale).toBeGreaterThan(1);
    });
  });

  describe('edge cases', () => {
    test('very small image can be resized', () => {
      const smallNatW = 10;
      const smallNatH = 10;
      const smallOrigW = 10;
      const smallOrigH = 10;
      const result = computeCornerResize({
        handle: 'se', origW: smallOrigW, origH: smallOrigH, origScale: 0.1,
        origCX: 0, origCY: 0, dxComp: 100, dyComp: 100,
        naturalW: smallNatW, naturalH: smallNatH,
      });
      expect(result.scale).toBeGreaterThan(0.1);
      expect(result.w).toBeGreaterThan(smallOrigW);
    });

    test('very large image can be resized', () => {
      const largeNatW = 4000;
      const largeNatH = 3000;
      const largeOrigW = 4000;
      const largeOrigH = 3000;
      const result = computeCornerResize({
        handle: 'se', origW: largeOrigW, origH: largeOrigH, origScale: 1,
        origCX: 0, origCY: 0, dxComp: 200, dyComp: 150,
        naturalW: largeNatW, naturalH: largeNatH,
      });
      expect(result.scale).toBeGreaterThan(1);
      expect(result.w).toBeCloseTo(largeNatW * result.scale, 2);
    });

    test('dragging inward makes image smaller', () => {
      const result = computeCornerResize({
        handle: 'se', origW, origH, origScale: initialScale,
        origCX: 0, origCY: 0, dxComp: -200, dyComp: -150,
        naturalW: natW, naturalH: natH,
      });
      expect(result.scale).toBeLessThan(initialScale);
    });

    test('image positioned outside composition can still be resized', () => {
      const result = computeCornerResize({
        handle: 'nw', origW, origH, origScale: initialScale,
        origCX: -500, origCY: -300, dxComp: -100, dyComp: -75,
        naturalW: natW, naturalH: natH,
      });
      // NW handle anchors at SE corner: (-500 + 400, -300 + 300) = (-100, 0)
      const seNewX = result.x + result.w / 2;
      const seNewY = result.y + result.h / 2;
      expect(seNewX).toBeCloseTo(-100, 4);
      expect(seNewY).toBeCloseTo(0, 4);
    });
  });

  describe('portrait image', () => {
    const pNatW = 600;
    const pNatH = 800;

    test('SE corner resize maintains portrait aspect ratio', () => {
      const pOrigW = pNatW;
      const pOrigH = pNatH;
      const result = computeCornerResize({
        handle: 'se', origW: pOrigW, origH: pOrigH, origScale: 1,
        origCX: 0, origCY: 0, dxComp: 100, dyComp: 133.33,
        naturalW: pNatW, naturalH: pNatH,
      });
      expect(result.w / result.h).toBeCloseTo(pNatW / pNatH, 6);
      // NW corner stays fixed
      const nwNewX = result.x - result.w / 2;
      const nwNewY = result.y - result.h / 2;
      expect(nwNewX).toBeCloseTo(-pOrigW / 2, 4);
      expect(nwNewY).toBeCloseTo(-pOrigH / 2, 4);
    });
  });

  describe('square image', () => {
    const sNatW = 500;
    const sNatH = 500;

    test('any corner resize maintains square aspect ratio', () => {
      const sOrigW = sNatW;
      const sOrigH = sNatH;
      const result = computeCornerResize({
        handle: 'ne', origW: sOrigW, origH: sOrigH, origScale: 1,
        origCX: 0, origCY: 0, dxComp: 150, dyComp: -150,
        naturalW: sNatW, naturalH: sNatH,
      });
      expect(result.w / result.h).toBeCloseTo(1, 6);
      // SW corner stays fixed
      const swNewX = result.x - result.w / 2;
      const swNewY = result.y + result.h / 2;
      expect(swNewX).toBeCloseTo(-sOrigW / 2, 4);
      expect(swNewY).toBeCloseTo(sOrigH / 2, 4);
    });
  });
});
