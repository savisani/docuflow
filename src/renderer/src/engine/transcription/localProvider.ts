import { TranscriptionProvider, TranscriptionResult } from './types';

const BASE_URL = (import.meta as any).env?.VITE_TRANSCRIPTION_URL || 'http://127.0.0.1:8765';

export interface ServerHealth {
  status: string;
  cuda_available: boolean;
  gpu_name: string | null;
  model: string;
  device: string;
  provider: string;
}

export interface WhisperModelInfo {
  name: string;
  description: string;
  speed: string;
  accuracy: string;
}

let cachedHealth: ServerHealth | null = null;
let lastHealthCheck = 0;
const HEALTH_CACHE_MS = 5000;

export async function checkServerHealth(): Promise<ServerHealth | null> {
  const now = Date.now();
  if (cachedHealth && now - lastHealthCheck < HEALTH_CACHE_MS) {
    return cachedHealth;
  }

  try {
    const response = await fetch(`${BASE_URL}/health`, {
      signal: AbortSignal.timeout(3000),
    });
    if (!response.ok) return null;
    const health: ServerHealth = await response.json();
    cachedHealth = health;
    lastHealthCheck = now;
    return health;
  } catch {
    cachedHealth = null;
    return null;
  }
}

export async function isServerOnline(): Promise<boolean> {
  const health = await checkServerHealth();
  return health !== null && health.status === 'ok';
}

export function invalidateHealthCache(): void {
  cachedHealth = null;
  lastHealthCheck = 0;
}

export async function getAvailableModels(): Promise<{ models: WhisperModelInfo[]; default: string } | null> {
  try {
    const response = await fetch(`${BASE_URL}/models`, {
      signal: AbortSignal.timeout(3000),
    });
    if (!response.ok) return null;
    return await response.json();
  } catch {
    return null;
  }
}

export class LocalTranscriptionProvider implements TranscriptionProvider {
  name = 'Local GPU (faster-whisper)';
  private _available = false;
  private _health: ServerHealth | null = null;

  isAvailable(): boolean {
    return this._available;
  }

  async checkAvailability(): Promise<boolean> {
    this._health = await checkServerHealth();
    this._available = this._health !== null && this._health.status === 'ok';
    return this._available;
  }

  getHealth(): ServerHealth | null {
    return this._health;
  }

  async transcribe(audio: Blob | File, language?: string, model?: string): Promise<TranscriptionResult> {
    const health = await checkServerHealth();
    if (!health || health.status !== 'ok') {
      return {
        transcript: { language: language || 'auto', text: '', segments: [] },
        status: 'error',
        error: 'Local transcription server is not running. Start it with server/start.bat',
      };
    }

    const formData = new FormData();
    formData.append('file', audio);
    formData.append('language', language || 'auto');
    formData.append('word_timestamps', 'true');
    formData.append('vad_filter', 'true');
    formData.append('model', model || 'base');

    try {
      const response = await fetch(`${BASE_URL}/transcribe`, {
        method: 'POST',
        body: formData,
        signal: AbortSignal.timeout(300000),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => null);
        const detail = errorData?.detail || `Server error ${response.status}`;
        return {
          transcript: { language: language || 'auto', text: '', segments: [] },
          status: 'error',
          error: detail,
        };
      }

      const data = await response.json();

      return {
        transcript: {
          language: data.language || language || 'auto',
          text: data.text || '',
          segments: (data.segments || []).map((s: any) => ({
            id: s.id,
            text: s.text,
            start: s.start,
            end: s.end,
            words: s.words?.map((w: any) => ({
              text: w.text,
              start: w.start,
              end: w.end,
            })),
          })),
        },
        status: 'complete',
      };
    } catch (err) {
      if (err instanceof DOMException && err.name === 'TimeoutError') {
        return {
          transcript: { language: language || 'auto', text: '', segments: [] },
          status: 'error',
          error: 'Transcription timed out. Try a shorter audio file or check GPU memory.',
        };
      }
      const message = err instanceof Error ? err.message : String(err);
      return {
        transcript: { language: language || 'auto', text: '', segments: [] },
        status: 'error',
        error: `Cannot reach transcription server: ${message}`,
      };
    }
  }
}
