// ---------------------------------------------------------------------------
// AI Scene Breakdown Service — Ollama (local) + OpenRouter (cloud) + Gemini (cloud)
// ---------------------------------------------------------------------------

import {
  compileSceneIntents,
  parseSceneIntents,
  buildFASTPrompt,
  type SceneIntent,
  type PromptSegment,
} from '../engine/sceneDSL/intentCompiler';

export type AIProvider = 'ollama' | 'openrouter' | 'gemini';

export interface AISceneRequest {
  transcriptionSegments: Array<{ start: number; end: number; text: string; originalText?: string; originalLanguage?: string }>;
  fullScript?: string;
  provider: AIProvider;
  model?: string;
  openRouterApiKey?: string;
  geminiApiKey?: string;
  geminiModel?: string;
  geminiTemperature?: number;
  geminiMaxOutputTokens?: number;
  audioDuration?: number;
}

export interface SceneItem {
  sceneId: number;
  startTime: number;
  endTime: number;
  transcriptChunk: string;
  visualDescription: string;
  imagePrompt: string;
  cameraMotion: 'zoom_in' | 'zoom_out' | 'pan_left' | 'pan_right' | 'static';
  reasoning?: string;
}

// ---------------------------------------------------------------------------
// Scene DSL system prompt — AI produces simple key-value blocks, NOT JSON
// ---------------------------------------------------------------------------

const SCENE_DSL_SYSTEM_PROMPT = `You are an expert video director and storyboard artist.

Given audio timestamped transcript segments, group them into logical visual scenes. Focus on WHAT to show visually — the system handles timing automatically.

OUTPUT FORMAT: For each scene, output a simple key-value block. Separate scenes with a blank line followed by --- followed by a blank line.

Each scene MUST include:
- text: The transcript text for this scene
- visual: A highly descriptive visual prompt for image generation (cinematic, detailed, lighting, composition, mood)
- motion: Camera motion (must be exactly one of: none, slow_zoom, medium_zoom, fast_zoom, slow_zoom_out, medium_zoom_out, fast_zoom_out, slow_pan_left, slow_pan_right, slow_pan_up, slow_pan_down, medium_pan_left, medium_pan_right, fast_pan_left, fast_pan_right, dolly_in, dolly_out, orbit_left, orbit_right, tilt_up, tilt_down, crane_up, crane_down, handheld, parallax)
- transition: How this scene transitions to the next (must be exactly one of: cut, crossfade, slide_left, slide_right, slide_up, slide_down, wipe_left, wipe_right, wipe_up, wipe_down, zoom_in, zoom_out, dissolve, fade)
- style: Visual style (must be exactly one of: natural, cinematic, documentary, vintage, dramatic, minimal, none)

Optional fields:
- layers: Comma-separated additional visual elements
- extras: Comma-separated additional notes
- reasoning: Why you chose this visual and motion

DO NOT calculate durations or timings — the system uses transcript timestamps for that.
DO NOT include a duration field — timing is handled automatically.

EXAMPLE OUTPUT:
text: The ancient temple stood atop the misty mountain peak
visual: Ancient stone temple with intricate carvings, morning mist swirling around weathered columns, golden sunlight filtering through carved windows, dramatic mountain landscape in background, cinematic composition with temple centered, volumetric lighting
motion: slow_zoom
transition: crossfade
style: cinematic
reasoning: Slow zoom builds reverence and scale for the temple introduction

---

text: Monks in orange robes walked silently through the corridors
visual: Buddhist monks in flowing orange robes walking through stone corridor, soft morning light streaming through archways, incense smoke drifting through air, warm earth tones, documentary style composition with leading lines from corridor perspective
motion: slow_pan_right
transition: cut
style: documentary
reasoning: Pan right follows the monks' movement through the space

IMPORTANT RULES:
1. Use EXACTLY the values listed above for motion, transition, and style — no variations
2. Output plain text only — no markdown fences, no JSON, no backticks
3. Each scene block starts with "text:" on its own line
4. Separate scenes with a blank line, three dashes, blank line
5. Keep visual descriptions detailed but concise (1-2 sentences)
6. Group transcript segments that form a single visual idea
7. Do NOT include a duration field — timing is computed from transcript timestamps`;

// ---------------------------------------------------------------------------
// Legacy JSON system prompt — used as fallback
// ---------------------------------------------------------------------------

const LEGACY_SYSTEM_PROMPT = `You are an expert video director and storyboard artist.

Given audio timestamped transcript segments, group them into coherent visual scenes. For each scene:
1. Combine adjacent segments that form a single visual idea.
2. Write a highly descriptive visual prompt for FLUX / Stable Diffusion image generation (cinematic, detailed, lighting, composition, mood).
3. Select a camera motion that matches the pacing.
DO NOT calculate durations — timing is handled by the system from transcript timestamps.

Output STRICTLY valid JSON matching this exact schema — no markdown fences, no prose, no explanation:

{
  "scenes": [
    {
      "sceneId": 1,
      "transcriptChunk": "...",
      "visualDescription": "...",
      "imagePrompt": "...",
      "cameraMotion": "zoom_in"
    }
  ]
}

cameraMotion MUST be one of: zoom_in, zoom_out, pan_left, pan_right, static.
Do NOT include startTime/endTime — the system computes timing from transcript timestamps.`;

async function ensureOllamaResources(): Promise<void> {
  try {
    const activeModel = await window.docuflow.getActiveLocalModel();
    if (activeModel.type === 'diffusion' && activeModel.model) {
      console.log('[Ollama] Unloading diffusion model before Ollama request:', activeModel.model);
      await window.docuflow.unloadLocalModel();
      await new Promise(resolve => setTimeout(resolve, 500));
    }
  } catch (err) {
    console.warn('[Ollama] Could not check/unload diffusion model:', err);
  }
}

// ---------------------------------------------------------------------------
// Scene DSL text parser — converts AI plain text output to SceneDSL[]
// ---------------------------------------------------------------------------

