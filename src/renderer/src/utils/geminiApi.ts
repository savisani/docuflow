/**
 * Gemini API Client — Phase 1
 *
 * Provides:
 *  - Configurable Gemini provider (model, temperature, maxOutputTokens)
 *  - Configurable storage behind an abstraction (swappable later)
 *  - Connection test
 *  - Structured JSON response generation
 *
 * Does NOT:
 *  - Touch Ollama, OpenRouter, Cloudflare FLUX, or transcription
 *  - Auto-send user audio or assets to Gemini
 *  - Implement B-roll analysis
 */

import { configStorage } from './configStorage';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface GeminiProviderConfig {
  apiKey: string;
  model: string;
  temperature: number;
  maxOutputTokens: number;
}

export interface GeminiGenerateResult<T = string> {
  success: boolean;
  data?: T;
  error?: string;
  model?: string;
  responseTimeMs?: number;
  promptFeedback?: string;
}

export interface GeminiConnectionTestResult {
  connected: boolean;
  model: string;
  error?: string;
  responseTimeMs?: number;
}

// ---------------------------------------------------------------------------
// Storage keys
// ---------------------------------------------------------------------------

const STORAGE_KEY = 'docuflow-gemini-config';

const DEFAULT_CONFIG: GeminiProviderConfig = {
  apiKey: '',
  model: 'gemini-2.5-flash',
  temperature: 0.3,
  maxOutputTokens: 8192,
};

// Available Gemini Flash models for the selector
export const GEMINI_MODELS = [
  { id: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash', description: 'Latest, fast, versatile' },
  { id: 'gemini-2.0-flash', label: 'Gemini 2.0 Flash', description: 'Stable, fast' },
  { id: 'gemini-2.0-flash-lite', label: 'Gemini 2.0 Flash Lite', description: 'Lightweight, fastest' },
] as const;

// ---------------------------------------------------------------------------
// Config persistence (behind abstraction — swap storage later)
// ---------------------------------------------------------------------------

export function loadGeminiConfig(): GeminiProviderConfig {
  return configStorage.load<GeminiProviderConfig>(STORAGE_KEY, { ...DEFAULT_CONFIG });
}

export function saveGeminiConfig(config: GeminiProviderConfig): void {
  configStorage.save(STORAGE_KEY, config);
}

/** Mask an API key for safe display: show only last 4 chars. */
export function maskApiKey(key: string): string {
  if (!key) return '';
  if (key.length <= 8) return '••••••••';
  return `••••••••${key.slice(-4)}`;
}

// ---------------------------------------------------------------------------
// Raw Gemini API call
// ---------------------------------------------------------------------------

const GEMINI_BASE = 'https://generativelanguage.googleapis.com/v1beta';

interface GeminiRawRequest {
  contents: Array<{
    role: 'user' | 'model';
    parts: Array<{ text: string }>;
  }>;
  generationConfig: {
    temperature: number;
    maxOutputTokens: number;
    responseMimeType?: string;
  };
  systemInstruction?: {
    parts: Array<{ text: string }>;
  };
}

interface GeminiRawResponse {
  candidates?: Array<{
    content: {
      parts: Array<{ text: string }>;
      role: string;
    };
    finishReason: string;
    safetyRatings?: Array<{ category: string; probability: string }>;
  }>;
  promptFeedback?: {
    blockReason?: string;
    safetyRatings?: Array<{ category: string; probability: string }>;
  };
  usageMetadata?: {
    promptTokenCount: number;
    candidatesTokenCount: number;
    totalTokenCount: number;
  };
}

async function callGeminiRaw(
  config: GeminiProviderConfig,
  prompt: string,
  opts?: { jsonMode?: boolean; systemInstruction?: string },
): Promise<GeminiRawResponse> {
  if (!config.apiKey) throw new Error('Gemini API key not configured');

  const body: GeminiRawRequest = {
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
    generationConfig: {
      temperature: config.temperature,
      maxOutputTokens: config.maxOutputTokens,
    },
  };

  if (opts?.jsonMode) {
    body.generationConfig.responseMimeType = 'application/json';
  }

  if (opts?.systemInstruction) {
    body.systemInstruction = { parts: [{ text: opts.systemInstruction }] };
  }

  const url = `${GEMINI_BASE}/models/${config.model}:generateContent?key=${config.apiKey}`;

  const resp = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(120_000),
  });

  const data = await resp.json() as GeminiRawResponse;

  if (!resp.ok) {
    const msg =
      (data as Record<string, unknown>).error
        ? String((data as Record<string, unknown>).error)
        : `HTTP ${resp.status}`;
    throw new Error(`Gemini API error: ${msg}`);
  }

  if (data.promptFeedback?.blockReason) {
    throw new Error(`Gemini blocked request: ${data.promptFeedback.blockReason}`);
  }

  return data;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Test connection to Gemini API. Makes a minimal request and verifies
 * the API key and model are valid.
 */
