import { env, SELF } from 'cloudflare:test';
import { describe, it, expect, vi, beforeEach, afterEach, type Mock } from 'vitest';
import worker, { buildAiParams, resolveImage, uint8ToBase64 } from '../src';

// Plain base64 image payload (no data-URI prefix), what the live endpoint
// historically returned and what our resolveImage test fixtures expect.
const MOCK_IMAGE = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwA';

// A data URI wrapping MOCK_IMAGE. The live BFL endpoint now returns a URL, but
// the worker's resolveImage() also accepts data URIs, so integration tests use
// one to stay hermetic (no global fetch stub required).
const MOCK_DATA_URI = `data:image/jpeg;base64,${MOCK_IMAGE}`;

const IMAGE_BYTES = new TextEncoder().encode('IMG');
const IMAGE_URL = 'https://example.com/generated.jpeg';

describe('AI Image Generator Worker', () => {
	let runSpy: Mock;

	beforeEach(() => {
		// Simulate the live endpoint returning a { image: "<url>" } payload.
		runSpy = vi.spyOn(env.AI, 'run').mockResolvedValue({ image: MOCK_DATA_URI }) as unknown as Mock;
	});

	afterEach(() => {
		runSpy.mockRestore();
		vi.unstubAllGlobals();
	});

	describe('OPTIONS', () => {
		it('responds with CORS headers', async () => {
			const request = new Request('http://example.com/', { method: 'OPTIONS' });
			const response = await worker.fetch(request, env);
			expect(response.status).toBe(204);
			expect(response.headers.get('Access-Control-Allow-Origin')).toBe('*');
			expect(response.headers.get('Access-Control-Allow-Methods')).toBe('GET, POST, OPTIONS');
		});
	});

	describe('POST / generate', () => {
		it('returns a JSON image array for a valid prompt', async () => {
			const request = new Request('http://example.com/', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ prompt: 'a fantasy castle', model: '@cf/black-forest-labs/flux-1-schnell' }),
			});
			const response = await SELF.fetch(request);
			expect(response.status).toBe(200);
			const data = await response.json<{ success: boolean; images: string[] }>();
			expect(data.success).toBe(true);
			expect(data.images).toHaveLength(1);
			expect(data.images[0]).toBe(MOCK_IMAGE);
		});

		it('generates a batch when count is provided', async () => {
			const request = new Request('http://example.com/', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ prompt: 'a cat', count: 3 }),
			});
			const response = await SELF.fetch(request);
			const data = await response.json<{ images: string[] }>();
			expect(response.status).toBe(200);
			expect(data.images).toHaveLength(3);
			expect(runSpy).toHaveBeenCalledTimes(3);
		});

		it('clamps count to a maximum of 4', async () => {
			const request = new Request('http://example.com/', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ prompt: 'a cat', count: 10 }),
			});
			const response = await SELF.fetch(request);
			const data = await response.json<{ images: string[] }>();
			expect(response.status).toBe(200);
			expect(data.images).toHaveLength(4);
			expect(runSpy).toHaveBeenCalledTimes(4);
		});

		it('returns 400 when prompt is missing', async () => {
			const request = new Request('http://example.com/', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({}),
			});
			const response = await SELF.fetch(request);
			expect(response.status).toBe(400);
			const data = await response.json<{ success: boolean; error: string }>();
			expect(data.success).toBe(false);
			expect(data.error).toBe('Missing prompt parameter');
		});

		it('returns 400 for an invalid JSON body', async () => {
			const request = new Request('http://example.com/', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: 'not json',
			});
			const response = await SELF.fetch(request);
			expect(response.status).toBe(400);
			const data = await response.json<{ success: boolean; error: string }>();
			expect(data.success).toBe(false);
		});

		it('folds the negative prompt into the positive prompt', async () => {
			const request = new Request('http://example.com/', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ prompt: 'a cat', negative_prompt: 'blurry, low quality' }),
			});
			await SELF.fetch(request);
			expect(runSpy).toHaveBeenCalledWith(
				expect.any(String),
				expect.objectContaining({ prompt: expect.stringContaining('a cat, negative prompt: blurry, low quality') }),
			);
		});

		it('defaults steps to 4 and clamps to the BFL schema range', async () => {
			const request = new Request('http://example.com/', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ prompt: 'a cat' }),
			});
			await SELF.fetch(request);
			expect(runSpy).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ steps: 4 }));
		});

		it('clamps an out-of-range step count to 50', async () => {
			const request = new Request('http://example.com/', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ prompt: 'a cat', steps: 999 }),
			});
			await SELF.fetch(request);
			expect(runSpy).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ steps: 50 }));
		});

		it('returns 502 when the AI model returns no image', async () => {
			runSpy.mockResolvedValueOnce({ notImage: true });
			const request = new Request('http://example.com/', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ prompt: 'a cat' }),
			});
			const response = await SELF.fetch(request);
			expect(response.status).toBe(502);
			const data = await response.json<{ success: boolean; error: string }>();
			expect(data.success).toBe(false);
			expect(data.error).toBe('No image generated');
		});

		it('does not emit unsupported fields (BFL strict schema)', async () => {
			const request = new Request('http://example.com/', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({
					prompt: 'a cat',
					negative_prompt: 'bad',
					steps: 5,
					image: 'abc',
					output_format: 'png',
					seed: 42,
					width: 512,
					height: 512,
					guidance: 7,
					input_images: ['data:image/png;base64,abc'],
					safety_tolerance: 3,
				}),
			});
			await SELF.fetch(request);
			const params = runSpy.mock.calls[0][1] as Record<string, unknown>;
			expect(params).not.toHaveProperty('negative_prompt');
			expect(params).not.toHaveProperty('num_steps');
			expect(params).not.toHaveProperty('image_b64');
			expect(params).not.toHaveProperty('output_format');
			expect(params).not.toHaveProperty('seed');
			expect(params).not.toHaveProperty('width');
			expect(params).not.toHaveProperty('height');
			expect(params).not.toHaveProperty('guidance');
			expect(params).not.toHaveProperty('input_images');
			expect(params).not.toHaveProperty('safety_tolerance');
		});
	});

	describe('GET / legacy', () => {
		it('returns a binary JPEG for a valid prompt', async () => {
			const request = new Request('http://example.com/?prompt=hello', { method: 'GET' });
			const response = await SELF.fetch(request);
			expect(response.status).toBe(200);
			expect(response.headers.get('content-type')).toBe('image/jpeg');
			expect(response.headers.get('Access-Control-Allow-Origin')).toBe('*');
		});

		it('returns 400 when the prompt query param is missing', async () => {
			const request = new Request('http://example.com/', { method: 'GET' });
			const response = await SELF.fetch(request);
			expect(response.status).toBe(400);
		});
	});

	describe('buildAiParams', () => {
		it('defaults steps to 4 and includes only accepted fields', () => {
			const params = buildAiParams({ prompt: 'x' });
			expect(params).toMatchObject({ prompt: 'x', steps: 4 });
			expect(params).not.toHaveProperty('seed');
			expect(params).not.toHaveProperty('width');
			expect(params).not.toHaveProperty('height');
			expect(params).not.toHaveProperty('guidance');
			expect(params).not.toHaveProperty('output_format');
			expect(params).not.toHaveProperty('input_images');
			expect(params).not.toHaveProperty('safety_tolerance');
		});

		it('folds negative_prompt into the prompt string', () => {
			const params = buildAiParams({ prompt: 'x', negative_prompt: 'blurry' });
			expect(params.prompt).toBe('x, negative prompt: blurry');
		});
	});

	describe('resolveImage', () => {
		it('strips a data URI prefix and returns the raw base64 body', async () => {
			const result = await resolveImage({ image: MOCK_DATA_URI });
			expect(result).toBe(MOCK_IMAGE);
		});

		it('passes legacy base64 strings through unchanged', async () => {
			const result = await resolveImage({ image: MOCK_IMAGE });
			expect(result).toBe(MOCK_IMAGE);
		});

		it('fetches a URL and returns base64 encoded bytes', async () => {
			const fetchSpy = vi.fn().mockResolvedValue({
				ok: true,
				arrayBuffer: async () => IMAGE_BYTES.buffer,
			});
			vi.stubGlobal('fetch', fetchSpy);
			const result = await resolveImage({ image: IMAGE_URL });
			expect(result).toBe(uint8ToBase64(IMAGE_BYTES));
			expect(fetchSpy).toHaveBeenCalledWith(IMAGE_URL);
		});

		it('throws when the image field is absent', async () => {
			await expect(resolveImage({})).rejects.toThrow('No image generated');
		});

		it('throws (502-style) when fetching the URL fails', async () => {
			vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 404 }));
			await expect(resolveImage({ image: IMAGE_URL })).rejects.toThrow('Failed to fetch generated image (404)');
		});
	});
});
