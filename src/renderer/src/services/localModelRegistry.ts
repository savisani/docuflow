/**
 * Local Stable Diffusion Model Registry
 *
 * Discovers and manages local SD models installed in the models directory.
 * Wraps the Python backend's list-models command with caching and metadata.
 */

import { listLocalModels, type LocalModel } from './localImageProvider'

export interface LocalSDModel extends LocalModel {
  /** Whether this is a single-file (.safetensors) or Diffusers directory */
  format: 'diffusers' | 'single-file'
  /** Display-friendly name */
  displayName: string
  /** Whether the model is verified/usable */
  isReady: boolean
}

const MODEL_CACHE_TTL = 30_000 // 30 seconds
let cachedModels: LocalSDModel[] | null = null
let cacheTimestamp = 0

/**
 * List all installed local SD models with enriched metadata.
 */
export async function listLocalSDModels(forceRefresh = false): Promise<LocalSDModel[]> {
  const now = Date.now()
  if (!forceRefresh && cachedModels && now - cacheTimestamp < MODEL_CACHE_TTL) {
    return cachedModels
  }

  const rawModels = await listLocalModels()
  const models: LocalSDModel[] = rawModels.map((m) => ({
    ...m,
    format: (m as any).format === 'single-file' ? 'single-file' : 'diffusers',
    displayName: formatModelDisplayName(m.name, (m as any).format),
    isReady: m.has_required_files,
  }))

  cachedModels = models
  cacheTimestamp = now
  return models
}

/**
 * Find a model by path.
 */
export async function findModelByPath(path: string): Promise<LocalSDModel | undefined> {
  const models = await listLocalSDModels()
  return models.find((m) => m.path === path)
}

/**
 * Find a model by name.
 */
export async function findModelByName(name: string): Promise<LocalSDModel | undefined> {
  const models = await listLocalSDModels()
  return models.find((m) => m.name === name)
}

/**
 * Get recommended settings for a specific model based on hardware.
 */
export function getModelRecommendedSettings(
  model: LocalSDModel,
  vramMb: number
): { width: number; height: number; steps: number } {
  // Single-file models (like RV6) are typically fp16-based SD1.5
  // Diffusers directories could be SD1.5 or larger
  if (vramMb >= 6000) {
    return { width: 512, height: 512, steps: 25 }
  } else if (vramMb >= 4000) {
    return { width: 512, height: 512, steps: 20 }
  } else if (vramMb >= 2000) {
    return { width: 384, height: 384, steps: 15 }
  } else {
    return { width: 256, height: 256, steps: 10 }
  }
}

function formatModelDisplayName(name: string, format?: string): string {
  // Convert directory names like "realistic-vision-v6" to "Realistic Vision V6"
  const words = name
    .replace(/[-_]/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase())
  return words
}