interface SceneDSL {
  text: string;
  visual?: string;
  motion?: string;
  transition?: string;
  style?: string;
  duration?: string;
  layers?: string[];
  extras?: string[];
  reasoning?: string;
}

const MOTION_ALIASES: Record<string, string> = {
  'none': 'none', 'no': 'none', 'static': 'none', 'still': 'none',
  'slow zoom in': 'slow_zoom', 'slow zoom': 'slow_zoom', 'slowzoom': 'slow_zoom',
  'medium zoom in': 'medium_zoom', 'medium zoom': 'medium_zoom', 'mediumzoom': 'medium_zoom',
  'fast zoom in': 'fast_zoom', 'fast zoom': 'fast_zoom', 'fastzoom': 'fast_zoom',
  'slow zoom out': 'slow_zoom_out', 'slowzoomout': 'slow_zoom_out',
  'medium zoom out': 'medium_zoom_out', 'mediumzoomout': 'medium_zoom_out',
  'fast zoom out': 'fast_zoom_out', 'fastzoomout': 'fast_zoom_out',
  'slow pan left': 'slow_pan_left', 'slowpanleft': 'slow_pan_left',
  'slow pan right': 'slow_pan_right', 'slowpanright': 'slow_pan_right',
  'slow pan up': 'slow_pan_up', 'slowpanup': 'slow_pan_up',
  'slow pan down': 'slow_pan_down', 'slowpandown': 'slow_pan_down',
  'medium pan left': 'medium_pan_left', 'mediumpanleft': 'medium_pan_left',
  'medium pan right': 'medium_pan_right', 'mediumpanright': 'medium_pan_right',
  'fast pan left': 'fast_pan_left', 'fastpanleft': 'fast_pan_left',
  'fast pan right': 'fast_pan_right', 'fastpanright': 'fast_pan_right',
  'dolly in': 'dolly_in', 'dollyin': 'dolly_in',
  'dolly out': 'dolly_out', 'dollyout': 'dolly_out',
  'orbit left': 'orbit_left', 'orbitleft': 'orbit_left',
  'orbit right': 'orbit_right', 'orbitright': 'orbit_right',
  'tilt up': 'tilt_up', 'tiltup': 'tilt_up',
  'tilt down': 'tilt_down', 'tiltdown': 'tilt_down',
  'crane up': 'crane_up', 'craneup': 'crane_up',
  'crane down': 'crane_down', 'cranedown': 'crane_down',
  'handheld': 'handheld', 'hand': 'handheld', 'parallax': 'parallax',
};

const VALID_MOTIONS = new Set([
  'none', 'slow_zoom', 'medium_zoom', 'fast_zoom',
  'slow_zoom_out', 'medium_zoom_out', 'fast_zoom_out',
  'slow_pan_left', 'slow_pan_right', 'slow_pan_up', 'slow_pan_down',
  'medium_pan_left', 'medium_pan_right', 'fast_pan_left', 'fast_pan_right',
  'dolly_in', 'dolly_out', 'orbit_left', 'orbit_right',
  'tilt_up', 'tilt_down', 'crane_up', 'crane_down', 'handheld', 'parallax',
]);

function normalizeMotion(raw: string): string {
  const lower = raw.toLowerCase().trim();
  if (MOTION_ALIASES[lower]) return MOTION_ALIASES[lower];
  const snake = lower.replace(/\s+/g, '_');
  if (VALID_MOTIONS.has(snake)) return snake;
  for (const [alias, normalized] of Object.entries(MOTION_ALIASES)) {
    if (alias.includes(lower) || lower.includes(alias)) return normalized;
  }
  return 'none';
}

function normalizeTransition(raw: string): string {
  const lower = raw.toLowerCase().trim().replace(/\s+/g, '_');
  const valid = new Set(['cut', 'crossfade', 'slide_left', 'slide_right', 'slide_up', 'slide_down', 'wipe_left', 'wipe_right', 'wipe_up', 'wipe_down', 'zoom_in', 'zoom_out', 'dissolve', 'fade']);
  if (valid.has(lower)) return lower;
  const aliases: Record<string, string> = {
    'cross-fade': 'crossfade', 'cross fade': 'crossfade', 'hard': 'cut', 'jump': 'cut',
  };
  return aliases[lower] || 'cut';
}

function normalizeStyle(raw: string): string {
  const lower = raw.toLowerCase().trim().replace(/\s+/g, '_');
  const valid = new Set(['natural', 'cinematic', 'documentary', 'vintage', 'dramatic', 'minimal', 'none']);
  if (valid.has(lower)) return lower;
  const aliases: Record<string, string> = {
    'real': 'natural', 'realistic': 'natural', 'movie': 'cinematic', 'film': 'cinematic',
    'docu': 'documentary', 'retro': 'vintage', 'old': 'vintage', 'classic': 'vintage',
    'epic': 'dramatic', 'intense': 'dramatic', 'simple': 'minimal', 'clean': 'minimal',
  };
  return aliases[lower] || 'natural';
}

function parseSceneDSLBlock(block: string): SceneDSL | null {
  const lines = block.split('\n').filter(l => l.trim());
  const scene: SceneDSL = { text: '' };

  for (const line of lines) {
    const colonIdx = line.indexOf(':');
    if (colonIdx === -1) continue;
    const key = line.substring(0, colonIdx).trim().toLowerCase();
    const value = line.substring(colonIdx + 1).trim();
    if (!value) continue;

    switch (key) {
      case 'text': scene.text = value; break;
      case 'visual': case 'image': case 'description': scene.visual = value; break;
      case 'motion': case 'camera': case 'movement': scene.motion = normalizeMotion(value); break;
      case 'transition': case 'trans': scene.transition = normalizeTransition(value); break;
      case 'style': case 'look': scene.style = normalizeStyle(value); break;
      case 'duration': case 'dur': case 'len': case 'length': scene.duration = value; break;
      case 'layers': case 'layer': scene.layers = value.split(',').map(l => l.trim()).filter(Boolean); break;
      case 'extras': case 'extra': scene.extras = value.split(',').map(e => e.trim()).filter(Boolean); break;
      case 'reasoning': case 'reason': case 'thought': scene.reasoning = value; break;
    }
  }

  return scene.text ? scene : null;
}

