import { describe, it, expect } from 'vitest';
import {
  sampleBorderColor,
  borderUniformity,
  isChromaKeyGreen,
  meanBorderLuminance,
  colorKeyToAlpha,
  luminanceToAlpha,
  transparentRatio,
} from '../alpha';

function makeImage(
  width: number,
  height: number,
  paint: (x: number, y: number) => [number, number, number],
): Uint8ClampedArray {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const [r, g, b] = paint(x, y);
      const i = (y * width + x) * 4;
      data[i] = r;
      data[i + 1] = g;
      data[i + 2] = b;
      data[i + 3] = 255;
    }
  }
  return data;
}

/** Green background with an opaque red square in the middle. */
function greenScreenWithSubject(width = 40, height = 40) {
  return makeImage(width, height, (x, y) =>
    x >= 12 && x < 28 && y >= 12 && y < 28 ? [220, 30, 30] : [0, 255, 0],
  );
}

describe('sampleBorderColor', () => {
  it('returns the background color sampled from the border', () => {
    const data = greenScreenWithSubject();
    const key = sampleBorderColor(data, 40, 40);
    expect(key.g).toBeGreaterThan(240);
    expect(key.r).toBeLessThan(15);
    expect(key.b).toBeLessThan(15);
  });

  it('ignores subject pixels in the interior', () => {
    const data = greenScreenWithSubject();
    const key = sampleBorderColor(data, 40, 40);
    expect(key.r).toBeLessThan(15);
  });
});

describe('borderUniformity', () => {
  it('scores a flat key background as uniform', () => {
    const data = greenScreenWithSubject();
    expect(borderUniformity(data, 40, 40)).toBeLessThan(10);
  });

  it('scores a rendered scene border as non-uniform', () => {
    const data = makeImage(40, 40, (x, y) => [(x * 17) % 255, (y * 31) % 255, ((x + y) * 13) % 255]);
    expect(borderUniformity(data, 40, 40)).toBeGreaterThan(45);
  });
});

describe('isChromaKeyGreen', () => {
  it('accepts green-dominant key colors', () => {
    expect(isChromaKeyGreen({ r: 0, g: 255, b: 0 })).toBe(true);
    expect(isChromaKeyGreen({ r: 60, g: 210, b: 60 })).toBe(true);
  });

  it('rejects non-green key colors', () => {
    expect(isChromaKeyGreen({ r: 255, g: 0, b: 255 })).toBe(false);
    expect(isChromaKeyGreen({ r: 40, g: 60, b: 220 })).toBe(false);
    expect(isChromaKeyGreen({ r: 120, g: 130, b: 110 })).toBe(false);
  });
});

describe('colorKeyToAlpha', () => {
  it('makes the key background transparent and keeps the subject opaque', () => {
    const data = greenScreenWithSubject();
    const key = sampleBorderColor(data, 40, 40);
    const ratio = colorKeyToAlpha(data, 40, 40, key);

    // border pixel (0,0) transparent
    expect(data[3]).toBeLessThanOrEqual(8);
    // subject center opaque (pixel 20,20)
    const center = (20 * 40 + 20) * 4;
    expect(data[center + 3]).toBe(255);
    // subject color preserved
    expect(data[center]).toBeGreaterThan(180);
    // roughly the border area is transparent: 1 - (16*16)/(40*40) ≈ 0.84
    expect(ratio).toBeGreaterThan(0.7);
    expect(ratio).toBeLessThan(0.95);
  });

  it('suppresses green spill on partially keyed pixels', () => {
    const data = makeImage(10, 10, () => [40, 90, 40]);
    const key = { r: 0, g: 255, b: 0 };
    colorKeyToAlpha(data, 10, 10, key, 40, 200);
    for (let i = 0; i < data.length; i += 4) {
      if (data[i + 3] < 255) {
        expect(data[i + 1]).toBeLessThanOrEqual(Math.max(data[i], data[i + 2]));
      }
    }
  });
});

describe('luminanceToAlpha', () => {
  it('turns black background transparent and bright effect opaque', () => {
    const data = makeImage(40, 40, (x, y) =>
      x >= 10 && x < 30 && y >= 10 && y < 30 ? [255, 255, 255] : [0, 0, 0],
    );
    const ratio = luminanceToAlpha(data, 40, 40);

    expect(data[3]).toBe(0); // corner transparent
    const center = (20 * 40 + 20) * 4;
    expect(data[center + 3]).toBe(255); // glow opaque
    expect(ratio).toBeGreaterThan(0.7);
    expect(ratio).toBeLessThan(0.95);
  });

  it('scales intermediate brightness proportionally', () => {
    const data = makeImage(4, 1, () => [100, 100, 100]);
    luminanceToAlpha(data, 4, 1, 1);
    expect(data[3]).toBeGreaterThan(90);
    expect(data[3]).toBeLessThan(110);
  });
});

describe('meanBorderLuminance', () => {
  it('is near zero for a black border', () => {
    const data = makeImage(20, 20, () => [0, 0, 0]);
    expect(meanBorderLuminance(data, 20, 20)).toBeLessThan(1);
  });

  it('is high for a bright border', () => {
    const data = makeImage(20, 20, () => [220, 220, 220]);
    expect(meanBorderLuminance(data, 20, 20)).toBeGreaterThan(200);
  });
});

describe('transparentRatio', () => {
  it('counts fully transparent pixels', () => {
    const data = new Uint8ClampedArray(16 * 4); // 16 pixels
    data[3] = 255; // one opaque pixel
    expect(transparentRatio(data)).toBeCloseTo(15 / 16);
  });
});
