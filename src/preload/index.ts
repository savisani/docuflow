import { contextBridge, ipcRenderer } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'

const ASSET_PROTOCOL = 'docuflow-asset'

function filePathToAssetUrl(filePath: string): string {
  const normalized = filePath.replace(/\\/g, '/')
  return `${ASSET_PROTOCOL}://localhost/${encodeURIComponent(normalized)}`
}

const docuflowAPI = {
  importAsset: (projectName: string): Promise<string[]> => {
    return ipcRenderer.invoke('assets:import', projectName)
  },

  getProjectRoot: (): Promise<string> => {
    return ipcRenderer.invoke('project:getRoot')
  },

  ensureProjectFolder: (projectName: string): Promise<string> => {
    return ipcRenderer.invoke('project:ensureFolder', projectName)
  },

  getAssetsDir: (projectName: string): Promise<string> => {
    return ipcRenderer.invoke('project:getAssetsDir', projectName)
  },

  getProjectFilePath: (projectName: string): Promise<string> => {
    return ipcRenderer.invoke('project:getFilePath', projectName)
  },

  projectExists: (projectName: string): Promise<boolean> => {
    return ipcRenderer.invoke('project:exists', projectName)
  },

  filePathToAssetUrl,

  copyDroppedFiles: (projectName: string, sourcePaths: string[]): Promise<string[]> => {
    return ipcRenderer.invoke('assets:copyDropped', projectName, sourcePaths)
  },

  minimize: (): void => {
    ipcRenderer.send('window:minimize')
  },

  maximize: (): void => {
    ipcRenderer.send('window:maximize')
  },

  close: (): void => {
    ipcRenderer.send('window:close')
  },

  isMaximized: (): Promise<boolean> => {
    return ipcRenderer.invoke('window:isMaximized')
  },

  onMaximizedChange: (callback: (maximized: boolean) => void): (() => void) => {
    const handler = (_event: Electron.IpcRendererEvent, maximized: boolean) => callback(maximized)
    ipcRenderer.on('window:maximized', handler)
    return () => ipcRenderer.removeListener('window:maximized', handler)
  },

  generateLocalImage: (params: {
    prompt: string;
    width: number;
    height: number;
    outputPath: string;
    seed?: number;
  }): Promise<{ success: boolean; path?: string; error?: string }> => {
    return ipcRenderer.invoke('image:generate-local', params)
  },

  saveImage: (params: {
    imageBase64: string;
    defaultName?: string;
  }): Promise<{ success: boolean; path?: string; error?: string }> => {
    return ipcRenderer.invoke('image:save', params)
  },

  saveImageFromPath: (params: {
    sourcePath: string;
    defaultName?: string;
  }): Promise<{ success: boolean; path?: string; error?: string }> => {
    return ipcRenderer.invoke('image:saveFromPath', params)
  },

  selectFolder: (): Promise<{ canceled: boolean; filePath: string }> => {
    return ipcRenderer.invoke('dialog:selectFolder')
  },

  saveImageToFolder: (params: {
    imageBase64: string;
    folderPath: string;
    fileName?: string;
  }): Promise<{ success: boolean; path?: string; error?: string }> => {
    return ipcRenderer.invoke('image:saveToFolder', params)
  },

  saveBytes: (params: {
    imageBase64: string;
    filename?: string;
  }): Promise<{ success: boolean; path?: string; error?: string }> => {
    return ipcRenderer.invoke('image:saveBytes', params)
  },

  readImageAsBase64: (filePath: string): Promise<string> => {
    return ipcRenderer.invoke('image:readAsBase64', filePath)
  },

  transcribeAudio: (params: {
    audioPath: string;
    modelSize?: string;
  }): Promise<{
    success: boolean;
    text?: string;
    segments?: { id: number; start: number; end: number; text: string; words?: { word: string; start: number; end: number; probability: number }[] }[];
    language?: string;
    duration?: number;
    error?: string;
  }> => {
    return ipcRenderer.invoke('transcribe-audio', params)
  },

  selectAudioFile: (): Promise<{ canceled: boolean; filePath: string }> => {
    return ipcRenderer.invoke('dialog:selectAudioFile')
  },

  startOllama: (): Promise<{ success: boolean; error?: string }> => {
    return ipcRenderer.invoke('ollama:start')
  },

  // Local model management
  listLocalModels: (): Promise<{ models: Array<{ name: string; path: string; size_bytes: number; size_label: string; type: string; format?: string; has_required_files: boolean }> }> => {
    return ipcRenderer.invoke('local-models:list')
  },

  detectLocalHardware: (): Promise<{ cuda: boolean; directml: boolean; cpu: boolean; vram_mb: number; device_name: string }> => {
    return ipcRenderer.invoke('local-models:detect-hardware')
  },

  importLocalModel: (): Promise<{ success: boolean; path?: string; error?: string }> => {
    return ipcRenderer.invoke('local-models:import')
  },

  getLocalModelsDir: (): Promise<string> => {
    return ipcRenderer.invoke('local-models:get-dir')
  },

  getGpuStatus: (): Promise<{
    cuda: boolean
    device_name: string
    total_vram_gb: number
    allocated_vram_gb: number
    reserved_vram_gb: number
    free_vram_gb: number
    supports_fp16?: boolean
  }> => {
    return ipcRenderer.invoke('local-models:gpu-status')
  },

  generateLocalImageEnhanced: (params: {
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
    return ipcRenderer.invoke('image:generate-local-enhanced', params)
  },

  cancelLocalGeneration: (): Promise<{ success: boolean }> => {
    return ipcRenderer.invoke('local-models:cancel-generation')
  },

  // Model lifecycle management (GPU exclusivity)
  unloadModel: (): Promise<{ success: boolean; action?: string; model?: string; vram?: any }> => {
    return ipcRenderer.invoke('model:unload')
  },

  switchModel: (params: { modelPath: string }): Promise<{ success: boolean; action?: string; model?: string; vram?: any; error?: string }> => {
    return ipcRenderer.invoke('model:switch', params)
  },

  getModelStatus: (): Promise<{ loaded: boolean; model?: string; dtype?: string; vram?: any; pid?: number }> => {
    return ipcRenderer.invoke('model:status')
  },

  beginBatch: (params: { modelPath: string }): Promise<{ success: boolean; model?: string; vram?: any; error?: string }> => {
    return ipcRenderer.invoke('model:begin-batch', params)
  },

  endBatch: (): Promise<{ success: boolean; action?: string; vram?: any; error?: string }> => {
    return ipcRenderer.invoke('model:end-batch')
  },

  upscaleImage: (params: {
    inputPath: string;
    outputPath: string;
    scale?: number;
    device?: string;
  }): Promise<{ success: boolean; path?: string; inputSize?: string; outputSize?: string; time?: number; model?: string; device?: string; error?: string }> => {
    return ipcRenderer.invoke('image:upscale', params)
  },

  compositeImages: (params: {
    backgroundPath: string;
    foregroundPath: string;
    maskPath?: string;
    outputPath: string;
    width: number;
    height: number;
  }): Promise<{ success: boolean; path?: string; error?: string }> => {
    return ipcRenderer.invoke('pipeline:composite', params)
  },

  checkImageQuality: (params: {
    imagePath: string;
    expectedWidth: number;
    expectedHeight: number;
    requirePerson: boolean;
  }): Promise<{
    passed: boolean;
    score: number;
    issues: Array<{ code: string; severity: string; message: string }>;
    recommendations: string[];
    identitySimilarityScore?: number;
  }> => {
    return ipcRenderer.invoke('pipeline:checkQuality', params)
  },

  batchGenerate: (params: {
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
    return ipcRenderer.invoke('pipeline:batch-generate', params)
  },

  batchUpscale: (params: {
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
    return ipcRenderer.invoke('pipeline:batch-upscale', params)
  },

  saveProject: (projectName: string, projectData: any): Promise<{ success: boolean; path?: string; error?: string }> => {
    return ipcRenderer.invoke('project:save', projectName, projectData)
  },

  loadProject: (projectName: string): Promise<{ success: boolean; data?: any; error?: string }> => {
    return ipcRenderer.invoke('project:load', projectName)
  },

  listProjects: (): Promise<{ success: boolean; projects?: Array<{ name: string; hasFile: boolean }>; error?: string }> => {
    return ipcRenderer.invoke('project:list')
  },

  onLocalGenerationProgress: (callback: (data: { type: string; step?: number; total?: number; percent?: number; message?: string }) => void): (() => void) => {
    const handler = (_event: Electron.IpcRendererEvent, data: any) => callback(data)
    ipcRenderer.on('local-generation:progress', handler)
    return () => ipcRenderer.removeListener('local-generation:progress', handler)
  },
}

// Always use contextBridge when contextIsolation is on
// electron-vite sets contextIsolation: true in our config
contextBridge.exposeInMainWorld('electron', electronAPI)
contextBridge.exposeInMainWorld('docuflow', docuflowAPI)
