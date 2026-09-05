import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  generateWithNim,
  NIM_MODELS,
  NIM_DEFAULT_MODEL,
  loadNimConfig,
  saveNimConfig,
  type NimGenerateParams,
} from '../nvidiaNimApi';

// ---------------------------------------------------------------------------
// Mock configStorage
// ---------------------------------------------------------------------------

const localStorageStore: Record<string, string> = {};

vi.mock('../configStorage', () => ({
  configStorage: {
    load: vi.fn((key: string, fallback: unknown) => {
      const raw = localStorageStore[key];
      return raw ? JSON.parse(raw) : fallback;
    }),
    save: vi.fn((key: string, value: unknown) => {
      localStorageStore[key] = JSON.stringify(value);
    }),
  },
}));

// ---------------------------------------------------------------------------
// Mock fetch
// ---------------------------------------------------------------------------

const originalFetch = globalThis.fetch;

function mockFetch(handler: (url: string, init?: RequestInit) => Response | Promise<Response>) {
  (globalThis as any).fetch = vi.fn((url: string, init?: RequestInit) => handler(url, init));
}

beforeEach(() => {
  Object.keys(localStorageStore).forEach((k) => delete localStorageStore[k]);
});

afterEach(() => {
  (globalThis as any).fetch = originalFetch;
});

// ---------------------------------------------------------------------------
// Config helpers
// ---------------------------------------------------------------------------

describe('loadNimConfig / saveNimConfig', () => {
  test('returns empty config when nothing stored', () => {
    const config = loadNimConfig();
    expect(config).toEqual({ apiKey: '' });
  });

  test('saves and loads config', () => {
    saveNimConfig({ apiKey: 'nvapi-test-1234' });
    const loaded = loadNimConfig();
    expect(loaded.apiKey).toBe('nvapi-test-1234');
  });
});

// ---------------------------------------------------------------------------
// NIM_MODELS constant
// ---------------------------------------------------------------------------

describe('NIM_MODELS', () => {
  test('has 5 models', () => {
    expect(NIM_MODELS).toHaveLength(5);
  });

  test('default model is flux.2-klein-4b', () => {
    expect(NIM_DEFAULT_MODEL).toBe('black-forest-labs/flux.2-klein-4b');
  });

  test('each model has required fields', () => {
    for (const m of NIM_MODELS) {
      expect(m.id).toBeTruthy();
      expect(m.label).toBeTruthy();
      expect(m.description).toBeTruthy();
      expect(typeof m.maxSteps).toBe('number');
    }
  });
});

// ---------------------------------------------------------------------------
// generateWithNim — error paths
// ---------------------------------------------------------------------------

describe('generateWithNim — errors', () => {
  test('returns error when API key is empty', async () => {
    const result = await generateWithNim({ prompt: 'hello' }, '');
    expect(result.success).toBe(false);
    expect(result.error).toContain('API key not configured');
  });

  test('returns error on 401', async () => {
    mockFetch(() => new Response('Unauthorized', { status: 401 }));
    const result = await generateWithNim({ prompt: 'test' }, 'nvapi-bad');
    expect(result.success).toBe(false);
    expect(result.error).toContain('Invalid NVIDIA API key');
  });

  test('returns error on 403', async () => {
    mockFetch(() => new Response('Forbidden', { status: 403 }));
    const result = await generateWithNim({ prompt: 'test' }, 'nvapi-key');
    expect(result.success).toBe(false);
    expect(result.error).toContain('access denied');
  });

  test('returns error on 404', async () => {
    mockFetch(() => new Response('Not Found', { status: 404 }));
    const result = await generateWithNim(
      { prompt: 'test', model: 'bad/model' },
      'nvapi-key',
    );
    expect(result.success).toBe(false);
    expect(result.error).toContain('Model not found');
    expect(result.error).toContain('bad/model');
  });

  test('returns error on 429', async () => {
    mockFetch(() => new Response('Rate Limited', { status: 429 }));
    const result = await generateWithNim({ prompt: 'test' }, 'nvapi-key');
    expect(result.success).toBe(false);
    expect(result.error).toContain('rate limit');
  });

  test('returns error on network failure', async () => {
    mockFetch(() => {
      throw new TypeError('Failed to fetch');
    });
    const result = await generateWithNim({ prompt: 'test' }, 'nvapi-key');
    expect(result.success).toBe(false);
    expect(result.error).toContain('Network error');
  });

  test('returns error when API returns empty data array', async () => {
    mockFetch(() => new Response(JSON.stringify({ data: [] }), { status: 200 }));
    const result = await generateWithNim({ prompt: 'test' }, 'nvapi-key');
    expect(result.success).toBe(false);
    expect(result.error).toContain('no images');
  });

  test('returns error when API returns no data field', async () => {
    mockFetch(() => new Response(JSON.stringify({}), { status: 200 }));
    const result = await generateWithNim({ prompt: 'test' }, 'nvapi-key');
    expect(result.success).toBe(false);
    expect(result.error).toContain('no images');
  });
});

// ---------------------------------------------------------------------------
// generateWithNim — success paths
// ---------------------------------------------------------------------------

