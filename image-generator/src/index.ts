export interface Env {
	AI: Ai;
}

const DEFAULT_MODEL = '@cf/black-forest-labs/flux-1-schnell';

const CORS_HEADERS: Record<string, string> = {
	'Access-Control-Allow-Origin': '*',
	'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
	'Access-Control-Allow-Headers': 'Content-Type, Accept',
};

interface GenerateRequest {
	prompt: string;
	model?: string;
	steps?: number;
	negative_prompt?: string;
	count?: number;
}

function clamp(value: number | undefined, min: number, max: number, fallback: number): number {
	if (value === undefined || value === null || Number.isNaN(Number(value))) return fallback;
	return Math.min(Math.max(Math.round(Number(value)), min), max);
}

/**
 * Encode a byte array to a base64 string.
 */
export function uint8ToBase64(bytes: Uint8Array): string {
	let binary = '';
	for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
	return btoa(binary);
}

/**
 * Build the params object forwarded to `env.AI.run()` for the Cloudflare Workers
 * AI BFL (Black Forest Labs) endpoint.
 *
 * The live endpoint validates its payload with `additionalProperties: false`.
 * Only the following fields are accepted by the runtime schema:
 *   prompt (required), steps
 *
 * All other fields (seed, width, height, guidance, output_format,
 * safety_tolerance, input_images) are rejected by the model.
 *
 * `negative_prompt` is folded into the positive `prompt` string so the feature
 * still works via prompt engineering.
 */
export function buildAiParams(req: GenerateRequest): Record<string, unknown> {
	let prompt = (req.prompt || '').slice(0, 2048);
	if (req.negative_prompt) {
		prompt += `, negative prompt: ${(req.negative_prompt as string).slice(0, 512)}`;
	}

	const params: Record<string, unknown> = { prompt };

	const steps = clamp(req.steps, 1, 50, 4);
	params.steps = steps;

	return params;
}

/**
 * Normalize a Cloudflare Workers AI result into a base64-encoded image string.
 *
 * The live BFL endpoint returns `{ image: "<url>" }` (a URL), whereas older
 * endpoints returned `{ image: "<base64>" }`. `data:` URIs are also supported.
 * This helper normalises every shape to a plain base64 string so all response
 * paths (GET binary, POST JSON) deliver the same canonical payload and the
 * client never has to care about URLs/data URIs.
 */
export async function resolveImage(result: { image?: string } | undefined): Promise<string> {
	const image = result?.image;
	if (!image) {
		throw new Error('No image generated');
	}

	// data URI: strip the media-type prefix, keep the raw base64 body.
	if (image.startsWith('data:')) {
		const commaIdx = image.indexOf(',');
		return commaIdx >= 0 ? image.slice(commaIdx + 1) : image;
	}

	// https(s) URL: fetch the bytes and re-encode as base64.
	if (image.startsWith('http://') || image.startsWith('https://')) {
		const resp = await fetch(image);
		if (!resp.ok) {
			throw new Error(`Failed to fetch generated image (${resp.status})`);
		}
		const arrayBuffer = await resp.arrayBuffer();
		return uint8ToBase64(new Uint8Array(arrayBuffer));
	}

	// Legacy plain base64 string.
	return image;
}

function json(data: unknown, status = 200): Response {
	return Response.json(data, { status, headers: CORS_HEADERS });
}

export default {
	async fetch(request: Request, env: Env): Promise<Response> {
		if (request.method === 'OPTIONS') {
			return new Response(null, { status: 204, headers: CORS_HEADERS });
		}

		const url = new URL(request.url);

		// Legacy GET support: single image returned as a binary JPEG response.
		// Kept for backward compatibility with existing GET-based callers.
		if (request.method === 'GET') {
			const prompt = url.searchParams.get('prompt');
			if (!prompt) {
				return new Response('Missing prompt parameter', {
					status: 400,
					headers: { ...CORS_HEADERS, 'content-type': 'text/plain' },
				});
			}

			const model = url.searchParams.get('model') || DEFAULT_MODEL;
			const stepsParam = url.searchParams.get('steps');

			try {
				const result = await env.AI.run(model, buildAiParams({ prompt, model, steps: stepsParam ? parseInt(stepsParam, 10) : undefined }));

				const base64 = await resolveImage(result);
				const binary = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));

				return new Response(binary, {
					headers: {
						...CORS_HEADERS,
						'content-type': 'image/jpeg',
						'cache-control': 'public, max-age=86400',
					},
				});
			} catch (err) {
				const message = err instanceof Error ? err.message : 'Cloudflare generation failed';
				return new Response(message, {
					status: 502,
					headers: { ...CORS_HEADERS, 'content-type': 'text/plain' },
				});
			}
		}

		// POST: full-featured JSON payload supporting dimensions, guidance,
		// output format, image-to-image references and batch generation.
		if (request.method !== 'POST') {
			return new Response('Method not allowed', { status: 405, headers: CORS_HEADERS });
		}

		let body: GenerateRequest;
		try {
			body = (await request.json()) as GenerateRequest;
		} catch {
			return json({ success: false, error: 'Invalid JSON body' }, 400);
		}

		if (!body.prompt || !body.prompt.trim()) {
			return json({ success: false, error: 'Missing prompt parameter' }, 400);
		}

		const model = body.model || DEFAULT_MODEL;
		const count = clamp(body.count, 1, 4, 1);

		try {
			const images: string[] = [];
			for (let i = 0; i < count; i++) {
				const result = await env.AI.run(model, buildAiParams(body));
				const base64 = await resolveImage(result);
				images.push(base64);
			}

			return json({ success: true, images });
		} catch (err) {
			const message = err instanceof Error ? err.message : 'Cloudflare generation failed';
			const status = message === 'No image generated' ? 502 : 500;
			return json({ success: false, error: message }, status);
		}
	},
} satisfies ExportedHandler<Env>;
