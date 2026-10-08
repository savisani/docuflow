import { dirname, join } from 'path'

export interface SaveBytesPathParams {
  /** Target file name. A timestamped default is generated when omitted. */
  filename?: string
  /**
   * Base directory supplied by the caller. Existing callers pass the project
   * file path (`store.projectPath`); images are persisted under
   * `<base>/generated/images` so project assets stay in one place.
   */
  baseDir?: string
  /**
   * True when `baseDir` points to an existing FILE (e.g. a .docuflow.json
   * project file). `join()` under a file throws ENOTDIR, so the containing
   * directory is used instead.
   */
  baseDirIsFile?: boolean
  /**
   * Explicit destination file path. When provided it is respected exactly:
   * the file is written to this path and its parent directory is created.
   * Overrides `baseDir`.
   */
  destPath?: string
  /**
   * Electron userData directory. Required when neither `destPath` nor
   * `baseDir` is provided (the persistent fallback location).
   */
  userDataDir?: string
}

export interface SaveBytesPathResult {
  /** Directory that must exist before writing `filePath`. */
  dir: string
  /** Exact file path the bytes will be written to. */
  filePath: string
}

/**
 * Resolve where `image:saveBytes` should write its bytes.
 *
 * Precedence:
 *  1. `destPath`   - explicit destination, honored exactly.
 *  2. `baseDir`    - project-relative `generated/images` directory
 *                    (file paths are resolved to their containing directory).
 *  3. fallback     - `<userDataDir>/docuflow-generated`.
 *
 * Pure function (no fs/electron access) so it can be unit tested directly.
 */
export function resolveSaveBytesPath(params: SaveBytesPathParams): SaveBytesPathResult {
  const filename =
    params.filename || `docuflow-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.png`

  if (params.destPath) {
    return { dir: dirname(params.destPath), filePath: params.destPath }
  }

  if (params.baseDir) {
    const base = params.baseDirIsFile ? dirname(params.baseDir) : params.baseDir
    const dir = join(base, 'generated', 'images')
    return { dir, filePath: join(dir, filename) }
  }

  if (!params.userDataDir) {
    throw new Error('resolveSaveBytesPath: userDataDir is required when destPath and baseDir are omitted')
  }
  const dir = join(params.userDataDir, 'docuflow-generated')
  return { dir, filePath: join(dir, filename) }
}