function parseSceneDSLText(text: string): SceneDSL[] {
  const blocks = text.split(/\n\s*---\s*\n/).filter(b => b.trim());
  return blocks.map(parseSceneDSLBlock).filter((s): s is SceneDSL => s !== null);
}

// ---------------------------------------------------------------------------
// JSON extraction / cleanup (legacy fallback)
// ---------------------------------------------------------------------------

function extractJSON(raw: string): { scenes: SceneItem[] } {
  let cleaned = raw.trim();
  cleaned = cleaned.replace(/^```(?:json)?\s*\n?/i, '').replace(/\n?```\s*$/i, '');

  try {
    const parsed = JSON.parse(cleaned);
    if (parsed && Array.isArray(parsed.scenes)) return parsed;
  } catch { /* continue */ }

  const jsonStart = cleaned.indexOf('{');
  const jsonEnd = cleaned.lastIndexOf('}');
  if (jsonStart !== -1 && jsonEnd > jsonStart) {
    const slice = cleaned.slice(jsonStart, jsonEnd + 1);
    try {
      const parsed = JSON.parse(slice);
      if (parsed && Array.isArray(parsed.scenes)) return parsed;
    } catch { /* continue */ }
  }

  const arrStart = cleaned.indexOf('[');
  const arrEnd = cleaned.lastIndexOf(']');
  if (arrStart !== -1 && arrEnd > arrStart) {
    const slice = cleaned.slice(arrStart, arrEnd + 1);
    try {
      const parsed = JSON.parse(slice);
      if (Array.isArray(parsed)) return { scenes: parsed };
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

// Models that natively support thinking/reasoning via the `thinking` field
const THINKING_CAPABLE_PATTERNS = [
  /^qwen3/i,
  /^deepseek-r1/i,
  /^deepseek\/deepseek-r1/i,
  /^qwq/i,
  /^o1/i,
  /^o3/i,
];

/**
 * Check if an Ollama model supports the `thinking` parameter.
 * Models like gemma3, llama3, phi3 do NOT support thinking.
 * Models like qwen3, deepseek-r1 DO support thinking.
 */
export function modelSupportsThinking(modelName: string): boolean {
  return THINKING_CAPABLE_PATTERNS.some(pattern => pattern.test(modelName));
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

// ---------------------------------------------------------------------------
// Translation — translate non-English transcripts to English for AI reasoning
// ---------------------------------------------------------------------------

export async function translateToEnglish(
  segments: Array<{ text: string; start: number; end: number }>,
  provider: AIProvider,
  model?: string,
  apiKey?: string,
  geminiApiKey?: string,
): Promise<Array<{ text: string; start: number; end: number; originalText: string }>> {
  const combined = segments.map((s, i) => `[${i}] ${s.text}`).join('\n');
  const prompt = `Translate each line below from its source language to English. Keep the [N] index prefix on each line. Output ONLY the translations, one per line, no explanations.

${combined}`;

  let raw: string;

  if (provider === 'ollama') {
    raw = await callOllamaStreaming(prompt, model || 'llama3.2');
  } else if (provider === 'gemini' && geminiApiKey) {
    raw = await callGemini(prompt, geminiApiKey, 'gemini-2.5-flash', 0.1, 2048);
  } else if (provider === 'openrouter' && apiKey) {
    raw = await callOpenRouter(prompt, apiKey, model || 'openrouter/free');
  } else {
    return segments.map(s => ({ text: s.text, start: s.start, end: s.end, originalText: s.text }));
  }

  const lines = raw.split('\n').filter(l => l.trim());
  return segments.map((s, i) => {
    const translatedLine = lines[i] || s.text;
    const translated = translatedLine.replace(/^\[\d+\]\s*/, '').trim();
    return {
      text: translated || s.text,
      start: s.start,
      end: s.end,
      originalText: s.text,
    };
  });
}

export interface StreamingCallbacks {
  /** @deprecated Use onOutputToken for new code */
  onToken?: (token: string, fullText: string) => void;
  /** @deprecated Use onThinkingToken for new code */
  onThinkingChunk?: (chunk: string) => void;
  onThinkingToken?: (token: string, fullThinking: string) => void;
  onOutputToken?: (token: string, fullOutput: string) => void;
  onThinkingComplete?: (fullThinking: string) => void;
  onModelLoading?: (loading: boolean) => void;
  onModelLoaded?: () => void;
  onTiming?: (label: string, ms: number) => void;
  onStatus?: (status: string) => void;
}

// ---------------------------------------------------------------------------
// Streaming Thinking Parser
// Supports: (A) Ollama native `thinking` field, (B) <think>...</think> tag parsing
// Handles chunk boundaries for tag splitting
// ---------------------------------------------------------------------------

export class StreamingThinkingParser {
  private thinking = '';
  private output = '';
  private mode: 'auto' | 'thinking' | 'output' = 'auto';
  private tagBuffer = '';

  constructor(private preferNativeThinking = true) {}

  feedNativeThinking(token: string): void {
    if (token) {
      this.thinking += token;
      this.mode = 'thinking';
    }
  }

  feedNativeResponse(token: string): void {
    if (token) {
      if (this.mode === 'thinking') this.mode = 'output';
      this.output += token;
    }
  }

  feedToken(token: string): { thinkingDelta: string; outputDelta: string } {
    if (this.mode === 'output') {
      this.output += token;
      return { thinkingDelta: '', outputDelta: token };
    }

    if (this.mode === 'thinking') {
      this.thinking += token;
      return { thinkingDelta: token, outputDelta: '' };
    }

    // auto mode: detect <think> tags across chunk boundaries
    this.tagBuffer += token;
    let thinkingDelta = '';
    let outputDelta = '';

    while (this.tagBuffer.length > 0) {
      if (this.mode === 'auto') {
        const openIdx = this.tagBuffer.indexOf('<think>');
        if (openIdx === -1) {
          const safeEnd = this.findSafeEnd(this.tagBuffer, '...');
          if (safeEnd > 0) {
            this.output += this.tagBuffer.slice(0, safeEnd);
            outputDelta += this.tagBuffer.slice(0, safeEnd);
            this.tagBuffer = this.tagBuffer.slice(safeEnd);
          } else if (this.tagBuffer.length > 3) {
            const safe = this.tagBuffer.slice(0, -3);
            if (safe) {
              this.output += safe;
              outputDelta += safe;
            }
            this.tagBuffer = this.tagBuffer.slice(-3);
          } else {
            break;
          }
        } else {
          if (openIdx > 0) {
            this.output += this.tagBuffer.slice(0, openIdx);
            outputDelta += this.tagBuffer.slice(0, openIdx);
          }
          this.tagBuffer = this.tagBuffer.slice(openIdx);
          if (this.tagBuffer.startsWith('<think>') && this.tagBuffer.length >= 7) {
            this.tagBuffer = this.tagBuffer.slice(7);
            this.mode = 'thinking';
          } else {
            break;
          }
        }
      } else if (this.mode === 'thinking') {
        const closeIdx = this.tagBuffer.indexOf('</think>');
        if (closeIdx === -1) {
          const safeEnd = this.findSafeEnd(this.tagBuffer, '</');
          if (safeEnd > 0) {
            this.thinking += this.tagBuffer.slice(0, safeEnd);
            thinkingDelta += this.tagBuffer.slice(0, safeEnd);
            this.tagBuffer = this.tagBuffer.slice(safeEnd);
          } else if (this.tagBuffer.length > 4) {
            const safe = this.tagBuffer.slice(0, -4);
            if (safe) {
              this.thinking += safe;
              thinkingDelta += safe;
            }
            this.tagBuffer = this.tagBuffer.slice(-4);
          } else {
            break;
          }
        } else {
          if (closeIdx > 0) {
            this.thinking += this.tagBuffer.slice(0, closeIdx);
            thinkingDelta += this.tagBuffer.slice(0, closeIdx);
          }
          this.tagBuffer = this.tagBuffer.slice(closeIdx);
          if (this.tagBuffer.startsWith('</think>') && this.tagBuffer.length >= 8) {
            this.tagBuffer = this.tagBuffer.slice(8);
            this.mode = 'output';
          } else {
            break;
          }
        }
      }
    }

    return { thinkingDelta, outputDelta };
  }

  private findSafeEnd(buffer: string, lookahead: string): number {
    for (let i = buffer.length - lookahead.length; i >= 0; i--) {
      if (lookahead.startsWith(buffer[i])) {
        let matches = true;
        for (let j = 0; j < lookahead.length && i + j < buffer.length; j++) {
          if (buffer[i + j] !== lookahead[j]) { matches = false; break; }
        }
        if (matches) return i;
      }
    }
    return 0;
  }

  flush(): { thinkingDelta: string; outputDelta: string } {
    const remaining = this.tagBuffer;
    this.tagBuffer = '';
    if (this.mode === 'thinking') {
      this.thinking += remaining;
      return { thinkingDelta: remaining, outputDelta: '' };
    }
    this.output += remaining;
    return { thinkingDelta: '', outputDelta: remaining };
  }

  getThinking(): string { return this.thinking; }
  getOutput(): string { return this.output; }
  isInsideThinking(): boolean { return this.mode === 'thinking'; }
  reset(): void { this.thinking = ''; this.output = ''; this.mode = 'auto'; this.tagBuffer = ''; }
}

function extractThinkingTags(text: string): { thinking: string; response: string } {
  const thinkingMatch = text.match(/<think>([\s\S]*?)<\/think>/);
  const thinking = thinkingMatch ? thinkingMatch[1].trim() : '';
  const response = text.replace(/<think>[\s\S]*?<\/think>/g, '').trim();
  return { thinking, response };
}

// ---------------------------------------------------------------------------
// AI Context — structured information for the model
// ---------------------------------------------------------------------------

export interface AIContextProject {
  name: string;
  totalScenes: number;
  existingScenes: number;
}

export interface AIContextModel {
  provider: AIProvider;
  name: string;
  thinkingSupported: boolean;
}

export interface AIContextTask {
  type: 'scene_generation' | 'translation' | 'chat';
  status: 'starting' | 'loading_model' | 'processing' | 'complete' | 'error';
  sceneIndex?: number;
  totalScenes?: number;
}

export interface AIContextTranscript {
  language: string;
  segmentCount: number;
  currentSegment?: { text: string; start: number; end: number };
}

export interface AIContextEditor {
  fps: number;
  width: number;
  height: number;
}

export interface AIContext {
  project: AIContextProject;
  model: AIContextModel;
  task: AIContextTask;
  transcript: AIContextTranscript;
  editor: AIContextEditor;
}

export function buildAIContext(params: {
  provider: AIProvider;
  model: string;
  transcriptLanguage?: string;
  transcriptSegmentCount?: number;
  currentSegment?: { text: string; start: number; end: number };
  fps: number;
  width: number;
  height: number;
  sceneCount: number;
  existingSceneCount: number;
  taskType?: AIContextTask['type'];
  taskStatus?: AIContextTask['status'];
  sceneIndex?: number;
}): AIContext {
  const thinkingModels = ['qwen3', 'qwen3.5', 'deepseek-r1', 'deepseek-r1:'];
  const thinkingSupported = params.provider === 'ollama' &&
    thinkingModels.some(m => params.model.toLowerCase().includes(m.toLowerCase()));

  return {
    project: {
      name: 'DocuFlow Project',
      totalScenes: params.sceneCount,
      existingScenes: params.existingSceneCount,
    },
    model: {
      provider: params.provider,
      name: params.model,
      thinkingSupported,
    },
    task: {
      type: params.taskType || 'scene_generation',
      status: params.taskStatus || 'processing',
      sceneIndex: params.sceneIndex,
      totalScenes: params.sceneCount || undefined,
    },
    transcript: {
      language: params.transcriptLanguage || 'en',
      segmentCount: params.transcriptSegmentCount || 0,
      currentSegment: params.currentSegment,
    },
    editor: {
      fps: params.fps,
      width: params.width,
      height: params.height,
    },
  };
}

async function callOllamaStreaming(
  prompt: string,
  model = 'llama3.2',
  callbacks?: StreamingCallbacks,
  options?: { think?: boolean },
): Promise<string> {
  await ensureOllamaResources();
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 300_000);

  const supportsThinking = modelSupportsThinking(model);
  const think = options?.think !== undefined ? options.think : supportsThinking;

  const body: Record<string, any> = {
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

  // Only include `think` if the model supports it
  if (supportsThinking) {
    body.think = think;
  }

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
    let fullThinking = '';
    let firstTokenReceived = false;
    const parser = new StreamingThinkingParser(true);
    let hasNativeThinking = false;

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

            // Native Ollama thinking field (qwen3, deepseek-r1, etc.)
            if (chunk.thinking !== undefined && chunk.thinking !== null && chunk.thinking !== '') {
              hasNativeThinking = true;
              fullThinking += chunk.thinking;
              parser.feedNativeThinking(chunk.thinking);
              if (!firstTokenReceived) {
                firstTokenReceived = true;
                callbacks?.onModelLoading?.(false);
                callbacks?.onModelLoaded?.();
              }
              callbacks?.onThinkingToken?.(chunk.thinking, fullThinking);
              // Also fire deprecated callback for backward compat
              callbacks?.onThinkingChunk?.(chunk.thinking);
            }

            // Response field
            if (chunk.response !== undefined && chunk.response !== null && chunk.response !== '') {
              if (!firstTokenReceived) {
                firstTokenReceived = true;
                callbacks?.onModelLoading?.(false);
                callbacks?.onModelLoaded?.();
              }

              if (hasNativeThinking) {
                fullResponse += chunk.response;
                parser.feedNativeResponse(chunk.response);
              } else {
                // Fallback: parse <think> tags from response field
                const { thinkingDelta, outputDelta } = parser.feedToken(chunk.response);
                if (thinkingDelta) {
                  fullThinking += thinkingDelta;
                  callbacks?.onThinkingToken?.(thinkingDelta, fullThinking);
                  callbacks?.onThinkingChunk?.(thinkingDelta);
                }
                if (outputDelta) {
                  fullResponse += outputDelta;
                }
              }

              callbacks?.onToken?.(chunk.response, fullResponse);
              callbacks?.onOutputToken?.(chunk.response, fullResponse);
            }
          } catch {
            // skip malformed lines
          }
        }
      }

      // Flush any remaining tag buffer
      const { thinkingDelta, outputDelta } = parser.flush();
      if (thinkingDelta) {
        fullThinking += thinkingDelta;
        callbacks?.onThinkingToken?.(thinkingDelta, fullThinking);
        callbacks?.onThinkingChunk?.(thinkingDelta);
      }
      if (outputDelta) {
        fullResponse += outputDelta;
      }
    } finally {
      reader.releaseLock();
    }

    // Final fallback: if parser didn't find native thinking, try regex extraction
    if (!fullThinking && !hasNativeThinking) {
      const { thinking, response } = extractThinkingTags(fullResponse);
      if (thinking) {
        fullThinking = thinking;
        fullResponse = response;
        callbacks?.onThinkingComplete?.(thinking);
      }
    } else if (fullThinking) {
      callbacks?.onThinkingComplete?.(fullThinking);
    }

    callbacks?.onModelLoading?.(false);
    return fullResponse;
  } finally {
    clearTimeout(timeoutId);
    callbacks?.onModelLoading?.(false);
  }
}

