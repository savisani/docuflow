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
}

// Always use contextBridge when contextIsolation is on
// electron-vite sets contextIsolation: true in our config
contextBridge.exposeInMainWorld('electron', electronAPI)
contextBridge.exposeInMainWorld('docuflow', docuflowAPI)
