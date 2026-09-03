import { app, BrowserWindow, shell, ipcMain, protocol, dialog } from 'electron'
import { join, extname } from 'path'
import { readFile, writeFile } from 'fs/promises'
import { existsSync, mkdirSync, readdirSync, statSync, readFileSync, writeFileSync } from 'fs'
import { spawn } from 'child_process'
import { is } from '@electron-toolkit/utils'
import { tmpdir } from 'os'
import {
  ensureProjectFolder,
  getProjectsRoot,
  getAssetsDir,
  getProjectFilePath,
  projectExists
} from './services/projectFolder'
import { registerAssetIpc } from './ipc/assets'
import { registerPipelineIpc } from './ipc/pipeline'
import { getModelManager, ModelManagerRunner } from './modelManager'

const ASSET_PROTOCOL = 'docuflow-asset'

const MIME_TYPES: Record<string, string> = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.bmp': 'image/bmp',
  '.svg': 'image/svg+xml',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.mov': 'video/quicktime',
  '.avi': 'video/x-msvideo',
  '.mkv': 'video/x-matroska',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.ogg': 'audio/ogg',
  '.flac': 'audio/flac',
  '.aac': 'audio/aac',
}

function getMimeType(filePath: string): string {
  const ext = extname(filePath).toLowerCase()
  return MIME_TYPES[ext] || 'application/octet-stream'
}

/**
 * Converts an absolute file path to a docuflow-asset:// URL.
 * Example: "C:/Users/me/video.mp4" -> "docuflow-asset://localhost/C%3A%5CUsers%5Cme%5Cvideo.mp4"
 */
export function filePathToAssetUrl(filePath: string): string {
  // Normalize to forward slashes and encode
  const normalized = filePath.replace(/\\/g, '/')
  return `${ASSET_PROTOCOL}://localhost/${encodeURIComponent(normalized)}`
}

/**
 * Converts a docuflow-asset:// URL back to an absolute file path.
 */
export function assetUrlToFilePath(url: string): string {
  const prefix = `${ASSET_PROTOCOL}://localhost/`
  if (!url.startsWith(prefix)) throw new Error(`Invalid asset URL: ${url}`)
  return decodeURIComponent(url.slice(prefix.length))
}

function registerAssetProtocol(): void {
  protocol.handle(ASSET_PROTOCOL, async (request) => {
    try {
      const url = new URL(request.url)
      let filePath = decodeURIComponent(url.pathname)

      // Strip leading slash on Windows ( pathname starts with /C:/... )
      if (process.platform === 'win32' && filePath.startsWith('/')) {
        filePath = filePath.slice(1)
      }

      const buffer = await readFile(filePath)
      return new Response(buffer, {
        headers: {
          'Content-Type': getMimeType(filePath),
          'Cache-Control': 'no-cache',
        },
      })
    } catch (err) {
      console.error('Protocol handler error:', err)
      return new Response('File not found', { status: 404 })
    }
  })
}

function createWindow(): void {
  const mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1024,
    minHeight: 700,
    show: false,
    frame: false,
    titleBarStyle: 'hidden',
    backgroundColor: '#0f172a',
    autoHideMenuBar: true,
    title: 'DocuFlow',
    webPreferences: {
      preload: join(__dirname, '../preload/index.mjs'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: false
    }
  })

  mainWindow.on('ready-to-show', () => {
    mainWindow.show()
  })

  mainWindow.webContents.on('did-fail-load', (_event, errorCode, errorDescription) => {
    console.error('Renderer failed to load:', errorCode, errorDescription)
  })

  mainWindow.webContents.on('did-finish-load', () => {
    if (!mainWindow.isVisible()) {
      mainWindow.show()
    }
  })

  mainWindow.on('maximize', () => {
    mainWindow.webContents.send('window:maximized', true)
  })

  mainWindow.on('unmaximize', () => {
    mainWindow.webContents.send('window:maximized', false)
  })

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

function registerWindowControls(): void {
  ipcMain.on('window:minimize', (event) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    win?.minimize()
  })

  ipcMain.on('window:maximize', (event) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    if (win?.isMaximized()) {
      win.unmaximize()
    } else {
      win?.maximize()
    }
  })

  ipcMain.on('window:close', (event) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    win?.close()
  })

  ipcMain.handle('window:isMaximized', (event) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    return win?.isMaximized() ?? false
  })
}