// ---------------------------------------------------------------------------
// Provider: Ollama — non-streaming FAST mode (think:false, small output)
// ---------------------------------------------------------------------------

async function callOllamaDirect(
  prompt: string,
  model = 'gemma3:4b',
  options?: { think?: boolean; temperature?: number; numPredict?: number },
): Promise<string> {
  await ensureOllamaResources();
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 120_000);

  const body = {
    model,
    prompt,
    stream: false,
    think: options?.think ?? false,
    keep_alive: '15m',
    options: {
      temperature: options?.temperature ?? 0.2,
      num_predict: options?.numPredict ?? 512,
      num_ctx: 2048,
    },
  };

  try {
    const resp = await fetch('http://localhost:11434/api/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    if (!resp.ok) {
      const text = await resp.text().catch(() => '');
      throw new Error(`Ollama error ${resp.status}: ${text.slice(0, 300)}`);
    }

    const data = await resp.json();
    return data.response ?? '';
  } finally {
    clearTimeout(timeoutId);
  }
}

// ---------------------------------------------------------------------------
// Provider: OpenRouter
// ---------------------------------------------------------------------------

async function callOpenRouter(
  prompt: string,
  apiKey: string,
  model = 'openrouter/free',
  systemPrompt?: string,
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
        { role: 'system', content: systemPrompt || SCENE_DSL_SYSTEM_PROMPT },
        { role: 'user', content: prompt },
      ],
      temperature: 0.3,
      max_tokens: 4096,
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
  systemInstruction?: string,
): Promise<string> {
  const body: Record<string, unknown> = {
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
    generationConfig: {
      temperature,
      maxOutputTokens,
    },
  };

  if (systemInstruction) {
    (body as Record<string, unknown>).systemInstruction = {
      parts: [{ text: systemInstruction }],
    };
  }

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
    (s) => {
      const text = s.originalText && s.originalLanguage && s.originalLanguage !== 'en'
        ? `${s.originalText} (English: ${s.text})`
        : s.text;
      return `[${s.start.toFixed(2)}s - ${s.end.toFixed(2)}s] ${text}`;
    },
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
  options?: { think?: boolean },
): Promise<{ thinking: string; response: string }> {
  await ensureOllamaResources();
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 300_000);

  const supportsThinking = modelSupportsThinking(model);
  const think = options?.think !== undefined ? options.think : supportsThinking;

  const body: Record<string, any> = {
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

  // Only include `think` if the model supports it
  if (supportsThinking) {
    body.think = think;
  }

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
    let fullThinking = '';
    let firstTokenReceived = false;
    const parser = new StreamingThinkingParser(true);
    let hasNativeThinking = false;

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

            if (chunk.thinking !== undefined && chunk.thinking !== null && chunk.thinking !== '') {
              hasNativeThinking = true;
              fullThinking += chunk.thinking;
              parser.feedNativeThinking(chunk.thinking);
              if (!firstTokenReceived) {
                firstTokenReceived = true;
                callbacks?.onModelLoading?.(false);
                callbacks?.onModelLoaded?.();
              }
              callbacks?.onThinkingToken?.(chunk.thinking, fullThinking);
            }

            if (chunk.response !== undefined && chunk.response !== null && chunk.response !== '') {
              if (!firstTokenReceived) {
                firstTokenReceived = true;
                callbacks?.onModelLoading?.(false);
                callbacks?.onModelLoaded?.();
              }

              if (hasNativeThinking) {
                fullResponse += chunk.response;
                parser.feedNativeResponse(chunk.response);
              } else {
                const { thinkingDelta, outputDelta } = parser.feedToken(chunk.response);
                if (thinkingDelta) {
                  fullThinking += thinkingDelta;
                  callbacks?.onThinkingToken?.(thinkingDelta, fullThinking);
                }
                if (outputDelta) {
                  fullResponse += outputDelta;
                }
              }

              callbacks?.onToken?.(chunk.response, fullResponse);
              callbacks?.onOutputToken?.(chunk.response, fullResponse);
            }
          } catch {
            // skip malformed lines
          }
        }
      }

      const { thinkingDelta, outputDelta } = parser.flush();
      if (thinkingDelta) fullThinking += thinkingDelta;
      if (outputDelta) fullResponse += outputDelta;
    } finally {
      reader.releaseLock();
    }

    if (fullThinking) {
      callbacks?.onThinkingComplete?.(fullThinking);
    } else if (!hasNativeThinking) {
      const { thinking, response } = extractThinkingTags(fullResponse);
      if (thinking) {
        fullThinking = thinking;
        fullResponse = response;
        callbacks?.onThinkingComplete?.(thinking);
      }
    }

    callbacks?.onModelLoading?.(false);
    return { thinking: fullThinking, response: fullResponse };
  } finally {
    clearTimeout(timeoutId);
    callbacks?.onModelLoading?.(false);
  }
}

