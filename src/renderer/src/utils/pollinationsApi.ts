/**
 * Pollinations AI Image Generation API
 * Uses the official Pollinations API for image generation
 */

export interface PollinationsConfig {
	apiKey: string;
}

export interface PollinationsGenerateParams {
	prompt: string;
	model?: string;
	size?: string;
	quality?: string;
	n?: number;
	seed?: number;
}

export interface PollinationsGenerateResult {
	success: boolean;
	imageBase64?: string;
	error?: string;
}

export const POLLINATIONS_MODELS = [
	{
		id: 'flux',
		label: 'FLUX',
		description: 'High quality, versatile model',
	},
	{
		id: 'zimage',
		label: 'Zimage',
		description: 'Artistic and stylized',
	},
] as const;

export type PollinationsModelId = typeof POLLINATIONS_MODELS[number]['id'];

const DEFAULT_MODEL = 'flux';
const BASE_URL = 'https://gen.pollinations.ai';

/**
 * Generate an image using the Pollinations API.
 * Returns base64-encoded image data.
 */
export async function generateWithPollinations(
	config: PollinationsConfig,
	params: PollinationsGenerateParams,
): Promise<PollinationsGenerateResult> {
	try {
		if (!config.apiKey) {
			return {
				success: false,
				error: 'Pollinations API key not configured. Go to Settings to configure it.',
			};
		}

		const body = {
			prompt: params.prompt.slice(0, 2048),
			model: params.model || DEFAULT_MODEL,
			n: params.n || 1,
			size: params.size || '1024x1024',
			quality: params.quality || 'medium',
			response_format: 'b64_json',
			...(params.seed !== undefined && { seed: params.seed }),
		};

		const response = await fetch(`${BASE_URL}/v1/images/generations`, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				Authorization: `Bearer ${config.apiKey}`,
				Accept: 'application/json',
			},
			body: JSON.stringify(body),
		});

		if (!response.ok) {
			if (response.status === 401) {
				return {
					success: false,
					error: 'Invalid Pollinations API key. Please check your settings.',
				};
			}
			if (response.status === 402) {
				return {
					success: false,
					error: 'Pollinations API quota exceeded. Please try again later.',
				};
			}
			if (response.status === 429) {
				return {
					success: false,
					error: 'Pollinations API rate limit exceeded. Please try again later.',
				};
			}
			const errorText = await response.text().catch(() => 'Unknown error');
			return {
				success: false,
				error: `Pollinations API error (${response.status}): ${errorText}`,
			};
		}

		const data = (await response.json()) as {
			created?: number;
			data?: Array<{ b64_json?: string; url?: string }>;
			error?: string;
		};

		if (!data.data || data.data.length === 0 || !data.data[0].b64_json) {
			return {
				success: false,
				error: data.error || 'No image returned from Pollinations API',
			};
		}

		return { success: true, imageBase64: data.data[0].b64_json };
	} catch (err) {
		return {
			success: false,
			error: err instanceof Error ? err.message : 'Pollinations generation failed',
		};
	}
}
