import { describe, it, expect } from 'vitest';
import { planScene, chooseShotType } from '../planner';
import { deriveVisualContext } from '../context';
import type { SceneLayer } from '../types';

function ids(): () => string {
  let n = 0;
  return () => `layer-${++n}`;
}

function types(layers: SceneLayer[]): string[] {
  return layers.map((l) => l.type);
}

describe('deriveVisualContext', () => {
  it('extracts period, location, lighting and wardrobe from scene text', () => {
    const ctx = deriveVisualContext(
      '1970s rural Punjab at sunset, farmers in turbans and dhotis near mud houses',
    );
    expect(ctx.period).toMatch(/1970s/);
    expect(ctx.location).toMatch(/rural/);
    expect(ctx.location).toMatch(/Punjab/);
    expect(ctx.lighting).toMatch(/sunset/i);
    expect(ctx.clothing).toMatch(/turbans/);
    expect(ctx.architecture).toMatch(/mud houses/);
    expect(ctx.characters).toMatch(/farmers/);
  });

  it('leaves unknown fields undefined instead of inventing them', () => {
    const ctx = deriveVisualContext('a plain sentence with no visual anchors');
    expect(ctx.period).toBeUndefined();
    expect(ctx.weather).toBeUndefined();
    expect(ctx.clothing).toBeUndefined();
  });
});

describe('chooseShotType', () => {
  it('picks historical reconstruction for period narration', () => {
    const ctx = deriveVisualContext('pre-independence era');
    expect(chooseShotType('people used to travel before the automobiles came', ctx)).toBe(
      'historical_reconstruction',
    );
  });

  it('picks establishing for wide landscape language', () => {
    expect(chooseShotType('wide establishing shot of the valley horizon', {})).toBe('establishing');
  });

  it('picks detail for close-up language', () => {
    expect(chooseShotType('close-up detail of hands weaving the cloth', {})).toBe('detail');
  });

  it('picks atmospheric for weather-driven language', () => {
    expect(chooseShotType('thick morning mist and fog over the water', {})).toBe('atmospheric');
  });

  it('defaults to subject', () => {
    expect(chooseShotType('a man walking with his cart', {})).toBe('subject');
  });
});

describe('planScene', () => {
  it('plans background + subjects + foreground for a pre-automobile travel scene', () => {
    const plan = planScene({
      text: 'Show how people travelled in rural India before automobiles became common.',
      visual:
        'Villagers walking along a dirt road with a bullock cart in rural India, warm evening light, mud houses in the distance',
      idFactory: ids(),
    });

    expect(plan.shot).toBe('historical_reconstruction');
    const t = types(plan.layers);
    expect(t[0]).toBe('background');
    expect(t).toContain('midground');
    expect(t).toContain('foreground');
    expect(t).toContain('atmosphere'); // dusty rural road justifies atmosphere

    // orders are contiguous and start at 0
    plan.layers.forEach((l, i) => expect(l.order).toBe(i));

    // shared context captured for cross-layer consistency
    expect(plan.context.location).toMatch(/India/);
    expect(plan.context.lighting).toMatch(/evening|sunset|warm/i);
  });

  it('gives every layer the same shared context block in its prompt', () => {
    const plan = planScene({
      visual: '1970s rural Punjab village at sunset, farmers in turbans near mud houses',
      text: 'The village came alive at dusk.',
      idFactory: ids(),
    });

    const contextMarkers = plan.layers.map((l) =>
      l.prompt.match(/Shared scene context — [^.]+\./)?.[0],
    );
    expect(contextMarkers.length).toBeGreaterThan(1);
    contextMarkers.forEach((m) => expect(m).toBe(contextMarkers[0]));
    expect(contextMarkers[0]).toMatch(/time period: 1970s/);
    expect(contextMarkers[0]).toMatch(/lighting: warm sunset light/);
  });

  it('does not force atmosphere onto a clear-weather scene', () => {
    const plan = planScene({
      visual: 'bright sunny day at a bustling market street, vendors and shoppers',
      text: 'People buy vegetables at the midday market.',
      idFactory: ids(),
    });
    expect(types(plan.layers)).not.toContain('atmosphere');
  });

  it('produces a background-only plan for an empty establishing landscape', () => {
    const plan = planScene({
      visual: 'wide aerial panorama of mountain valley horizon at sunrise, no people',
      idFactory: ids(),
    });
    expect(plan.shot).toBe('establishing');
    expect(types(plan.layers)).toEqual(['background']);
  });

  it('keeps atmosphere optional and luminance-keyed', () => {
    const plan = planScene({
      visual: 'dense fog rolling over a river at dawn',
      idFactory: ids(),
    });
    const atmo = plan.layers.find((l) => l.type === 'atmosphere');
    expect(atmo).toBeDefined();
    expect(atmo!.optional).toBe(true);
    expect(atmo!.alphaMode).toBe('luminance');
  });

  it('marks background opaque and subject/foreground as chroma layers', () => {
    const plan = planScene({
      visual: 'a farmer ploughing a field with an ox, golden hour, traditional clothing',
      idFactory: ids(),
    });
    for (const layer of plan.layers) {
      if (layer.type === 'background') expect(layer.alphaMode).toBe('none');
      else if (layer.type === 'atmosphere') expect(layer.alphaMode).toBe('luminance');
      else expect(layer.alphaMode).toBe('chroma');
    }
  });

  it('seeds the background layer from an existing legacy image asset', () => {
    const plan = planScene({
      visual: 'a village scene',
      existingAssetId: 'legacy-asset-1',
      idFactory: ids(),
    });
    const bg = plan.layers[0];
    expect(bg.type).toBe('background');
    expect(bg.status).toBe('done');
    expect(bg.assetId).toBe('legacy-asset-1');
  });

  it('respects the AI-chosen camera motion and defaults to subtle intensity', () => {
    const plan = planScene({
      visual: 'a quiet street',
      cameraMotion: 'pan_left',
      idFactory: ids(),
    });
    expect(plan.camera).toEqual({ movement: 'pan_left', intensity: 'subtle' });
  });

  it('is deterministic for the same input', () => {
    const input = {
      text: 'Farmers returning home at dusk with their bullock carts through the fields',
      visual: 'rural fields at dusk, farmers, carts, warm lantern light',
    };
    const a = planScene({ ...input, idFactory: ids() });
    const b = planScene({ ...input, idFactory: ids() });
    const strip = (layers: SceneLayer[]) => layers.map(({ id, ...rest }) => rest);
    expect(strip(a.layers)).toEqual(strip(b.layers));
    expect(a.shot).toBe(b.shot);
    expect(a.context).toEqual(b.context);
  });

  it('assigns a usable prompt to every layer', () => {
    const plan = planScene({
      visual: 'a blacksmith working his forge in a village workshop, firelight',
      idFactory: ids(),
    });
    for (const layer of plan.layers) {
      expect(layer.prompt.length).toBeGreaterThan(50);
      expect(layer.prompt).toContain('cinematic documentary still');
    }
  });
});
