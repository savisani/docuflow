import React, { useState, useCallback, useRef } from 'react';
import {
  Wand2, Upload, FileText, Mic, Loader2, X, CheckCircle, AlertCircle,
  Film, Clock, Image as ImageIcon, Clapperboard, Sparkles,
  Trash2, Settings, Globe, Cpu, Key, ChevronDown, ChevronRight,
  Brain, Zap, MonitorDot,
} from 'lucide-react';
import { useDocuFlowStore } from '../../app/store';
import { Button } from '../ui';
import { v4 as uuidv4 } from 'uuid';
import { Asset } from '../../types/assets';
import { Command } from '../../engine/commands/types';
import { generateLogicalId } from '../../engine/media/findAsset';
import { generateWithCloudflare, CLOUDFLARE_MODELS, CloudflareConfig } from '../../utils/cloudflareApi';
import { generateScenesStream, fetchOllamaModels, offloadModel, type AIProvider, type SceneItem, type OllamaModel } from '../../services/aiService';
import {
  loadGeminiConfig,
  saveGeminiConfig,
  testGeminiConnection,
  generateStructuredResponse,
  maskApiKey,
  GEMINI_MODELS,
  type GeminiProviderConfig,
  type GeminiConnectionTestResult,
} from '../../utils/geminiApi';
import { ThinkingInspector } from './ThinkingInspector';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface TranscriptionSegment {
  id: number;
  start: number;
  end: number;
  text: string;
  words?: { word: string; start: number; end: number; probability: number }[];
}

interface TranscriptionResult {
  success: boolean;
  text?: string;
  segments?: TranscriptionSegment[];
  language?: string;
  duration?: number;
  error?: string;
}

interface StoryboardScene extends SceneItem {
  status: 'pending' | 'generating' | 'done' | 'error';
  imageUrl?: string;
  error?: string;
}

// ---------------------------------------------------------------------------
// Helpers / persistence
// ---------------------------------------------------------------------------

function loadCloudflareConfig(): CloudflareConfig {
  try {
    const stored = localStorage.getItem('docuflow-cloudflare-config');
    if (stored) return JSON.parse(stored);
  } catch {}
  return { workerUrl: '' };
}

function loadAdvancedSettings(): { model: string; steps: number } {
  try {
    const stored = localStorage.getItem('docuflow-advanced-settings');
    if (stored) return JSON.parse(stored);
  } catch {}
  return { model: '@cf/black-forest-labs/flux-1-schnell', steps: 4 };
}

function loadAIProviderSettings(): { provider: AIProvider; ollamaModel: string; openRouterModel: string; openRouterApiKey: string; geminiModel: string } {
  try {
    const stored = localStorage.getItem('docuflow-ai-provider');
    if (stored) return JSON.parse(stored);
  } catch {}
  return { provider: 'ollama', ollamaModel: 'llama3.2', openRouterModel: 'openrouter/free', openRouterApiKey: '', geminiModel: 'gemini-2.5-flash' };
}