function registerProjectIpc(): void {
  ipcMain.handle('project:getRoot', () => {
    return getProjectsRoot()
  })

  ipcMain.handle('project:ensureFolder', async (_event, projectName: string) => {
    return ensureProjectFolder(projectName)
  })

  ipcMain.handle('project:getAssetsDir', async (_event, projectName: string) => {
    return getAssetsDir(projectName)
  })

  ipcMain.handle('project:getFilePath', (_event, projectName: string) => {
    return getProjectFilePath(projectName)
  })

  ipcMain.handle('project:exists', async (_event, projectName: string) => {
    return projectExists(projectName)
  })

  ipcMain.handle('project:save', async (_event, projectName: string, projectData: any) => {
    try {
      const filePath = getProjectFilePath(projectName)
      const dir = join(filePath, '..')
      if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true })
      }
      writeFileSync(filePath, JSON.stringify(projectData, null, 2), 'utf-8')
      return { success: true, path: filePath }
    } catch (err: any) {
      return { success: false, error: err.message }
    }
  })

  ipcMain.handle('project:load', async (_event, projectName: string) => {
    try {
      const filePath = getProjectFilePath(projectName)
      if (!existsSync(filePath)) {
        return { success: false, error: 'Project file not found' }
      }
      const data = readFileSync(filePath, 'utf-8')
      return { success: true, data: JSON.parse(data) }
    } catch (err: any) {
      return { success: false, error: err.message }
    }
  })

  ipcMain.handle('project:list', async () => {
    try {
      const root = getProjectsRoot()
      if (!existsSync(root)) return { success: true, projects: [] }
      const entries = readdirSync(root, { withFileTypes: true })
      const projects = entries
        .filter(e => e.isDirectory())
        .map(e => {
          const projectFile = join(root, e.name, 'project.json')
          const exists = existsSync(projectFile)
          return { name: e.name, hasFile: exists }
        })
      return { success: true, projects }
    } catch (err: any) {
      return { success: false, error: err.message }
    }
  })
}

function getScriptPath(): string {
  if (is.dev) {
    return join(__dirname, '../../scripts/generate_local.py')
  }
  return join(process.resourcesPath, 'scripts/generate_local.py')
}

function getPythonPath(): string {
  if (is.dev) {
    return join(__dirname, '../../scripts/.venv/Scripts/python.exe')
  }
  return join(process.resourcesPath, 'scripts/.venv/Scripts/python.exe')
}

function getLocalModelPath(): string | null {
  // Check for locally downloaded model in scripts/models/
  const localModel = join(__dirname, '../../scripts/models/stable-diffusion-v1-5')
  if (existsSync(localModel) && existsSync(join(localModel, 'model_index.json'))) {
    return localModel
  }
  return null
}

function getModelsDir(): string {
  if (is.dev) {
    return join(__dirname, '../../scripts/models')
  }
  return join(process.resourcesPath, 'scripts/models')
}

function getScriptsBasePath(): string {
  if (is.dev) {
    return join(__dirname, '../../scripts')
  }
  return join(process.resourcesPath, 'scripts')
}

function getModelManagerInstance(): ModelManagerRunner {
  return getModelManager(getScriptsBasePath())
}

