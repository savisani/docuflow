// ---------------------------------------------------------------------------
// AI Scene Breakdown Service — Ollama (local) + OpenRouter (cloud) + Gemini (cloud)
// ---------------------------------------------------------------------------

export type AIProvider = 'ollama' | 'openrouter' | 'gemini';

export interface AISceneRequest {
  transcriptionSegments: Array<{ start: number; end: number; text: string }>;
  fullScript?: string;
  provider: AIProvider;
  model?: string;
  openRouterApiKey?: string;
  geminiApiKey?: string;
  geminiModel?: string;
  geminiTemperature?: number;
  geminiMaxOutputTokens?: number;
}

export interface SceneItem {
  sceneId: number;
  startTime: number;
  endTime: number;
  transcriptChunk: string;
  visualDescription: string;
  imagePrompt: string;
  cameraMotion: 'zoom_in' | 'zoom_out' | 'pan_left' | 'pan_right' | 'static';
}

interface AISceneResponse {
  scenes: SceneItem[];
}

// ---------------------------------------------------------------------------
// System prompt
// ---------------------------------------------------------------------------

const SYSTEM_PROMPT = `You are an expert video director and storyboard artist.

Given audio timestamped transcript segments, group them into coherent visual scenes (3-6 seconds each). For each scene:
1. Combine adjacent segments that form a single visual idea.
2. Write a highly descriptive visual prompt for FLUX / Stable Diffusion image generation (cinematic, detailed, lighting, composition, mood).
3. Select a camera motion that matches the pacing.

Output STRICTLY valid JSON matching this exact schema — no markdown fences, no prose, no explanation:

{
  "scenes": [
    {
      "sceneId": 1,
      "startTime": 0.0,
      "endTime": 4.2,
      "transcriptChunk": "...",
      "visualDescription": "...",
      "imagePrompt": "...",
      "cameraMotion": "zoom_in"
    }
  ]
}

cameraMotion MUST be one of: zoom_in, zoom_out, pan_left, pan_right, static.`;

// ---------------------------------------------------------------------------
// JSON extraction / cleanup
// ---------------------------------------------------------------------------

function extractJSON(raw: string): AISceneResponse {
  let cleaned = raw.trim();

  // Strip markdown code fences
  cleaned = cleaned.replace(/^```(?:json)?\s*\n?/i, '').replace(/\n?```\s*$/i, '');

  // Try direct parse first
  try {
    const parsed = JSON.parse(cleaned);
    if (parsed && Array.isArray(parsed.scenes)) return parsed as AISceneResponse;
  } catch { /* continue */ }

  // Find the first { ... } block that contains "scenes"
  const jsonStart = cleaned.indexOf('{');
  const jsonEnd = cleaned.lastIndexOf('}');
  if (jsonStart !== -1 && jsonEnd > jsonStart) {
    const slice = cleaned.slice(jsonStart, jsonEnd + 1);
    try {
      const parsed = JSON.parse(slice);
      if (parsed && Array.isArray(parsed.scenes)) return parsed as AISceneResponse;
    } catch { /* continue */ }
  }

  // Last resort: find the first [ ... ] array
  const arrStart = cleaned.indexOf('[');
  const arrEnd = cleaned.lastIndexOf(']');
  if (arrStart !== -1 && arrEnd > arrStart) {
    const slice = cleaned.slice(arrStart, arrEnd + 1);
    try {
      const parsed = JSON.parse(slice);
      if (Array.isArray(parsed)) return { scenes: parsed as SceneItem[] };
    } catch { /* continue */ }
  }

  throw new Error('Could not extract valid JSON from AI response');
}

// ---------------------------------------------------------------------------
// Ollama model listing
// ---------------------------------------------------------------------------

export interface OllamaModel {
  name: string;
  size: number;
  parameter_size: string;
  modified_at: string;
}

