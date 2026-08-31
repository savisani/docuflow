import { app } from 'electron'
import { join } from 'path'
import { mkdir, access } from 'fs/promises'

const PROJECTS_ROOT = 'DocuFlow Projects'

/**
 * Returns the base path where all DocuFlow projects live:
 *   {documents}/DocuFlow Projects/
 */
export function getProjectsRoot(): string {
  return join(app.getPath('documents'), PROJECTS_ROOT)
}

/**
 * Ensures the project folder structure exists for a given project name:
 *   {documents}/DocuFlow Projects/{projectName}/
 *   {documents}/DocuFlow Projects/{projectName}/assets/
 *
 * Returns the absolute path to the project folder.
 */
export async function ensureProjectFolder(projectName: string): Promise<string> {
  const projectRoot = join(getProjectsRoot(), projectName)
  const assetsDir = join(projectRoot, 'assets')

  await mkdir(assetsDir, { recursive: true })

  return projectRoot
}

/**
 * Returns the absolute path to a project's assets directory.
 * Creates it if it doesn't exist.
 */
export async function getAssetsDir(projectName: string): Promise<string> {
  const assetsDir = join(getProjectsRoot(), projectName, 'assets')
  await mkdir(assetsDir, { recursive: true })
  return assetsDir
}

/**
 * Returns the absolute path to a project's project.json file.
 */
export function getProjectFilePath(projectName: string): string {
  return join(getProjectsRoot(), projectName, 'project.json')
}

/**
 * Checks if a project folder already exists.
 */
export async function projectExists(projectName: string): Promise<boolean> {
  try {
    await access(join(getProjectsRoot(), projectName))
    return true
  } catch {
    return false
  }
}