function registerLocalModelManagerIpc(): void {
  // List installed local models
  ipcMain.handle('local-models:list', async () => {
    try {
      const pythonPath = getPythonPath()
      const scriptPath = getScriptPath()
      const modelsDir = getModelsDir()

      return new Promise((resolve) => {
        const proc = spawn(pythonPath, [
          scriptPath, 'list-models', '--models_dir', modelsDir
        ], { stdio: ['pipe', 'pipe', 'pipe'], timeout: 10000 })

        let stdout = ''
        proc.stdout.on('data', (d: Buffer) => { stdout += d.toString() })
        proc.on('close', (code) => {
          if (code === 0) {
            try {
              resolve(JSON.parse(stdout.trim()))
            } catch {
              resolve({ models: [] })
            }
          } else {
            resolve({ models: [] })
          }
        })
        proc.on('error', () => resolve({ models: [] }))
      })
    } catch {
      return { models: [] }
    }
  })

  // Detect hardware capabilities
  ipcMain.handle('local-models:detect-hardware', async () => {
    try {
      const pythonPath = getPythonPath()
      const scriptPath = getScriptPath()

      return new Promise((resolve) => {
        const proc = spawn(pythonPath, [
          scriptPath, 'detect-hardware'
        ], { stdio: ['pipe', 'pipe', 'pipe'], timeout: 15000 })

        let stdout = ''
        proc.stdout.on('data', (d: Buffer) => { stdout += d.toString() })
        proc.on('close', (code) => {
          if (code === 0) {
            try {
              resolve(JSON.parse(stdout.trim()))
            } catch {
              resolve({ cuda: false, directml: false, cpu: true, vram_mb: 0, device_name: 'CPU' })
            }
          } else {
            resolve({ cuda: false, directml: false, cpu: true, vram_mb: 0, device_name: 'CPU' })
          }
        })
        proc.on('error', () => resolve({ cuda: false, directml: false, cpu: true, vram_mb: 0, device_name: 'CPU' }))
      })
    } catch {
      return { cuda: false, directml: false, cpu: true, vram_mb: 0, device_name: 'CPU' }
    }
  })

  // Select a model directory (import)
  ipcMain.handle('local-models:import', async () => {
    const result = await dialog.showOpenDialog({
      title: 'Select Model Directory',
      properties: ['openDirectory'],
    })
    if (result.canceled || result.filePaths.length === 0) {
      return { success: false, error: 'Cancelled' }
    }
    const selectedPath = result.filePaths[0]
    // Validate it looks like a model directory
    const modelIndex = join(selectedPath, 'model_index.json')
    if (!existsSync(modelIndex)) {
      return { success: false, error: 'Invalid model: model_index.json not found' }
    }
    return { success: true, path: selectedPath }
  })

  // Generate image with progress (enhanced version — uses ModelManager for GPU exclusivity)
  ipcMain.handle('image:generate-local-enhanced', async (event, params: {
    prompt: string
    negativePrompt?: string
    width: number
    height: number
    outputPath: string
    modelPath: string
    steps?: number
    seed?: number
    device?: string
    generationId?: string
    unloadAfter?: boolean
  }): Promise<{ success: boolean; path?: string; error?: string }> => {
    const genId = params.generationId || `gen-${Date.now()}`
    console.log(`[image-gen] ENHANCED genId=${genId} model=${params.modelPath} unloadAfter=${params.unloadAfter}`)

    let resolvedOutputPath = params.outputPath
    if (resolvedOutputPath.includes('%TEMP%')) {
      resolvedOutputPath = resolvedOutputPath.replace(/%TEMP%/g, tmpdir())
    }

    try {
      const mgr = getModelManagerInstance()
      mgr.setWindow(BrowserWindow.getAllWindows()[0])

      // Load model (reuses if same model already loaded)
      const loadResult = await mgr.loadModel(params.modelPath)
      if (!loadResult.success) {
        return { success: false, error: loadResult.error || 'Failed to load model' }
      }

      // Generate
      const genResult = await mgr.generate({
        prompt: params.prompt,
        negativePrompt: params.negativePrompt,
        width: params.width,
        height: params.height,
        steps: params.steps || 10,
        seed: params.seed,
        outputPath: resolvedOutputPath,
        generationId: genId,
      })

      // Unload after generation if requested (for scene generation: bg → unload → person)
      if (params.unloadAfter && genResult.success) {
        console.log(`[image-gen] Unloading model after generation (unloadAfter=true)`)
        await mgr.unloadModel()
      }

      return genResult
    } catch (err) {
      console.error(`[image-gen] ERROR genId=${genId}`, err)
      return { success: false, error: err instanceof Error ? err.message : 'Generation failed' }
    }
  })

  // Cancel ongoing generation
  ipcMain.handle('local-models:cancel-generation', async () => {
    // Unload the model and shutdown the worker — cancelled by the user.
    try {
      const mgr = getModelManagerInstance()
      await mgr.shutdown('generation_cancelled', 'renderer:cancel-local-generation')
    } catch {}
    return { success: true }
  })

  // Unload model from CUDA
  ipcMain.handle('model:unload', async () => {
    try {
      const mgr = getModelManagerInstance()
      return await mgr.unloadModel()
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : 'Unload failed' }
    }
  })

  // Switch model (unload previous, load new)
  ipcMain.handle('model:switch', async (_event, params: { modelPath: string }) => {
    try {
      const mgr = getModelManagerInstance()
      return await mgr.switchModel(params.modelPath)
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : 'Switch failed' }
    }
  })

  // Get model manager status
  ipcMain.handle('model:status', async () => {
    try {
      const mgr = getModelManagerInstance()
      return await mgr.getStatus()
    } catch (err) {
      return { loaded: false, error: err instanceof Error ? err.message : 'Status failed' }
    }
  })

  // Begin batch session
  ipcMain.handle('model:begin-batch', async (_event, params: { modelPath: string }) => {
    try {
      const mgr = getModelManagerInstance()
      return await mgr.beginBatch(params.modelPath)
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : 'Batch start failed' }
    }
  })

  // End batch session
  ipcMain.handle('model:end-batch', async () => {
    try {
      const mgr = getModelManagerInstance()
      return await mgr.endBatch()
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : 'Batch end failed' }
    }
  })

  // Get detailed GPU/VRAM status
  ipcMain.handle('local-models:gpu-status', async () => {
    try {
      const pythonPath = getPythonPath()
      const scriptPath = getScriptPath()

      return new Promise((resolve) => {
        const proc = spawn(pythonPath, [
          scriptPath, 'gpu-status'
        ], { stdio: ['pipe', 'pipe', 'pipe'], timeout: 10000 })

        let stdout = ''
        proc.stdout.on('data', (d: Buffer) => { stdout += d.toString() })
        proc.on('close', (code) => {
          if (code === 0) {
            try {
              resolve(JSON.parse(stdout.trim()))
            } catch {
              resolve({ cuda: false, device_name: 'CPU', total_vram_gb: 0, allocated_vram_gb: 0, reserved_vram_gb: 0, free_vram_gb: 0 })
            }
          } else {
            resolve({ cuda: false, device_name: 'CPU', total_vram_gb: 0, allocated_vram_gb: 0, reserved_vram_gb: 0, free_vram_gb: 0 })
          }
        })
        proc.on('error', () => resolve({ cuda: false, device_name: 'CPU', total_vram_gb: 0, allocated_vram_gb: 0, reserved_vram_gb: 0, free_vram_gb: 0 }))
      })
    } catch {
      return { cuda: false, device_name: 'CPU', total_vram_gb: 0, allocated_vram_gb: 0, reserved_vram_gb: 0, free_vram_gb: 0 }
    }
  })

  // Get default models directory
  ipcMain.handle('local-models:get-dir', async () => {
    return getModelsDir()
  })
}

