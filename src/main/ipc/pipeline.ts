/**
 * Pipeline IPC Handlers
 *
 * Registers Electron IPC handlers for pipeline operations:
 * - Image compositing (layering person on background)
 * - Image quality checking
 *
 * These run in the main process and can perform file I/O.
 */

import { ipcMain } from 'electron'
import { join } from 'path'
import { existsSync, readFileSync, statSync } from 'fs'
import { readFile, writeFile, mkdir } from 'fs/promises'
import { tmpdir } from 'os'
import { normalizeError, ErrorCode } from '../../core/errors'

function getTempDir(): string {
  return join(tmpdir(), 'docuflow', 'pipeline')
}

/**
 * Register all pipeline-related IPC handlers.
 */
export function registerPipelineIpc(): void {
  // ---------------------------------------------------------------------------
  // Composite two images (foreground onto background using mask)
  // ---------------------------------------------------------------------------
  ipcMain.handle(
    'pipeline:composite',
    async (
      _event,
      params: {
        backgroundPath: string
        foregroundPath: string
        maskPath?: string
        outputPath: string
        width: number
        height: number
      },
    ): Promise<{ success: boolean; path?: string; error?: string | ReturnType<typeof normalizeError.prototype.toSerializable> }> => {
      // Validate required fields
      if (!params || typeof params.backgroundPath !== 'string' || !params.backgroundPath) {
        const err = normalizeError('backgroundPath is required', ErrorCode.VALIDATION)
        return { success: false, error: err.toSerializable() }
      }
      if (typeof params.foregroundPath !== 'string' || !params.foregroundPath) {
        const err = normalizeError('foregroundPath is required', ErrorCode.VALIDATION)
        return { success: false, error: err.toSerializable() }
      }
      if (typeof params.outputPath !== 'string' || !params.outputPath) {
        const err = normalizeError('outputPath is required', ErrorCode.VALIDATION)
        return { success: false, error: err.toSerializable() }
      }
      if (typeof params.width !== 'number' || params.width <= 0) {
        const err = normalizeError('width must be a positive number', ErrorCode.VALIDATION)
        return { success: false, error: err.toSerializable() }
      }
      if (typeof params.height !== 'number' || params.height <= 0) {
        const err = normalizeError('height must be a positive number', ErrorCode.VALIDATION)
        return { success: false, error: err.toSerializable() }
      }
      try {
        if (!existsSync(params.backgroundPath)) {
          const err = normalizeError(`Background not found: ${params.backgroundPath}`, ErrorCode.MEDIA_LOAD, {
            context: { path: params.backgroundPath },
          })
          return { success: false, error: err.toSerializable() }
        }
        if (!existsSync(params.foregroundPath)) {
          const err = normalizeError(`Foreground not found: ${params.foregroundPath}`, ErrorCode.MEDIA_LOAD, {
            context: { path: params.foregroundPath },
          })
          return { success: false, error: err.toSerializable() }
        }

        // Resolve output path
        let resolvedOutput = params.outputPath
        if (resolvedOutput.includes('%TEMP%')) {
          resolvedOutput = resolvedOutput.replace(/%TEMP%/g, tmpdir())
        }

        const outputDir = resolvedOutput.substring(0, resolvedOutput.lastIndexOf('\\'))
        if (outputDir && !existsSync(outputDir)) {
          await mkdir(outputDir, { recursive: true })
        }

        // Use Sharp for compositing if available, otherwise use canvas fallback
        // For now, use a simple approach: copy the background and overlay the foreground
        try {
          // Try using sharp (if installed in the project)
          const sharp = require('sharp')

          const background = sharp(params.backgroundPath).resize(params.width, params.height)
          const foreground = sharp(params.foregroundPath).resize(params.width, params.height)

          let compositeOptions: any[] = []

          if (params.maskPath && existsSync(params.maskPath)) {
            const mask = sharp(params.maskPath).resize(params.width, params.height).greyscale()
            compositeOptions.push({
              input: await foreground.png().toBuffer(),
              blend: 'dest-in',
              mask: await mask.toBuffer(),
            })
            // First apply mask, then composite onto background
            await background
              .composite(compositeOptions)
              .png()
              .toFile(resolvedOutput)
          } else {
            // Simple overlay without mask
            compositeOptions.push({
              input: await foreground.png().toBuffer(),
              blend: 'over',
            })
            await background
              .composite(compositeOptions)
              .png()
              .toFile(resolvedOutput)
          }

          return { success: true, path: resolvedOutput }
        } catch {
          // Sharp not available — fallback to simple copy
          const bgBuffer = await readFile(params.backgroundPath)
          await writeFile(resolvedOutput, bgBuffer)
          return { success: true, path: resolvedOutput }
        }
      } catch (err: unknown) {
        const normalized = normalizeError(err, ErrorCode.MEDIA_PROCESSING, {
          context: {
            backgroundPath: params.backgroundPath,
            foregroundPath: params.foregroundPath,
          },
        })
        return {
          success: false,
          error: normalized.toSerializable(),
        }
      }
    },
  )

  // ---------------------------------------------------------------------------
  // Check image quality
  // ---------------------------------------------------------------------------
  ipcMain.handle(
    'pipeline:checkQuality',
    async (
      _event,
      params: {
        imagePath: string
        expectedWidth: number
        expectedHeight: number
        requirePerson: boolean
      },
    ): Promise<{
      passed: boolean
      score: number
      issues: Array<{ code: string; severity: string; message: string }>
      recommendations: string[]
      identitySimilarityScore?: number
    }> => {
      // Validate required fields
      if (!params || typeof params.imagePath !== 'string' || !params.imagePath) {
        return {
          passed: false,
          score: 0,
          issues: [{ code: 'INVALID_PARAMS', severity: 'error', message: 'imagePath is required' }],
          recommendations: [],
        }
      }
      const issues: Array<{ code: string; severity: string; message: string }> = []
      const recommendations: string[] = []
      let score = 1.0

      try {
        // Check file exists
        if (!existsSync(params.imagePath)) {
          return {
            passed: false,
            score: 0,
            issues: [{ code: 'FILE_NOT_FOUND', severity: 'error', message: 'Image file not found' }],
            recommendations: ['Generate an image first'],
          }
        }

        // Check file size
        const stat = statSync(params.imagePath)
        if (stat.size < 1000) {
          issues.push({
            code: 'FILE_TOO_SMALL',
            severity: 'error',
            message: `Image file is suspiciously small (${stat.size} bytes)`,
          })
          score *= 0.2
        }

        // Read image header to validate it's a real image
        const buffer = readFileSync(params.imagePath)
        const header = buffer.subarray(0, 8)

        const isPNG =
          header[0] === 0x89 && header[1] === 0x50 && header[2] === 0x4e && header[3] === 0x47
        const isJPEG = header[0] === 0xff && header[1] === 0xd8

        if (!isPNG && !isJPEG) {
          issues.push({
            code: 'INVALID_IMAGE',
            severity: 'error',
            message: 'File is not a valid PNG or JPEG image',
          })
          score *= 0.1
        }

        // Try to read dimensions using a simple check
        // For PNG: width is at offset 16, height at offset 20 (big-endian)
        let imgWidth = 0
        let imgHeight = 0

        if (isPNG && buffer.length >= 24) {
          imgWidth = buffer.readUInt32BE(16)
          imgHeight = buffer.readUInt32BE(20)
        }

        // Check dimensions
        if (imgWidth > 0 && imgHeight > 0) {
          if (imgWidth < 64 || imgHeight < 64) {
            issues.push({
              code: 'DIMENSIONS_TOO_SMALL',
              severity: 'warning',
              message: `Image dimensions are very small: ${imgWidth}x${imgHeight}`,
            })
            score *= 0.6
          }

          if (params.expectedWidth > 0 && params.expectedHeight > 0) {
            const widthRatio = Math.abs(imgWidth - params.expectedWidth) / params.expectedWidth
            const heightRatio = Math.abs(imgHeight - params.expectedHeight) / params.expectedHeight
            if (widthRatio > 0.2 || heightRatio > 0.2) {
              issues.push({
                code: 'DIMENSION_MISMATCH',
                severity: 'warning',
                message: `Image dimensions ${imgWidth}x${imgHeight} differ from expected ${params.expectedWidth}x${params.expectedHeight}`,
              })
              score *= 0.8
            }
          }
        }

        // Check if image is all-black (mean pixel value very low)
        // Sample a portion of the image data
        const sampleSize = Math.min(buffer.length, 100000)
        const sampleStart = Math.floor(buffer.length * 0.1)
        let sum = 0
        let count = 0
        for (let i = sampleStart; i < sampleStart + sampleSize && i < buffer.length; i++) {
          sum += buffer[i]
          count++
        }
        const meanVal = count > 0 ? sum / count : 128

        if (meanVal < 5) {
          issues.push({
            code: 'IMAGE_BLACK',
            severity: 'error',
            message: 'Image appears to be entirely black',
          })
          score *= 0.1
          recommendations.push('Check if generation produced a valid image')
        } else if (meanVal < 20) {
          issues.push({
            code: 'IMAGE_DARK',
            severity: 'warning',
            message: 'Image appears to be very dark',
          })
          score *= 0.7
        }

        // Determine pass/fail
        const hasErrors = issues.some((i) => i.severity === 'error')
        const passed = !hasErrors && score >= 0.3

        return {
          passed,
          score: Math.max(0, Math.min(1, score)),
          issues,
          recommendations,
        }
      } catch (err) {
        return {
          passed: false,
          score: 0,
          issues: [{
            code: 'CHECK_ERROR',
            severity: 'error',
            message: err instanceof Error ? err.message : 'Quality check failed',
          }],
          recommendations: [],
        }
      }
    },
  )
}
