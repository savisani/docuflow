import { dialog, ipcMain, BrowserWindow } from 'electron'
import { copyFile, access } from 'fs/promises'
import { join, extname, basename } from 'path'
import { getAssetsDir } from '../services/projectFolder'

const ASSET_FILTERS = [
  { name: 'Media', extensions: ['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'svg', 'mp4', 'webm', 'mov', 'avi', 'mkv', 'mp3', 'wav', 'ogg', 'flac', 'aac'] },
  { name: 'Images', extensions: ['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'svg'] },
  { name: 'Video', extensions: ['mp4', 'webm', 'mov', 'avi', 'mkv'] },
  { name: 'Audio', extensions: ['mp3', 'wav', 'ogg', 'flac', 'aac'] },
]

/**
 * Generates a unique filename by appending a counter suffix if the file already exists.
 * e.g. "video.mp4" -> "video.mp4" (first), "video-1.mp4", "video-2.mp4", ...
 */
async function uniqueFilename(dir: string, filename: string): Promise<string> {
  const ext = extname(filename)
  const name = basename(filename, ext)

  let candidate = join(dir, filename)
  let counter = 1

  // eslint-disable-next-line no-constant-condition
  while (true) {
    try {
      await access(candidate)
      // File exists, try next
      candidate = join(dir, `${name}-${counter}${ext}`)
      counter++
    } catch {
      // File does not exist — this name is free
      return candidate
    }
  }
}

async function handleImportAsset(
  event: Electron.IpcMainInvokeEvent,
  projectName: string
): Promise<string[]> {
  const win = BrowserWindow.fromWebContents(event.sender)
  if (!win) throw new Error('No window found for sender')

  const { canceled, filePaths } = await dialog.showOpenDialog(win, {
    title: 'Import Asset',
    properties: ['openFile', 'multiSelections'],
    filters: ASSET_FILTERS,
  })

  if (canceled || filePaths.length === 0) return []

  const assetsDir = await getAssetsDir(projectName)
  const copiedPaths: string[] = []

  for (const srcPath of filePaths) {
    const filename = basename(srcPath)
    const destPath = await uniqueFilename(assetsDir, filename)
    await copyFile(srcPath, destPath)
    copiedPaths.push(destPath)
  }

  return copiedPaths
}

async function handleCopyDroppedFiles(
  _event: Electron.IpcMainInvokeEvent,
  projectName: string,
  sourcePaths: string[]
): Promise<string[]> {
  const assetsDir = await getAssetsDir(projectName)
  const copiedPaths: string[] = []

  for (const srcPath of sourcePaths) {
    const filename = basename(srcPath)
    const destPath = await uniqueFilename(assetsDir, filename)
    await copyFile(srcPath, destPath)
    copiedPaths.push(destPath)
  }

  return copiedPaths
}

export function registerAssetIpc(): void {
  ipcMain.handle('assets:import', handleImportAsset)
  ipcMain.handle('assets:copyDropped', handleCopyDroppedFiles)
}
