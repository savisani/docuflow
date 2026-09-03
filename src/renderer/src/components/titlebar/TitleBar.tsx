import React, { useState, useEffect, useCallback } from 'react';
import { Minus, Square, X, Maximize2, Play, RotateCcw, Undo2, Redo2, PanelLeft, Image, SlidersHorizontal, Sparkles, Film, Clapperboard, Cpu, Zap } from 'lucide-react';
import { useDocuFlowStore } from '../../app/store';
import { buildTimeline } from '../../engine/timeline/builder';
import { validateCommands } from '../../engine/commands/validator';
import { loadAssetMetadata } from '../../engine/media/loader';
import { generateId } from '../../utils/format';
import { fetchOllamaPs } from '../../services/aiService';
import { Tooltip } from '../ui';
import { listLocalModels } from '../../services/localImageProvider';

const TABS = [
  { id: 'studio' as const, label: 'Studio', icon: Film },
  { id: 'generator' as const, label: 'Image Gen', icon: Sparkles },
  { id: 'scenes' as const, label: 'Scene Gen', icon: Clapperboard },
] as const;

export const TitleBar: React.FC = () => {
  const [isMaximized, setIsMaximized] = useState(false);
  const {
    settings, assets, commands, historyIndex, history,
    panelVisibility, setPanelVisibility,
    setTimeline, setSettings, setCommands, setAssets, undo, redo,
    activeTab, setActiveTab,
    ollamaModelStatus, ollamaModelName, setOllamaModelStatus,
    gpuStatus, setGpuStatus, setGpuStatusLoading,
    localModelCount, localModelNames, setLocalModelInfo,
    loadedModelName, modelLoadState, setLoadedModel,
  } = useDocuFlowStore();

  const [gpuPolling, setGpuPolling] = useState(false);

  useEffect(() => {
    window.docuflow?.isMaximized()?.then(setIsMaximized);
    const unsubscribe = window.docuflow?.onMaximizedChange(setIsMaximized);
    return () => { unsubscribe?.(); };
  }, []);

  // Poll GPU status
  useEffect(() => {
    let cancelled = false;
    const pollGpu = async () => {
      if (gpuPolling) return;
      setGpuPolling(true);
      try {
        const status = await window.docuflow.getGpuStatus();
        if (!cancelled) setGpuStatus(status);
      } catch {
        if (!cancelled) setGpuStatus(null);
      } finally {
        if (!cancelled) setGpuPolling(false);
      }
    };
    pollGpu();
    const interval = setInterval(pollGpu, 10000); // Poll every 10s
    return () => { cancelled = true; clearInterval(interval); };
  }, [setGpuStatus]);

  // Load local model info
  useEffect(() => {
    let cancelled = false;
    const loadModels = async () => {
      try {
        const models = await listLocalModels();
        if (!cancelled) {
          setLocalModelInfo(models.length, models.map(m => m.name));
        }
      } catch {}
    };
    loadModels();
    const interval = setInterval(loadModels, 30000); // Refresh every 30s
    return () => { cancelled = true; clearInterval(interval); };
  }, [setLocalModelInfo]);

  useEffect(() => {
    let cancelled = false;
    const poll = async () => {
      try {
        const ps = await fetchOllamaPs();
        if (cancelled) return;
        if (ps.models.length > 0) {
          setOllamaModelStatus('loaded', ps.models[0].name);
        } else {
          setOllamaModelStatus('unknown');
        }
      } catch {
        if (!cancelled) setOllamaModelStatus('error');
      }
    };
    poll();
    const interval = setInterval(poll, 5000);
    return () => { cancelled = true; clearInterval(interval); };
  }, [setOllamaModelStatus]);

  const handleMinimize = useCallback(() => { window.docuflow?.minimize(); }, []);
  const handleMaximize = useCallback(() => { window.docuflow?.maximize(); }, []);
  const handleClose = useCallback(() => { window.docuflow?.close(); }, []);

  const handleOffload = useCallback(async () => {
    try {
      setLoadedModel(null, 'unloading');
      // Cancel any running generation
      await window.docuflow.cancelLocalGeneration();
      // Force GPU status refresh after a delay
      setTimeout(async () => {
        try {
          const status = await window.docuflow.getGpuStatus();
          setGpuStatus(status);
          setLoadedModel(null, 'unloaded');
        } catch {}
      }, 2000);
    } catch {}
  }, [setGpuStatus, setLoadedModel]);

  const handleBuild = useCallback(() => {
    const state = useDocuFlowStore.getState();
    const validation = validateCommands(state.commands, state.assets);
    if (!validation.valid) {
      console.info('Building timeline with warnings:', validation.errors.map((e) => e.message).join('; '));
    }
    const voiceoverAsset = state.voiceover ? state.assets.find(a => a.id === state.voiceover!.assetId) : undefined;
    const timeline = buildTimeline(state.commands, state.assets, state.settings, voiceoverAsset?.duration);
    setTimeline(timeline);
  }, [setTimeline]);

  const handleLoadDemo = useCallback(async () => {
    try {
      const response = await fetch('/demo-commands.docuflow.json');
      const project = await response.json();

      if (project.settings) setSettings(project.settings);
      if (project.commands) setCommands(project.commands);

      const demoAssets = [
        { filename: 'image1.jpg', type: 'image' as const, mimeType: 'image/jpeg' },
        { filename: 'image2.jpg', type: 'image' as const, mimeType: 'image/jpeg' },
        { filename: 'image3.jpg', type: 'image' as const, mimeType: 'image/jpeg' },
        { filename: 'whoosh.wav', type: 'audio' as const, mimeType: 'audio/wav' },
      ];

      const loadedAssets: any[] = [];
      for (const assetInfo of demoAssets) {
        try {
          const res = await fetch(`/${assetInfo.filename}`);
          if (res.ok) {
            const blob = await res.blob();
            const file = new File([blob], assetInfo.filename, { type: assetInfo.mimeType });
            const metadata = await loadAssetMetadata(file, loadedAssets);
            const newAsset = { id: generateId(), ...metadata };
            loadedAssets.push(newAsset);
          }
        } catch (err) {
          console.warn(`Failed to load demo asset ${assetInfo.filename}:`, err);
        }
      }

      if (loadedAssets.length > 0) {
        setAssets(loadedAssets);
        const currentState = useDocuFlowStore.getState();
        if (currentState.commands.length > 0) {
          const voiceoverAsset = currentState.voiceover ? currentState.assets.find(a => a.id === currentState.voiceover!.assetId) : undefined;
          const tl = buildTimeline(currentState.commands, loadedAssets, currentState.settings, voiceoverAsset?.duration);
          setTimeline(tl);
        }
      }
      useDocuFlowStore.getState().resetHistory();
    } catch (err) {
      console.error('Failed to load demo:', err);
    }
  }, [setSettings, setCommands, setAssets, setTimeline]);

  const canUndo = historyIndex > 0;
  const canRedo = historyIndex < history.length - 1;

  return (
    <div
      className="h-[36px] flex items-center bg-df-surface-1 border-b border-df-border select-none shrink-0"
      style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}
    >
      {/* Left: Logo + Title */}
      <div className="flex items-center gap-2 px-3 shrink-0">
        <div className="w-5 h-5 rounded-df-sm bg-df-accent flex items-center justify-center">
          <span className="text-df-xs font-bold text-white">D</span>
        </div>
        <span className="text-df-sm font-semibold text-df-text-primary tracking-wide">DocuFlow</span>
      </div>

      <div className="w-px h-4 bg-df-divider mx-1" />

      {/* Workspace Tabs — Segmented Control */}
      <div
        className="flex items-center bg-df-surface-2 rounded-df-md border border-df-border p-px"
        style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
      >
        {TABS.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`
              flex items-center gap-1.5 px-2.5 py-1 rounded-df-sm text-df-xs font-medium
              transition-all duration-df-fast
              ${activeTab === tab.id
                ? 'bg-df-accent text-white shadow-sm'
                : 'text-df-text-muted hover:text-df-text-primary hover:bg-df-surface-3'}
            `}
          >
            <tab.icon size={11} />
            <span>{tab.label}</span>
          </button>
        ))}
      </div>

      <div className="w-px h-4 bg-df-divider mx-1" />

      {/* Actions */}
      <div
        className="flex items-center gap-0.5"
        style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
      >
        <Tooltip content="Build Timeline (Ctrl+B)" position="bottom">
          <button
            onClick={handleBuild}
            className="flex items-center gap-1.5 px-2 py-1 rounded-df-sm text-df-xs font-medium bg-df-surface-2 hover:bg-df-surface-3 border border-df-border text-df-text-primary transition-all duration-df-fast active:scale-[0.97]"
          >
            <Play size={11} />
            <span>Build</span>
          </button>
        </Tooltip>
        <Tooltip content="Load Demo Project" position="bottom">
          <button
            onClick={handleLoadDemo}
            className="flex items-center gap-1.5 px-2 py-1 rounded-df-sm text-df-xs font-medium bg-df-surface-2 hover:bg-df-surface-3 border border-df-border text-df-text-secondary hover:text-df-text-primary transition-all duration-df-fast active:scale-[0.97]"
          >
            <RotateCcw size={11} />
            <span>Demo</span>
          </button>
        </Tooltip>

        <div className="w-px h-4 bg-df-divider mx-1" />

        <Tooltip content="Undo (Ctrl+Z)" position="bottom">
          <button
            onClick={undo}
            disabled={!canUndo}
            className="w-[26px] h-[26px] flex items-center justify-center rounded-df-sm text-df-text-muted hover:text-df-text-primary hover:bg-df-surface-3 transition-all duration-df-fast disabled:opacity-30 disabled:cursor-not-allowed"
          >
            <Undo2 size={12} />
          </button>
        </Tooltip>
        <Tooltip content="Redo (Ctrl+Shift+Z)" position="bottom">
          <button
            onClick={redo}
            disabled={!canRedo}
            className="w-[26px] h-[26px] flex items-center justify-center rounded-df-sm text-df-text-muted hover:text-df-text-primary hover:bg-df-surface-3 transition-all duration-df-fast disabled:opacity-30 disabled:cursor-not-allowed"
          >
            <Redo2 size={12} />
          </button>
        </Tooltip>

        <div className="w-px h-4 bg-df-divider mx-1" />

        {/* Panel toggles */}
        <Tooltip content="Assets Panel" position="bottom">
          <button
            onClick={() => setPanelVisibility('assets', !panelVisibility.assets)}
            className={`w-[26px] h-[26px] flex items-center justify-center rounded-df-sm transition-all duration-df-fast ${
              panelVisibility.assets
                ? 'bg-df-accent-muted text-df-accent'
                : 'text-df-text-muted hover:text-df-text-primary hover:bg-df-surface-3'
            }`}
          >
            <PanelLeft size={12} />
          </button>
        </Tooltip>
        <Tooltip content="Asset Preview" position="bottom">
          <button
            onClick={() => setPanelVisibility('assetPreview', !panelVisibility.assetPreview)}
            className={`w-[26px] h-[26px] flex items-center justify-center rounded-df-sm transition-all duration-df-fast ${
              panelVisibility.assetPreview
                ? 'bg-df-accent-muted text-df-accent'
                : 'text-df-text-muted hover:text-df-text-primary hover:bg-df-surface-3'
            }`}
          >
            <Image size={12} />
          </button>
        </Tooltip>
        <Tooltip content="Inspector" position="bottom">
          <button
            onClick={() => setPanelVisibility('inspector', !panelVisibility.inspector)}
            className={`w-[26px] h-[26px] flex items-center justify-center rounded-df-sm transition-all duration-df-fast ${
              panelVisibility.inspector
                ? 'bg-df-accent-muted text-df-accent'
                : 'text-df-text-muted hover:text-df-text-primary hover:bg-df-surface-3'
            }`}
          >
            <SlidersHorizontal size={12} />
          </button>
        </Tooltip>
      </div>

      {/* Spacer */}
      <div className="flex-1" />

      {/* Right: Status + Window Controls */}
      <div className="flex items-center gap-2 shrink-0">
        <div
          className="flex items-center gap-1.5 text-df-xs text-df-text-muted font-mono mr-1"
          style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
        >
          <span>{settings.width}x{settings.height}</span>
          <span className="text-df-text-dim">@</span>
          <span>{settings.fps}fps</span>
        </div>

        {/* GPU Status */}
        <div
          className="flex items-center gap-1.5 px-2 py-0.5 rounded-df-sm text-df-xs font-mono"
          style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
          title={
            gpuStatus
              ? `GPU: ${gpuStatus.device_name}\nVRAM: ${gpuStatus.allocated_vram_gb?.toFixed(1) || 0} / ${gpuStatus.total_vram_gb?.toFixed(1) || 0} GB\nFree: ${gpuStatus.free_vram_gb?.toFixed(1) || 0} GB\nLocal models: ${localModelCount}${loadedModelName ? `\nLoaded: ${loadedModelName} (${modelLoadState})` : ''}`
              : 'GPU status unavailable'
          }
        >
          <Cpu size={10} className={gpuStatus?.cuda ? 'text-df-success' : 'text-df-text-dim'} />
          <span className="text-df-text-muted">
            {gpuStatus?.cuda
              ? `${gpuStatus.allocated_vram_gb?.toFixed(1) || '?'} / ${gpuStatus.total_vram_gb?.toFixed(1) || '?'} GB`
              : 'No GPU'}
          </span>
          {localModelCount > 0 && (
            <>
              <span className="text-df-text-dim">|</span>
              <span className="text-df-text-muted">{localModelCount} model{localModelCount !== 1 ? 's' : ''}</span>
            </>
          )}
          {loadedModelName && (
            <>
              <span className="text-df-text-dim">|</span>
              <span className={`text-df-xs ${
                modelLoadState === 'generating' ? 'text-df-accent animate-pulse' :
                modelLoadState === 'loading' ? 'text-df-warning animate-pulse' :
                modelLoadState === 'loaded' ? 'text-df-success' :
                'text-df-text-muted'
              }`}>
                {modelLoadState === 'generating' ? '⚡' : modelLoadState === 'loading' ? '⏳' : modelLoadState === 'loaded' ? '●' : '○'}
                {' '}{loadedModelName}
              </span>
            </>
          )}
        </div>

        {/* Offload Button */}
        <Tooltip content={loadedModelName ? `Offload ${loadedModelName} from GPU` : "Offload AI models from GPU"} position="bottom">
          <button
            onClick={handleOffload}
            disabled={!gpuStatus?.cuda || (!loadedModelName && (gpuStatus?.allocated_vram_gb || 0) < 0.1)}
            className="flex items-center gap-1 px-1.5 py-0.5 rounded-df-sm text-df-xs font-medium bg-df-surface-2 hover:bg-df-surface-3 border border-df-border text-df-text-secondary hover:text-df-text-primary transition-all duration-df-fast disabled:opacity-30 disabled:cursor-not-allowed"
            style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
          >
            <Zap size={9} />
            <span>Offload</span>
          </button>
        </Tooltip>

        {/* Model status */}
        <div
          className="flex items-center gap-1.5 px-2 py-0.5 rounded-df-sm text-df-xs font-mono"
          style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
          title={
            ollamaModelStatus === 'loaded'
              ? `Model loaded: ${ollamaModelName}`
              : ollamaModelStatus === 'loading'
                ? 'Model loading...'
                : ollamaModelStatus === 'error'
                  ? 'Ollama connection error'
                  : 'No model loaded'
          }
        >
          <span
            className={`w-1.5 h-1.5 rounded-full ${
              ollamaModelStatus === 'loaded'
                ? 'bg-df-success'
                : ollamaModelStatus === 'loading'
                  ? 'bg-df-warning animate-pulse'
                  : ollamaModelStatus === 'error'
                    ? 'bg-df-error'
                    : 'bg-df-text-dim'
            }`}
          />
          <span className="text-df-text-muted">
            {ollamaModelStatus === 'loaded'
              ? ollamaModelName || 'Loaded'
              : ollamaModelStatus === 'loading'
                ? 'Loading'
                : ollamaModelStatus === 'error'
                  ? 'Error'
                  : 'No model'}
          </span>
        </div>

        <div
          className="flex items-center h-full"
          style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
        >
          <button
            onClick={handleMinimize}
            className="h-full w-[36px] flex items-center justify-center text-df-text-muted hover:text-df-text-primary hover:bg-df-surface-2 transition-colors"
            aria-label="Minimize"
          >
            <Minus size={13} strokeWidth={1.5} />
          </button>
          <button
            onClick={handleMaximize}
            className="h-full w-[36px] flex items-center justify-center text-df-text-muted hover:text-df-text-primary hover:bg-df-surface-2 transition-colors"
            aria-label={isMaximized ? 'Restore' : 'Maximize'}
          >
            {isMaximized ? <Square size={10} strokeWidth={1.5} /> : <Maximize2 size={11} strokeWidth={1.5} />}
          </button>
          <button
            onClick={handleClose}
            className="h-full w-[36px] flex items-center justify-center text-df-text-muted hover:text-white hover:bg-df-error transition-colors"
            aria-label="Close"
          >
            <X size={13} strokeWidth={1.5} />
          </button>
        </div>
      </div>
    </div>
  );
};