describe('generateWithNim — success', () => {
  test('returns object URL from b64_json response', async () => {
    // Minimal valid base64 PNG (1x1 pixel)
    const tinyPng = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

    mockFetch((_url, init) => {
      // Verify request body
      const body = JSON.parse(init?.body as string);
      expect(body.model).toBe('black-forest-labs/flux.2-klein-4b');
      expect(body.prompt).toBe('a cat');
      expect(body.n).toBe(1);
      expect(body.response_format).toBe('b64_json');

      return new Response(
        JSON.stringify({ data: [{ b64_json: tinyPng }] }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    });

    const result = await generateWithNim(
      { prompt: 'a cat' },
      'nvapi-test1234',
    );

    expect(result.success).toBe(true);
    expect(result.imageUrls).toHaveLength(1);
    expect(result.imageUrls![0]).toMatch(/^blob:/);
  });

  test('handles multiple images (n=3)', async () => {
    const tinyPng = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

    mockFetch((_url, init) => {
      const body = JSON.parse(init?.body as string);
      expect(body.n).toBe(3);

      return new Response(
        JSON.stringify({
          data: [
            { b64_json: tinyPng },
            { b64_json: tinyPng },
            { b64_json: tinyPng },
          ],
        }),
        { status: 200 },
      );
    });

    const result = await generateWithNim(
      { prompt: 'three cats', n: 3 },
      'nvapi-test1234',
    );

    expect(result.success).toBe(true);
    expect(result.imageUrls).toHaveLength(3);
  });

  test('clamps n to max 4', async () => {
    const tinyPng = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

    mockFetch((_url, init) => {
      const body = JSON.parse(init?.body as string);
      expect(body.n).toBe(4); // clamped from 10
      return new Response(
        JSON.stringify({ data: [{ b64_json: tinyPng }, { b64_json: tinyPng }, { b64_json: tinyPng }, { b64_json: tinyPng }] }),
        { status: 200 },
      );
    });

    const result = await generateWithNim(
      { prompt: 'many cats', n: 10 },
      'nvapi-test1234',
    );
    expect(result.success).toBe(true);
  });

  test('downloads URL responses as blob', async () => {
    const imageBlob = new Blob([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], { type: 'image/png' });

    let fetchCount = 0;
    mockFetch((url) => {
      fetchCount++;
      if (fetchCount === 1) {
        // First call is the API
        return new Response(
          JSON.stringify({ data: [{ url: 'https://cdn.nvidia.com/img1.png' }] }),
          { status: 200 },
        );
      }
      // Second call is the image download
      return new Response(imageBlob, { status: 200 });
    });

    const result = await generateWithNim(
      { prompt: 'a dog' },
      'nvapi-test1234',
    );

    expect(result.success).toBe(true);
    expect(result.imageUrls).toHaveLength(1);
  });

  test('includes optional params in request body', async () => {
    const tinyPng = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

    mockFetch((_url, init) => {
      const body = JSON.parse(init?.body as string);
      expect(body.steps).toBe(20);
      expect(body.seed).toBe(42);
      expect(body.size).toBe('1024x768');
      expect(body.model).toBe('stabilityai/stable-diffusion-3.5-large');
      return new Response(
        JSON.stringify({ data: [{ b64_json: tinyPng }] }),
        { status: 200 },
      );
    });

    const result = await generateWithNim(
      {
        prompt: 'landscape',
        model: 'stabilityai/stable-diffusion-3.5-large',
        steps: 20,
        seed: 42,
        width: 1024,
        height: 768,
      },
      'nvapi-test1234',
    );

    expect(result.success).toBe(true);
  });

  test('truncates prompt to 2048 chars', async () => {
    const tinyPng = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
    const longPrompt = 'a'.repeat(3000);

    mockFetch((_url, init) => {
      const body = JSON.parse(init?.body as string);
      expect(body.prompt.length).toBe(2048);
      return new Response(
        JSON.stringify({ data: [{ b64_json: tinyPng }] }),
        { status: 200 },
      );
    });

    const result = await generateWithNim(
      { prompt: longPrompt },
      'nvapi-test1234',
    );
    expect(result.success).toBe(true);
  });

  test('sends correct Authorization header', async () => {
    const tinyPng = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
    const apiKey = 'nvapi-abcdef123456';

    mockFetch((_url, init) => {
      expect(init?.headers).toMatchObject({
        Authorization: `Bearer ${apiKey}`,
      });
      return new Response(
        JSON.stringify({ data: [{ b64_json: tinyPng }] }),
        { status: 200 },
      );
    });

    await generateWithNim({ prompt: 'test' }, apiKey);
  });
});

// ---------------------------------------------------------------------------
// generateWithNim — abort
// ---------------------------------------------------------------------------

describe('generateWithNim — abort', () => {
  test('returns error on AbortError', async () => {
    mockFetch(() => {
      const err = new DOMException('Aborted', 'AbortError');
      return Promise.reject(err);
    });

    const controller = new AbortController();
    controller.abort();

    const result = await generateWithNim(
      { prompt: 'test' },
      'nvapi-test1234',
      controller.signal,
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain('cancelled');
  });
});