function saveAIProviderSettings(s: { provider: AIProvider; ollamaModel: string; openRouterModel: string; openRouterApiKey: string; geminiModel: string }) {
  localStorage.setItem('docuflow-ai-provider', JSON.stringify(s));
}

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  const ms = Math.round((seconds % 1) * 1000);
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(ms).padStart(3, '0')}`;
}

function formatTimeShort(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

const CAMERA_MOTIONS = [
  { value: 'zoom_in', label: 'Zoom In' },
  { value: 'zoom_out', label: 'Zoom Out' },
  { value: 'pan_left', label: 'Pan Left' },
  { value: 'pan_right', label: 'Pan Right' },
  { value: 'static', label: 'Static' },
] as const;

function formatElapsed(ms: number): string {
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  const ss = s % 60;
  return m > 0 ? `${m}m ${ss}s` : `${ss}s`;
}

// ---------------------------------------------------------------------------
// SceneGenerator
// ---------------------------------------------------------------------------

export const SceneGenerator: React.FC = () => {
  const { addAsset, addCommand, setActiveTab } = useDocuFlowStore();

  // -- Audio file --
  const [audioFilePath, setAudioFilePath] = useState('');
  const [audioFileName, setAudioFileName] = useState('');
  const [scriptText, setScriptText] = useState('');

  // -- Step 1: Transcription --
  const [transcribing, setTranscribing] = useState(false);
  const [transcription, setTranscription] = useState<TranscriptionResult | null>(null);
  const [transcriptionError, setTranscriptionError] = useState<string | null>(null);
  const [whisperModel, setWhisperModel] = useState('small');

  // -- Step 2: AI Scene Breaking --
  const [scenes, setScenes] = useState<StoryboardScene[]>([]);
  const [breakingScenes, setBreakingScenes] = useState(false);
  const [sceneError, setSceneError] = useState<string | null>(null);

  // -- AI Inspector state --
  const [inspectorOpen, setInspectorOpen] = useState(false);
  const [inspectorStatus, setInspectorStatus] = useState<'idle' | 'loading_model' | 'thinking' | 'generating' | 'done' | 'error'>('idle');
  const [liveOutput, setLiveOutput] = useState('');
  const [thinkingLog, setThinkingLog] = useState('');
  const [elapsedMs, setElapsedMs] = useState(0);
  const [modelLoading, setModelLoading] = useState(false);
  const elapsedRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // -- AI Provider settings --
  const [aiSettings, setAISettings] = useState(loadAIProviderSettings);
  const [showAISettings, setShowAISettings] = useState(false);
  const [ollamaModels, setOllamaModels] = useState<OllamaModel[]>([]);
  const [ollamaStatus, setOllamaStatus] = useState<'idle' | 'checking' | 'online' | 'offline' | 'starting'>('idle');

  // -- Gemini settings --
  const [geminiConfig, setGeminiConfig] = useState<GeminiProviderConfig>(loadGeminiConfig);
  const [geminiTestResult, setGeminiTestResult] = useState<GeminiConnectionTestResult | null>(null);
  const [geminiTesting, setGeminiTesting] = useState(false);
  const [showGeminiTestPanel, setShowGeminiTestPanel] = useState(false);
  const [geminiTestPrompt, setGeminiTestPrompt] = useState('Return JSON containing a description of a documentary video editor.');
  const [geminiTestResponse, setGeminiTestResponse] = useState<string | null>(null);

  // -- Step 3: Batch generation --
  const [generatingAll, setGeneratingAll] = useState(false);
  const [generationProgress, setGenerationProgress] = useState({ current: 0, total: 0 });

  // -- Cloudflare config (for image generation) --
  const [cloudflareConfig] = useState<CloudflareConfig>(loadCloudflareConfig);
  const [advancedSettings] = useState(loadAdvancedSettings);

  // -- UI state --
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);

  // -- Derived --
  const step1Done = transcription?.success === true && transcription.segments && transcription.segments.length > 0;
  const step2Done = scenes.length > 0;
  const canTranscribe = audioFilePath && !transcribing;
  const canBreakScenes = step1Done && !breakingScenes;
  const canGenerateAll = step2Done && scenes.some((s) => s.status !== 'done') && !generatingAll;

  // -----------------------------------------------------------------------
  // Step 1: Transcribe Audio
  // -----------------------------------------------------------------------

  const handleFileSelect = useCallback(async () => {
    try {
      const result = await window.docuflow.selectAudioFile();
      if (!result.canceled && result.filePath) {
        setAudioFilePath(result.filePath);
        setAudioFileName(result.filePath.split(/[/\\]/).pop() || 'audio.mp3');
        setTranscription(null);
        setTranscriptionError(null);
        setScenes([]);
      }
    } catch (err) {
      console.error('Failed to select file:', err);
    }
  }, []);

  const handleTranscribe = useCallback(async () => {
    if (!audioFilePath) return;
    setTranscribing(true);
    setTranscriptionError(null);
    setTranscription(null);

    try {
      const result = await window.docuflow.transcribeAudio({
        audioPath: audioFilePath,
        modelSize: whisperModel,
      });

      if (result.success) {
        setTranscription(result);
        setToast({ message: `Transcription complete: ${result.segments?.length ?? 0} segments`, type: 'success' });
      } else {
        setTranscriptionError(result.error || 'Transcription failed');
      }
    } catch (err) {
      setTranscriptionError(err instanceof Error ? err.message : String(err));
    } finally {
      setTranscribing(false);
    }
  }, [audioFilePath, whisperModel]);

  // -----------------------------------------------------------------------
  // Step 2: AI Scene Breakdown
  // -----------------------------------------------------------------------

  const handleBreakScenes = useCallback(async () => {
    if (!transcription?.segments) return;
    setBreakingScenes(true);
    setSceneError(null);
    setScenes([]);
    setLiveOutput('');
    setThinkingLog('');
    setElapsedMs(0);
    setInspectorStatus('loading_model');
    setInspectorOpen(true);

    // Start elapsed timer
    const startTime = Date.now();
    elapsedRef.current = setInterval(() => {
      setElapsedMs(Date.now() - startTime);
    }, 100);

    try {
      const segments = transcription.segments.map((s) => ({
        start: s.start,
        end: s.end,
        text: s.text,
      }));

      const sceneItems = await generateScenesStream(
        {
          transcriptionSegments: segments,
          fullScript: scriptText.trim() || undefined,
          provider: aiSettings.provider,
          model: aiSettings.provider === 'ollama' ? aiSettings.ollamaModel : aiSettings.openRouterModel,
          openRouterApiKey: aiSettings.openRouterApiKey || undefined,
          geminiApiKey: geminiConfig.apiKey || undefined,
          geminiModel: aiSettings.geminiModel || geminiConfig.model,
          geminiTemperature: geminiConfig.temperature,
          geminiMaxOutputTokens: geminiConfig.maxOutputTokens,
        },
        {
          onToken: (_token, fullText) => {
            setLiveOutput(fullText);
            setInspectorStatus('thinking');
          },
          onThinkingChunk: (chunk) => {
            setThinkingLog((prev) => prev + chunk);
          },
          onThinkingComplete: (thinking) => {
            setThinkingLog(thinking);
          },
          onModelLoading: (loading) => {
            setModelLoading(loading);
            if (loading) setInspectorStatus('loading_model');
          },
          onModelLoaded: () => {
            setModelLoading(false);
            setInspectorStatus('thinking');
          },
          onProgress: (elapsed) => {
            setElapsedMs(elapsed);
          },
        },
      );

      const storyboard: StoryboardScene[] = sceneItems.map((s) => ({
        ...s,
        status: 'pending' as const,
      }));

      setScenes(storyboard);
      setInspectorStatus('done');
      setToast({ message: `AI breakdown complete: ${storyboard.length} scenes`, type: 'success' });
    } catch (err) {
      setSceneError(err instanceof Error ? err.message : String(err));
      setInspectorStatus('error');
    } finally {
      setBreakingScenes(false);
      if (elapsedRef.current) {
        clearInterval(elapsedRef.current);
        elapsedRef.current = null;
      }
    }
  }, [transcription, scriptText, aiSettings, geminiConfig]);

  // -----------------------------------------------------------------------
  // Step 3: Single image generation
  // -----------------------------------------------------------------------

  const handleGenerateSingle = useCallback(async (sceneId: number) => {
    const idx = scenes.findIndex((s) => s.sceneId === sceneId);
    if (idx === -1) return;

    const scene = scenes[idx];
    const updated = [...scenes];
    updated[idx] = { ...scene, status: 'generating' };
    setScenes(updated);

    try {
      if (!cloudflareConfig.workerUrl) throw new Error('Cloudflare Worker URL not configured');
      const result = await generateWithCloudflare(cloudflareConfig, {
        prompt: scene.imagePrompt,
        model: advancedSettings.model,
        steps: advancedSettings.steps,
      });

      if (result.success && result.imageUrls && result.imageUrls.length > 0) {
        updated[idx] = { ...scene, status: 'done', imageUrl: result.imageUrls[0] };
      } else {
        updated[idx] = { ...scene, status: 'error', error: result.error || 'Failed' };
      }
    } catch (err) {
      updated[idx] = { ...scene, status: 'error', error: err instanceof Error ? err.message : String(err) };
    }

    setScenes([...updated]);
  }, [scenes, cloudflareConfig, advancedSettings]);

  // -----------------------------------------------------------------------
  // Step 3: Batch generate all
  // -----------------------------------------------------------------------

  const handleGenerateAll = useCallback(async () => {
    if (scenes.length === 0) return;
    setGeneratingAll(true);
    setGenerationProgress({ current: 0, total: scenes.length });

    const updated = [...scenes];

    for (let i = 0; i < updated.length; i++) {
      if (updated[i].status === 'done') {
        setGenerationProgress({ current: i + 1, total: updated.length });
        continue;
      }

      updated[i] = { ...updated[i], status: 'generating' };
      setScenes([...updated]);

      try {
        if (!cloudflareConfig.workerUrl) throw new Error('Cloudflare Worker URL not configured');
        const result = await generateWithCloudflare(cloudflareConfig, {
          prompt: updated[i].imagePrompt,
          model: advancedSettings.model,
          steps: advancedSettings.steps,
        });

        if (result.success && result.imageUrls && result.imageUrls.length > 0) {
          updated[i] = { ...updated[i], status: 'done', imageUrl: result.imageUrls[0] };
        } else {
          updated[i] = { ...updated[i], status: 'error', error: result.error || 'Failed' };
        }
      } catch (err) {
        updated[i] = { ...updated[i], status: 'error', error: err instanceof Error ? err.message : String(err) };
      }

      setScenes([...updated]);
      setGenerationProgress({ current: i + 1, total: updated.length });
    }

    // Assemble timeline
    try {
      const currentAssets = useDocuFlowStore.getState().assets;
      const newAssets: Asset[] = [];
      const newCommands: Command[] = [];

      for (const sc of updated) {
        if (sc.status !== 'done' || !sc.imageUrl) continue;
        const logicalId = generateLogicalId('image', [...currentAssets, ...newAssets]);
        newAssets.push({
          id: uuidv4(),
          logicalId,
          filename: `scene-${sc.sceneId}.png`,
          type: 'image',
          mimeType: 'image/png',
          url: sc.imageUrl,
        });
        newCommands.push({
          id: uuidv4(),
          type: 'show',
          asset: logicalId,
          start: sc.startTime,
          duration: sc.endTime - sc.startTime,
        } as Command);
      }

      const store = useDocuFlowStore.getState();
      store.beginBatch();
      newAssets.forEach((a) => store.addAsset(a));
      newCommands.forEach((c) => store.addCommand(c));
      store.endBatch();

      setToast({ message: `Timeline built: ${newAssets.length} scenes`, type: 'success' });
      setActiveTab('studio');
    } catch (err) {
      setToast({ message: `Timeline error: ${err instanceof Error ? err.message : String(err)}`, type: 'error' });
    } finally {
      setGeneratingAll(false);
    }
  }, [scenes, cloudflareConfig, advancedSettings, setActiveTab]);

  // -----------------------------------------------------------------------
  // Edit helpers
  // -----------------------------------------------------------------------

  const handleUpdateScene = useCallback((sceneId: number, updates: Partial<StoryboardScene>) => {
    setScenes((prev) => prev.map((s) => (s.sceneId === sceneId ? { ...s, ...updates } : s)));
  }, []);

  const handleRemoveScene = useCallback((sceneId: number) => {
    setScenes((prev) => prev.filter((s) => s.sceneId !== sceneId));
  }, []);

  const handleAISettingChange = useCallback((patch: Partial<typeof aiSettings>) => {
    setAISettings((prev) => {
      const next = { ...prev, ...patch };
      saveAIProviderSettings(next);
      return next;
    });
  }, []);

  const handleGeminiConfigChange = useCallback((patch: Partial<GeminiProviderConfig>) => {
    setGeminiConfig((prev) => {
      const next = { ...prev, ...patch };
      saveGeminiConfig(next);
      return next;
    });
    setGeminiTestResult(null);
    setGeminiTestResponse(null);
  }, []);

  const handleTestGemini = useCallback(async () => {
    setGeminiTesting(true);
    setGeminiTestResult(null);
    setGeminiTestResponse(null);
    try {
      const result = await testGeminiConnection(geminiConfig);
      setGeminiTestResult(result);
    } finally {
      setGeminiTesting(false);
    }
  }, [geminiConfig]);

  const handleRunGeminiTestPrompt = useCallback(async () => {
    setGeminiTesting(true);
    setGeminiTestResponse(null);
    setGeminiTestResult(null);
    try {
      const result = await generateStructuredResponse<unknown>(
        geminiConfig,
        geminiTestPrompt,
        { systemInstruction: 'You are a helpful assistant. Return only valid JSON.' },
      );
      if (result.success) {
        setGeminiTestResponse(JSON.stringify(result.data, null, 2));
        setGeminiTestResult({
          connected: true,
          model: result.model || geminiConfig.model,
          responseTimeMs: result.responseTimeMs,
        });
      } else {
        setGeminiTestResult({
          connected: false,
          model: geminiConfig.model,
          error: result.error,
          responseTimeMs: result.responseTimeMs,
        });
      }
    } finally {
      setGeminiTesting(false);
    }
  }, [geminiConfig, geminiTestPrompt]);

  const handleClearAll = useCallback(() => {
    setAudioFilePath('');
    setAudioFileName('');
    setScriptText('');
    setTranscription(null);
    setTranscriptionError(null);
    setScenes([]);
    setSceneError(null);
    setLiveOutput('');
    setThinkingLog('');
    setInspectorStatus('idle');
    setElapsedMs(0);
  }, []);

  const handleOffloadModel = useCallback(async () => {
    if (aiSettings.provider === 'ollama' && aiSettings.ollamaModel) {
      await offloadModel(aiSettings.ollamaModel);
    }
  }, [aiSettings]);

  // Toast auto-dismiss
  React.useEffect(() => {
    if (toast) {
      const t = setTimeout(() => setToast(null), 3000);
      return () => clearTimeout(t);
    }
  }, [toast]);

  // Cleanup elapsed timer on unmount
  React.useEffect(() => {
    return () => {
      if (elapsedRef.current) clearInterval(elapsedRef.current);
    };
  }, []);

  // Fetch Ollama models when panel opens or provider switches to ollama
  React.useEffect(() => {
    if (aiSettings.provider !== 'ollama') return;
    let cancelled = false;

    async function load() {
      setOllamaStatus('checking');
      const models = await fetchOllamaModels();
      if (cancelled) return;
      if (models.length > 0) {
        setOllamaModels(models);
        setOllamaStatus('online');
        // Auto-select first model if current one isn't in the list
        if (!models.some((m) => m.name === aiSettings.ollamaModel)) {
          handleAISettingChange({ ollamaModel: models[0].name });
        }
      } else {
        // Auto-start Ollama
        setOllamaStatus('starting');
        try {
          await window.docuflow.startOllama();
        } catch {}
        // Re-check after start attempt
        const retry = await fetchOllamaModels();
        if (cancelled) return;
        if (retry.length > 0) {
          setOllamaModels(retry);
          setOllamaStatus('online');
          if (!retry.some((m) => m.name === aiSettings.ollamaModel)) {
            handleAISettingChange({ ollamaModel: retry[0].name });
          }
        } else {
          setOllamaModels([]);
          setOllamaStatus('offline');
        }
      }
    }

    load();
    return () => { cancelled = true; };
  }, [aiSettings.provider, showAISettings]);

  // -----------------------------------------------------------------------
  // Render
  // -----------------------------------------------------------------------

  return (
    <div className="h-full flex flex-col bg-slate-950 text-white overflow-hidden relative">
      {/* Toast */}
      {toast && (
        <div className={`fixed top-4 right-4 z-50 flex items-center gap-2 px-4 py-2.5 rounded-lg shadow-lg backdrop-blur-sm transition-all ${
          toast.type === 'success' ? 'bg-emerald-500/90 text-white' : 'bg-red-500/90 text-white'
        }`}>
          {toast.type === 'success' ? <CheckCircle size={14} /> : <X size={14} />}
          <span className="text-[11px] font-medium max-w-[300px] truncate">{toast.message}</span>
        </div>
      )}

      {/* Header */}
      <div className="shrink-0 border-b border-white/5 bg-slate-900/40 px-4 py-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-amber-500 to-orange-600 flex items-center justify-center">
              <Clapperboard size={14} className="text-white" />
            </div>
            <div>
              <h1 className="text-[13px] font-bold text-white">AI Scene Generator</h1>
              <p className="text-[10px] text-slate-400">Transcribe, breakdown with AI, generate & build timeline</p>
            </div>
          </div>
          <div className="flex items-center gap-1.5">
            {/* Inspector toggle */}
            <button
              onClick={() => setInspectorOpen(!inspectorOpen)}
              className={`flex items-center gap-1 px-2 py-1 rounded-md text-[10px] font-medium transition-all ${
                inspectorOpen
                  ? 'bg-amber-500/20 text-amber-300 border border-amber-500/30'
                  : 'bg-slate-800/60 text-slate-400 border border-white/5 hover:text-white hover:border-white/10'
              }`}
            >
              <MonitorDot size={10} />
              Inspector
            </button>
            <button
              onClick={() => setShowAISettings(!showAISettings)}
              className={`flex items-center gap-1 px-2 py-1 rounded-md text-[10px] font-medium transition-all ${
                showAISettings
                  ? 'bg-amber-500/20 text-amber-300 border border-amber-500/30'
                  : 'bg-slate-800/60 text-slate-400 border border-white/5 hover:text-white hover:border-white/10'
              }`}
            >
              <Settings size={10} />
              AI Settings
            </button>
            <button
              onClick={handleClearAll}
              className="flex items-center gap-1 px-2 py-1 rounded-md text-[10px] font-medium bg-slate-800/60 text-slate-400 border border-white/5 hover:text-white hover:border-white/10 transition-all"
            >
              <Trash2 size={10} />
              Reset
            </button>
          </div>
        </div>

        {/* Step indicators */}
        <div className="flex items-center gap-2 mt-3">
          {[
            { num: 1, label: 'Transcribe', done: !!step1Done },
            { num: 2, label: 'AI Scene Break', done: step2Done },
            { num: 3, label: 'Generate & Build', done: false },
          ].map((step, i) => (
            <React.Fragment key={step.num}>
              {i > 0 && <div className="w-6 h-px bg-white/10" />}
              <div className={`flex items-center gap-1.5 px-2 py-1 rounded-md text-[10px] font-medium ${
                step.done
                  ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
                  : 'bg-slate-800/40 text-slate-500 border border-white/5'
              }`}>
                {step.done ? <CheckCircle size={10} /> : <span className="w-4 h-4 rounded-full bg-slate-700/50 flex items-center justify-center text-[9px]">{step.num}</span>}
                {step.label}
              </div>
            </React.Fragment>
          ))}
        </div>

        {/* Model loading progress bar — visible during AI breakdown */}
        {modelLoading && (
          <div className="mt-3 flex items-center gap-3">
            <div className="flex-1">
              <div className="flex items-center justify-between mb-1">
                <span className="text-[9px] text-amber-400 font-medium flex items-center gap-1">
                  <Loader2 size={9} className="animate-spin" />
                  Loading {aiSettings.ollamaModel} to GPU...
                </span>
                <span className="text-[8px] text-slate-500 font-mono">{formatElapsed(elapsedMs)}</span>
              </div>
              <div className="w-full bg-slate-800 rounded-full h-1.5 overflow-hidden">
                <div className="h-full bg-gradient-to-r from-amber-500 to-orange-400 rounded-full animate-pulse"
                  style={{ width: '50%' }} />
              </div>
              <p className="text-[8px] text-slate-600 mt-0.5">First token arrives after model loads into VRAM (~30-60s)</p>
            </div>
          </div>
        )}
      </div>

      {/* AI Settings Panel */}
      {showAISettings && (
        <div className="shrink-0 border-b border-white/5 bg-slate-900/60 px-4 py-3 space-y-3">
          <div className="flex items-center justify-between mb-1">
            <h3 className="text-[11px] font-semibold text-slate-300 uppercase tracking-wider flex items-center gap-1.5">
              <Sparkles size={11} />
              AI Provider Settings
            </h3>
            <button onClick={() => setShowAISettings(false)} className="text-slate-500 hover:text-white">
              <X size={12} />
            </button>
          </div>

          {/* Provider selector */}
          <div className="flex gap-2">
            <button
              onClick={() => handleAISettingChange({ provider: 'ollama' })}
              className={`flex-1 flex items-center justify-center gap-2 px-3 py-2 rounded-lg text-[11px] font-medium transition-all ${
                aiSettings.provider === 'ollama'
                  ? 'bg-amber-500/15 text-amber-300 border border-amber-500/30'
                  : 'bg-slate-800/40 text-slate-400 border border-white/5 hover:text-white hover:border-white/10'
              }`}
            >
              <Cpu size={13} />
              <div className="text-left">
                <div>Ollama (Local)</div>
                <div className="text-[8px] text-slate-500">Offline, free, private</div>
              </div>
            </button>
            <button
              onClick={() => handleAISettingChange({ provider: 'openrouter' })}
              className={`flex-1 flex items-center justify-center gap-2 px-3 py-2 rounded-lg text-[11px] font-medium transition-all ${
                aiSettings.provider === 'openrouter'
                  ? 'bg-indigo-500/15 text-indigo-300 border border-indigo-500/30'
                  : 'bg-slate-800/40 text-slate-400 border border-white/5 hover:text-white hover:border-white/10'
              }`}
            >
              <Globe size={13} />
              <div className="text-left">
                <div>OpenRouter (Cloud)</div>
                <div className="text-[8px] text-slate-500">Free tier available</div>
              </div>
            </button>
            <button
              onClick={() => handleAISettingChange({ provider: 'gemini' })}
              className={`flex-1 flex items-center justify-center gap-2 px-3 py-2 rounded-lg text-[11px] font-medium transition-all ${
                aiSettings.provider === 'gemini'
                  ? 'bg-sky-500/15 text-sky-300 border border-sky-500/30'
                  : 'bg-slate-800/40 text-slate-400 border border-white/5 hover:text-white hover:border-white/10'
              }`}
            >
              <Brain size={13} />
              <div className="text-left">
                <div>Gemini (Cloud)</div>
                <div className="text-[8px] text-slate-500">Google AI, vision capable</div>
              </div>
            </button>
          </div>

          {/* Ollama settings */}
          {aiSettings.provider === 'ollama' && (
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <label className="text-[9px] text-slate-400 uppercase tracking-wider shrink-0">Model:</label>
                {ollamaStatus === 'checking' ? (
                  <div className="flex-1 flex items-center gap-2 bg-slate-700/50 border border-white/10 rounded px-2 py-1.5 text-[10px] text-slate-400">
                    <Loader2 size={10} className="animate-spin" />
                    Checking Ollama...
                  </div>
                ) : ollamaModels.length > 0 ? (
                  <select
                    value={aiSettings.ollamaModel}
                    onChange={(e) => handleAISettingChange({ ollamaModel: e.target.value })}
                    className="flex-1 bg-slate-700/50 border border-white/10 rounded px-2 py-1.5 text-[11px] text-white"
                  >
                    {ollamaModels.map((m) => (
                      <option key={m.name} value={m.name}>
                        {m.name} ({m.parameter_size})
                      </option>
                    ))}
                  </select>
                ) : (
                  <input
                    type="text"
                    value={aiSettings.ollamaModel}
                    onChange={(e) => handleAISettingChange({ ollamaModel: e.target.value })}
                    placeholder="llama3.2"
                    className="flex-1 bg-slate-700/50 border border-white/10 rounded px-2 py-1.5 text-[11px] text-white placeholder:text-slate-600 focus:outline-none focus:ring-1 focus:ring-amber-500"
                  />
                )}
              </div>
              {ollamaStatus === 'starting' && (
                <div className="text-[9px] text-amber-400 flex items-center gap-1.5">
                  <Loader2 size={9} className="animate-spin" />
                  Starting Ollama server...
                </div>
              )}
              {ollamaStatus === 'offline' && (
                <div className="flex items-center justify-between">
                  <div className="text-[9px] text-slate-500 flex items-center gap-1">
                    <AlertCircle size={9} className="text-amber-500" />
                    Ollama not running
                  </div>
                  <button
                    onClick={async () => {
                      setOllamaStatus('starting');
                      try { await window.docuflow.startOllama(); } catch {}
                      const models = await fetchOllamaModels();
                      if (models.length > 0) {
                        setOllamaModels(models);
                        setOllamaStatus('online');
                        if (!models.some((m) => m.name === aiSettings.ollamaModel)) {
                          handleAISettingChange({ ollamaModel: models[0].name });
                        }
                      } else {
                        setOllamaStatus('offline');
                      }
                    }}
                    className="text-[9px] px-2 py-0.5 rounded bg-amber-500/10 text-amber-400 border border-amber-500/20 hover:bg-amber-500/20 transition-colors"
                  >
                    Retry
                  </button>
                </div>
              )}
              {ollamaStatus === 'online' && (
                <div className="text-[9px] text-emerald-500 flex items-center gap-1">
                  <CheckCircle size={9} />
                  {ollamaModels.length} model{ollamaModels.length !== 1 ? 's' : ''} available
                </div>
              )}
              <div className="text-[9px] text-slate-600">localhost:11434</div>
            </div>
          )}

          {/* OpenRouter settings */}
          {aiSettings.provider === 'openrouter' && (
            <>
              <div className="flex items-center gap-2">
                <label className="text-[9px] text-slate-400 uppercase tracking-wider shrink-0 w-14">API Key:</label>
                <input
                  type="password"
                  value={aiSettings.openRouterApiKey}
                  onChange={(e) => handleAISettingChange({ openRouterApiKey: e.target.value })}
                  placeholder="sk-or-..."
                  className="flex-1 bg-slate-700/50 border border-white/10 rounded px-2 py-1.5 text-[11px] text-white placeholder:text-slate-600 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                />
              </div>
              <div className="flex items-center gap-2">
                <label className="text-[9px] text-slate-400 uppercase tracking-wider shrink-0 w-14">Model:</label>
                <select
                  value={aiSettings.openRouterModel}
                  onChange={(e) => handleAISettingChange({ openRouterModel: e.target.value })}
                  className="flex-1 bg-slate-700/50 border border-white/10 rounded px-2 py-1.5 text-[11px] text-white"
                >
                  <option value="openrouter/free">Free Auto-Router</option>
                  <option value="meta-llama/llama-3.2-3b-instruct:free">Llama 3.2 3B (free)</option>
                  <option value="google/gemma-2-9b-it:free">Gemma 2 9B (free)</option>
                  <option value="mistralai/mistral-7b-instruct:free">Mistral 7B (free)</option>
                </select>
              </div>
            </>
          )}

          {/* Gemini settings */}
          {aiSettings.provider === 'gemini' && (
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <label className="text-[9px] text-slate-400 uppercase tracking-wider shrink-0 w-14">API Key:</label>
                <input
                  type="password"
                  value={geminiConfig.apiKey}
                  onChange={(e) => handleGeminiConfigChange({ apiKey: e.target.value })}
                  placeholder="AIza..."
                  className="flex-1 bg-slate-700/50 border border-white/10 rounded px-2 py-1.5 text-[11px] text-white placeholder:text-slate-600 focus:outline-none focus:ring-1 focus:ring-sky-500"
                />
              </div>
              <div className="flex items-center gap-2">
                <label className="text-[9px] text-slate-400 uppercase tracking-wider shrink-0 w-14">Model:</label>
                <select
                  value={geminiConfig.model}
                  onChange={(e) => handleGeminiConfigChange({ model: e.target.value })}
                  className="flex-1 bg-slate-700/50 border border-white/10 rounded px-2 py-1.5 text-[11px] text-white"
                >
                  {GEMINI_MODELS.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.label} — {m.description}
                    </option>
                  ))}
                </select>
              </div>

              {/* Connection status */}
              {geminiConfig.apiKey && (
                <div className="flex items-center justify-between">
                  <div className="text-[9px] text-slate-500 flex items-center gap-1">
                    {geminiTestResult?.connected ? (
                      <>
                        <CheckCircle size={9} className="text-emerald-500" />
                        <span className="text-emerald-400">Connected</span>
                        {geminiTestResult.responseTimeMs && (
                          <span className="text-slate-600 ml-1">({geminiTestResult.responseTimeMs}ms)</span>
                        )}
                      </>
                    ) : geminiTestResult && !geminiTestResult.connected ? (
                      <>
                        <AlertCircle size={9} className="text-red-500" />
                        <span className="text-red-400">{geminiTestResult.error || 'Failed'}</span>
                      </>
                    ) : (
                      <>
                        <Key size={9} />
                        {maskApiKey(geminiConfig.apiKey)}
                      </>
                    )}
                  </div>
                  <button
                    onClick={handleTestGemini}
                    disabled={geminiTesting || !geminiConfig.apiKey}
                    className="text-[9px] px-2 py-0.5 rounded bg-sky-500/10 text-sky-400 border border-sky-500/20 hover:bg-sky-500/20 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    {geminiTesting ? 'Testing...' : 'Test Connection'}
                  </button>
                </div>
              )}

              {/* Advanced settings toggle */}
              <div className="border-t border-white/5 pt-2 mt-2">
                <button
                  onClick={() => setShowGeminiTestPanel(!showGeminiTestPanel)}
                  className="flex items-center gap-1.5 text-[9px] text-slate-400 hover:text-white transition-colors"
                >
                  {showGeminiTestPanel ? <ChevronDown size={10} /> : <ChevronRight size={10} />}
                  <Zap size={9} />
                  Test Prompt & Config
                </button>
              </div>

              {/* Test prompt panel */}
              {showGeminiTestPanel && (
                <div className="space-y-2 bg-slate-800/30 rounded-lg p-2 border border-white/5">
                  <div className="flex items-center gap-2">
                    <label className="text-[9px] text-slate-400 uppercase tracking-wider shrink-0 w-14">Temp:</label>
                    <input
                      type="number"
                      min="0"
                      max="2"
                      step="0.1"
                      value={geminiConfig.temperature}
                      onChange={(e) => handleGeminiConfigChange({ temperature: Number(e.target.value) })}
                      className="w-16 bg-slate-700/50 border border-white/10 rounded px-2 py-1 text-[11px] text-white"
                    />
                    <label className="text-[9px] text-slate-400 uppercase tracking-wider shrink-0 ml-2">Tokens:</label>
                    <input
                      type="number"
                      min="256"
                      max="32768"
                      step="256"
                      value={geminiConfig.maxOutputTokens}
                      onChange={(e) => handleGeminiConfigChange({ maxOutputTokens: Number(e.target.value) })}
                      className="w-20 bg-slate-700/50 border border-white/10 rounded px-2 py-1 text-[11px] text-white"
                    />
                  </div>
                  <div>
                    <label className="text-[9px] text-slate-400 uppercase tracking-wider block mb-1">Test Prompt:</label>
                    <textarea
                      value={geminiTestPrompt}
                      onChange={(e) => setGeminiTestPrompt(e.target.value)}
                      rows={2}
                      className="w-full bg-slate-700/50 border border-white/10 rounded px-2 py-1.5 text-[11px] text-white placeholder:text-slate-600 focus:outline-none focus:ring-1 focus:ring-sky-500 resize-none"
                    />
                  </div>
                  <button
                    onClick={handleRunGeminiTestPrompt}
                    disabled={geminiTesting || !geminiConfig.apiKey}
                    className="w-full flex items-center justify-center gap-1.5 px-3 py-1.5 rounded bg-sky-500/15 text-sky-300 border border-sky-500/30 text-[10px] font-medium hover:bg-sky-500/25 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    {geminiTesting ? (
                      <>
                        <Loader2 size={10} className="animate-spin" />
                        Running...
                      </>
                    ) : (
                      <>
                        <Zap size={10} />
                        Run Structured Test
                      </>
                    )}
                  </button>
                  {geminiTestResponse && (
                    <div className="bg-slate-900/80 rounded border border-white/5 p-2 max-h-40 overflow-y-auto">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="text-[9px] text-emerald-400 font-medium">Response:</span>
                        {geminiTestResult?.responseTimeMs && (
                          <span className="text-[8px] text-slate-500">{geminiTestResult.responseTimeMs}ms</span>
                        )}
                      </div>
                      <pre className="text-[10px] text-slate-300 whitespace-pre-wrap break-words font-mono">
                        {geminiTestResponse}
                      </pre>
                    </div>
                  )}
                  {geminiTestResult && !geminiTestResult.connected && geminiTestResult.error && (
                    <div className="bg-red-500/5 rounded border border-red-500/10 p-2">
                      <p className="text-[10px] text-red-400">{geminiTestResult.error}</p>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Main content: 2-panel split */}
      <div className="flex-1 flex min-h-0 overflow-hidden">
        {/* Left panel */}
        <div className="w-[380px] shrink-0 flex flex-col border-r border-white/5 overflow-hidden">
          <div className="flex-1 overflow-y-auto p-4 space-y-4">
            {/* Audio Upload */}
            <div>
              <h3 className="text-[11px] font-semibold text-slate-300 uppercase tracking-wider mb-2 flex items-center gap-1.5">
                <Mic size={11} />
                Audio File
              </h3>
              {audioFilePath ? (
                <div className="bg-slate-800/50 border border-white/10 rounded-lg p-3 space-y-2">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2 min-w-0">
                      <Mic size={12} className="text-amber-400 shrink-0" />
                      <span className="text-[11px] text-white truncate">{audioFileName}</span>
                    </div>
                    <button
                      onClick={() => { setAudioFilePath(''); setAudioFileName(''); setTranscription(null); setScenes([]); }}
                      className="text-slate-500 hover:text-white transition-colors shrink-0"
                    >
                      <X size={12} />
                    </button>
                  </div>
                  <div className="text-[9px] text-slate-500 font-mono truncate">{audioFilePath}</div>
                  <div className="flex items-center gap-2">
                    <label className="text-[9px] text-slate-400 uppercase tracking-wider">Whisper:</label>
                    <select
                      value={whisperModel}
                      onChange={(e) => setWhisperModel(e.target.value)}
                      disabled={transcribing}
                      className="flex-1 bg-slate-700/50 border border-white/10 rounded px-2 py-1 text-[10px] text-white disabled:opacity-50"
                    >
                      <option value="tiny">tiny</option>
                      <option value="base">base</option>
                      <option value="small">small</option>
                      <option value="medium">medium</option>
                      <option value="large-v3">large-v3</option>
                    </select>
                  </div>
                </div>
              ) : (
                <button
                  onClick={handleFileSelect}
                  className="w-full border-2 border-dashed border-white/10 rounded-lg p-5 flex flex-col items-center gap-2 text-slate-400 hover:border-amber-500/30 hover:text-amber-400 transition-colors"
                >
                  <Upload size={18} />
                  <span className="text-[11px] font-medium">Select audio file</span>
                </button>
              )}
            </div>

            {/* Script */}
            <div>
              <h3 className="text-[11px] font-semibold text-slate-300 uppercase tracking-wider mb-2 flex items-center gap-1.5">
                <FileText size={11} />
                Script (optional)
              </h3>
              <textarea
                value={scriptText}
                onChange={(e) => setScriptText(e.target.value)}
                placeholder="Paste script for better AI scene context..."
                rows={4}
                className="w-full bg-slate-800/50 border border-white/10 rounded-lg px-3 py-2 text-[11px] text-slate-200 placeholder:text-slate-600 resize-none focus:outline-none focus:ring-1 focus:ring-amber-500"
              />
            </div>

            {/* Transcribe */}
            <Button
              variant="primary"
              onClick={handleTranscribe}
              disabled={!canTranscribe}
              loading={transcribing}
              icon={transcribing ? <Loader2 size={12} className="animate-spin" /> : <Mic size={12} />}
              className="w-full justify-center gap-2 px-3 py-2.5 text-[11px] bg-gradient-to-r from-amber-600 to-orange-600 hover:from-amber-500 hover:to-orange-500 border-0"
            >
              {transcribing ? 'Transcribing...' : 'Transcribe Audio'}
            </Button>
            {transcriptionError && (
              <div className="flex items-start gap-1.5 text-[10px] text-red-400">
                <AlertCircle size={11} className="shrink-0 mt-0.5" />
                <span className="whitespace-pre-wrap">{transcriptionError}</span>
              </div>
            )}

            {/* Transcription segments */}
            {step1Done && transcription?.segments && (
              <div>
                <h3 className="text-[11px] font-semibold text-slate-300 uppercase tracking-wider mb-2 flex items-center gap-1.5">
                  <CheckCircle size={11} className="text-emerald-400" />
                  Transcript ({transcription.language})
                </h3>
                <div className="bg-slate-800/50 border border-white/10 rounded-lg p-2 max-h-40 overflow-y-auto space-y-1">
                  {transcription.segments.map((seg) => (
                    <div key={seg.id} className="flex gap-2 text-[10px] py-1 border-b border-white/5 last:border-0">
                      <span className="text-amber-400 font-mono shrink-0 w-16">{formatTime(seg.start)}</span>
                      <span className="text-slate-300">{seg.text}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* AI Breakdown */}
            {step1Done && (
              <div>
                <Button
                  variant="primary"
                  onClick={handleBreakScenes}
                  disabled={!canBreakScenes}
                  loading={breakingScenes}
                  icon={breakingScenes ? <Loader2 size={12} className="animate-spin" /> : <Sparkles size={12} />}
                  className="w-full justify-center gap-2 px-3 py-2.5 text-[11px] bg-gradient-to-r from-purple-600 to-pink-600 hover:from-purple-500 hover:to-pink-500 border-0"
                >
                  {breakingScenes
                    ? `AI analyzing with ${aiSettings.provider === 'ollama' ? aiSettings.ollamaModel : 'OpenRouter'}...`
                    : 'AI Scene Breakdown'}
                </Button>
                {sceneError && (
                  <div className="mt-2 flex items-start gap-1.5 text-[10px] text-amber-400">
                    <AlertCircle size={11} className="shrink-0 mt-0.5" />
                    <span className="whitespace-pre-wrap">{sceneError}</span>
                  </div>
                )}
              </div>
            )}

            {/* Batch generate */}
            {step2Done && (
              <div>
                <Button
                  variant="primary"
                  onClick={handleGenerateAll}
                  disabled={!canGenerateAll}
                  loading={generatingAll}
                  icon={generatingAll ? <Loader2 size={12} className="animate-spin" /> : <Wand2 size={12} />}
                  className="w-full justify-center gap-2 px-3 py-2.5 text-[11px] bg-gradient-to-r from-indigo-600 to-cyan-600 hover:from-indigo-500 hover:to-cyan-500 border-0"
                >
                  {generatingAll
                    ? `Generating ${generationProgress.current}/${generationProgress.total}...`
                    : 'Batch Generate All & Build Video'}
                </Button>
                {generatingAll && (
                  <div className="mt-2">
                    <div className="w-full bg-slate-700/50 rounded-full h-1.5 overflow-hidden">
                      <div
                        className="h-full bg-indigo-500 rounded-full transition-all duration-300"
                        style={{ width: `${(generationProgress.current / generationProgress.total) * 100}%` }}
                      />
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Right panel: Storyboard */}
        <div className="flex-1 flex flex-col overflow-hidden">
          <div className="flex-1 overflow-y-auto p-4">
            {scenes.length === 0 ? (
              <div className="h-full flex items-center justify-center">
                <div className="text-center text-slate-500">
                  <div className="w-12 h-12 rounded-2xl bg-slate-800/50 flex items-center justify-center mx-auto mb-3">
                    <Film size={22} className="text-slate-600" />
                  </div>
                  <h3 className="text-[12px] font-semibold text-slate-400 mb-1">No scenes yet</h3>
                  <p className="text-[10px] text-slate-600 max-w-[200px]">
                    Transcribe audio then click AI Scene Breakdown
                  </p>
                </div>
              </div>
            ) : (
              <div className="space-y-3">
                <div className="flex items-center justify-between mb-2">
                  <h3 className="text-[11px] font-semibold text-slate-300 uppercase tracking-wider flex items-center gap-1.5">
                    <Clapperboard size={11} />
                    Storyboard ({scenes.length} scenes)
                  </h3>
                </div>

                {scenes.map((scene) => (
                  <div
                    key={scene.sceneId}
                    className="bg-slate-800/50 border border-white/10 rounded-xl overflow-hidden hover:border-white/15 transition-colors"
                  >
                    {/* Card header */}
                    <div className="flex items-center justify-between px-3 py-2 border-b border-white/5 bg-slate-800/30">
                      <div className="flex items-center gap-2">
                        <span className="text-[10px] font-bold text-amber-400 bg-amber-500/10 px-2 py-0.5 rounded-md">
                          Scene {scene.sceneId}
                        </span>
                        <div className="flex items-center gap-1 text-[9px] font-mono text-slate-400 bg-slate-700/40 px-2 py-0.5 rounded">
                          <Clock size={9} />
                          {formatTimeShort(scene.startTime)} &mdash; {formatTimeShort(scene.endTime)}
                          <span className="text-slate-600 ml-0.5">({(scene.endTime - scene.startTime).toFixed(1)}s)</span>
                        </div>
                        <span className={`text-[9px] px-2 py-0.5 rounded-full font-medium ${
                          scene.cameraMotion === 'static' ? 'bg-slate-600/30 text-slate-400' :
                          scene.cameraMotion.includes('zoom') ? 'bg-amber-500/15 text-amber-400' :
                          'bg-indigo-500/15 text-indigo-400'
                        }`}>
                          {scene.cameraMotion.replace(/_/g, ' ')}
                        </span>
                      </div>
                      <div className="flex items-center gap-1">
                        <select
                          value={scene.cameraMotion}
                          onChange={(e) => handleUpdateScene(scene.sceneId, { cameraMotion: e.target.value as SceneItem['cameraMotion'] })}
                          className="bg-slate-700/50 border border-white/10 rounded px-1.5 py-0.5 text-[9px] text-slate-300"
                        >
                          {CAMERA_MOTIONS.map((m) => (
                            <option key={m.value} value={m.value}>{m.label}</option>
                          ))}
                        </select>
                        <button
                          onClick={() => handleRemoveScene(scene.sceneId)}
                          className="text-slate-600 hover:text-red-400 transition-colors p-0.5"
                        >
                          <X size={10} />
                        </button>
                      </div>
                    </div>

                    {/* Card body */}
                    <div className="p-3 space-y-2.5">
                      {/* Image preview */}
                      <div className="flex gap-3">
                        <div className="w-40 shrink-0">
                          {scene.imageUrl ? (
                            <div className="rounded-lg overflow-hidden border border-white/5 aspect-video bg-slate-900/50">
                              <img src={scene.imageUrl} alt="" className="w-full h-full object-cover" />
                            </div>
                          ) : scene.status === 'generating' ? (
                            <div className="rounded-lg border border-amber-500/20 aspect-video bg-amber-500/5 flex items-center justify-center">
                              <Loader2 size={18} className="text-amber-400 animate-spin" />
                            </div>
                          ) : scene.status === 'error' ? (
                            <div className="rounded-lg border border-red-500/20 aspect-video bg-red-500/5 flex items-center justify-center p-2">
                              <span className="text-[8px] text-red-400 text-center leading-tight">{scene.error}</span>
                            </div>
                          ) : (
                            <div className="rounded-lg border border-white/5 aspect-video bg-slate-900/50 flex items-center justify-center">
                              <ImageIcon size={14} className="text-slate-700" />
                            </div>
                          )}
                        </div>

                        <div className="flex-1 min-w-0 space-y-2">
                          {/* Voiceover text */}
                          <div>
                            <label className="text-[8px] text-slate-500 uppercase tracking-wider block mb-0.5">Voiceover</label>
                            <p className="text-[10px] text-slate-300 leading-relaxed line-clamp-3">{scene.transcriptChunk}</p>
                          </div>
                          {/* Visual description */}
                          <div>
                            <label className="text-[8px] text-slate-500 uppercase tracking-wider block mb-0.5">Visual</label>
                            <p className="text-[10px] text-slate-400 leading-relaxed line-clamp-2">{scene.visualDescription}</p>
                          </div>
                        </div>
                      </div>

                      {/* Editable image prompt */}
                      <div>
                        <label className="text-[8px] text-slate-500 uppercase tracking-wider block mb-1">Image Prompt (FLUX/SD)</label>
                        <textarea
                          value={scene.imagePrompt}
                          onChange={(e) => handleUpdateScene(scene.sceneId, { imagePrompt: e.target.value })}
                          rows={2}
                          className="w-full bg-slate-700/30 border border-white/5 rounded-lg px-2.5 py-1.5 text-[10px] text-slate-300 resize-none focus:outline-none focus:ring-1 focus:ring-amber-500 transition-all"
                        />
                      </div>

                      {/* Generate button */}
                      <div className="flex items-center justify-between">
                        <span className="text-[9px] text-slate-600">
                          {scene.status === 'done' ? 'Image ready' : scene.status === 'generating' ? 'Generating...' : ''}
                        </span>
                        <Button
                          variant="secondary"
                          size="sm"
                          onClick={() => handleGenerateSingle(scene.sceneId)}
                          disabled={scene.status === 'generating' || !cloudflareConfig.workerUrl}
                          loading={scene.status === 'generating'}
                          icon={<ImageIcon size={10} />}
                          className="px-2.5 py-1 text-[9px] border border-white/10 hover:border-amber-500/30 hover:text-amber-300"
                        >
                          {scene.status === 'done' ? 'Regenerate' : 'Generate Image'}
                        </Button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Thinking Inspector Panel — slides in from right */}
      <ThinkingInspector
        open={inspectorOpen}
        onToggle={() => setInspectorOpen(!inspectorOpen)}
        active={inspectorStatus === 'thinking' || inspectorStatus === 'loading_model' || inspectorStatus === 'generating'}
        thinkingLog={thinkingLog}
        liveOutput={liveOutput}
        elapsedMs={elapsedMs}
        status={inspectorStatus}
        progress={generatingAll ? generationProgress : undefined}
        modelName={aiSettings.provider === 'ollama' ? aiSettings.ollamaModel : aiSettings.provider}
        onOffload={handleOffloadModel}
      />
    </div>
  );
};