function registerLocalGenerationIpc(): void {
  ipcMain.handle('image:generate-local', async (_event, params: {
    prompt: string;
    width: number;
    height: number;
    outputPath: string;
    seed?: number;
  }): Promise<{ success: boolean; path?: string; error?: string }> => {
    return new Promise((resolve) => {
      const scriptPath = getScriptPath()

      // Resolve %TEMP% and ensure output goes to a valid directory
      let resolvedOutputPath = params.outputPath
      if (resolvedOutputPath.includes('%TEMP%')) {
        resolvedOutputPath = resolvedOutputPath.replace(/%TEMP%/g, tmpdir())
      }
      resolvedOutputPath = join(resolvedOutputPath)

      const args = [
        scriptPath,
        '--prompt', params.prompt,
        '--output_path', resolvedOutputPath,
        '--width', String(params.width),
        '--height', String(params.height),
      ]

      // Use local model if available (skip HuggingFace download)
      const localModel = getLocalModelPath()
      if (localModel) {
        args.push('--model_path', localModel)
      }

      if (params.seed !== undefined && params.seed >= 0) {
        args.push('--seed', String(params.seed))
      }

      const pythonPath = getPythonPath()
      const pythonProcess = spawn(pythonPath, args, {
        stdio: ['pipe', 'pipe', 'pipe'],
        timeout: 300000, // 5 minutes - model loading + generation can be slow
      })

      let stdout = ''
      let stderr = ''

      pythonProcess.stdout.on('data', (data: Buffer) => {
        const msg = data.toString()
        stdout += msg
        // Log Python stdout to main process console for debugging
        console.log('[image-gen:stdout]', msg.trim())
      })

      pythonProcess.stderr.on('data', (data: Buffer) => {
        const msg = data.toString()
        stderr += msg
        // Log Python stderr to main process console for debugging
        console.log('[image-gen]', msg.trim())
      })

      pythonProcess.on('close', (code) => {
        if (code === 0) {
          try {
            const result = JSON.parse(stdout.trim())
            resolve(result)
          } catch {
            resolve({ success: false, error: `Failed to parse script output: ${stdout.slice(0, 200)}` })
          }
        } else {
          let errorMsg = `Python process exited with code ${code}`
          try {
            const errResult = JSON.parse(stderr.trim())
            errorMsg = errResult.error || errorMsg
          } catch {
            if (stderr.trim()) errorMsg = stderr.trim().slice(0, 500)
          }
          resolve({ success: false, error: errorMsg })
        }
      })

      pythonProcess.on('error', (err) => {
        resolve({ success: false, error: `Failed to start Python: ${err.message}` })
      })
    })
  })
}

function getTranscribeScriptPath(): string {
  if (is.dev) {
    return join(__dirname, '../../scripts/transcribe.py')
  }
  return join(process.resourcesPath, 'scripts/transcribe.py')
}

function registerTranscriptionIpc(): void {
  ipcMain.handle('ollama:start', async (): Promise<{ success: boolean; error?: string }> => {
    return new Promise((resolve) => {
      const proc = spawn('ollama', ['serve'], {
        stdio: 'ignore',
        detached: true,
      })
      proc.unref()

      // Give it a moment then check if it's alive
      setTimeout(async () => {
        try {
          const resp = await fetch('http://localhost:11434/api/tags', { signal: AbortSignal.timeout(3000) })
          if (resp.ok) {
            resolve({ success: true })
          } else {
            resolve({ success: false, error: 'Ollama started but not responding' })
          }
        } catch {
          resolve({ success: false, error: 'Ollama started but not yet ready' })
        }
      }, 2000)
    })
  })

  ipcMain.handle('dialog:selectAudioFile', async (): Promise<{ canceled: boolean; filePath: string }> => {
    const result = await dialog.showOpenDialog({
      title: 'Select Audio File',
      filters: [
        { name: 'Audio', extensions: ['mp3', 'wav', 'm4a', 'aac', 'ogg', 'webm', 'flac'] },
      ],
      properties: ['openFile'],
    })
    return {
      canceled: result.canceled,
      filePath: result.filePaths[0] || '',
    }
  })

  ipcMain.handle('transcribe-audio', async (_event, params: {
    audioPath: string;
    modelSize?: string;
  }): Promise<{ success: boolean; text?: string; segments?: any[]; language?: string; duration?: number; error?: string }> => {
    if (!params.audioPath) {
      return { success: false, error: 'No audio file path provided' }
    }

    return new Promise((resolve) => {
      const scriptPath = getTranscribeScriptPath()
      const args = [
        scriptPath,
        '--audio_path', params.audioPath,
      ]
      if (params.modelSize) {
        args.push('--model', params.modelSize)
      }

      const pythonPath = getPythonPath()
      console.log('[transcribe] Running:', pythonPath, args.join(' '))

      const pythonProcess = spawn(pythonPath, args, {
        stdio: ['pipe', 'pipe', 'pipe'],
        timeout: 600000,
        env: { ...process.env, PYTHONIOENCODING: 'utf-8' },
      })

      let stdout = ''
      let stderr = ''

      pythonProcess.stdout.on('data', (data: Buffer) => {
        stdout += data.toString()
      })

      pythonProcess.stderr.on('data', (data: Buffer) => {
        stderr += data.toString()
        console.log('[transcribe]', data.toString().trim())
      })

      pythonProcess.on('close', (code) => {
        if (code === 0) {
          try {
            const result = JSON.parse(stdout.trim())
            resolve(result)
          } catch {
            resolve({ success: false, error: `Failed to parse transcription output: ${stdout.slice(0, 200)}` })
          }
        } else {
          let errorMsg = `Python process exited with code ${code}`
          if (stderr.trim()) errorMsg = stderr.trim().slice(0, 500)
          resolve({ success: false, error: errorMsg })
        }
      })

      pythonProcess.on('error', (err) => {
        resolve({ success: false, error: `Failed to start Python: ${err.message}` })
      })
    })
  })
}

