import React, { useState, useEffect, useCallback } from 'react';
import { Minus, Square, X, Maximize2, Play, RotateCcw, Undo2, Redo2, PanelLeft, Image, SlidersHorizontal, Sparkles, Film, Clapperboard } from 'lucide-react';
import { useDocuFlowStore } from '../../app/store';
import { buildTimeline } from '../../engine/timeline/builder';
import { validateCommands } from '../../engine/commands/validator';
import { loadAssetMetadata } from '../../engine/media/loader';
import { generateId } from '../../utils/format';

export const TitleBar: React.FC = () => {
  const [isMaximized, setIsMaximized] = useState(false);
  const { settings, assets, commands, historyIndex, history, panelVisibility, setPanelVisibility, setTimeline, setSettings, setCommands, setAssets, undo, redo, activeTab, setActiveTab } = useDocuFlowStore();

  useEffect(() => {
    window.docuflow?.isMaximized()?.then(setIsMaximized);
    const unsubscribe = window.docuflow?.onMaximizedChange(setIsMaximized);
    return () => { unsubscribe?.(); };
  }, []);

  const handleMinimize = useCallback(() => { window.docuflow?.minimize(); }, []);
  const handleMaximize = useCallback(() => { window.docuflow?.maximize(); }, []);
  const handleClose = useCallback(() => { window.docuflow?.close(); }, []);

  const handleBuild = useCallback(() => {
    const state = useDocuFlowStore.getState();
    const validation = validateCommands(state.commands, state.assets);
    if (!validation.valid) {
      console.info('Building timeline with warnings:', validation.errors.map((e) => e.message).join('; '));
    }
    const timeline = buildTimeline(state.commands, state.assets, state.settings);
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
          const tl = buildTimeline(currentState.commands, loadedAssets, currentState.settings);
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
      className="h-[36px] flex items-center bg-slate-900/80 backdrop-blur-md border-b border-white/5 select-none shrink-0"
      style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}
    >
      {/* Left: Logo + Title */}
      <div className="flex items-center gap-2 px-3 shrink-0">
        <div className="w-5 h-5 rounded bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center shadow-lg shadow-indigo-500/20">
          <span className="text-[9px] font-bold text-white">D</span>
        </div>
        <span className="text-[12px] font-bold tracking-wide">
          <span className="bg-gradient-to-r from-indigo-400 via-purple-400 to-pink-400 bg-clip-text text-transparent">Docu</span>
          <span className="text-slate-300">Flow</span>
        </span>
      </div>

      <div className="w-px h-4 bg-white/10 mx-1" />

      {/* Workspace Tab Switcher */}
      <div
        className="flex items-center bg-slate-800/60 rounded-lg border border-white/10 p-0.5"
        style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
      >
        <button
          onClick={() => setActiveTab('studio')}
          className={`flex items-center gap-1.5 px-3 py-1 rounded-md text-[11px] font-medium transition-all duration-150 ${
            activeTab === 'studio'
              ? 'bg-indigo-500/20 text-indigo-300 border border-indigo-500/30 shadow-sm'
              : 'text-slate-400 hover:text-white border border-transparent hover:border-white/10'
          }`}
        >
          <Film size={11} />
          <span>Timeline Studio</span>
        </button>
        <button
          onClick={() => setActiveTab('generator')}
          className={`flex items-center gap-1.5 px-3 py-1 rounded-md text-[11px] font-medium transition-all duration-150 ${
            activeTab === 'generator'
              ? 'bg-purple-500/20 text-purple-300 border border-purple-500/30 shadow-sm'
              : 'text-slate-400 hover:text-white border border-transparent hover:border-white/10'
          }`}
        >
          <Sparkles size={11} />
          <span>AI Image Generator</span>
        </button>
        <button
          onClick={() => setActiveTab('scenes')}
          className={`flex items-center gap-1.5 px-3 py-1 rounded-md text-[11px] font-medium transition-all duration-150 ${
            activeTab === 'scenes'
              ? 'bg-amber-500/20 text-amber-300 border border-amber-500/30 shadow-sm'
              : 'text-slate-400 hover:text-white border border-transparent hover:border-white/10'
          }`}
        >
          <Clapperboard size={11} />
          <span>AI Scene Generator</span>
        </button>
      </div>

      <div className="w-px h-4 bg-white/10 mx-1" />
      <div
        className="flex items-center gap-1"
        style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
      >
        <button
          onClick={handleBuild}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium bg-slate-800/60 hover:bg-slate-700/80 border border-white/10 text-slate-200 hover:text-white transition-all duration-150 active:scale-[0.97]"
          title="Build Timeline (Ctrl+B)"
        >
          <Play size={11} />
          <span>Build</span>
        </button>
        <button
          onClick={handleLoadDemo}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium bg-slate-800/60 hover:bg-slate-700/80 border border-white/10 text-slate-200 hover:text-white transition-all duration-150 active:scale-[0.97]"
          title="Load Demo Project"
        >
          <RotateCcw size={11} />
          <span>Demo</span>
        </button>

        <div className="w-px h-4 bg-white/10 mx-1" />

        <button
          onClick={undo}
          disabled={!canUndo}
          className="flex items-center justify-center w-[28px] h-[28px] rounded-md bg-slate-800/60 hover:bg-slate-700/80 border border-white/10 text-slate-400 hover:text-white transition-all duration-150 disabled:opacity-30 disabled:cursor-not-allowed active:scale-[0.97]"
          title="Undo (Ctrl+Z)"
        >
          <Undo2 size={12} />
        </button>
        <button
          onClick={redo}
          disabled={!canRedo}
          className="flex items-center justify-center w-[28px] h-[28px] rounded-md bg-slate-800/60 hover:bg-slate-700/80 border border-white/10 text-slate-400 hover:text-white transition-all duration-150 disabled:opacity-30 disabled:cursor-not-allowed active:scale-[0.97]"
          title="Redo (Ctrl+Shift+Z)"
        >
          <Redo2 size={12} />
        </button>

        <div className="w-px h-4 bg-white/10 mx-1" />

        {/* Panel toggles */}
        <button
          onClick={() => setPanelVisibility('assets', !panelVisibility.assets)}
          className={`flex items-center justify-center w-[28px] h-[28px] rounded-md border transition-all duration-150 active:scale-[0.97] ${
            panelVisibility.assets
              ? 'bg-indigo-500/20 border-indigo-500/30 text-indigo-300'
              : 'bg-slate-800/60 border-white/10 text-slate-500 hover:text-white hover:bg-slate-700/80'
          }`}
          title={panelVisibility.assets ? 'Hide Assets Panel' : 'Show Assets Panel'}
        >
          <PanelLeft size={12} />
        </button>
        <button
          onClick={() => setPanelVisibility('assetPreview', !panelVisibility.assetPreview)}
          className={`flex items-center justify-center w-[28px] h-[28px] rounded-md border transition-all duration-150 active:scale-[0.97] ${
            panelVisibility.assetPreview
              ? 'bg-indigo-500/20 border-indigo-500/30 text-indigo-300'
              : 'bg-slate-800/60 border-white/10 text-slate-500 hover:text-white hover:bg-slate-700/80'
          }`}
          title={panelVisibility.assetPreview ? 'Hide Asset Preview' : 'Show Asset Preview'}
        >
          <Image size={12} />
        </button>
        <button
          onClick={() => setPanelVisibility('inspector', !panelVisibility.inspector)}
          className={`flex items-center justify-center w-[28px] h-[28px] rounded-md border transition-all duration-150 active:scale-[0.97] ${
            panelVisibility.inspector
              ? 'bg-indigo-500/20 border-indigo-500/30 text-indigo-300'
              : 'bg-slate-800/60 border-white/10 text-slate-500 hover:text-white hover:bg-slate-700/80'
          }`}
          title={panelVisibility.inspector ? 'Hide Inspector' : 'Show Inspector'}
        >
          <SlidersHorizontal size={12} />
        </button>
      </div>

      {/* Spacer */}
      <div className="flex-1" />

      {/* Right: Resolution + Window Controls */}
      <div className="flex items-center gap-2 shrink-0">
        <div
          className="flex items-center gap-1.5 text-[10px] text-slate-500 font-mono mr-1"
          style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
        >
          <span>{settings.width}x{settings.height}</span>
          <span className="text-slate-600">@</span>
          <span>{settings.fps}fps</span>
        </div>

        <div
          className="flex items-center h-full"
          style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
        >
          <button
            onClick={handleMinimize}
            className="h-full w-[40px] flex items-center justify-center text-slate-400 hover:text-white hover:bg-white/5 transition-colors"
            aria-label="Minimize"
          >
            <Minus size={14} strokeWidth={1.5} />
          </button>
          <button
            onClick={handleMaximize}
            className="h-full w-[40px] flex items-center justify-center text-slate-400 hover:text-white hover:bg-white/5 transition-colors"
            aria-label={isMaximized ? 'Restore' : 'Maximize'}
          >
            {isMaximized ? <Square size={11} strokeWidth={1.5} /> : <Maximize2 size={12} strokeWidth={1.5} />}
          </button>
          <button
            onClick={handleClose}
            className="h-full w-[40px] flex items-center justify-center text-slate-400 hover:text-white hover:bg-red-500/80 transition-colors"
            aria-label="Close"
          >
            <X size={14} strokeWidth={1.5} />
          </button>
        </div>
      </div>
    </div>
  );
};