// ---------------------------------------------------------------------------
// Generic chat — works with any provider (Ollama, OpenRouter, Gemini)
// ---------------------------------------------------------------------------

export interface ChatRequest {
  message: string;
  provider: AIProvider;
  model?: string;
  openRouterApiKey?: string;
  geminiApiKey?: string;
  geminiModel?: string;
  systemPrompt?: string;
}

/**
 * Chat with any AI provider. The UI doesn't need to know the implementation.
 */
export async function chatWithProvider(
  req: ChatRequest,
  callbacks?: StreamingCallbacks,
): Promise<{ thinking: string; response: string }> {
  const systemContext = req.systemPrompt
    ? `[System context: ${req.systemPrompt}]\n\nUser message: ${req.message}`
    : req.message;

  try {
    if (req.provider === 'ollama') {
      return await chatWithModel(systemContext, req.model || 'llama3.2', callbacks);
    }

    if (req.provider === 'gemini') {
      if (!req.geminiApiKey) throw new Error('Gemini API key is required. Configure it in Settings.');
      const raw = await callGemini(
        systemContext, req.geminiApiKey, req.geminiModel || 'gemini-2.5-flash',
        0.7, 2048,
      );
      return { thinking: '', response: raw };
    }

    // OpenRouter
    if (!req.openRouterApiKey) throw new Error('OpenRouter API key is required. Configure it in Settings.');
    const raw = await callOpenRouter(systemContext, req.openRouterApiKey, req.model || 'openrouter/free');
    return { thinking: '', response: raw };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    // Re-throw with provider context
    throw new Error(`[${req.provider}] ${message}`);
  }
}