function registerSaveImageIpc(): void {
  ipcMain.handle('dialog:selectFolder', async (): Promise<{ canceled: boolean; filePath: string }> => {
    const result = await dialog.showOpenDialog({
      title: 'Select Save Location',
      properties: ['openDirectory', 'createDirectory'],
    })
    return {
      canceled: result.canceled,
      filePath: result.filePaths[0] || '',
    }
  })

  ipcMain.handle('image:save', async (_event, params: {
    imageBase64: string;
    defaultName?: string;
  }): Promise<{ success: boolean; path?: string; error?: string }> => {
    try {
      const result = await dialog.showSaveDialog({
        title: 'Save Image',
        defaultPath: params.defaultName || `docuflow-image-${Date.now()}.png`,
        filters: [
          { name: 'PNG Image', extensions: ['png'] },
          { name: 'JPEG Image', extensions: ['jpg', 'jpeg'] },
          { name: 'All Files', extensions: ['*'] },
        ],
      })

      if (result.canceled || !result.filePath) {
        return { success: false, error: 'Save cancelled' }
      }

      const buffer = Buffer.from(params.imageBase64, 'base64')
      await writeFile(result.filePath, buffer)
      return { success: true, path: result.filePath }
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : 'Save failed' }
    }
  })

  ipcMain.handle('image:saveFromPath', async (_event, params: {
    sourcePath: string;
    defaultName?: string;
  }): Promise<{ success: boolean; path?: string; error?: string }> => {
    try {
      if (!params.sourcePath || !existsSync(params.sourcePath)) {
        return { success: false, error: 'Source image not found' }
      }

      const result = await dialog.showSaveDialog({
        title: 'Save Image',
        defaultPath: params.defaultName || `docuflow-image-${Date.now()}.png`,
        filters: [
          { name: 'PNG Image', extensions: ['png'] },
          { name: 'JPEG Image', extensions: ['jpg', 'jpeg'] },
          { name: 'All Files', extensions: ['*'] },
        ],
      })

      if (result.canceled || !result.filePath) {
        return { success: false, error: 'Save cancelled' }
      }

      const buffer = await readFile(params.sourcePath)
      await writeFile(result.filePath, buffer)
      return { success: true, path: result.filePath }
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : 'Save failed' }
    }
  })

  ipcMain.handle('image:saveToFolder', async (_event, params: {
    imageBase64: string;
    folderPath: string;
    fileName?: string;
  }): Promise<{ success: boolean; path?: string; error?: string }> => {
    try {
      if (!params.folderPath) {
        return { success: false, error: 'No save location configured' }
      }

      const { mkdirSync } = await import('fs')
      if (!existsSync(params.folderPath)) {
        mkdirSync(params.folderPath, { recursive: true })
      }

      const fileName = params.fileName || `image-${Date.now()}.png`
      const filePath = join(params.folderPath, fileName)
      const buffer = Buffer.from(params.imageBase64, 'base64')
      await writeFile(filePath, buffer)
      return { success: true, path: filePath }
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : 'Save failed' }
    }
  })

  // Save raw image bytes to a temp file (for persisting Cloudflare images to disk)
  ipcMain.handle('image:saveBytes', async (_event, params: {
    imageBase64: string;
    filename?: string;
  }): Promise<{ success: boolean; path?: string; error?: string }> => {
    try {
      const { tmpdir } = await import('os')
      const fileName = params.filename || `docuflow-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.png`
      const filePath = join(tmpdir(), 'docuflow', fileName)
      const dir = join(tmpdir(), 'docuflow')
      if (!existsSync(dir)) {
        const { mkdirSync } = await import('fs')
        mkdirSync(dir, { recursive: true })
      }
      const buffer = Buffer.from(params.imageBase64, 'base64')
      await writeFile(filePath, buffer)
      return { success: true, path: filePath }
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : 'Save failed' }
    }
  })

  // Read an image file and return as base64 (for blobUrlToBase64 fallback)
  ipcMain.handle('image:readAsBase64', async (_event, filePath: string): Promise<string> => {
    try {
      if (!existsSync(filePath)) return '';
      const buffer = await readFile(filePath);
      return buffer.toString('base64');
    } catch {
      return '';
    }
  })
}