export async function fetchOllamaModels(): Promise<OllamaModel[]> {
  try {
    const resp = await fetch('http://localhost:11434/api/tags', {
      signal: AbortSignal.timeout(5000),
    });
    if (!resp.ok) return [];
    const data = await resp.json();
    return (data.models || []) as OllamaModel[];
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------
// Provider: Ollama — streaming with thinking-tag extraction
// ---------------------------------------------------------------------------

export interface OllamaPsModel {
  name: string;
  size: number;
  size_vram: number;
  digest: string;
  expires_at: string;
}

export interface OllamaPsResponse {
  models: OllamaPsModel[];
}

export async function fetchOllamaPs(): Promise<OllamaPsResponse> {
  try {
    const resp = await fetch('http://localhost:11434/api/ps', {
      signal: AbortSignal.timeout(3000),
    });
    if (!resp.ok) return { models: [] };
    const data = await resp.json();
    return (data as OllamaPsResponse) || { models: [] };
  } catch {
    return { models: [] };
  }
}

// ---------------------------------------------------------------------------
// GPU Detection — queries nvidia-smi via main process
// ---------------------------------------------------------------------------

export interface GpuInfo {
  name: string;
  totalVram: number;
  usedVram: number;
  freeVram: number;
  driverVersion: string;
  temperature: number;
  utilization: number;
}

let cachedGpuInfo: GpuInfo | null = null;

export async function detectGpu(): Promise<GpuInfo | null> {
  if (cachedGpuInfo) return cachedGpuInfo;
  try {
    const resp = await fetch('http://localhost:11434/api/tags', { signal: AbortSignal.timeout(2000) });
    if (!resp.ok) return null;
    // Ollama doesn't expose GPU directly — use a best-effort approach via /api/ps
    const ps = await fetchOllamaPs();
    if (ps.models.length > 0) {
      const m = ps.models[0];
      cachedGpuInfo = {
        name: 'GPU (via Ollama)',
        totalVram: m.size_vram || 0,
        usedVram: m.size_vram || 0,
        freeVram: 0,
        driverVersion: '',
        temperature: 0,
        utilization: 0,
      };
      return cachedGpuInfo;
    }
    return null;
  } catch {
    return null;
  }
}

export function clearGpuCache(): void {
  cachedGpuInfo = null;
}

// ---------------------------------------------------------------------------
// Model Offload — unload model from VRAM
// ---------------------------------------------------------------------------

export async function offloadModel(modelName: string): Promise<{ success: boolean; error?: string }> {
  try {
    const resp = await fetch('http://localhost:11434/api/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: modelName,
        keep_alive: 0,
        prompt: '',
      }),
      signal: AbortSignal.timeout(10000),
    });
    if (!resp.ok) {
      const text = await resp.text().catch(() => '');
      return { success: false, error: `Ollama error ${resp.status}: ${text.slice(0, 200)}` };
    }
    clearGpuCache();
    return { success: true };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export interface StreamingCallbacks {
  onToken?: (token: string, fullText: string) => void;
  onThinkingChunk?: (chunk: string) => void;
  onThinkingComplete?: (fullThinking: string) => void;
  onProgress?: (elapsed: number) => void;
  onModelLoading?: (loading: boolean) => void;
  onModelLoaded?: () => void;
}

function extractThinkingTags(text: string): { thinking: string; response: string } {
  const thinkingMatch = text.match(/<think>([\s\S]*?)<\/think>/);
  const thinking = thinkingMatch ? thinkingMatch[1].trim() : '';
  const response = text.replace(/<think>[\s\S]*?<\/think>/g, '').trim();
  return { thinking, response };
}

async function callOllamaStreaming(
  prompt: string,
  model = 'llama3.2',
  callbacks?: StreamingCallbacks,
): Promise<string> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 300_000);

  const body = {
    model,
    prompt,
    stream: true,
    keep_alive: '15m',
    options: {
      temperature: 0.3,
      num_predict: 4096,
      num_ctx: 2048,
    },
  };

  try {
    callbacks?.onModelLoading?.(true);

    const resp = await fetch('http://localhost:11434/api/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    if (!resp.ok) {
      callbacks?.onModelLoading?.(false);
      const text = await resp.text().catch(() => '');
      throw new Error(`Ollama error ${resp.status}: ${text.slice(0, 300)}`);
    }

    const reader = resp.body?.getReader();
    if (!reader) throw new Error('No response stream available');

    const decoder = new TextDecoder();
    let buffer = '';
    let fullResponse = '';
    let firstTokenReceived = false;

    const startTime = Date.now();
    const progressInterval = setInterval(() => {
      callbacks?.onProgress?.(Date.now() - startTime);
    }, 1000);

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed) continue;
          try {
            const chunk = JSON.parse(trimmed);
            if (chunk.response) {
              if (!firstTokenReceived) {
                firstTokenReceived = true;
                callbacks?.onModelLoading?.(false);
                callbacks?.onModelLoaded?.();
              }
              fullResponse += chunk.response;
              callbacks?.onToken?.(chunk.response, fullResponse);
              callbacks?.onThinkingChunk?.(chunk.response);
            }
          } catch {
            // skip malformed lines
          }
        }
      }
    } finally {
      clearInterval(progressInterval);
      reader.releaseLock();
    }

    // Final parse: extract thinking tags vs response
    const { thinking, response } = extractThinkingTags(fullResponse);
    if (thinking) {
      callbacks?.onThinkingComplete?.(thinking);
    }

    callbacks?.onModelLoading?.(false);
    return response || fullResponse;
  } finally {
    clearTimeout(timeoutId);
    callbacks?.onModelLoading?.(false);
  }
}

