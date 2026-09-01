/**
 * Model Registry — Unified model discovery for all AI providers.
 *
 * Provides a single interface to list available models from:
 * - Ollama (local)
 * - Google Gemini
 * - OpenRouter
 */

import { AIProvider } from './aiService';

export interface ModelInfo {
  /** Unique model identifier (e.g., 'gemma3:1b', 'gemini-2.5-flash') */
  id: string;
  /** Display name */
  name: string;
  /** Provider this model belongs to */
  provider: AIProvider;
  /** Whether the model supports thinking/reasoning */
  supportsThinking?: boolean;
  /** Context window size if known */
  contextLength?: number;
  /** Whether the model is currently loaded (Ollama only) */
  isLoaded?: boolean;
  /** Model size description (e.g., '1B', '7B') */
  sizeLabel?: string;
}

export interface ModelRegistryProvider {
  /** Provider identifier */
  provider: AIProvider;
  /** Display name */
  label: string;
  /** List available models */
  listModels(): Promise<ModelInfo[]>;
  /** Whether this provider is available/configured */
  isAvailable(): Promise<boolean>;
}

// ---------------------------------------------------------------------------
// Ollama Provider
// ---------------------------------------------------------------------------

async function fetchOllamaModels(): Promise<ModelInfo[]> {
  try {
    const resp = await fetch('http://localhost:11434/api/tags', {
      signal: AbortSignal.timeout(5000),
    });
    if (!resp.ok) return [];
    const data = await resp.json();
    const models = (data.models || []) as Array<{
      name: string;
      size: number;
      parameter_size: string;
    }>;

    // Also check which model is currently loaded
    let loadedModel = '';
    try {
      const psResp = await fetch('http://localhost:11434/api/ps', {
        signal: AbortSignal.timeout(3000),
      });
      if (psResp.ok) {
        const psData = await psResp.json();
        if (psData.models?.length > 0) {
          loadedModel = psData.models[0].name;
        }
      }
    } catch {}

    return models.map((m) => ({
      id: m.name,
      name: m.name,
      provider: 'ollama' as AIProvider,
      supportsThinking: modelSupportsThinking(m.name),
      isLoaded: m.name === loadedModel,
      sizeLabel: m.parameter_size || formatModelSize(m.size),
    }));
  } catch {
    return [];
  }
}

function modelSupportsThinking(name: string): boolean {
  return /^(qwen3|deepseek-r1|deepseek\/deepseek-r1|qwq|o1|o3)/i.test(name);
}

function formatModelSize(bytes: number): string {
  const gb = bytes / (1024 * 1024 * 1024);
  if (gb >= 1) return `${gb.toFixed(1)}GB`;
  const mb = bytes / (1024 * 1024);
  return `${Math.round(mb)}MB`;
}