function registerUpscaleIpc(): void {
  ipcMain.handle('image:upscale', async (event, params: {
    inputPath: string;
    outputPath: string;
    scale?: number;
    device?: string;
  }): Promise<{ success: boolean; path?: string; inputSize?: string; outputSize?: string; time?: number; model?: string; device?: string; error?: string }> => {
    const pythonPath = getPythonPath()
    const scriptDir = join(getScriptPath(), '..')
    const scriptPath = join(scriptDir, 'upscale_local.py')

    if (!existsSync(params.inputPath)) {
      console.error(`[UPSCALE] INPUT NOT FOUND: ${params.inputPath}`)
      return { success: false, error: `Input file not found: ${params.inputPath}` }
    }

    let inputSizeBytes = 0
    try { inputSizeBytes = statSync(params.inputPath).size } catch {}

    if (!existsSync(pythonPath)) {
      return { success: false, error: `Python not found: ${pythonPath}` }
    }
    if (!existsSync(scriptPath)) {
      return { success: false, error: `Upscale script not found: ${scriptPath}` }
    }

    const scale = params.scale || 2
    const device = params.device || 'auto'

    console.log(`[UPSCALE] ═══════════════════════════════════════`)
    console.log(`[UPSCALE] Input path:  ${params.inputPath}`)
    console.log(`[UPSCALE] Input bytes:  ${inputSizeBytes}`)
    console.log(`[UPSCALE] Output path: ${params.outputPath}`)
    console.log(`[UPSCALE] Scale: ${scale}x  Device: ${device}`)

    return new Promise((resolve) => {
      const proc = spawn(pythonPath, [
        scriptPath,
        '--input', params.inputPath,
        '--output', params.outputPath,
        '--scale', String(scale),
        '--device', device,
      ], { stdio: ['pipe', 'pipe', 'pipe'], timeout: 300000 })

      let stdout = ''
      let stderr = ''
      proc.stdout.on('data', (d: Buffer) => {
        const raw = d.toString()
        stdout += raw
        const lines = raw.split('\n').filter(l => l.trim())
        for (const line of lines) {
          try {
            const parsed = JSON.parse(line)
            if (parsed.type === 'status') {
              console.log(`[UPSCALE] Python: ${parsed.message}`)
              event.sender.send('local-generation:progress', parsed)
            }
          } catch {}
        }
      })
      proc.stderr.on('data', (d: Buffer) => { stderr += d.toString() })
      proc.on('close', (code) => {
        console.log(`[UPSCALE] Process exit code: ${code}`)

        if (code === 0) {
          try {
            const lines = stdout.trim().split('\n')
            let lastJson: Record<string, unknown> | null = null
            for (let i = lines.length - 1; i >= 0; i--) {
              try { lastJson = JSON.parse(lines[i]); break } catch {}
            }

            if (lastJson && lastJson.success) {
              const outPath = lastJson.path as string

              if (!outPath || !existsSync(outPath)) {
                console.error(`[UPSCALE] OUTPUT NOT FOUND: ${outPath}`)
                resolve({ success: false, error: `Upscale output not found: ${outPath}` })
                return
              }

              const outStat = statSync(outPath)
              if (outStat.size === 0) {
                console.error(`[UPSCALE] OUTPUT EMPTY: ${outPath}`)
                resolve({ success: false, error: 'Upscale output is empty' })
                return
              }

              const header = readFileSync(outPath).subarray(0, 8)
              const isPNG = header[0] === 0x89 && header[1] === 0x50 && header[2] === 0x4E && header[3] === 0x47
              const isJPEG = header[0] === 0xFF && header[1] === 0xD8
              if (!isPNG && !isJPEG) {
                console.error(`[UPSCALE] OUTPUT NOT IMAGE. Header hex: ${header.toString('hex')}`)
                resolve({ success: false, error: 'Output is not a valid image' })
                return
              }

              console.log(`[UPSCALE] Output valid: ${isPNG ? 'PNG' : 'JPEG'}, ${outStat.size} bytes`)
              console.log(`[UPSCALE] ${lastJson.input_size} → ${lastJson.output_size}`)
              console.log(`[UPSCALE] Model: ${lastJson.model}  Device: ${lastJson.device}  Time: ${lastJson.time}s`)
              console.log(`[UPSCALE] ═══════════════════════════════════════`)

              resolve({
                success: true,
                path: outPath,
                inputSize: lastJson.input_size as string,
                outputSize: lastJson.output_size as string,
                time: lastJson.time as number,
                model: (lastJson.model as string) || 'RealESRGAN_x4plus_anime_6B',
                device: lastJson.device as string,
              })
            } else {
              const errMsg = (lastJson?.error as string) || 'Upscale returned failure'
              console.error(`[UPSCALE] PYTHON FAILURE: ${errMsg}`)
              resolve({ success: false, error: errMsg })
            }
          } catch (e) {
            console.error(`[UPSCALE] PARSE ERROR: ${e}`)
            resolve({ success: false, error: `Parse error: ${String(e)}` })
          }
        } else {
          console.error(`[UPSCALE] EXIT ${code}: ${stderr.slice(0, 500)}`)
          resolve({ success: false, error: stderr || `Exit code ${code}` })
        }
      })
      proc.on('error', (err) => {
        console.error(`[UPSCALE] SPAWN ERROR: ${err.message}`)
        resolve({ success: false, error: `Spawn error: ${err.message}` })
      })
    })
  })
}