// ---------------------------------------------------------------------------
// Provider: OpenRouter
// ---------------------------------------------------------------------------

async function callOpenRouter(
  prompt: string,
  apiKey: string,
  model = 'openrouter/free',
): Promise<string> {
  const resp = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: prompt },
      ],
      temperature: 0.3,
      max_tokens: 4096,
      response_format: { type: 'json_object' },
    }),
    signal: AbortSignal.timeout(120_000),
  });

  if (!resp.ok) {
    const text = await resp.text().catch(() => '');
    throw new Error(`OpenRouter error ${resp.status}: ${text.slice(0, 300)}`);
  }

  const data = await resp.json();
  return data.choices?.[0]?.message?.content ?? '';
}

// ---------------------------------------------------------------------------
// Provider: Gemini
// ---------------------------------------------------------------------------

const GEMINI_API_BASE = 'https://generativelanguage.googleapis.com/v1beta';

interface GeminiRawResponse {
  candidates?: Array<{
    content: {
      parts: Array<{ text: string }>;
      role: string;
    };
    finishReason: string;
  }>;
  promptFeedback?: {
    blockReason?: string;
  };
}

async function callGemini(
  prompt: string,
  apiKey: string,
  model = 'gemini-2.5-flash',
  temperature = 0.3,
  maxOutputTokens = 8192,
): Promise<string> {
  const body = {
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
    generationConfig: {
      temperature,
      maxOutputTokens,
      responseMimeType: 'application/json',
    },
  };

  const url = `${GEMINI_API_BASE}/models/${model}:generateContent?key=${apiKey}`;

  const resp = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(120_000),
  });

  const data = await resp.json() as GeminiRawResponse;

  if (!resp.ok) {
    const msg = (data as Record<string, unknown>).error
      ? String((data as Record<string, unknown>).error)
      : `HTTP ${resp.status}`;
    throw new Error(`Gemini error ${resp.status}: ${msg}`);
  }

  if (data.promptFeedback?.blockReason) {
    throw new Error(`Gemini blocked request: ${data.promptFeedback.blockReason}`);
  }

  const text = data.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
  if (!text) {
    throw new Error('Gemini returned empty response');
  }

  return text;
}

// ---------------------------------------------------------------------------
// Build user prompt from segments
// ---------------------------------------------------------------------------

function buildUserPrompt(req: AISceneRequest): string {
  const lines = req.transcriptionSegments.map(
    (s) => `[${s.start.toFixed(2)}s - ${s.end.toFixed(2)}s] ${s.text}`,
  );

  let prompt = `Timestamped Transcript:\n${lines.join('\n')}`;
  if (req.fullScript?.trim()) {
    prompt = `Full Script:\n${req.fullScript.trim()}\n\n${prompt}`;
  }
  return prompt;
}

// ---------------------------------------------------------------------------
// Interactive Chat — streaming single-turn chat with a loaded Ollama model
// ---------------------------------------------------------------------------

