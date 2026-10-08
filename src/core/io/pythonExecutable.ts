import { join } from 'path'

export type PythonSource = 'configured' | 'venv' | 'py-launcher' | 'path'

export type PythonResolution =
  | { ok: true; path: string; source: PythonSource }
  | { ok: false; error: string; attempted: string[] }

export interface PythonExecutableOptions {
  /**
   * Explicit interpreter from project/user configuration (e.g. the
   * DOCUFLOW_PYTHON environment variable). Used first when it points at a
   * runnable interpreter; never used blindly.
   */
  configuredPath?: string
  /** Project-configured interpreter (the scripts/.venv python). */
  venvPython?: string
  /** PATH command names to try as fallbacks, in order (e.g. ['py', 'python']). */
  fallbackCommands?: string[]
  /** fs.existsSync (injected for tests). */
  fileExists: (p: string) => boolean
  /**
   * Verify the executable actually runs and identifies as Python.
   * Catches stale venv redirectors whose base interpreter was uninstalled
   * and Windows Store aliases that exist but do not run.
   */
  isRunnablePython: (exe: string) => boolean
  /** Environment used for PATH/PATHEXT lookup (defaults to process.env). */
  env?: Record<string, string | undefined>
}

/** Resolve a command name (e.g. 'py') to an absolute file using PATH and PATHEXT. */
export function findOnPath(
  command: string,
  env: Record<string, string | undefined>,
  fileExists: (p: string) => boolean,
): string | undefined {
  const pathValue = env.PATH || env.Path || env.path || ''
  const pathext = env.PATHEXT || env.pathtext || '.COM;.EXE;.BAT;.CMD'
  const extensions = pathext.split(';').filter(Boolean)
  const hasExtension = /\.[a-z0-9]+$/i.test(command)

  for (const dir of pathValue.split(';').filter(Boolean)) {
    if (hasExtension) {
      const full = join(dir, command)
      if (fileExists(full)) return full
    } else {
      for (const ext of extensions) {
        const full = join(dir, `${command}${ext}`)
        if (fileExists(full)) return full
      }
    }
  }
  return undefined
}

/**
 * Resolve a Python interpreter that actually works, in priority order:
 *
 *   1. explicitly configured executable (DOCUFLOW_PYTHON)
 *   2. the project-configured interpreter (scripts/.venv)
 *   3. the Windows `py` launcher on PATH
 *   4. `python` on PATH
 *
 * Every candidate must pass `isRunnablePython`, so a stale venv redirector
 * ("No Python at ...") or a Store alias is skipped instead of launched.
 * Returns a clear error listing every attempted candidate when nothing runs.
 */
export function resolvePythonExecutable(options: PythonExecutableOptions): PythonResolution {
  const env = options.env ?? process.env
  const attempted: string[] = []
  const { fileExists, isRunnablePython } = options

  const tryCandidate = (raw: string | undefined, source: PythonSource): string | undefined => {
    if (!raw) return undefined

    // Absolute/relative file path first; bare command names resolve via PATH.
    let candidate: string | undefined
    if (fileExists(raw)) {
      candidate = raw
    } else if (!/[\\/]/.test(raw)) {
      candidate = findOnPath(raw, env, fileExists)
    }

    if (!candidate) {
      attempted.push(`${raw} (not found)`)
      return undefined
    }
    if (!isRunnablePython(candidate)) {
      attempted.push(`${candidate} (not runnable)`)
      return undefined
    }
    return candidate
  }

  const configured = tryCandidate(options.configuredPath, 'configured')
  if (configured) return { ok: true, path: configured, source: 'configured' }

  const venv = tryCandidate(options.venvPython, 'venv')
  if (venv) return { ok: true, path: venv, source: 'venv' }

  for (const command of options.fallbackCommands ?? []) {
    const resolved = tryCandidate(command, command === 'py' ? 'py-launcher' : 'path')
    if (resolved) return { ok: true, path: resolved, source: command === 'py' ? 'py-launcher' : 'path' }
  }

  const detail = attempted.length > 0 ? ` Tried: ${attempted.join(', ')}.` : ''
  return {
    ok: false,
    error:
      `No runnable Python interpreter found.${detail} ` +
      'Set the DOCUFLOW_PYTHON environment variable to a valid Python executable.',
    attempted,
  }
}