function getBatchGenerateScriptPath(): string {
  if (is.dev) {
    return join(__dirname, '../../scripts/generate_batch.py')
  }
  return join(process.resourcesPath, 'scripts/generate_batch.py')
}

function getBatchUpscaleScriptPath(): string {
  if (is.dev) {
    return join(__dirname, '../../scripts/upscale_batch.py')
  }
  return join(process.resourcesPath, 'scripts/upscale_batch.py')
}

function registerBatchPipelineIpc(): void {
  // Batch generate backgrounds — loads model once, generates all, releases
  ipcMain.handle('pipeline:batch-generate', async (event, params: {
    jobs: Array<{
      sceneId: string;
      prompt: string;
      negativePrompt?: string;
      width?: number;
      height?: number;
      steps?: number;
      seed?: number;
    }>;
    modelPath: string;
    device?: string;
    outputDir: string;
  }): Promise<{
    success: boolean;
    results?: Array<{
      sceneId: string;
      success: boolean;
      path?: string;
      error?: string;
    }>;
    summary?: { total: number; success: number; failed: number };
    error?: string;
  }> => {
    const pythonPath = getPythonPath()
    const scriptPath = getBatchGenerateScriptPath()

    if (!existsSync(pythonPath)) {
      return { success: false, error: `Python not found: ${pythonPath}` }
    }
    if (!existsSync(scriptPath)) {
      return { success: false, error: `Batch generate script not found: ${scriptPath}` }
    }

    // Write jobs config to a temp file
    const configPath = join(tmpdir(), 'docuflow', `batch_gen_${Date.now()}.json`)
    const configDir = join(tmpdir(), 'docuflow')
    if (!existsSync(configDir)) {
      const { mkdirSync } = await import('fs')
      mkdirSync(configDir, { recursive: true })
    }

    const config = {
      model_path: params.modelPath,
      device: params.device || 'auto',
      default_steps: 10,
      default_width: 512,
      default_height: 512,
      jobs: params.jobs.map(j => ({
        scene_id: j.sceneId,
        prompt: j.prompt,
        negative_prompt: j.negativePrompt,
        width: j.width,
        height: j.height,
        steps: j.steps,
        seed: j.seed,
      })),
    }

    const { writeFileSync } = await import('fs')
    writeFileSync(configPath, JSON.stringify(config, null, 2))

    console.log(`[BATCH-GEN] Starting batch: ${params.jobs.length} scenes`)
    console.log(`[BATCH-GEN] Config: ${configPath}`)
    console.log(`[BATCH-GEN] Output: ${params.outputDir}`)

    return new Promise((resolve) => {
      const proc = spawn(pythonPath, [
        scriptPath,
        '--input', configPath,
        '--output_dir', params.outputDir,
        '--device', params.device || 'auto',
      ], { stdio: ['pipe', 'pipe', 'pipe'], timeout: 1800000 }) // 30 minutes for batch

      let stdout = ''
      let stderr = ''

      proc.stdout.on('data', (data: Buffer) => {
        const raw = data.toString()
        stdout += raw
        // Forward progress/status to renderer
        const lines = raw.trim().split('\n')
        for (const line of lines) {
          try {
            const parsed = JSON.parse(line)
            if (parsed.type === 'progress' || parsed.type === 'status') {
              event.sender.send('local-generation:progress', parsed)
            }
          } catch {}
        }
      })

      proc.stderr.on('data', (data: Buffer) => {
        stderr += data.toString()
      })

      proc.on('close', (code) => {
        // Clean up temp config
        try { require('fs').unlinkSync(configPath) } catch {}

        if (code === 0) {
          try {
            const lines = stdout.trim().split('\n')
            let lastJson: Record<string, unknown> | null = null
            for (let i = lines.length - 1; i >= 0; i--) {
              try { lastJson = JSON.parse(lines[i]); break } catch {}
            }

            if (lastJson && lastJson.success) {
              console.log(`[BATCH-GEN] Completed: ${(lastJson.summary as any)?.success} success, ${(lastJson.summary as any)?.failed} failed`)
              resolve({
                success: true,
                results: lastJson.results as any,
                summary: lastJson.summary as any,
              })
            } else {
              resolve({ success: false, error: (lastJson?.error as string) || 'Batch generation failed' })
            }
          } catch (e) {
            resolve({ success: false, error: `Parse error: ${String(e)}` })
          }
        } else {
          console.error(`[BATCH-GEN] EXIT ${code}: ${stderr.slice(0, 500)}`)
          resolve({ success: false, error: stderr || `Exit code ${code}` })
        }
      })

      proc.on('error', (err) => {
        resolve({ success: false, error: `Spawn error: ${err.message}` })
      })
    })
  })

  // Batch upscale — loads model once, upscales all, releases
  ipcMain.handle('pipeline:batch-upscale', async (event, params: {
    jobs: Array<{
      sceneId: string;
      inputPath: string;
    }>;
    scale?: number;
    device?: string;
    outputDir: string;
  }): Promise<{
    success: boolean;
    results?: Array<{
      sceneId: string;
      success: boolean;
      path?: string;
      inputSize?: string;
      outputSize?: string;
      time?: number;
      error?: string;
    }>;
    summary?: { total: number; success: number; failed: number };
    error?: string;
  }> => {
    const pythonPath = getPythonPath()
    const scriptPath = getBatchUpscaleScriptPath()

    if (!existsSync(pythonPath)) {
      return { success: false, error: `Python not found: ${pythonPath}` }
    }
    if (!existsSync(scriptPath)) {
      return { success: false, error: `Batch upscale script not found: ${scriptPath}` }
    }

    // Write jobs config to a temp file
    const configPath = join(tmpdir(), 'docuflow', `batch_up_${Date.now()}.json`)
    const configDir = join(tmpdir(), 'docuflow')
    if (!existsSync(configDir)) {
      const { mkdirSync } = await import('fs')
      mkdirSync(configDir, { recursive: true })
    }

    const config = {
      scale: params.scale || 2,
      device: params.device || 'auto',
      jobs: params.jobs.map(j => ({
        scene_id: j.sceneId,
        input_path: j.inputPath,
      })),
    }

    const { writeFileSync } = await import('fs')
    writeFileSync(configPath, JSON.stringify(config, null, 2))

    console.log(`[BATCH-UP] Starting batch: ${params.jobs.length} images`)
    console.log(`[BATCH-UP] Scale: ${params.scale || 2}x`)

    return new Promise((resolve) => {
      const proc = spawn(pythonPath, [
        scriptPath,
        '--input', configPath,
        '--output_dir', params.outputDir,
        '--scale', String(params.scale || 2),
        '--device', params.device || 'auto',
      ], { stdio: ['pipe', 'pipe', 'pipe'], timeout: 1800000 })

      let stdout = ''
      let stderr = ''

      proc.stdout.on('data', (data: Buffer) => {
        const raw = data.toString()
        stdout += raw
        const lines = raw.trim().split('\n')
        for (const line of lines) {
          try {
            const parsed = JSON.parse(line)
            if (parsed.type === 'status' || parsed.type === 'progress') {
              event.sender.send('local-generation:progress', parsed)
            }
          } catch {}
        }
      })

      proc.stderr.on('data', (data: Buffer) => {
        stderr += data.toString()
      })

      proc.on('close', (code) => {
        try { require('fs').unlinkSync(configPath) } catch {}

        if (code === 0) {
          try {
            const lines = stdout.trim().split('\n')
            let lastJson: Record<string, unknown> | null = null
            for (let i = lines.length - 1; i >= 0; i--) {
              try { lastJson = JSON.parse(lines[i]); break } catch {}
            }

            if (lastJson && lastJson.success) {
              console.log(`[BATCH-UP] Completed: ${(lastJson.summary as any)?.success} success, ${(lastJson.summary as any)?.failed} failed`)
              resolve({
                success: true,
                results: lastJson.results as any,
                summary: lastJson.summary as any,
              })
            } else {
              resolve({ success: false, error: (lastJson?.error as string) || 'Batch upscale failed' })
            }
          } catch (e) {
            resolve({ success: false, error: `Parse error: ${String(e)}` })
          }
        } else {
          console.error(`[BATCH-UP] EXIT ${code}: ${stderr.slice(0, 500)}`)
          resolve({ success: false, error: stderr || `Exit code ${code}` })
        }
      })

      proc.on('error', (err) => {
        resolve({ success: false, error: `Spawn error: ${err.message}` })
      })
    })
  })
}

