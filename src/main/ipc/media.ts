import { ipcMain } from 'electron'
import { spawn } from 'child_process'
import { existsSync, statSync } from 'fs'
import { join, extname, basename } from 'path'
import { mkdir } from 'fs/promises'
import { is } from '@electron-toolkit/utils'
import { normalizeError, createLogger, ErrorCode } from '../../core/errors'

const log = createLogger('media')

function getFfmpegPath(): string {
  if (is.dev) {
    // Check common development locations
    const devPath = join(__dirname, '../../../ffmpeg/bin/ffmpeg.exe')
    if (existsSync(devPath)) return devPath
  }
  // Production: check resources
  const resourcesPath = process.resourcesPath || ''
  const resourcePath = join(resourcesPath, 'ffmpeg/bin/ffmpeg.exe')
  if (existsSync(resourcePath)) return resourcePath
  // Fallback: assume ffmpeg is on PATH
  return 'ffmpeg'
}

function getFfprobePath(): string {
  if (is.dev) {
    const devPath = join(__dirname, '../../../ffmpeg/bin/ffprobe.exe')
    if (existsSync(devPath)) return devPath
  }
  const resourcesPath = process.resourcesPath || ''
  const resourcePath = join(resourcesPath, 'ffmpeg/bin/ffprobe.exe')
  if (existsSync(resourcePath)) return resourcePath
  return 'ffprobe'
}

export interface MediaProbeResult {
  success: boolean
  format?: string
  duration?: number
  size?: number
  bitrate?: number
  videoCodec?: string
  videoProfile?: string
  videoWidth?: number
  videoHeight?: number
  videoPixFmt?: string
  videoFps?: number
  videoBitrate?: number
  audioCodec?: string
  audioProfile?: string
  audioSampleRate?: number
  audioChannels?: number
  audioBitrate?: number
  audioChannelLayout?: string
  container?: string
  error?: string
}

function probeMedia(filePath: string): Promise<MediaProbeResult> {
  return new Promise((resolve) => {
    const ffprobePath = getFfprobePath()

    if (!existsSync(filePath)) {
      resolve({ success: false, error: 'File not found' })
      return
    }

    const args = [
      '-v', 'error',
      '-show_format',
      '-show_streams',
      '-of', 'json',
      filePath
    ]

    const proc = spawn(ffprobePath, args, {
      stdio: ['pipe', 'pipe', 'pipe'],
      timeout: 15000,
    })

    let stdout = ''
    let stderr = ''

    proc.stdout.on('data', (d: Buffer) => { stdout += d.toString() })
    proc.stderr.on('data', (d: Buffer) => { stderr += d.toString() })

    proc.on('close', (code) => {
      if (code !== 0) {
        resolve({ success: false, error: stderr || `ffprobe exited with code ${code}` })
        return
      }

      try {
        const data = JSON.parse(stdout)
        const format = data.format || {}
        const videoStream = (data.streams || []).find((s: any) => s.codec_type === 'video')
        const audioStream = (data.streams || []).find((s: any) => s.codec_type === 'audio')

        // Parse FPS from r_frame_rate (e.g., "30/1")
        let videoFps: number | undefined
        if (videoStream?.r_frame_rate) {
          const parts = videoStream.r_frame_rate.split('/')
          if (parts.length === 2) {
            const num = parseInt(parts[0], 10)
            const den = parseInt(parts[1], 10)
            if (den > 0) videoFps = num / den
          }
        }

        resolve({
          success: true,
          format: format.format_name,
          duration: parseFloat(format.duration) || undefined,
          size: parseInt(format.size) || undefined,
          bitrate: parseInt(format.bit_rate) || undefined,
          videoCodec: videoStream?.codec_name,
          videoProfile: videoStream?.profile,
          videoWidth: videoStream?.width,
          videoHeight: videoStream?.height,
          videoPixFmt: videoStream?.pix_fmt,
          videoFps,
          videoBitrate: parseInt(videoStream?.bit_rate) || undefined,
          audioCodec: audioStream?.codec_name,
          audioProfile: audioStream?.profile,
          audioSampleRate: parseInt(audioStream?.sample_rate) || undefined,
          audioChannels: audioStream?.channels,
          audioBitrate: parseInt(audioStream?.bit_rate) || undefined,
          audioChannelLayout: audioStream?.channel_layout,
        })
      } catch (e) {
        resolve({ success: false, error: `Failed to parse ffprobe output: ${String(e)}` })
      }
    })

    proc.on('error', (err) => {
      resolve({ success: false, error: `Failed to run ffprobe: ${err.message}` })
    })
  })
}

