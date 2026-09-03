/**
 * Local Image Generation Provider
 *
 * Handles offline image generation using local Stable Diffusion models.
 * Communicates with the Python backend via Electron IPC.
 */

export interface LocalModel {
  name: string
  path: string
  size_bytes: number
  size_label: string
  type: string
  format?: 'diffusers' | 'single-file'
  has_required_files: boolean
}

export interface LocalHardware {
  cuda: boolean
  directml: boolean
  cpu: boolean
  vram_mb: number
  device_name: string
}

export interface LocalGenerationProgress {
  type: 'progress' | 'status' | 'cancelled'
  step?: number
  total?: number
  percent?: number
  message?: string
}

export interface LocalGenerationRequest {
  prompt: string
  width?: number
  height?: number
  modelPath: string
  steps?: number
  seed?: number
  device?: 'auto' | 'gpu' | 'cpu' | 'directml'
  negativePrompt?: string
}

export interface LocalGenerationResult {
  success: boolean
  path?: string
  error?: string
}

/** List installed local models */
export async function listLocalModels(): Promise<LocalModel[]> {
  try {
    const result = await window.docuflow.listLocalModels()
    return result.models || []
  } catch {
    return []
  }
}

/** Detect hardware capabilities */
export async function detectHardware(): Promise<LocalHardware> {
  try {
    return await window.docuflow.detectLocalHardware()
  } catch {
    return { cuda: false, directml: false, cpu: true, vram_mb: 0, device_name: 'CPU' }
  }
}

/** Import a model directory */
export async function importModel(): Promise<{ success: boolean; path?: string; error?: string }> {
  try {
    return await window.docuflow.importLocalModel()
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : 'Import failed' }
  }
}

/** Get the default models directory */
export async function getModelsDir(): Promise<string> {
  try {
    return await window.docuflow.getLocalModelsDir()
  } catch {
    return ''
  }
}

/** Generate an image locally */
export async function generateLocalImage(
  req: LocalGenerationRequest,
  onProgress?: (progress: LocalGenerationProgress) => void
): Promise<LocalGenerationResult> {
  // Subscribe to progress events
  let unsubscribe: (() => void) | undefined
  if (onProgress) {
    unsubscribe = window.docuflow.onLocalGenerationProgress((data) => {
      onProgress(data)
    })
  }

  try {
    const outputPath = `%TEMP%\\docuflow-local-${Date.now()}.png`
    const generationId = `ui-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`

    const result = await window.docuflow.generateLocalImageEnhanced({
      prompt: req.prompt,
      negativePrompt: req.negativePrompt,
      width: req.width || 512,
      height: req.height || 512,
      outputPath,
      modelPath: req.modelPath,
      steps: req.steps || 10,
      seed: req.seed,
      device: req.device || 'auto',
      generationId,
    })

    return result
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : 'Generation failed' }
  } finally {
    unsubscribe?.()
  }
}

/** Cancel ongoing local generation */
export async function cancelLocalGeneration(): Promise<void> {
  try {
    await window.docuflow.cancelLocalGeneration()
  } catch {}
}

/** Get recommended settings based on hardware - GPU ONLY */
export function getRecommendedSettings(hardware: LocalHardware): {
  width: number
  height: number
  steps: number
  device: 'auto' | 'gpu'
} {
  if (hardware.cuda && hardware.vram_mb >= 4000) {
    return { width: 512, height: 512, steps: 10, device: 'gpu' }
  } else if (hardware.cuda && hardware.vram_mb >= 2000) {
    return { width: 384, height: 384, steps: 10, device: 'gpu' }
  } else {
    // No CUDA GPU available - return GPU settings but generation will fail fast
    return { width: 512, height: 512, steps: 10, device: 'gpu' }
  }
}

/** Quality presets */
export const QUALITY_PRESETS = {
  performance: { label: 'Performance', width: 384, height: 384, steps: 8 },
  balanced: { label: 'Balanced', width: 512, height: 512, steps: 10 },
  quality: { label: 'Quality', width: 512, height: 512, steps: 20 },
} as const

export type QualityPreset = keyof typeof QUALITY_PRESETS