// ---------------------------------------------------------------------------
// Public API — Non-streaming
// ---------------------------------------------------------------------------

export async function generateScenes(req: AISceneRequest): Promise<SceneItem[]> {
  const userPrompt = buildUserPrompt(req);
  const fullPrompt = `${SCENE_DSL_SYSTEM_PROMPT}\n\n---\n\n${userPrompt}`;

  let raw: string;

  if (req.provider === 'ollama') {
    raw = await callOllamaStreaming(fullPrompt, req.model || 'llama3.2');
  } else if (req.provider === 'gemini') {
    if (!req.geminiApiKey) throw new Error('Gemini API key is required');
    raw = await callGemini(
      userPrompt, req.geminiApiKey, req.geminiModel || 'gemini-2.5-flash',
      req.geminiTemperature ?? 0.3, req.geminiMaxOutputTokens ?? 8192,
      SCENE_DSL_SYSTEM_PROMPT,
    );
  } else {
    if (!req.openRouterApiKey) throw new Error('OpenRouter API key is required');
    raw = await callOpenRouter(userPrompt, req.openRouterApiKey, req.model || 'openrouter/free', SCENE_DSL_SYSTEM_PROMPT);
  }

  return convertAIResponseToSceneItems(raw, req.transcriptionSegments);
}

// ---------------------------------------------------------------------------
// Streaming variant — used by the Thinking Inspector
// Now uses FAST mode: compact JSON output, per-segment batching,
// think:false, minimal prompt.
// ---------------------------------------------------------------------------