export interface ConvertResult {
  success: boolean
  outputPath?: string
  error?: string
}

function convertMedia(
  inputPath: string,
  outputPath: string,
  options: {
    videoCodec?: string
    audioCodec?: string
    videoBitrate?: string
    audioBitrate?: string
    maxWidth?: number
    maxHeight?: number
    pixelFormat?: string
  } = {}
): Promise<ConvertResult> {
  return new Promise((resolve) => {
    const ffmpegPath = getFfmpegPath()

    if (!existsSync(inputPath)) {
      resolve({ success: false, error: 'Input file not found' })
      return
    }

    const args = ['-y', '-i', inputPath]

    // Video codec
    const vcodec = options.videoCodec || 'libx264'
    args.push('-c:v', vcodec)

    // Audio codec
    const acodec = options.audioCodec || 'aac'
    args.push('-c:a', acodec)

    // Pixel format for browser compatibility
    const pixFmt = options.pixelFormat || 'yuv420p'
    args.push('-pix_fmt', pixFmt)

    // Bitrate controls
    if (options.videoBitrate) args.push('-b:v', options.videoBitrate)
    if (options.audioBitrate) args.push('-b:a', options.audioBitrate)

    // Scale to fit within max dimensions while preserving aspect ratio
    if (options.maxWidth || options.maxHeight) {
      const w = options.maxWidth || -1
      const h = options.maxHeight || -1
      args.push('-vf', `scale='min(${w},iw)':min'(${h},ih)':force_original_aspect_ratio=decrease`)
    }

    // Profile/level for broad browser compatibility
    if (vcodec === 'libx264') {
      args.push('-profile:v', 'main')
      args.push('-level', '4.0')
    }

    // Fast start for progressive playback (moves moov atom to beginning)
    args.push('-movflags', '+faststart')

    args.push(outputPath)

    log.info('Starting media conversion', { inputPath, outputPath, vcodec, acodec })

    const proc = spawn(ffmpegPath, args, {
      stdio: ['pipe', 'pipe', 'pipe'],
      timeout: 300000, // 5 minutes
    })

    let stderr = ''
    proc.stderr.on('data', (d: Buffer) => { stderr += d.toString() })

    proc.on('close', (code) => {
      if (code === 0 && existsSync(outputPath)) {
        const stat = statSync(outputPath)
        if (stat.size > 0) {
          log.info('Media conversion succeeded', { outputPath, size: stat.size })
          resolve({ success: true, outputPath })
        } else {
          resolve({ success: false, error: 'Output file is empty' })
        }
      } else {
        log.error('Media conversion failed', { exitCode: code, stderr: stderr.slice(0, 500) })
        resolve({ success: false, error: stderr.slice(0, 1000) || `ffmpeg exited with code ${code}` })
      }
    })

    proc.on('error', (err) => {
      resolve({ success: false, error: `Failed to run ffmpeg: ${err.message}` })
    })
  })
}

/**
 * Get the proxy directory for a project. Creates it if it doesn't exist.
 */
async function getProxyDir(projectAssetsDir: string): Promise<string> {
  const proxyDir = join(projectAssetsDir, '.proxies')
  if (!existsSync(proxyDir)) {
    await mkdir(proxyDir, { recursive: true })
  }
  return proxyDir
}

export function registerMediaIpc(): void {
  // Probe media file with ffprobe
  ipcMain.handle('media:probe', async (_event, filePath: string): Promise<MediaProbeResult> => {
    if (!filePath || typeof filePath !== 'string') {
      return { success: false, error: 'Invalid filePath' }
    }
    return probeMedia(filePath)
  })

  // Convert media to browser-compatible format
  ipcMain.handle('media:convert', async (_event, params: {
    inputPath: string
    outputPath: string
    videoCodec?: string
    audioCodec?: string
    videoBitrate?: string
    audioBitrate?: string
    maxWidth?: number
    maxHeight?: number
    pixelFormat?: string
  }): Promise<ConvertResult> => {
    if (!params.inputPath || !params.outputPath) {
      return { success: false, error: 'inputPath and outputPath are required' }
    }
    return convertMedia(params.inputPath, params.outputPath, params)
  })

  // Get/create proxy directory for a project
  ipcMain.handle('media:getProxyDir', async (_event, projectAssetsDir: string): Promise<string> => {
    return getProxyDir(projectAssetsDir)
  })

  // Check if a proxy already exists
  ipcMain.handle('media:proxyExists', async (_event, proxyPath: string): Promise<boolean> => {
    return existsSync(proxyPath)
  })
}
