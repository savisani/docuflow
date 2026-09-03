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
  saveImageFromPath(params: {
    sourcePath: string;
    defaultName?: string;
  }): Promise<{ success: boolean; path?: string; error?: string }>
  selectFolder(): Promise<{ canceled: boolean; filePath: string }>
  saveImageToFolder(params: {
    imageBase64: string;
    folderPath: string;
    fileName?: string;
  }): Promise<{ success: boolean; path?: string; error?: string }>
  saveBytes(params: {
    imageBase64: string;
    filename?: string;
  }): Promise<{ success: boolean; path?: string; error?: string }>
  readImageAsBase64(filePath: string): Promise<string>
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
    negativePrompt?: string
    width: number
    height: number
    outputPath: string
    modelPath: string
    steps?: number
    seed?: number
    device?: string
    generationId?: string
  }): Promise<{ success: boolean; path?: string; error?: string }>
  cancelLocalGeneration(): Promise<{ success: boolean }>
  upscaleImage(params: {
    inputPath: string;
    outputPath: string;
    scale?: number;
    device?: string;
  }): Promise<{ success: boolean; path?: string; inputSize?: string; outputSize?: string; time?: number; model?: string; device?: string; error?: string }>
  compositeImages(params: {
    backgroundPath: string;
    foregroundPath: string;
    maskPath?: string;
    outputPath: string;
    width: number;
    height: number;
  }): Promise<{ success: boolean; path?: string; error?: string }>
  checkImageQuality(params: {
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
  }>
  batchGenerate(params: {
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
  }>
  batchUpscale(params: {
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
  }>
  saveProject(projectName: string, projectData: any): Promise<{ success: boolean; path?: string; error?: string }>
  loadProject(projectName: string): Promise<{ success: boolean; data?: any; error?: string }>
  listProjects(): Promise<{ success: boolean; projects?: Array<{ name: string; hasFile: boolean }>; error?: string }>
  onLocalGenerationProgress(callback: (data: { type: string; step?: number; total?: number; percent?: number; message?: string }) => void): (() => void)
}

declare global {
  interface Window {
    electron: ElectronAPI
    docuflow: DocuFlowAPI
  }
}