export async function generateScenesStream(
  req: AISceneRequest,
  callbacks?: StreamingCallbacks,
): Promise<SceneItem[]> {
  const segments = req.transcriptionSegments;
  if (segments.length === 0) return [];

  const model = req.provider === 'ollama' ? (req.model || 'gemma3:4b') : (req.model || 'openrouter/free');

  // Batch segments into groups of 3 for small models
  const BATCH_SIZE = 3;
  const batches: PromptSegment[][] = [];
  for (let i = 0; i < segments.length; i += BATCH_SIZE) {
    batches.push(segments.slice(i, i + BATCH_SIZE).map(s => ({
      start: s.start,
      end: s.end,
      text: s.originalText && s.originalLanguage && s.originalLanguage !== 'en'
        ? `${s.text}`
        : s.text,
    })));
  }

  const allIntents: SceneIntent[] = [];
  const allTexts: string[] = [];
  const totalBatches = batches.length;

  callbacks?.onStatus?.(`Generating ${segments.length} scenes in ${totalBatches} batches...`);

  for (let batchIdx = 0; batchIdx < totalBatches; batchIdx++) {
    const batch = batches[batchIdx];
    const prompt = buildFASTPrompt(batch, req.fullScript?.trim());

    callbacks?.onStatus?.(`Batch ${batchIdx + 1}/${totalBatches}...`);
    callbacks?.onOutputToken?.(`[${batchIdx + 1}/${totalBatches}]`, '');

    let raw: string;

    if (req.provider === 'ollama') {
      const t0 = performance.now();
      raw = await callOllamaDirect(prompt, model, {
        think: false,
        temperature: 0.2,
        numPredict: 512,
      });
      callbacks?.onTiming?.(`batch_${batchIdx + 1}`, performance.now() - t0);
    } else if (req.provider === 'gemini') {
      if (!req.geminiApiKey) throw new Error('Gemini API key is required');
      raw = await callGemini(
        prompt, req.geminiApiKey, req.geminiModel || 'gemini-2.5-flash',
        req.geminiTemperature ?? 0.2, req.geminiMaxOutputTokens ?? 1024,
        'Return only a JSON array. No explanation.',
      );
    } else {
      if (!req.openRouterApiKey) throw new Error('OpenRouter API key is required');
      raw = await callOpenRouter(prompt, req.openRouterApiKey, model, 'Return only a JSON array. No explanation.');
    }

    // Parse JSON response into SceneIntents
    const intents = parseSceneIntents(raw);
    if (intents.length > 0) {
      allIntents.push(...intents);
      allTexts.push(...batch.map(s => s.text));
    } else {
      // Fallback: if JSON parsing failed, create intents from raw text
      // This handles models that output text instead of JSON
      for (const seg of batch) {
        allIntents.push({ v: seg.text, a: 'zoom_in', t: 'cut', s: 'cinematic' });
        allTexts.push(seg.text);
      }
    }
  }

  if (allIntents.length === 0) {
    throw new Error('AI returned no valid scene data. Please try again.');
  }

  // Compile SceneIntent → SceneDSL (deterministic, no AI)
  const dslScenes = compileSceneIntents(allIntents, allTexts);

  // Convert to SceneItems with timing from transcript segments
  const motionMap: Record<string, SceneItem['cameraMotion']> = {
    'none': 'static',
    'slow_zoom': 'zoom_in', 'medium_zoom': 'zoom_in', 'fast_zoom': 'zoom_in',
    'slow_zoom_out': 'zoom_out', 'medium_zoom_out': 'zoom_out', 'fast_zoom_out': 'zoom_out',
    'slow_pan_left': 'pan_left', 'slow_pan_right': 'pan_right',
    'medium_pan_left': 'pan_left', 'medium_pan_right': 'pan_right',
    'fast_pan_left': 'pan_left', 'fast_pan_right': 'pan_right',
    'dolly_in': 'zoom_in', 'dolly_out': 'zoom_out',
    'orbit_left': 'pan_left', 'orbit_right': 'pan_right',
    'tilt_up': 'zoom_out', 'tilt_down': 'zoom_in',
    'crane_up': 'zoom_out', 'crane_down': 'zoom_in',
    'handheld': 'static', 'parallax': 'pan_right',
  };

  // Use transcript timestamps directly (1:1 mapping since we batch segments)
  return dslScenes.map((scene, i) => ({
    sceneId: i + 1,
    startTime: segments[i]?.start ?? 0,
    endTime: segments[i]?.end ?? segments[i]?.start ?? 0,
    transcriptChunk: scene.text,
    visualDescription: scene.visual || scene.text,
    imagePrompt: scene.visual || scene.text,
    cameraMotion: motionMap[scene.motion || 'none'] || 'static',
  }));
}

// ---------------------------------------------------------------------------
// Unified converter — handles both Scene DSL text and legacy JSON fallback
// ---------------------------------------------------------------------------

