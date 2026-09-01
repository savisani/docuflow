import { app, BrowserWindow, shell, ipcMain, protocol, dialog } from 'electron'
import { join, extname } from 'path'
import { readFile, writeFile, existsSync, mkdirSync, readdirSync, statSync } from 'fs/promises'
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
  const fs = require('fs')
  // Check for locally downloaded model in scripts/models/
  const localModel = join(__dirname, '../../scripts/models/stable-diffusion-v1-5')
  if (fs.existsSync(localModel) && fs.existsSync(join(localModel, 'model_index.json'))) {
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

  // Generate image with progress (enhanced version)
  ipcMain.handle('image:generate-local-enhanced', async (event, params: {
    prompt: string
    width: number
    height: number
    outputPath: string
    modelPath: string
    steps?: number
    seed?: number
    device?: string
  }): Promise<{ success: boolean; path?: string; error?: string }> => {
    return new Promise((resolve) => {
      const scriptPath = getScriptPath()
      const pythonPath = getPythonPath()

      let resolvedOutputPath = params.outputPath
      if (resolvedOutputPath.includes('%TEMP%')) {
        resolvedOutputPath = resolvedOutputPath.replace(/%TEMP%/g, tmpdir())
      }

      const args = [
        scriptPath, 'generate',
        '--prompt', params.prompt,
        '--output_path', resolvedOutputPath,
        '--width', String(params.width),
        '--height', String(params.height),
        '--steps', String(params.steps || 20),
        '--model_path', params.modelPath,
        '--device', params.device || 'auto',
      ]

      if (params.seed !== undefined && params.seed >= 0) {
        args.push('--seed', String(params.seed))
      }

      const proc = spawn(pythonPath, args, {
        stdio: ['pipe', 'pipe', 'pipe'],
        timeout: 600000, // 10 minutes for slow generation
      })

      let stdout = ''
      let stderr = ''

      proc.stdout.on('data', (data: Buffer) => {
        const msg = data.toString()
        stdout += msg
        // Forward progress/status lines to renderer
        const lines = msg.trim().split('\n')
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
        if (code === 0) {
          try {
            const lastLine = stdout.trim().split('\n').pop() || '{}'
            resolve(JSON.parse(lastLine))
          } catch {
            resolve({ success: false, error: 'Failed to parse output' })
          }
        } else {
          let errorMsg = `Process exited with code ${code}`
          try {
            const errResult = JSON.parse(stderr.trim())
            errorMsg = errResult.error || errorMsg
          } catch {
            if (stderr.trim()) errorMsg = stderr.trim().slice(0, 500)
          }
          resolve({ success: false, error: errorMsg })
        }
      })

      proc.on('error', (err) => {
        resolve({ success: false, error: `Failed to start Python: ${err.message}` })
      })

      // Store process reference for cancellation
      const genId = `gen-${Date.now()}`
      ;(global as any).__localGenProcesses = (global as any).__localGenProcesses || {}
      ;(global as any).__localGenProcesses[genId] = proc

      proc.on('close', () => {
        delete (global as any).__localGenProcesses?.[genId]
      })
    })
  })

  // Cancel ongoing generation
  ipcMain.handle('local-models:cancel-generation', async () => {
    const processes = (global as any).__localGenProcesses || {}
    for (const id of Object.keys(processes)) {
      try {
        processes[id].kill('SIGTERM')
      } catch {}
    }
    return { success: true }
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

  ipcMain.handle('image:saveToFolder', async (_event, params: {
    imageBase64: string;
    folderPath: string;
    fileName?: string;
  }): Promise<{ success: boolean; path?: string; error?: string }> => {
    try {
      if (!params.folderPath) {
        return { success: false, error: 'No save location configured' }
      }

      const { mkdirSync, existsSync } = await import('fs')
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