export async function chatWithModel(
  message: string,
  model = 'llama3.2',
  callbacks?: StreamingCallbacks,
): Promise<string> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 300_000);

  const body = {
    model,
    prompt: message,
    stream: true,
    keep_alive: '15m',
    options: {
      temperature: 0.7,
      num_predict: 2048,
      num_ctx: 2048,
    },
  };

  try {
    callbacks?.onModelLoading?.(true);

    const resp = await fetch('http://localhost:11434/api/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    if (!resp.ok) {
      callbacks?.onModelLoading?.(false);
      const text = await resp.text().catch(() => '');
      throw new Error(`Ollama error ${resp.status}: ${text.slice(0, 300)}`);
    }

    const reader = resp.body?.getReader();
    if (!reader) throw new Error('No response stream available');

    const decoder = new TextDecoder();
    let buffer = '';
    let fullResponse = '';
    let firstTokenReceived = false;

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed) continue;
          try {
            const chunk = JSON.parse(trimmed);
            if (chunk.response) {
              if (!firstTokenReceived) {
                firstTokenReceived = true;
                callbacks?.onModelLoading?.(false);
                callbacks?.onModelLoaded?.();
              }
              fullResponse += chunk.response;
              callbacks?.onToken?.(chunk.response, fullResponse);
            }
          } catch {
            // skip malformed lines
          }
        }
      }
    } finally {
      reader.releaseLock();
    }

    callbacks?.onModelLoading?.(false);
    return fullResponse;
  } finally {
    clearTimeout(timeoutId);
    callbacks?.onModelLoading?.(false);
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export async function generateScenes(req: AISceneRequest): Promise<SceneItem[]> {
  const userPrompt = buildUserPrompt(req);
  const fullPrompt = `${SYSTEM_PROMPT}\n\n---\n\n${userPrompt}`;

  let raw: string;

  if (req.provider === 'ollama') {
    raw = await callOllamaStreaming(fullPrompt, req.model || 'llama3.2');
  } else if (req.provider === 'gemini') {
    if (!req.geminiApiKey) {
      throw new Error('Gemini API key is required');
    }
    raw = await callGemini(
      userPrompt,
      req.geminiApiKey,
      req.geminiModel || 'gemini-2.5-flash',
      req.geminiTemperature ?? 0.3,
      req.geminiMaxOutputTokens ?? 8192,
    );
  } else {
    if (!req.openRouterApiKey) {
      throw new Error('OpenRouter API key is required');
    }
    raw = await callOpenRouter(userPrompt, req.openRouterApiKey, req.model || 'openrouter/free');
  }

  const parsed = extractJSON(raw);

  // Validate & normalise
  return parsed.scenes.map((s, i) => ({
    sceneId: s.sceneId ?? i + 1,
    startTime: Number(s.startTime) || 0,
    endTime: Number(s.endTime) || 0,
    transcriptChunk: s.transcriptChunk || '',
    visualDescription: s.visualDescription || '',
    imagePrompt: s.imagePrompt || s.visualDescription || '',
    cameraMotion: ['zoom_in', 'zoom_out', 'pan_left', 'pan_right', 'static'].includes(s.cameraMotion)
      ? s.cameraMotion
      : 'static',
  }));
}

// ---------------------------------------------------------------------------
// Streaming variant — used by the Thinking Inspector
// ---------------------------------------------------------------------------

export async function generateScenesStream(
  req: AISceneRequest,
  callbacks?: StreamingCallbacks,
): Promise<SceneItem[]> {
  const userPrompt = buildUserPrompt(req);
  const fullPrompt = `${SYSTEM_PROMPT}\n\n---\n\n${userPrompt}`;

  let raw: string;

  if (req.provider === 'ollama') {
    raw = await callOllamaStreaming(fullPrompt, req.model || 'llama3.2', callbacks);
  } else if (req.provider === 'gemini') {
    if (!req.geminiApiKey) {
      throw new Error('Gemini API key is required');
    }
    callbacks?.onProgress?.(0);
    raw = await callGemini(
      userPrompt,
      req.geminiApiKey,
      req.geminiModel || 'gemini-2.5-flash',
      req.geminiTemperature ?? 0.3,
      req.geminiMaxOutputTokens ?? 8192,
    );
  } else {
    if (!req.openRouterApiKey) {
      throw new Error('OpenRouter API key is required');
    }
    callbacks?.onProgress?.(0);
    raw = await callOpenRouter(userPrompt, req.openRouterApiKey, req.model || 'openrouter/free');
  }

  const parsed = extractJSON(raw);

  return parsed.scenes.map((s, i) => ({
    sceneId: s.sceneId ?? i + 1,
    startTime: Number(s.startTime) || 0,
    endTime: Number(s.endTime) || 0,
    transcriptChunk: s.transcriptChunk || '',
    visualDescription: s.visualDescription || '',
    imagePrompt: s.imagePrompt || s.visualDescription || '',
    cameraMotion: ['zoom_in', 'zoom_out', 'pan_left', 'pan_right', 'static'].includes(s.cameraMotion)
      ? s.cameraMotion
      : 'static',
  }));
}
