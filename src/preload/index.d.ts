import { ElectronAPI } from '@electron-toolkit/preload'

export interface DocuFlowAPI {
  importAsset(projectName: string): Promise<string[]>
  getProjectRoot(): Promise<string>
  ensureProjectFolder(projectName: string): Promise<string>
  getAssetsDir(projectName: string): Promise<string>
  getProjectFilePath(projectName: string): Promise<string>
  projectExists(projectName: string): Promise<boolean>
  filePathToAssetUrl(filePath: string): string
  copyDroppedFiles(projectName: string, sourcePaths: string[]): Promise<string[]>
  minimize(): void
  maximize(): void
  close(): void
  isMaximized(): Promise<boolean>
  onMaximizedChange(callback: (maximized: boolean) => void): (() => void)
  generateLocalImage(params: {
    prompt: string;
    width: number;
    height: number;
    outputPath: string;
    seed?: number;
  }): Promise<{ success: boolean; path?: string; error?: string }>
  saveImage(params: {
    imageBase64: string;
    defaultName?: string;
  }): Promise<{ success: boolean; path?: string; error?: string }>
  selectFolder(): Promise<{ canceled: boolean; filePath: string }>
  saveImageToFolder(params: {
    imageBase64: string;
    folderPath: string;
    fileName?: string;
  }): Promise<{ success: boolean; path?: string; error?: string }>
  transcribeAudio(params: {
    audioPath: string;
    modelSize?: string;
  }): Promise<{
    success: boolean;
    text?: string;
    segments?: { id: number; start: number; end: number; text: string; words?: { word: string; start: number; end: number; probability: number }[] }[];
    language?: string;
    duration?: number;
    error?: string;
  }>
  selectAudioFile(): Promise<{ canceled: boolean; filePath: string }>
  startOllama(): Promise<{ success: boolean; error?: string }>
  listLocalModels(): Promise<{ models: Array<{ name: string; path: string; size_bytes: number; size_label: string; type: string; has_required_files: boolean }> }>
  detectLocalHardware(): Promise<{ cuda: boolean; directml: boolean; cpu: boolean; vram_mb: number; device_name: string }>
  importLocalModel(): Promise<{ success: boolean; path?: string; error?: string }>
  getLocalModelsDir(): Promise<string>
  generateLocalImageEnhanced(params: {
    prompt: string
    width: number
    height: number
    outputPath: string
    modelPath: string
    steps?: number
    seed?: number
    device?: string
  }): Promise<{ success: boolean; path?: string; error?: string }>
  cancelLocalGeneration(): Promise<{ success: boolean }>
  onLocalGenerationProgress(callback: (data: { type: string; step?: number; total?: number; percent?: number; message?: string }) => void): (() => void)
}

declare global {
  interface Window {
    electron: ElectronAPI
    docuflow: DocuFlowAPI
  }
}
