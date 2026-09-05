/**
 * NVIDIA NIM Image Generation API
 *
 * Uses the OpenAI-compatible /v1/images/generations endpoint
 * hosted at integrate.api.nvidia.com for text-to-image generation.
 */

import { configStorage } from './configStorage';

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

export interface NimConfig {
	apiKey: string;
}

const NIM_CONFIG_KEY = 'docuflow-nim-config';

export function loadNimConfig(): NimConfig {
	return configStorage.load<NimConfig>(NIM_CONFIG_KEY, { apiKey: '' });
}

export function saveNimConfig(config: NimConfig): void {
	configStorage.save(NIM_CONFIG_KEY, config);
}

// ---------------------------------------------------------------------------
// Models
// ---------------------------------------------------------------------------

export const NIM_MODELS = [
	{
		id: 'black-forest-labs/flux.2-klein-4b',
		label: 'FLUX 2 Klein 4B',
		description: 'Ultra-fast, distilled',
		maxSteps: 8,
	},
	{
		id: 'black-forest-labs/flux.1-schnell',
		label: 'FLUX 1 Schnell',
		description: 'Fast, 4 steps',
		maxSteps: 8,
	},
	{
		id: 'black-forest-labs/flux.1-dev',
		label: 'FLUX 1 Dev',
		description: 'High quality, 50 steps',
		maxSteps: 50,
	},
	{
		id: 'stabilityai/stable-diffusion-3.5-large',
		label: 'SD 3.5 Large',
		description: 'Stable Diffusion 3.5',
		maxSteps: 50,
	},
	{
		id: 'qwen/qwen-image',
		label: 'Qwen Image',
		description: 'Qwen image generation',
		maxSteps: 50,
	},
] as const;

export type NimModelId = (typeof NIM_MODELS)[number]['id'];

export const NIM_DEFAULT_MODEL: NimModelId = 'black-forest-labs/flux.2-klein-4b';

// ---------------------------------------------------------------------------
// API types
// ---------------------------------------------------------------------------

export interface NimGenerateParams {
	prompt: string;
	model?: NimModelId;
	n?: number;
	width?: number;
	height?: number;
	steps?: number;
	seed?: number;
}

export interface NimGenerateResult {
	success: boolean;
	imageUrls?: string[];
	error?: string;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

const BASE_URL = 'https://integrate.api.nvidia.com/v1';

function redactKey(key: string): string {
	if (!key) return '';
	if (key.length <= 8) return '****';
	return `${key.slice(0, 4)}****${key.slice(-4)}`;
}

/**
 * Convert a base64 string into an object URL.
 */
function base64ToObjectUrl(base64: string, mimeType = 'image/jpeg'): string {
	const binary = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
	const blob = new Blob([binary], { type: mimeType });
	return URL.createObjectURL(blob);
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Generate images using NVIDIA NIM's OpenAI-compatible endpoint.
 *
 * Returns object URLs for generated images. The caller is responsible for
 * persisting them to disk before the URLs are revoked.
 */
export async function generateWithNim(
	config: NimGenerateParams,
	apiKey: string,
	abortSignal?: AbortSignal,
): Promise<NimGenerateResult> {
	if (!apiKey) {
		return {
			success: false,
			error: 'NVIDIA API key not configured. Go to Settings to add your NVIDIA_API_KEY.',
		};
	}

	const model = config.model || NIM_DEFAULT_MODEL;
	const n = Math.min(Math.max(config.n ?? 1, 1), 4);

	const body: Record<string, unknown> = {
		model,
		prompt: config.prompt.slice(0, 2048),
		n,
		response_format: 'b64_json',
	};

	if (config.steps !== undefined) {
		body.steps = config.steps;
	}
	if (config.seed !== undefined) {
		body.seed = config.seed;
	}
	if (config.width !== undefined && config.height !== undefined) {
		body.size = `${config.width}x${config.height}`;
	}

	try {
		const response = await fetch(`${BASE_URL}/images/generations`, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				Authorization: `Bearer ${apiKey}`,
			},
			body: JSON.stringify(body),
			signal: abortSignal,
		});

		if (!response.ok) {
			const errorText = await response.text().catch(() => 'Unknown error');
			const status = response.status;

			if (status === 401) {
				return { success: false, error: 'Invalid NVIDIA API key. Check your key in Settings.' };
			}
			if (status === 403) {
				return { success: false, error: 'NVIDIA API access denied. Your key may lack image-generation permissions.' };
			}
			if (status === 404) {
				return { success: false, error: `Model not found: ${model}. Check available models in Settings.` };
			}
			if (status === 429) {
				return { success: false, error: 'NVIDIA API rate limit exceeded. Please wait and try again.' };
			}
			return {
				success: false,
				error: `NVIDIA API error (${status}): ${errorText.slice(0, 300)}`,
			};
		}

		const data = (await response.json()) as {
			data?: Array<{ b64_json?: string; url?: string; revised_prompt?: string }>;
		};

		if (!data.data || data.data.length === 0) {
			return { success: false, error: 'NVIDIA API returned no images.' };
		}

		const imageUrls: string[] = [];
		for (const item of data.data) {
			if (item.b64_json) {
				imageUrls.push(base64ToObjectUrl(item.b64_json));
			} else if (item.url) {
				// Download temporary URL immediately
				try {
					const imgResp = await fetch(item.url, { signal: abortSignal });
					if (!imgResp.ok) {
						console.warn(`[NIM] Failed to download image URL: ${imgResp.status}`);
						continue;
					}
					const blob = await imgResp.blob();
					const objectUrl = URL.createObjectURL(blob);
					imageUrls.push(objectUrl);
				} catch (dlErr) {
					console.warn('[NIM] Image download failed:', dlErr);
				}
			}
		}

		if (imageUrls.length === 0) {
			return { success: false, error: 'NVIDIA API returned images but none could be processed.' };
		}

		return { success: true, imageUrls };
	} catch (err) {
		if (err instanceof DOMException && err.name === 'AbortError') {
			return { success: false, error: 'Generation cancelled.' };
		}
		if (err instanceof TypeError) {
			// Network-level errors from fetch
			const msg = err.message.toLowerCase();
			if (msg.includes('fetch') || msg.includes('network') || msg.includes('connection') || msg.includes('ssl') || msg.includes('tls')) {
				return { success: false, error: 'Network error connecting to NVIDIA API. Check internet connection and proxy settings.' };
			}
			// Other TypeErrors might be CORS or other issues
			return { success: false, error: `Request failed: ${err.message}` };
		}
		return {
			success: false,
			error: err instanceof Error ? err.message : 'NVIDIA generation failed',
		};
	}
}

export { redactKey };