app.whenReady().then(() => {
  registerAssetProtocol()
  registerWindowControls()
  registerProjectIpc()
  registerLocalGenerationIpc()
  registerLocalModelManagerIpc()
  registerTranscriptionIpc()
  registerSaveImageIpc()
  registerAssetIpc()
  registerUpscaleIpc()
  registerPipelineIpc()
  registerBatchPipelineIpc()
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

// === APP SHUTDOWN CLEANUP ===
// Kill all running Python processes and shutdown model manager on app quit
function killAllPythonProcesses(reason: 'user' | 'app_exit' | 'before_quit' = 'app_exit'): void {
  // Shutdown model manager (unloads model, kills worker)
  try {
    const mgr = getModelManager(getScriptsBasePath())
    // Fire-and-forget: app is quitting, no time to await
    mgr.shutdown(reason, 'app-quit-cleanup').catch(() => {})
  } catch {}

  // Kill any remaining ad-hoc Python processes
  const processes = (global as any).__localGenProcesses || {}
  const ids = Object.keys(processes)
  if (ids.length > 0) {
    console.log(`[DocuFlow] Cleaning up ${ids.length} running Python process(es)...`)
    for (const id of ids) {
      try {
        processes[id].kill('SIGTERM')
      } catch {}
    }
    // Force kill after 3 seconds if still alive
    setTimeout(() => {
      for (const id of Object.keys(processes)) {
        try {
          if (processes[id] && !processes[id].killed) {
            processes[id].kill('SIGKILL')
          }
        } catch {}
      }
    }, 3000)
  }
}

app.on('before-quit', () => {
  killAllPythonProcesses('before_quit')
})

app.on('will-quit', () => {
  killAllPythonProcesses('app_exit')
})
