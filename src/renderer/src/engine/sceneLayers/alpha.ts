/**
 * Pure pixel operations for extracting transparency from generated layers.
 *
 * None of DocuFlow's image providers emit an alpha channel, so layers that
 * must not occlude the scene behind them are generated on a keyable
 * background (chroma green for subjects, pure black for atmosphere) and
 * keyed here. All functions operate in-place on RGBA data and are fully
 * testable without a DOM.
 */

export interface RGB {
  r: number;
  g: number;
  b: number;
}

/** Width of the pixel band sampled along the image border. */
const BORDER_BAND = 3;

/**
 * Mean color of the image border. The border is what the model was asked to
 * fill with the key color, so it gives an adaptive key instead of assuming a
 * perfect #00FF00.
 */
export function sampleBorderColor(data: Uint8ClampedArray, width: number, height: number): RGB {
  let r = 0;
  let g = 0;
  let b = 0;
  let n = 0;
  for (let y = 0; y < height; y++) {
    const onVerticalEdge = y < BORDER_BAND || y >= height - BORDER_BAND;
    for (let x = 0; x < width; x++) {
      if (!onVerticalEdge && x >= BORDER_BAND && x < width - BORDER_BAND) continue;
      const i = (y * width + x) * 4;
      r += data[i];
      g += data[i + 1];
      b += data[i + 2];
      n++;
    }
  }
  if (n === 0) return { r: 0, g: 0, b: 0 };
  return { r: r / n, g: g / n, b: b / n };
}

/**
 * Uniformity of the border band: mean per-channel standard deviation.
 * A flat key background scores low (≈0–15); a rendered scene scores high.
 */
export function borderUniformity(data: Uint8ClampedArray, width: number, height: number): number {
  const mean = sampleBorderColor(data, width, height);
  let acc = 0;
  let n = 0;
  for (let y = 0; y < height; y++) {
    const onVerticalEdge = y < BORDER_BAND || y >= height - BORDER_BAND;
    for (let x = 0; x < width; x++) {
      if (!onVerticalEdge && x >= BORDER_BAND && x < width - BORDER_BAND) continue;
      const i = (y * width + x) * 4;
      acc +=
        Math.abs(data[i] - mean.r) +
        Math.abs(data[i + 1] - mean.g) +
        Math.abs(data[i + 2] - mean.b);
      n++;
    }
  }
  return n === 0 ? 255 : acc / (n * 3);
}

/** True when the sampled key color is green-dominant (a usable chroma key). */
export function isChromaKeyGreen(key: RGB): boolean {
  return key.g - Math.max(key.r, key.b) >= 18;
}

/** Mean border luminance (0–255). Used to validate black backgrounds. */
export function meanBorderLuminance(data: Uint8ClampedArray, width: number, height: number): number {
  const key = sampleBorderColor(data, width, height);
  return 0.2126 * key.r + 0.7152 * key.g + 0.0722 * key.b;
}

function colorDistance(r: number, g: number, b: number, key: RGB): number {
  const dr = r - key.r;
  const dg = g - key.g;
  const db = b - key.b;
  return Math.sqrt(dr * dr + dg * dg + db * db);
}

/**
 * Key a flat background color out to transparency.
 *
 * Pixels close to the key color become transparent, distant pixels stay
 * opaque, and the band between `lo` and `hi` feathers for soft edges.
 * Green spill is suppressed on partially transparent pixels.
 *
 * @returns fraction of pixels that became (nearly) transparent
 */
export function colorKeyToAlpha(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  key: RGB,
  lo = 40,
  hi = 95,
): number {
  const keyIsGreen = key.g - Math.max(key.r, key.b) >= 10;
  let transparent = 0;
  const total = width * height;

  for (let i = 0; i < data.length; i += 4) {
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    const dist = colorDistance(r, g, b, key);

    let alpha: number;
    if (dist <= lo) alpha = 0;
    else if (dist >= hi) alpha = 255;
    else alpha = Math.round(((dist - lo) / (hi - lo)) * 255);

    data[i + 3] = Math.min(data[i + 3], alpha);

    // Despill: when the key is green, clamp green excess so edges don't glow.
    if (keyIsGreen && g > Math.max(r, b) && data[i + 3] < 255) {
      data[i + 1] = Math.max(r, b);
    }

    if (data[i + 3] <= 8) transparent++;
  }

  return transparent / total;
}

/**
 * Convert brightness to alpha for effects generated on black
 * (dust, haze, light rays, smoke).
 *
 * @returns fraction of pixels that became (nearly) transparent
 */
export function luminanceToAlpha(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  gain = 1.5,
): number {
  let transparent = 0;
  const total = width * height;

  for (let i = 0; i < data.length; i += 4) {
    const luma = 0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2];
    const alpha = Math.max(0, Math.min(255, Math.round(luma * gain)));
    data[i + 3] = alpha;
    if (alpha <= 8) transparent++;
  }

  return transparent / total;
}

/** Fraction of pixels with alpha ≤ 8. */
export function transparentRatio(data: Uint8ClampedArray): number {
  let transparent = 0;
  const total = data.length / 4;
  for (let i = 3; i < data.length; i += 4) {
    if (data[i] <= 8) transparent++;
  }
  return total === 0 ? 0 : transparent / total;
}
