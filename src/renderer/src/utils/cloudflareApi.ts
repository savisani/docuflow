/**
 * Cloudflare Workers AI Image Generation API
 * Uses FLUX models for fast, high-quality image generation
 */

export interface CloudflareConfig {
	workerUrl: string;
}

export interface CloudflareGenerateParams {
	prompt: string;
	model?: string;
	steps?: number;
	negative_prompt?: string;
	count?: number;
}

export interface CloudflareGenerateResult {
	success: boolean;
	imageUrls?: string[];
	error?: string;
}

export const CLOUDFLARE_MODELS = [
	{
		id: '@cf/black-forest-labs/flux-1-schnell',
		label: 'FLUX Schnell',
		description: 'Fast, 4 steps, good quality',
		maxSteps: 8,
	},
	{
		id: '@cf/black-forest-labs/flux-2-klein-4b',
		label: 'FLUX 2 Klein 4B',
		description: 'Ultra-fast, distilled',
		maxSteps: 8,
	},
	{
		id: '@cf/black-forest-labs/flux-2-klein-9b',
		label: 'FLUX 2 Klein 9B',
		description: 'Ultra-fast, enhanced quality',
		maxSteps: 8,
	},
	{
		id: '@cf/black-forest-labs/flux-2-dev',
		label: 'FLUX 2 Dev',
		description: 'High quality, multi-reference',
		maxSteps: 8,
	},
] as const;

export type CloudflareModelId = typeof CLOUDFLARE_MODELS[number]['id'];

const DEFAULT_MODEL = '@cf/black-forest-labs/flux-1-schnell';

/**
 * Convert a base64 string (as returned by the worker) into an object URL.
 */
function base64ToObjectUrl(base64: string): string {
	const binary = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
	const blob = new Blob([binary], { type: 'image/jpeg' });
	return URL.createObjectURL(blob);
}

/**
 * Generate one or more images using a Cloudflare Worker backed endpoint.
 */
export async function generateWithCloudflare(
	config: CloudflareConfig,
	params: CloudflareGenerateParams,
): Promise<CloudflareGenerateResult> {
	try {
		if (!config.workerUrl) {
			return {
				success: false,
				error: 'Cloudflare Worker URL not configured. Go to Settings to configure it.',
			};
		}

		const body = {
			prompt: params.prompt.slice(0, 2048),
			model: params.model || DEFAULT_MODEL,
			steps: params.steps,
			negative_prompt: params.negative_prompt,
			count: params.count || 1,
		};

		const response = await fetch(config.workerUrl, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				Accept: 'application/json',
			},
			body: JSON.stringify(body),
		});

		if (!response.ok) {
			const errorText = await response.text().catch(() => 'Unknown error');
			return {
				success: false,
				error: `Cloudflare API error (${response.status}): ${errorText}`,
			};
		}

		const data = (await response.json()) as {
			success?: boolean;
			images?: string[];
			error?: string;
		};

		if (!data.success || !data.images || data.images.length === 0) {
			throw new Error(data.error || 'Image generation failed');
		}

		const imageUrls = data.images.map((base64) => base64ToObjectUrl(base64));

		return { success: true, imageUrls };
	} catch (err) {
		return {
			success: false,
			error: err instanceof Error ? err.message : 'Cloudflare generation failed',
		};
	}
}
