import { describe, test, expect } from 'vitest';
import { join } from 'path';
import { resolvePythonExecutable, findOnPath } from './pythonExecutable';

const VENV_PY = join('C:', 'proj', 'scripts', '.venv', 'Scripts', 'python.exe');
const CONFIGURED_PY = join('C:', 'python312', 'python.exe');
const SYSTEM_DIR = join('C:', 'Users', 'dev', 'AppData', 'Local', 'Programs', 'Python', 'Python313');
const SYSTEM_PY = join(SYSTEM_DIR, 'python.exe');
const WINDOWS_DIR = join('C:', 'Windows');
const PY_LAUNCHER = join(WINDOWS_DIR, 'py.exe');

const PATH_ENV = {
  PATH: [WINDOWS_DIR, SYSTEM_DIR].join(';'),
  PATHEXT: '.com;.exe;.bat;.cmd',
};

function fixture(opts: {
  files: string[]
  runnable?: string[]
  env?: Record<string, string | undefined>
}) {
  const files = new Set(opts.files.map((f) => f.toLowerCase()))
  const runnable = new Set((opts.runnable ?? opts.files).map((f) => f.toLowerCase()))
  return {
    fileExists: (p: string) => files.has(p.toLowerCase()),
    isRunnablePython: (exe: string) => runnable.has(exe.toLowerCase()),
    env: opts.env ?? PATH_ENV,
  };
}

describe('resolvePythonExecutable', () => {
  test('explicit valid executable is preferred over everything else', () => {
    const f = fixture({ files: [CONFIGURED_PY, VENV_PY, PY_LAUNCHER, SYSTEM_PY] });
    const result = resolvePythonExecutable({
      configuredPath: CONFIGURED_PY,
      venvPython: VENV_PY,
      fallbackCommands: ['py', 'python'],
      ...f,
    });
    expect(result).toEqual({ ok: true, path: CONFIGURED_PY, source: 'configured' });
  });

  test('nonexistent configured executable is not used blindly', () => {
    const f = fixture({ files: [VENV_PY, PY_LAUNCHER, SYSTEM_PY] });
    const result = resolvePythonExecutable({
      configuredPath: join('C:', 'deleted', 'python.exe'),
      venvPython: VENV_PY,
      fallbackCommands: ['py', 'python'],
      ...f,
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.path).toBe(VENV_PY);
    else expect.fail(result.error);
  });

  test('stale venv redirector is skipped and the py launcher is used', () => {
    // The real bug: scripts/.venv/Scripts/python.exe exists but its base
    // interpreter (Python311) was uninstalled, so it never runs.
    const f = fixture({ files: [VENV_PY, PY_LAUNCHER, SYSTEM_PY], runnable: [PY_LAUNCHER, SYSTEM_PY] });
    const result = resolvePythonExecutable({
      venvPython: VENV_PY,
      fallbackCommands: ['py', 'python'],
      ...f,
    });
    expect(result).toEqual({ ok: true, path: PY_LAUNCHER, source: 'py-launcher' });
  });

  test('python on PATH is used when the py launcher is absent', () => {
    const f = fixture({ files: [SYSTEM_PY], runnable: [SYSTEM_PY] });
    const result = resolvePythonExecutable({
      venvPython: VENV_PY,
      fallbackCommands: ['py', 'python'],
      ...f,
    });
    expect(result).toEqual({ ok: true, path: SYSTEM_PY, source: 'path' });
  });

  test('bare configured command name resolves via PATH', () => {
    const f = fixture({ files: [SYSTEM_PY], runnable: [SYSTEM_PY] });
    const result = resolvePythonExecutable({
      configuredPath: 'python',
      fallbackCommands: ['py', 'python'],
      ...f,
    });
    expect(result).toEqual({ ok: true, path: SYSTEM_PY, source: 'configured' });
  });

  test('no Python anywhere produces a clear error listing attempts', () => {
    const f = fixture({ files: [] });
    const result = resolvePythonExecutable({
      venvPython: VENV_PY,
      fallbackCommands: ['py', 'python'],
      ...f,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain('No runnable Python interpreter found');
      expect(result.error).toContain('DOCUFLOW_PYTHON');
      expect(result.error).toContain(VENV_PY);
      expect(result.attempted).toHaveLength(3); // venv, py, python
    }
  });

  test('Store alias style executables that exist but do not run are rejected', () => {
    const f = fixture({ files: [VENV_PY, PY_LAUNCHER, SYSTEM_PY], runnable: [] });
    const result = resolvePythonExecutable({
      venvPython: VENV_PY,
      fallbackCommands: ['py', 'python'],
      ...f,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.attempted.join('\n')).toContain('(not runnable)');
  });
});

describe('findOnPath', () => {
  test('respects PATHEXT order', () => {
    const f = fixture({ files: [join(SYSTEM_DIR, 'python.com'), SYSTEM_PY] });
    expect(findOnPath('python', PATH_ENV, f.fileExists)).toBe(join(SYSTEM_DIR, 'python.com'));
  });

  test('uses an explicit extension as-is', () => {
    const f = fixture({ files: [PY_LAUNCHER] });
    expect(findOnPath('py.exe', PATH_ENV, f.fileExists)).toBe(PY_LAUNCHER);
  });

  test('returns undefined when the command is not on PATH', () => {
    const f = fixture({ files: [] });
    expect(findOnPath('python', PATH_ENV, f.fileExists)).toBeUndefined();
  });
});