export async function testGeminiConnection(
  config: GeminiProviderConfig,
): Promise<GeminiConnectionTestResult> {
  const t0 = Date.now();
  try {
    const data = await callGeminiRaw(config, 'Say "hello" in one word.', {
      systemInstruction: 'You are a helpful assistant. Reply with only a single word.',
    });

    const text = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
    if (!text) {
      return { connected: false, model: config.model, error: 'Empty response from Gemini' };
    }

    return {
      connected: true,
      model: config.model,
      responseTimeMs: Date.now() - t0,
    };
  } catch (err) {
    return {
      connected: false,
      model: config.model,
      error: err instanceof Error ? err.message : 'Unknown error',
      responseTimeMs: Date.now() - t0,
    };
  }
}

/**
 * Send a prompt and get a structured JSON response from Gemini.
 * Parses and validates the JSON before returning.
 */
export async function generateStructuredResponse<T = unknown>(
  config: GeminiProviderConfig,
  prompt: string,
  opts?: { systemInstruction?: string; schemaHint?: string },
): Promise<GeminiGenerateResult<T>> {
  const t0 = Date.now();

  try {
    // Append schema hint to prompt if provided
    let fullPrompt = prompt;
    if (opts?.schemaHint) {
      fullPrompt += `\n\nReturn ONLY valid JSON matching this structure:\n${opts.schemaHint}`;
    }

    const data = await callGeminiRaw(config, fullPrompt, {
      jsonMode: true,
      systemInstruction: opts?.systemInstruction,
    });

    const rawText = data.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
    const finishReason = data.candidates?.[0]?.finishReason;

    if (finishReason === 'SAFETY') {
      return {
        success: false,
        error: 'Response blocked by safety filter',
        model: config.model,
        responseTimeMs: Date.now() - t0,
      };
    }

    if (!rawText) {
      return {
        success: false,
        error: 'Empty response from Gemini',
        model: config.model,
        responseTimeMs: Date.now() - t0,
      };
    }

    // Parse JSON — handle markdown fences
    let cleaned = rawText.trim();
    cleaned = cleaned.replace(/^```(?:json)?\s*\n?/i, '').replace(/\n?```\s*$/i, '');

    let parsed: T;
    try {
      parsed = JSON.parse(cleaned) as T;
    } catch {
      // Try finding first { } or [ ] block
      const jsonStart = cleaned.search(/[\[{]/);
      const jsonEnd = Math.max(cleaned.lastIndexOf('}'), cleaned.lastIndexOf(']'));
      if (jsonStart !== -1 && jsonEnd > jsonStart) {
        parsed = JSON.parse(cleaned.slice(jsonStart, jsonEnd + 1)) as T;
      } else {
        return {
          success: false,
          error: `Failed to parse Gemini response as JSON: ${cleaned.slice(0, 200)}`,
          model: config.model,
          responseTimeMs: Date.now() - t0,
        };
      }
    }

    return {
      success: true,
      data: parsed,
      model: config.model,
      responseTimeMs: Date.now() - t0,
    };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : 'Unknown error',
      model: config.model,
      responseTimeMs: Date.now() - t0,
    };
  }
}

/**
 * Send a plain text prompt to Gemini (no JSON mode).
 * Used for the scene-generation integration later.
 */
export async function generateText(
  config: GeminiProviderConfig,
  prompt: string,
  opts?: { systemInstruction?: string },
): Promise<GeminiGenerateResult<string>> {
  const t0 = Date.now();

  try {
    const data = await callGeminiRaw(config, prompt, {
      jsonMode: false,
      systemInstruction: opts?.systemInstruction,
    });

    const rawText = data.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
    const finishReason = data.candidates?.[0]?.finishReason;

    if (finishReason === 'SAFETY') {
      return {
        success: false,
        error: 'Response blocked by safety filter',
        model: config.model,
        responseTimeMs: Date.now() - t0,
      };
    }

    return {
      success: true,
      data: rawText,
      model: config.model,
      responseTimeMs: Date.now() - t0,
    };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : 'Unknown error',
      model: config.model,
      responseTimeMs: Date.now() - t0,
    };
  }
}