function convertAIResponseToSceneItems(
  raw: string,
  segments: Array<{ start: number; end: number; text: string }>,
): SceneItem[] {
  // Try Scene DSL first
  const dslScenes = parseSceneDSLText(raw);

  if (dslScenes.length > 0) {
    // Derive timing from transcript segments matched to scene text
    const totalDuration = segments.length > 0 ? segments[segments.length - 1].end : 0;

    // Build a mapping: for each DSL scene, find which transcript segments it covers
    // by matching scene.text against segment text
    const sceneSegmentRanges: Array<{ startIdx: number; endIdx: number }> = [];

    for (const scene of dslScenes) {
      const sceneTextLower = scene.text.toLowerCase().trim();
      let bestStart = -1;
      let bestEnd = -1;
      let bestScore = 0;

      // Try to find consecutive segments that best match this scene's text
      for (let startIdx = 0; startIdx < segments.length; startIdx++) {
        for (let endIdx = startIdx; endIdx < segments.length; endIdx++) {
          const combinedText = segments.slice(startIdx, endIdx + 1)
            .map(s => s.text).join(' ').toLowerCase().trim();
          // Simple overlap score: count matching words
          const sceneWords = new Set(sceneTextLower.split(/\s+/));
          const combinedWords = combinedText.split(/\s+/);
          let matches = 0;
          for (const w of combinedWords) {
            if (sceneWords.has(w)) matches++;
          }
          const score = matches / Math.max(sceneWords.size, 1);
          if (score > bestScore && score > 0.3) {
            bestScore = score;
            bestStart = startIdx;
            bestEnd = endIdx;
          }
        }
      }

      if (bestStart >= 0) {
        sceneSegmentRanges.push({ startIdx: bestStart, endIdx: bestEnd });
      } else {
        // No match found — will be assigned evenly later
        sceneSegmentRanges.push({ startIdx: -1, endIdx: -1 });
      }
    }

    // Assign timestamps: matched scenes get their segment times,
    // unmatched scenes get evenly distributed across total duration
    const unmatchedIndices: number[] = [];
    const assignedStarts: number[] = new Array(dslScenes.length).fill(-1);
    const assignedEnds: number[] = new Array(dslScenes.length).fill(-1);

    for (let i = 0; i < dslScenes.length; i++) {
      const range = sceneSegmentRanges[i];
      if (range.startIdx >= 0) {
        assignedStarts[i] = segments[range.startIdx].start;
        assignedEnds[i] = segments[range.endIdx].end;
      } else {
        unmatchedIndices.push(i);
      }
    }

    // Fill unmatched scenes with even distribution
    if (unmatchedIndices.length > 0 && totalDuration > 0) {
      const chunk = totalDuration / dslScenes.length;
      for (let j = 0; j < unmatchedIndices.length; j++) {
        const i = unmatchedIndices[j];
        assignedStarts[i] = j * chunk;
        assignedEnds[i] = (j + 1) * chunk;
      }
    }

    const motionMap: Record<string, SceneItem['cameraMotion']> = {
      'none': 'static',
      'slow_zoom': 'zoom_in', 'medium_zoom': 'zoom_in', 'fast_zoom': 'zoom_in',
      'slow_zoom_out': 'zoom_out', 'medium_zoom_out': 'zoom_out', 'fast_zoom_out': 'zoom_out',
      'slow_pan_left': 'pan_left', 'slow_pan_right': 'pan_right',
      'medium_pan_left': 'pan_left', 'medium_pan_right': 'pan_right',
      'fast_pan_left': 'pan_left', 'fast_pan_right': 'pan_right',
      'dolly_in': 'zoom_in', 'dolly_out': 'zoom_out',
      'orbit_left': 'pan_left', 'orbit_right': 'pan_right',
      'tilt_up': 'zoom_out', 'tilt_down': 'zoom_in',
      'crane_up': 'zoom_out', 'crane_down': 'zoom_in',
      'handheld': 'static', 'parallax': 'pan_right',
    };

    return dslScenes.map((scene, i) => ({
      sceneId: i + 1,
      startTime: assignedStarts[i],
      endTime: assignedEnds[i],
      transcriptChunk: scene.text,
      visualDescription: scene.visual || scene.text,
      imagePrompt: scene.visual || scene.text,
      cameraMotion: motionMap[scene.motion || 'none'] || 'static',
      reasoning: scene.reasoning,
    }));
  }

  // Fallback: try legacy JSON
  try {
    const parsed = extractJSON(raw);
    const totalDuration = segments.length > 0 ? segments[segments.length - 1].end : 0;
    const n = parsed.scenes.length;
    const chunk = n > 0 ? totalDuration / n : 3;

    return parsed.scenes.map((s, i) => ({
      sceneId: s.sceneId ?? i + 1,
      startTime: s.startTime ?? i * chunk,
      endTime: s.endTime ?? (i + 1) * chunk,
      transcriptChunk: s.transcriptChunk || '',
      visualDescription: s.visualDescription || '',
      imagePrompt: s.imagePrompt || s.visualDescription || '',
      cameraMotion: ['zoom_in', 'zoom_out', 'pan_left', 'pan_right', 'static'].includes(s.cameraMotion)
        ? s.cameraMotion
        : 'static',
      reasoning: s.reasoning,
    }));
  } catch {
    throw new Error('AI response could not be parsed as Scene DSL or JSON. Please try again.');
  }
}

// ---------------------------------------------------------------------------
// Project Context Builder — provides AI chat with current project state
// ---------------------------------------------------------------------------

export interface ProjectContext {
  scenes: Array<{ id: string; type: string; duration: number; content: string }>;
  assets: Array<{ id: string; name: string; type: string; duration?: number }>;
  timeline: { duration: number; fps: number } | null;
  transcript: { text: string; duration: number; segments: number } | null;
  selectedItems: string[];
}

/**
 * Build a context string from the current project state for AI chat.
 * This helps the AI understand what the user is working on.
 */
export function buildProjectContext(ctx: ProjectContext): string {
  const parts: string[] = [];

  if (ctx.scenes.length > 0) {
    parts.push(`Scenes (${ctx.scenes.length}):\n${
      ctx.scenes.map(s => `  - ${s.type}: "${s.content.substring(0, 100)}" (${s.duration}s)`).join('\n')
    }`);
  }

  if (ctx.assets.length > 0) {
    parts.push(`Assets (${ctx.assets.length}):\n${
      ctx.assets.map(a => `  - ${a.name} (${a.type}${a.duration ? `, ${a.duration}s` : ''})`).join('\n')
    }`);
  }

  if (ctx.timeline) {
    parts.push(`Timeline: ${ctx.timeline.duration}s @ ${ctx.timeline.fps}fps`);
  }

  if (ctx.transcript) {
    parts.push(`Transcript: ${ctx.transcript.text.substring(0, 200)}... (${ctx.transcript.segments} segments, ${ctx.transcript.duration}s)`);
  }

  if (ctx.selectedItems.length > 0) {
    parts.push(`Selected: ${ctx.selectedItems.join(', ')}`);
  }

  return parts.length > 0
    ? `\n\n[Project Context]\n${parts.join('\n\n')}`
    : '';
}