async function isOllamaAvailable(): Promise<boolean> {
  try {
    const resp = await fetch('http://localhost:11434/api/tags', {
      signal: AbortSignal.timeout(3000),
    });
    return resp.ok;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Google Gemini Provider
// ---------------------------------------------------------------------------

// Known Gemini models — Google doesn't expose a public model listing API
// for the Generative Language API, so we list the commonly available ones.
const GEMINI_KNOWN_MODELS: ModelInfo[] = [
  { id: 'gemini-2.5-flash', name: 'Gemini 2.5 Flash', provider: 'gemini', supportsThinking: true, contextLength: 1048576 },
  { id: 'gemini-2.0-flash', name: 'Gemini 2.0 Flash', provider: 'gemini', supportsThinking: false, contextLength: 1048576 },
  { id: 'gemini-2.0-flash-lite', name: 'Gemini 2.0 Flash Lite', provider: 'gemini', supportsThinking: false, contextLength: 1048576 },
  { id: 'gemini-1.5-flash', name: 'Gemini 1.5 Flash', provider: 'gemini', supportsThinking: false, contextLength: 1048576 },
  { id: 'gemini-1.5-pro', name: 'Gemini 1.5 Pro', provider: 'gemini', supportsThinking: false, contextLength: 2097152 },
];

async function fetchGeminiModels(): Promise<ModelInfo[]> {
  // Google's Generative Language API doesn't have a public model listing endpoint
  // Return known models filtered by what's typically available
  return GEMINI_KNOWN_MODELS;
}

async function isGeminiAvailable(): Promise<boolean> {
  // Check if a Gemini API key is configured
  try {
    const stored = localStorage.getItem('docuflow-gemini-config');
    if (stored) {
      const config = JSON.parse(stored);
      return !!config.apiKey;
    }
  } catch {}
  return false;
}

// ---------------------------------------------------------------------------
// OpenRouter Provider
// ---------------------------------------------------------------------------

interface OpenRouterModel {
  id: string;
  name: string;
  context_length: number;
  architecture?: {
    modality?: string;
  };
}

async function fetchOpenRouterModels(): Promise<ModelInfo[]> {
  try {
    // OpenRouter has a public model listing endpoint
    const resp = await fetch('https://openrouter.ai/api/v1/models', {
      signal: AbortSignal.timeout(10000),
    });
    if (!resp.ok) return getOpenRouterFallbackModels();
    const data = await resp.json();
    const models = (data.data || []) as OpenRouterModel[];

    // Filter to text-only models (not vision/image models)
    return models
      .filter((m) => {
        const modality = m.architecture?.modality || '';
        return modality.includes('text') || modality === '';
      })
      .slice(0, 50) // Limit to 50 models to avoid overwhelming the UI
      .map((m) => ({
        id: m.id,
        name: m.name || m.id,
        provider: 'openrouter' as AIProvider,
        contextLength: m.context_length,
      }));
  } catch {
    return getOpenRouterFallbackModels();
  }
}

function getOpenRouterFallbackModels(): ModelInfo[] {
  return [
    { id: 'openrouter/free', name: 'OpenRouter Free', provider: 'openrouter' },
    { id: 'meta-llama/llama-3.2-3b-instruct:free', name: 'Llama 3.2 3B', provider: 'openrouter' },
    { id: 'google/gemma-2-9b-it:free', name: 'Gemma 2 9B', provider: 'openrouter' },
    { id: 'mistralai/mistral-7b-instruct:free', name: 'Mistral 7B', provider: 'openrouter' },
  ];
}

async function isOpenRouterAvailable(): Promise<boolean> {
  try {
    const stored = localStorage.getItem('docuflow-openrouter-config');
    if (stored) {
      const config = JSON.parse(stored);
      return !!config.apiKey;
    }
  } catch {}
  return false;
}

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

const providers: ModelRegistryProvider[] = [
  {
    provider: 'ollama',
    label: 'Local (Ollama)',
    listModels: fetchOllamaModels,
    isAvailable: isOllamaAvailable,
  },
  {
    provider: 'gemini',
    label: 'Google Gemini',
    listModels: fetchGeminiModels,
    isAvailable: isGeminiAvailable,
  },
  {
    provider: 'openrouter',
    label: 'OpenRouter',
    listModels: fetchOpenRouterModels,
    isAvailable: isOpenRouterAvailable,
  },
];

/** Get all registered providers */
export function getProviders(): ModelRegistryProvider[] {
  return providers;
}

/** Get a specific provider */
export function getProvider(provider: AIProvider): ModelRegistryProvider | undefined {
  return providers.find((p) => p.provider === provider);
}

/** List models for a specific provider */
export async function listModelsForProvider(provider: AIProvider): Promise<ModelInfo[]> {
  const p = getProvider(provider);
  if (!p) return [];
  return p.listModels();
}

/** Check which providers are available */
export async function checkProviderAvailability(): Promise<Record<AIProvider, boolean>> {
  const results: Record<string, boolean> = {};
  await Promise.allSettled(
    providers.map(async (p) => {
      results[p.provider] = await p.isAvailable();
    })
  );
  return results as Record<AIProvider, boolean>;
}

/** Refresh models for a provider (with simple caching) */
const modelCache = new Map<AIProvider, { models: ModelInfo[]; timestamp: number }>();
const CACHE_TTL = 30_000; // 30 seconds

export async function refreshModels(provider: AIProvider, force = false): Promise<ModelInfo[]> {
  const cached = modelCache.get(provider);
  if (!force && cached && Date.now() - cached.timestamp < CACHE_TTL) {
    return cached.models;
  }

  const models = await listModelsForProvider(provider);
  modelCache.set(provider, { models, timestamp: Date.now() });
  return models;
}
