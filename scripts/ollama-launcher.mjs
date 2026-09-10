/**
 * Ollama Dev Launcher
 *
 * Ensures Ollama is running before starting the DocuFlow development server.
 * - Checks if Ollama is already reachable on its default API endpoint
 * - If not running, spawns `ollama serve` and polls until available
 * - Then runs the original dev command (electron-vite dev)
 * - Handles cleanup: only kills Ollama if WE spawned it
 */

import { spawn, exec } from 'child_process';
import http from 'http';
import { promisify } from 'util';

const execAsync = promisify(exec);

const OLLAMA_HOST = process.env.OLLAMA_HOST || '127.0.0.1';
const OLLAMA_PORT = parseInt(process.env.OLLAMA_PORT || '11434', 10);
const OLLAMA_API_URL = `http://${OLLAMA_HOST}:${OLLAMA_PORT}`;
const POLL_INTERVAL_MS = 500;
const MAX_WAIT_MS = 30_000;

/**
 * Check if Ollama API is reachable.
 */
export async function isOllamaRunning(): Promise<boolean> {
  return new Promise((resolve) => {
    const req = http.get(`${OLLAMA_API_URL}/api/tags`, { timeout: 2000 }, (res) => {
      res.resume();
      resolve(res.statusCode === 200);
    });
    req.on('error', () => resolve(false));
    req.on('timeout', () => {
      req.destroy();
      resolve(false);
    });
  });
}

/**
 * Wait for Ollama API to become reachable.
 */
export async function waitForOllama(timeoutMs: number = MAX_WAIT_MS): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await isOllamaRunning()) return true;
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
  }
  return false;
}

/**
 * Try to find the ollama executable path.
 * On Windows, it's typically in PATH or in standard install locations.
 */
async function findOllamaPath(): Promise<string> {
  // Try common Windows install locations
  const commonPaths = [
    'ollama',
    `${process.env.LOCALAPPDATA}\\Programs\\Ollama\\ollama.exe`,
    `${process.env.PROGRAMFILES}\\Ollama\\ollama.exe`,
    `${process.env.PROGRAMFILES}\\Ollama\\ollama.exe`,
  ];

  for (const p of commonPaths) {
    try {
      await execAsync(`where "${p}"`);
      return p;
    } catch {
      // not found, try next
    }
  }

  // Fallback: assume it's in PATH
  return 'ollama';
}

/**
 * Spawn Ollama serve process.
 * Returns the child process and whether we spawned it ourselves.
 */
export async function ensureOllamaRunning(): Promise<{
  spawned: boolean;
  process: ReturnType<typeof spawn> | null;
}> {
  // Already running?
  if (await isOllamaRunning()) {
    return { spawned: false, process: null };
  }

  console.log('[ollama-launcher] Ollama not detected. Starting ollama serve...');

  const ollamaPath = await findOllamaPath();
  const child = spawn(ollamaPath, ['serve'], {
    detached: false,
    stdio: 'ignore',
    windowsHide: false,
  });

  child.on('error', (err) => {
    console.error(`[ollama-launcher] Failed to start ollama: ${err.message}`);
    process.exit(1);
  });

  child.on('exit', (code) => {
    if (code !== null && code !== 0) {
      console.error(`[ollama-launcher] ollama serve exited with code ${code}`);
    }
  });

  // Wait for it to become available
  const ready = await waitForOllama();
  if (!ready) {
    console.error('[ollama-launcher] ERROR: Ollama did not become available within 30 seconds.');
    console.error('[ollama-launcher] Please ensure Ollama is installed and try again.');
    console.error('[ollama-launcher] Install from: https://ollama.com/download');
    process.exit(1);
  }

  console.log('[ollama-launcher] Ollama is ready.');
  return { spawned: true, process: child };
}

/**
 * Main entry point.
 * 1. Ensure Ollama is running
 * 2. Spawn the dev command
 * 3. Forward exit signals
 */
async function main(): Promise<void> {
  const ollama = await ensureOllamaRunning();

  // Run the dev command (electron-vite dev)
  const devArgs = process.argv.slice(2);
  const devCommand = devArgs.length > 0 ? devArgs : ['electron-vite', 'dev'];

  console.log(`[ollama-launcher] Starting: ${devCommand.join(' ')}`);

  const devProcess = spawn(devCommand[0], devCommand.slice(1), {
    stdio: 'inherit',
    shell: true,
  });

  // Clean up on exit
  function cleanup() {
    if (devProcess.exitCode === null) {
      devProcess.kill();
    }
    // Only kill ollama if WE spawned it
    if (ollama.spawned && ollama.process && ollama.process.exitCode === null) {
      console.log('[ollama-launcher] Shutting down ollama serve...');
      ollama.process.kill();
    }
  }

  process.on('SIGINT', cleanup);
  process.on('SIGTERM', cleanup);

  devProcess.on('exit', (code) => {
    cleanup();
    process.exit(code ?? 0);
  });
}

main();
